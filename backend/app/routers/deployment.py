"""
Deployment API routes
"""
import logging
from typing import Dict, List, Union, Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.models.deployment import (
    DeploymentRequest,
    LambdaDeploymentRequest,
    AgentCoreDeploymentRequest,
    ECSFargateDeploymentRequest,
    DeploymentStatus,
    DeploymentResponse,
    DeploymentType,
    DeploymentHealthStatus,
    AgentCoreInvokeRequest,
    AgentCoreInvokeResponse,
    LambdaInvokeRequest,
    LambdaInvokeResponse
)
from app.services.deployment_service import DeploymentService
from app.services.agentcore_invoke_service import AgentCoreInvokeService
from app.services.lambda_invoke_service import LambdaInvokeService
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api/deploy", tags=["deployment"])

# Global service instances
deployment_service = DeploymentService()
agentcore_invoke_service = AgentCoreInvokeService()
lambda_invoke_service = LambdaInvokeService()

@router.post("/", response_model=DeploymentResponse)
async def deploy_agent(request: Union[LambdaDeploymentRequest, AgentCoreDeploymentRequest, ECSFargateDeploymentRequest]):
    """Deploy Strands agent to specified target"""
    logger.info(f"Deployment request: {request.deployment_type}")

    try:
        result = await deployment_service.deploy(request)
        return result
    except Exception as e:
        logger.error(f"Deployment error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# Backward compatibility endpoint for Lambda deployments
@router.post("/lambda", response_model=DeploymentResponse)
async def deploy_to_lambda(request: LambdaDeploymentRequest):
    """Deploy Strands agent to AWS Lambda (backward compatibility)"""
    logger.info(f"Lambda deployment request: {request.function_name}")

    try:
        result = await deployment_service.deploy_to_lambda(request)
        return result
    except Exception as e:
        logger.error(f"Lambda deployment error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/agentcore", response_model=DeploymentResponse)
async def deploy_to_agentcore(request: AgentCoreDeploymentRequest):
    """Deploy Strands agent to AgentCore"""
    logger.info(f"AgentCore deployment request: {request.agent_name}")

    try:
        result = await deployment_service.deploy_to_agentcore(request)
        return result
    except Exception as e:
        logger.error(f"AgentCore deployment error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ecs-fargate", response_model=DeploymentResponse)
async def deploy_to_ecs_fargate(request: ECSFargateDeploymentRequest):
    """Deploy Strands agent to ECS Fargate"""
    logger.info(f"ECS Fargate deployment request: {request.service_name}")

    try:
        result = await deployment_service.deploy_to_ecs_fargate(request)
        return result
    except Exception as e:
        logger.error(f"ECS Fargate deployment error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/{deployment_id}", response_model=DeploymentStatus)
async def get_deployment_status(deployment_id: str):
    """Get deployment status by ID"""
    logger.info(f"Getting deployment status: {deployment_id}")

    status = await deployment_service.get_deployment_status(deployment_id)
    if not status:
        raise HTTPException(status_code=404, detail="Deployment not found")

    return status

@router.get("/list", response_model=Dict[str, DeploymentStatus])
async def list_deployments():
    """List all deployments"""
    logger.info("Listing all deployments")
    return await deployment_service.list_deployments()

@router.delete("/cleanup")
async def cleanup_old_deployments(max_age_hours: int = 24):
    """Clean up old deployment records"""
    logger.info(f"Cleaning up deployments older than {max_age_hours} hours")

    deleted_count = await deployment_service.cleanup_old_deployments(max_age_hours)
    return {
        "message": f"Cleaned up {deleted_count} old deployment records",
        "deleted_count": deleted_count
    }

@router.delete("/{deployment_id}")
async def delete_deployment(deployment_id: str):
    """Delete deployment record"""
    logger.info(f"Deleting deployment: {deployment_id}")

    success = await deployment_service.delete_deployment(deployment_id)
    if not success:
        raise HTTPException(status_code=404, detail="Deployment not found")

    return {"message": "Deployment deleted successfully"}

# Health check for deployment service
@router.get("/health", response_model=DeploymentHealthStatus)
async def deployment_health():
    """Check deployment service health"""
    try:
        health_status = await deployment_service.get_health_status()
        return health_status
    except Exception as e:
        logger.error(f"Deployment health check failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/types")
async def get_deployment_types():
    """Get available deployment types and their requirements"""
    return {
        "deployment_types": [
            {
                "type": DeploymentType.LAMBDA,
                "name": "AWS Lambda",
                "description": "Serverless deployment using AWS Lambda",
                "status": "implemented",
                "requirements": ["SAM CLI", "AWS CLI", "AWS credentials"]
            },
            {
                "type": DeploymentType.AGENT_CORE,
                "name": "AgentCore",
                "description": "Deploy to AgentCore platform",
                "status": "planned",
                "requirements": ["AgentCore endpoint", "AgentCore credentials"]
            },
            {
                "type": DeploymentType.ECS_FARGATE,
                "name": "ECS Fargate",
                "description": "Containerized deployment using AWS ECS Fargate",
                "status": "planned",
                "requirements": ["Docker", "AWS CLI", "ECS cluster"]
            }
        ]
    }

# AgentCore invoke endpoint
@router.post("/agentcore/invoke")
async def invoke_agentcore_agent(request: AgentCoreInvokeRequest):
    """
    Invoke a deployed AgentCore agent

    Automatically detects response type based on AgentCore's contentType:
    - text/event-stream: Returns StreamingResponse (SSE format)
    - application/json: Returns AgentCoreInvokeResponse (JSON format)
    """
    logger.info(f"AgentCore invoke request: {request.agent_runtime_arn}")
    logger.info(f"Session ID: {request.runtime_session_id}")

    try:
        # Validate session ID
        if not agentcore_invoke_service.validate_session_id(request.runtime_session_id):
            raise HTTPException(
                status_code=400,
                detail="Session ID must be at least 33 characters long"
            )

        # Get raw response from AgentCore
        raw_response = await agentcore_invoke_service.invoke_agent_raw(request)

        # Determine response type based on user preference and contentType
        content_type = raw_response.get("contentType", "")
        logger.info(f"AgentCore response contentType: {content_type}")
        logger.info(f"User requested streaming: {request.enable_stream}")

        if request.enable_stream and "text/event-stream" in content_type:
            # User wants streaming and AgentCore supports it - return StreamingResponse
            logger.info("Returning streaming response (user requested + AgentCore supports)")
            return StreamingResponse(
                agentcore_invoke_service.parse_streaming_response(raw_response),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Cache-Control"
                }
            )
        elif "application/json" in content_type:
            # JSON response - return standard response
            logger.info("Returning JSON response")
            result = await agentcore_invoke_service.parse_json_response(raw_response)
            return result
        elif "text/event-stream" in content_type:
            # AgentCore returned streaming but user didn't request it - convert to JSON-like response
            logger.info("Converting streaming response to aggregated result (user didn't request streaming)")

            # Collect all streaming chunks
            chunks = []
            async for chunk in agentcore_invoke_service.parse_streaming_response(raw_response):
                if chunk.startswith("event: message\ndata: "):
                    data_part = chunk[len("event: message\ndata: "):-2]  # Remove SSE formatting
                    if data_part.strip():
                        chunks.append(data_part)

            # Return aggregated response
            aggregated_content = "".join(chunks)
            return AgentCoreInvokeResponse(
                success=True,
                response_data={"response": aggregated_content, "type": "aggregated_stream"},
                execution_time=None
            )
        else:
            # Unknown response type
            logger.error(f"Unsupported response content type: {content_type}")
            raise HTTPException(
                status_code=500,
                detail=f"Unsupported response content type: {content_type}"
            )

    except Exception as e:
        logger.error(f"AgentCore invoke error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/agentcore/generate-session-id")
