"""
AgentCore invoke service for calling deployed AgentCore agents
"""
import json
import time
import logging
from typing import Dict, Any, Optional, AsyncGenerator

import boto3
from botocore.exceptions import ClientError, BotoCoreError

from app.models.deployment import AgentCoreInvokeRequest, AgentCoreInvokeResponse
from app.utils.sse_formatter import SSEFormatter, StreamingError

logger = logging.getLogger(__name__)

class AgentCoreInvokeService:
    """Service for invoking deployed AgentCore agents"""
    
    def __init__(self):
        """Initialize the AgentCore invoke service"""
        self.clients = {}  # Cache for boto3 clients by region
        
    def _get_client(self, region: str):
        """Get or create a boto3 bedrock-agentcore client for the specified region"""
        if region not in self.clients:
            try:
                self.clients[region] = boto3.client('bedrock-agentcore', region_name=region)
                logger.info(f"Created bedrock-agentcore client for region: {region}")
            except Exception as e:
                logger.error(f"Failed to create bedrock-agentcore client for region {region}: {e}")
                raise
        return self.clients[region]
    
    async def invoke_agent_raw(self, request: AgentCoreInvokeRequest) -> Dict[str, Any]:
        """
        Invoke AgentCore agent and return raw response with contentType

        Args:
            request: AgentCore invoke request containing ARN, session ID, and payload

        Returns:
            Dict containing contentType, response, sessionId, and agentRuntimeArn
        """
        try:
            logger.info(f"Invoking AgentCore agent (raw): {request.agent_runtime_arn}")
            logger.info(f"Session ID: {request.runtime_session_id}")
            logger.info(f"Region: {request.region}")

            # Get the boto3 client for the specified region
            client = self._get_client(request.region)

            # Prepare the payload - based on test_invoke_streaming.py
            payload_json = json.dumps(request.payload).encode()
            logger.info(f"Payload: {payload_json}")

            # Invoke the agent
            response = client.invoke_agent_runtime(
                agentRuntimeArn=request.agent_runtime_arn,
                runtimeSessionId=request.runtime_session_id,
                payload=payload_json,
                qualifier=request.qualifier
            )

            logger.info(f"Response contentType: {response.get('contentType', 'unknown')}")

            return {
                "contentType": response.get("contentType", ""),
                "response": response.get("response", {}),
                "sessionId": response.get("sessionId", request.runtime_session_id),
                "agentRuntimeArn": request.agent_runtime_arn
            }

        except Exception as e:
            logger.error(f"Error in invoke_agent_raw: {str(e)}", exc_info=True)
            raise

    async def invoke_agent(self, request: AgentCoreInvokeRequest) -> AgentCoreInvokeResponse:
        """
        Invoke an AgentCore agent with the provided request
        
        Args:
            request: AgentCore invoke request containing ARN, session ID, and payload
            
        Returns:
            AgentCoreInvokeResponse with the agent's response or error information
        """
        start_time = time.time()
        
        try:
            logger.info(f"Invoking AgentCore agent: {request.agent_runtime_arn}")
            logger.info(f"Session ID: {request.runtime_session_id}")
            logger.info(f"Region: {request.region}")
            
            # Get the boto3 client for the specified region
            client = self._get_client(request.region)
            
            # Prepare the payload
            payload_json = json.dumps(request.payload)
            logger.info(f"Payload: {payload_json}")
            
            # Invoke the agent
            response = client.invoke_agent_runtime(
                agentRuntimeArn=request.agent_runtime_arn,
                runtimeSessionId=request.runtime_session_id,
                payload=payload_json,
                qualifier=request.qualifier
            )
            
            # Read and parse the response
            response_body = response['response'].read()
            response_data = json.loads(response_body)
            
            execution_time = time.time() - start_time
            
            logger.info(f"AgentCore invocation successful in {execution_time:.2f}s")
            logger.info(f"Response data: {response_data}")
            
            return AgentCoreInvokeResponse(
                success=True,
                response_data=response_data,
                execution_time=execution_time
            )
            
        except ClientError as e:
            execution_time = time.time() - start_time
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            error_message = e.response.get('Error', {}).get('Message', str(e))
            
            logger.error(f"AWS ClientError during AgentCore invocation: {error_code} - {error_message}")
            
            return AgentCoreInvokeResponse(
                success=False,
                error=f"AWS Error ({error_code}): {error_message}",
                execution_time=execution_time
            )
            
        except BotoCoreError as e:
            execution_time = time.time() - start_time
            logger.error(f"BotoCoreError during AgentCore invocation: {e}")
            
            return AgentCoreInvokeResponse(
                success=False,
                error=f"AWS Connection Error: {str(e)}",
                execution_time=execution_time
            )
            
        except json.JSONDecodeError as e:
            execution_time = time.time() - start_time
            logger.error(f"JSON decode error in AgentCore response: {e}")
            
            return AgentCoreInvokeResponse(
                success=False,
                error=f"Invalid JSON response from agent: {str(e)}",
                execution_time=execution_time
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            logger.error(f"Unexpected error during AgentCore invocation: {e}", exc_info=True)
            
            return AgentCoreInvokeResponse(
                success=False,
                error=f"Unexpected error: {str(e)}",
                execution_time=execution_time
            )
    
    def validate_session_id(self, session_id: str) -> bool:
        """
        Validate that the session ID meets AgentCore requirements
        
        Args:
            session_id: The session ID to validate
            
        Returns:
            True if valid, False otherwise
        """
        return len(session_id) >= 33
    
    def generate_session_id(self) -> str:
        """
        Generate a valid session ID for AgentCore

        Returns:
            A valid session ID (33+ characters)
        """
        import uuid
        import time

        # Generate a unique session ID using timestamp and UUID
        timestamp = str(int(time.time() * 1000))  # milliseconds
        uuid_part = str(uuid.uuid4()).replace('-', '')
        session_id = f"session_{timestamp}_{uuid_part}"

        # Ensure it's at least 33 characters
        if len(session_id) < 33:
            session_id = session_id + "0" * (33 - len(session_id))

        return session_id

    async def parse_streaming_response(self, raw_response: Dict[str, Any]) -> AsyncGenerator[str, None]:
        """
        Parse streaming response and generate SSE format data with text filtering
        Only extracts actual text content from contentBlockDelta events

        Args:
            raw_response: Raw response from invoke_agent_raw

        Yields:
            SSE formatted strings containing only text content
        """
        if "text/event-stream" not in raw_response.get("contentType", ""):
            raise ValueError("Response is not a streaming response")

        response_stream = raw_response["response"]

        try:
            logger.info("Starting to parse streaming response (text-only mode)")

            # Use iter_lines to read streaming data - based on test_invoke_streaming.py
            for line in response_stream.iter_lines(chunk_size=10):
                if line:
                    # Decode the line
                    decoded_line = line.decode('utf-8')
                    logger.debug(f"Received line: {decoded_line}")

                    # Process lines that start with "data: " - based on test logic
                    if decoded_line.startswith("data: "):
                        data_content = decoded_line[6:]  # Remove "data: " prefix
                        if data_content.strip():  # Only process non-empty data
                            # Try to extract text from contentBlockDelta events
                            text_content = self._extract_text_from_data(data_content)
                            if text_content:
                                # Format as SSE and yield only the text
                                sse_data = self._format_sse_data(text_content)
                                yield sse_data

        except Exception as e:
            logger.error(f"Error parsing streaming response: {str(e)}", exc_info=True)
            # Send error event
            error_sse = self._format_sse_data(f"Error: {str(e)}", "error")
            yield error_sse
        finally:
            # Send end event
            logger.info("Streaming response parsing completed")
            end_sse = self._format_sse_data("", "end")
            yield end_sse

    def _extract_text_from_data(self, data_content: str) -> Optional[str]:
        """
        Extract text content from streaming data
        Only returns text from contentBlockDelta events

        Args:
            data_content: Raw data content from SSE stream

        Returns:
            Extracted text content or None if not a text event
        """
        try:
            import json

            # Try to parse as JSON
            data_json = json.loads(data_content)

            # Check if this is a contentBlockDelta event with text
            if (isinstance(data_json, dict) and
                "event" in data_json and
                isinstance(data_json["event"], dict) and
                "contentBlockDelta" in data_json["event"] and
                isinstance(data_json["event"]["contentBlockDelta"], dict) and
                "delta" in data_json["event"]["contentBlockDelta"] and
                isinstance(data_json["event"]["contentBlockDelta"]["delta"], dict) and
                "text" in data_json["event"]["contentBlockDelta"]["delta"]):

                text_content = data_json["event"]["contentBlockDelta"]["delta"]["text"]
                logger.debug(f"Extracted text: {repr(text_content)}")
                return text_content

            # Ignore all other types of events (init_event_loop, start, metadata, etc.)
            return None

        except json.JSONDecodeError:
            # If it's not valid JSON, ignore it
            logger.debug(f"Ignoring non-JSON data: {data_content[:100]}...")
            return None
        except Exception as e:
            logger.debug(f"Error extracting text from data: {e}")
            return None

    async def parse_json_response(self, raw_response: Dict[str, Any]) -> AgentCoreInvokeResponse:
        """
        Parse JSON response and return AgentCoreInvokeResponse
        Based on test_invoke_streaming.py logic

        Args:
            raw_response: Raw response from invoke_agent_raw

        Returns:
            AgentCoreInvokeResponse with parsed data
        """
        if "application/json" not in raw_response.get("contentType", ""):
            raise ValueError("Response is not a JSON response")

        response_data = raw_response["response"]

        try:
            # Parse JSON response content - based on test logic
            content = []
            for chunk in response_data:
                content.append(chunk.decode('utf-8'))

            response_json = json.loads(''.join(content))

            logger.info(f"Parsed JSON response: {response_json}")

            return AgentCoreInvokeResponse(
                success=True,
                response_data=response_json,
                execution_time=None  # Will be calculated at route level
            )

        except Exception as e:
            logger.error(f"Error parsing JSON response: {str(e)}", exc_info=True)
            return AgentCoreInvokeResponse(
                success=False,
                error=f"Failed to parse JSON response: {str(e)}",
                execution_time=None
            )

    def _format_sse_data(self, data: str, event_type: str = "message") -> str:
        """
        Format data as Server-Sent Events (SSE) format

        Args:
            data: The data to send
            event_type: The event type (default: "message")

        Returns:
            SSE formatted string
        """
        return f"event: {event_type}\ndata: {data}\n\n"
