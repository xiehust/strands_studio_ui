"""
Deployment API routes
"""
import logging
from typing import Dict, List, Union
from fastapi import APIRouter, HTTPException, Depends

from app.models.deployment import (
    DeploymentRequest,
    LambdaDeploymentRequest,
    AgentCoreDeploymentRequest,
    ECSFargateDeploymentRequest,
    DeploymentStatus,
    DeploymentResponse,
    DeploymentType,
    DeploymentHealthStatus
)
from app.services.deployment_service import DeploymentService

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api/deploy", tags=["deployment"])

# Global deployment service instance
deployment_service = DeploymentService()

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