async def generate_agentcore_session_id():
    """Generate a valid session ID for AgentCore invocation"""
    try:
        session_id = agentcore_invoke_service.generate_session_id()
        return {
            "session_id": session_id,
            "length": len(session_id),
            "valid": agentcore_invoke_service.validate_session_id(session_id)
        }
    except Exception as e:
        logger.error(f"Session ID generation error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/agentcore/{agent_runtime_arn:path}")
async def delete_agentcore_agent(agent_runtime_arn: str):
    """Delete AgentCore deployment and AWS resources"""
    logger.info(f"Deleting AgentCore agent: {agent_runtime_arn}")

    try:
        # Import AgentCore deployment service
        import sys
        from pathlib import Path

        # Add deployment module to path
        deployment_path = Path(__file__).parent.parent.parent / "deployment" / "agentcore"
        if str(deployment_path) not in sys.path:
            sys.path.insert(0, str(deployment_path))

        from agentcore_deployment_service import AgentCoreDeploymentService
        from agentcore_config import AgentCoreDeploymentConfig, DeploymentMethod, NetworkMode

        # Parse region from ARN for client initialization
        # ARN format: arn:aws:bedrock-agentcore:region:account:runtime/agent-name
        arn_parts = agent_runtime_arn.split(":")
        if len(arn_parts) < 6:
            raise HTTPException(status_code=400, detail="Invalid AgentCore ARN format")

        region = arn_parts[3]

        # Initialize AgentCore service
        agentcore_service = AgentCoreDeploymentService()

        # Delete the deployment by passing the full ARN
        result = await agentcore_service.delete_deployment(agent_runtime_arn, region)

        if result.success:
            return {
                "success": True,
                "message": result.message,
                "agent_runtime_arn": agent_runtime_arn,
                "logs": result.logs
            }
        else:
            raise HTTPException(status_code=500, detail=result.message)

    except Exception as e:
        logger.error(f"AgentCore deletion error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/lambda/{function_name}")
