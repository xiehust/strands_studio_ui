"""
ECS invoke service for calling deployed ECS Fargate services
Supports both synchronous and streaming invocation via HTTP endpoints
"""
import json
import time
import logging
import asyncio
from typing import Dict, Any, Optional, AsyncGenerator
from urllib.parse import urlparse

import aiohttp
from botocore.exceptions import ClientError, BotoCoreError

from app.models.deployment import ECSInvokeRequest, ECSInvokeResponse

logger = logging.getLogger(__name__)

class ECSInvokeService:
    """Service for invoking deployed ECS Fargate services"""

    def __init__(self):
        """Initialize the ECS invoke service"""
        self.session_timeout = aiohttp.ClientTimeout(total=300)  # 5 minutes default timeout

    async def invoke_service(self, request: ECSInvokeRequest) -> ECSInvokeResponse:
        """
        Invoke an ECS service synchronously

        Args:
            request: ECS invoke request containing endpoint URL and payload

        Returns:
            ECSInvokeResponse with the service's response or error information
        """
        start_time = time.time()

        try:
            logger.info(f"Invoking ECS service: {request.service_endpoint}")

            # Prepare the request
            endpoint_url = self._ensure_invoke_endpoint(request.service_endpoint)
            payload = self._prepare_payload(request.payload)

            logger.info(f"Resolved sync endpoint URL: {endpoint_url}")
            logger.info(f"Payload prepared for sync: {json.dumps(payload, default=str)}")

            headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Strands-Studio-ECS-Client/1.0'
            }

            # Make the HTTP request
            async with aiohttp.ClientSession(timeout=self.session_timeout) as session:
                async with session.post(
                    url=endpoint_url,
                    headers=headers,
                    json=payload
                ) as response:

                    response_text = await response.text()
                    execution_time = time.time() - start_time

                    if response.status == 200:
                        try:
                            result = json.loads(response_text)
                            return ECSInvokeResponse(
                                success=True,
                                response_data=result,
                                status_code=response.status,
                                execution_time=execution_time,
                                execution_context={
                                    'invocation_via': 'ECS Service HTTP',
                                    'service_endpoint': request.service_endpoint,
                                    'endpoint_url': endpoint_url
                                }
                            )
                        except json.JSONDecodeError:
                            # Return as text if not JSON
                            return ECSInvokeResponse(
                                success=True,
                                response_data=response_text,
                                status_code=response.status,
                                execution_time=execution_time,
                                execution_context={
                                    'invocation_via': 'ECS Service HTTP (text response)',
                                    'service_endpoint': request.service_endpoint,
                                    'endpoint_url': endpoint_url
                                }
                            )
                    else:
                        # Handle HTTP error responses
                        return ECSInvokeResponse(
                            success=False,
                            error=f"HTTP {response.status}: {response_text}",
                            status_code=response.status,
                            execution_time=execution_time,
                            execution_context={
                                'invocation_via': 'ECS Service HTTP (error)',
                                'service_endpoint': request.service_endpoint,
                                'endpoint_url': endpoint_url
                            }
                        )

        except asyncio.TimeoutError:
            execution_time = time.time() - start_time
            logger.error(f"ECS service invocation timeout: {request.service_endpoint}")

            return ECSInvokeResponse(
                success=False,
                error="Request timeout - ECS service did not respond in time",
                execution_time=execution_time,
                execution_context={
                    'invocation_via': 'ECS Service HTTP (timeout)',
                    'service_endpoint': request.service_endpoint
                }
            )

        except aiohttp.ClientError as e:
            execution_time = time.time() - start_time
            logger.error(f"HTTP client error during ECS invocation: {e}")

            return ECSInvokeResponse(
                success=False,
                error=f"HTTP client error: {str(e)}",
                execution_time=execution_time,
                execution_context={
                    'invocation_via': 'ECS Service HTTP (client error)',
                    'service_endpoint': request.service_endpoint
                }
            )

        except Exception as e:
            execution_time = time.time() - start_time
            logger.error(f"Unexpected error during ECS invocation: {e}", exc_info=True)

            return ECSInvokeResponse(
                success=False,
                error=f"Unexpected error: {str(e)}",
                execution_time=execution_time,
                execution_context={
                    'invocation_via': 'ECS Service HTTP (unexpected error)',
                    'service_endpoint': request.service_endpoint
                }
            )

    async def invoke_service_stream(self, request: ECSInvokeRequest) -> AsyncGenerator[str, None]:
        """
        Invoke an ECS service with streaming response

        Args:
            request: ECS invoke request with streaming enabled

        Yields:
            SSE formatted strings containing streaming data
        """
        try:
            logger.info(f"Invoking ECS service (streaming): {request.service_endpoint}")

            # Prepare the request
            endpoint_url = self._ensure_stream_endpoint(request.service_endpoint)
            payload = self._prepare_payload(request.payload)

            logger.info(f"Resolved streaming endpoint URL: {endpoint_url}")
            logger.info(f"Payload prepared for streaming: {json.dumps(payload, default=str)}")

            headers = {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'User-Agent': 'Strands-Studio-ECS-Client/1.0'
            }

            # Make the streaming HTTP request
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=600)) as session:
                async with session.post(
                    url=endpoint_url,
                    headers=headers,
                    json=payload
                ) as response:

                    if response.status != 200:
                        error_text = await response.text()
                        yield self._format_sse_error(f"HTTP {response.status}: {error_text}")
                        return

                    # Process streaming response
                    hasReceivedData = False
                    async for line in response.content:
                        decoded_line = line.decode('utf-8').strip()

                        if decoded_line.startswith('data: '):
                            hasReceivedData = True
                            # Forward the original SSE data directly to preserve format
                            yield f"{decoded_line}\n\n"
                        elif decoded_line.strip() == '' and hasReceivedData:
                            # Forward empty lines (part of SSE format)
                            yield "\n"

        except asyncio.TimeoutError:
            logger.error(f"ECS streaming invocation timeout: {request.service_endpoint}")
            yield self._format_sse_error("Request timeout - ECS service did not respond in time")

        except Exception as e:
            logger.error(f"Error in ECS streaming invocation: {str(e)}", exc_info=True)
            yield self._format_sse_error(f"Streaming error: {str(e)}")

        finally:
            # Always send end event
            yield self._format_sse_data("", "end")

    def _ensure_invoke_endpoint(self, service_endpoint: str) -> str:
        """Ensure the endpoint URL points to the invoke endpoint"""
        # Ensure HTTP protocol
        endpoint = self._ensure_http_protocol(service_endpoint)

        if endpoint.endswith('/'):
            return f"{endpoint}invoke"
        else:
            return f"{endpoint}/invoke"

    def _ensure_stream_endpoint(self, service_endpoint: str) -> str:
        """Ensure the endpoint URL points to the stream endpoint"""
        # Ensure HTTP protocol
        endpoint = self._ensure_http_protocol(service_endpoint)

        if endpoint.endswith('/'):
            return f"{endpoint}invoke-stream"
        else:
            return f"{endpoint}/invoke-stream"

    def _prepare_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare the payload for ECS service invocation"""
        # Ensure required fields are present
        prepared_payload = {
            "prompt": payload.get('prompt', payload.get('user_input', '')),
            "input_data": payload.get('input_data'),
            "api_keys": payload.get('api_keys', {}),
            "user_input": payload.get('user_input', payload.get('prompt', '')),
            "messages": payload.get('messages')
        }

        # Remove None values
        return {k: v for k, v in prepared_payload.items() if v is not None}

    def _ensure_http_protocol(self, service_endpoint: str) -> str:
        """Ensure the service endpoint has proper HTTP protocol"""
        if not service_endpoint.startswith(('http://', 'https://')):
            # Add HTTP protocol if missing (ECS ALB typically uses HTTP)
            return f"http://{service_endpoint}"
        else:
            # Use the original protocol
            return service_endpoint

    def _format_sse_data(self, data: str, event_type: str = "message") -> str:
        """Format data as Server-Sent Events (SSE)"""
        return f"event: {event_type}\ndata: {data}\n\n"

    def _format_sse_error(self, error_message: str) -> str:
        """Format error as SSE"""
        return f"event: error\ndata: {error_message}\n\n"

    def validate_service_endpoint(self, endpoint: str) -> bool:
        """
        Validate that the service endpoint is properly formatted

        Args:
            endpoint: The service endpoint URL

        Returns:
            True if valid, False otherwise
        """
        try:
            parsed = urlparse(endpoint)
            return bool(parsed.scheme and parsed.netloc)
        except Exception:
            return False