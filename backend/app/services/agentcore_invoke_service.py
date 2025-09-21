"""
AgentCore invoke service for calling deployed AgentCore agents
"""
import json
import time
import logging
from typing import Dict, Any, Optional

import boto3
from botocore.exceptions import ClientError, BotoCoreError

from app.models.deployment import AgentCoreInvokeRequest, AgentCoreInvokeResponse

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