async def delete_lambda_agent(function_name: str, region: str = "us-east-1", stack_name: Optional[str] = None):
    """Delete Lambda deployment and AWS resources"""
    logger.info(f"Deleting Lambda agent: {function_name} in region: {region}")

    try:
        # Import Lambda deployment service
        import sys
        from pathlib import Path

        # Add deployment module to path
        deployment_path = Path(__file__).parent.parent.parent / "deployment" / "lambda"
        if str(deployment_path) not in sys.path:
            sys.path.insert(0, str(deployment_path))

        from lambda_deployment_service import LambdaDeploymentService, LambdaDeploymentConfig

        # Create deployment config for deletion
        config = LambdaDeploymentConfig(
            function_name=function_name,
            region=region,
            stack_name=stack_name or f"strands-agent-{function_name.lower()}"
        )

        # Initialize Lambda service
        lambda_service = LambdaDeploymentService()

        # Delete the deployment
        result = await lambda_service.delete_deployment(config)

        if result.success:
            # Clean up deployment history records for this Lambda function
            try:
                from app.services.storage_service import StorageService
                storage_service = StorageService()

                # Get all deployment history records for this function
                deployments = await storage_service.get_deployment_history()

                # Find and delete records matching this Lambda function
                deleted_count = 0
                for deployment in deployments:
                    if (deployment.get("deployment_target") == "lambda" and
                        deployment.get("agent_name") == function_name and
                        deployment.get("region") == region):

                        deployment_id = deployment.get("deployment_id")
                        if deployment_id:
                            try:
                                await storage_service.delete_deployment_history_item(deployment_id)
                                deleted_count += 1
                                logger.info(f"Deleted deployment history record: {deployment_id}")
                            except Exception as e:
                                logger.warning(f"Failed to delete deployment history record {deployment_id}: {e}")

                if deleted_count > 0:
                    logger.info(f"Cleaned up {deleted_count} deployment history records for {function_name}")

            except Exception as e:
                logger.warning(f"Failed to clean up deployment history for {function_name}: {e}")
                # Don't fail the entire deletion if history cleanup fails

            return {
                "success": True,
                "message": result.message,
                "function_name": function_name,
                "region": region,
                "stack_name": config.stack_name,
                "logs": result.logs
            }
        else:
            raise HTTPException(status_code=500, detail=result.message)

    except Exception as e:
        logger.error(f"Lambda deletion error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# Pydantic models for Function URL invocation
class FunctionUrlInvokeRequest(BaseModel):
    """Request model for Lambda Function URL invocation"""
    function_url: str
    payload: Dict
    region: Optional[str] = None
    timeout: Optional[float] = 30.0


# Lambda Function URL invoke endpoints (with AWS IAM authentication)
@router.post("/lambda/invoke-url", response_model=LambdaInvokeResponse)
async def invoke_lambda_function_url(request: FunctionUrlInvokeRequest):
    """Invoke a Lambda Function URL with AWS IAM authentication"""
    logger.info(f"Lambda Function URL invoke request: {request.function_url}")
    logger.info(f"Region: {request.region}")

    try:
        result = await lambda_invoke_service.invoke_function_url(
            function_url=request.function_url,
            payload=request.payload,
            region=request.region,
            timeout=request.timeout
        )
        return result
    except Exception as e:
        logger.error(f"Lambda Function URL invoke error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/lambda/invoke-url/stream")
async def invoke_lambda_function_url_stream(request: FunctionUrlInvokeRequest):
    """Invoke a Lambda Function URL with AWS IAM authentication (streaming)"""
    logger.info(f"Lambda Function URL streaming invoke request: {request.function_url}")
    logger.info(f"Region: {request.region}")

    try:
        return StreamingResponse(
            lambda_invoke_service.invoke_function_url_stream(
                function_url=request.function_url,
                payload=request.payload,
                region=request.region,
                timeout=request.timeout or 60.0
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Cache-Control"
            }
        )
    except Exception as e:
        logger.error(f"Lambda Function URL streaming invoke error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
