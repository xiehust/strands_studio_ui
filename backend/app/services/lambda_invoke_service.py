"""
Lambda invoke service for calling deployed Lambda functions
Supports both AWS SDK invocation and AWS IAM authenticated Function URLs
"""
import json
import time
import logging
import asyncio
from typing import Dict, Any, Optional, AsyncGenerator
from urllib.parse import urlparse

import boto3
import aiohttp
from botocore.exceptions import ClientError, BotoCoreError
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

from app.models.deployment import LambdaInvokeRequest, LambdaInvokeResponse

logger = logging.getLogger(__name__)

class LambdaInvokeService:
    """Service for invoking deployed Lambda functions"""

    def __init__(self):
        """Initialize the Lambda invoke service"""
        self.clients = {}  # Cache for boto3 clients by region
        # Initialize boto3 session to get credentials for Function URL signing
        self.session = boto3.Session()
        self.credentials = self.session.get_credentials()

    def _get_client(self, region: str):
        """Get or create a boto3 lambda client for the specified region"""
        if region not in self.clients:
            try:
                self.clients[region] = boto3.client('lambda', region_name=region)
                logger.info(f"Created lambda client for region: {region}")
            except Exception as e:
                logger.error(f"Failed to create lambda client for region {region}: {e}")
                raise
        return self.clients[region]

    def _sign_request(self, method: str, url: str, headers: Dict[str, str], body: str, region: str) -> Dict[str, str]:
        """Sign the request using AWS SigV4 for Function URL access"""
        try:
            # Create AWS request object
            request = AWSRequest(
                method=method.upper(),
                url=url,
                data=body.encode('utf-8') if body else None,
                headers=headers.copy()
            )

            # Sign the request using SigV4
            signer = SigV4Auth(self.credentials, 'lambda', region)
            signer.add_auth(request)

            # Return the signed headers
            return dict(request.headers)

        except Exception as e:
            logger.error(f"Failed to sign request: {e}")
            raise Exception(f"AWS signature failed: {str(e)}")

    def _get_function_region_from_url(self, function_url: str) -> str:
        """Extract AWS region from Lambda Function URL"""
        try:
            # Lambda Function URLs have format: https://<url-id>.lambda-url.<region>.on.aws/
            parsed = urlparse(function_url)
            host_parts = parsed.hostname.split('.')

            # Find lambda-url part and get the region that follows
            for i, part in enumerate(host_parts):
                if part == 'lambda-url' and i + 1 < len(host_parts):
                    return host_parts[i + 1]

            # Default fallback
            logger.warning(f"Could not extract region from Function URL: {function_url}, using us-east-1")
            return 'us-east-1'

        except Exception as e:
            logger.error(f"Failed to extract region from URL {function_url}: {e}")
            return 'us-east-1'  # Safe fallback

    # Note: invoke_function method removed - replaced with invoke_function_url
    # for better integration with dual-function deployments

    # Note: invoke_function_stream method removed - replaced with invoke_function_url_stream
    # for better integration with dual-function deployments


    async def invoke_function_url(
        self,
        function_url: str,
        payload: Dict[str, Any],
        region: Optional[str] = None,
        timeout: float = 30.0
    ) -> LambdaInvokeResponse:
        """Invoke a Lambda Function URL with AWS IAM authentication (non-streaming)"""
        start_time = time.time()

        try:
            # Extract region from URL if not provided
            if not region:
                region = self._get_function_region_from_url(function_url)

            logger.info(f"Invoking Lambda Function URL: {function_url}")
            logger.info(f"Region: {region}")

            # Prepare request
            method = 'POST'
            body = json.dumps(payload)
            headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }

            # Sign the request
            signed_headers = self._sign_request(method, function_url, headers, body, region)

            # Make the request
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
                async with session.request(
                    method=method,
                    url=function_url,
                    headers=signed_headers,
                    data=body
                ) as response:

                    response_text = await response.text()
                    execution_time = time.time() - start_time

                    if response.status == 200:
                        try:
                            result = json.loads(response_text)
                            return LambdaInvokeResponse(
                                success=True,
                                response_data=result,
                                status_code=response.status,
                                execution_time=execution_time,
                                execution_context={
                                    'invocation_via': 'AWS IAM authenticated Function URL',
                                    'function_url': function_url
                                }
                            )
                        except json.JSONDecodeError:
                            return LambdaInvokeResponse(
                                success=True,
                                response_data=response_text,  # Return as text if not JSON
                                status_code=response.status,
                                execution_time=execution_time,
                                execution_context={
                                    'invocation_via': 'AWS IAM authenticated Function URL',
                                    'function_url': function_url
                                }
                            )
                    else:
                        logger.error(f"Lambda Function URL invocation failed: HTTP {response.status} - {response_text}")
                        return LambdaInvokeResponse(
                            success=False,
                            error=f"HTTP {response.status}: {response_text}",
                            status_code=response.status,
                            execution_time=execution_time
                        )

        except asyncio.TimeoutError:
            execution_time = time.time() - start_time
            logger.error(f"Lambda Function URL invocation timeout after {timeout}s")
            return LambdaInvokeResponse(
                success=False,
                error=f"Request timeout after {timeout} seconds",
                execution_time=execution_time
            )
        except Exception as e:
            execution_time = time.time() - start_time
            logger.error(f"Lambda Function URL invocation failed: {e}")
            return LambdaInvokeResponse(
                success=False,
                error=str(e),
                execution_time=execution_time
            )

    async def invoke_function_url_stream(
        self,
        function_url: str,
        payload: Dict[str, Any],
        region: Optional[str] = None,
        timeout: float = 60.0
    ) -> AsyncGenerator[str, None]:
        """Invoke a Lambda Function URL with AWS IAM authentication (streaming)"""
        try:
            # Extract region from URL if not provided
            if not region:
                region = self._get_function_region_from_url(function_url)

            # Add the streaming endpoint path to the Function URL
            stream_url = function_url.rstrip('/') + '/invoke/stream'

            logger.info(f"Starting streaming invocation of Lambda Function URL: {stream_url}")

            # Prepare request
            method = 'POST'
            body = json.dumps(payload)
            headers = {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            }

            # Sign the request using the complete streaming URL
            signed_headers = self._sign_request(method, stream_url, headers, body, region)

            # Make the streaming request
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
                async with session.request(
                    method=method,
                    url=stream_url,
                    headers=signed_headers,
                    data=body
                ) as response:

                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Lambda Function URL streaming invocation failed: HTTP {response.status} - {error_text}")
                        yield f"data: Error: HTTP {response.status}: {error_text}\n\n"
                        return

                    # Check if this is actually a streaming response
                    content_type = response.headers.get('content-type', '')
                    if 'text/event-stream' in content_type:
                        # Handle Server-Sent Events (SSE) streaming
                        async for line in response.content:
                            line_text = line.decode('utf-8', errors='ignore')
                            if line_text.strip():
                                yield line_text
                    else:
                        # Handle response stream (chunked response)
                        buffer = b''
                        async for chunk in response.content.iter_chunked(1024):
                            buffer += chunk

                            # Try to decode and yield complete chunks
                            try:
                                text = buffer.decode('utf-8')
                                buffer = b''
                                if text.strip():
                                    # Format as SSE for consistent frontend handling
                                    for line in text.split('\n'):
                                        if line.strip():
                                            yield f"data: {line}\n\n"
                            except UnicodeDecodeError:
                                # Keep accumulating bytes until we have a complete UTF-8 sequence
                                continue

                        # Handle any remaining buffer
                        if buffer:
                            try:
                                text = buffer.decode('utf-8', errors='ignore')
                                if text.strip():
                                    yield f"data: {text}\n\n"
                            except Exception:
                                pass

                    # Send completion signal
                    yield "data: [STREAM_COMPLETE]\n\n"

        except asyncio.TimeoutError:
            logger.error(f"Lambda Function URL streaming invocation timeout after {timeout}s")
            yield f"data: Error: Request timeout after {timeout} seconds\n\n"
        except Exception as e:
            logger.error(f"Lambda Function URL streaming invocation failed: {e}")
            yield f"data: Error: {str(e)}\n\n"


# We need to import asyncio for the sleep function
import asyncio