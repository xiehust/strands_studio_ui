"""
Deployment service that orchestrates different deployment types
"""
import logging
import uuid
from datetime import datetime
from typing import Dict, Any, Optional
from pathlib import Path

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

logger = logging.getLogger(__name__)

class DeploymentService:
    """Service that handles all deployment operations"""

    def __init__(self):
        self.deployments: Dict[str, DeploymentStatus] = {}

    async def deploy(self, request: DeploymentRequest) -> DeploymentResponse:
        """Deploy agent based on deployment type"""
        if request.deployment_type == DeploymentType.LAMBDA:
            return await self.deploy_to_lambda(request)
        elif request.deployment_type == DeploymentType.AGENT_CORE:
            return await self.deploy_to_agentcore(request)
        elif request.deployment_type == DeploymentType.ECS_FARGATE:
            return await self.deploy_to_ecs_fargate(request)
        else:
            raise ValueError(f"Unsupported deployment type: {request.deployment_type}")

    async def deploy_to_lambda(self, request: LambdaDeploymentRequest) -> DeploymentResponse:
        """Deploy Strands agent to AWS Lambda"""
        deployment_id = str(uuid.uuid4())

        # Create initial deployment status
        status = DeploymentStatus(
            deployment_id=deployment_id,
            deployment_type=DeploymentType.LAMBDA,
            status="pending",
            message="Lambda deployment initiated",
            created_at=datetime.now().isoformat()
        )

        self.deployments[deployment_id] = status

        logger.info(f"Starting Lambda deployment: {deployment_id}")

        try:
            # Import Lambda deployment service dynamically to avoid startup dependency
            import sys
            from pathlib import Path

            # Add deployment module to path
            deployment_path = Path(__file__).parent.parent.parent / "deployment" / "lambda"
            if str(deployment_path) not in sys.path:
                sys.path.insert(0, str(deployment_path))

            from lambda_deployment_service import (
                LambdaDeploymentService,
                LambdaDeploymentConfig
            )

            # Create deployment config
            config = LambdaDeploymentConfig(
                function_name=request.function_name,
                memory_size=request.memory_size,
                timeout=request.timeout,
                runtime=request.runtime,
                architecture=request.architecture,
                region=request.region,
                stack_name=request.stack_name,
                api_keys=request.api_keys
            )

            # Update status to building
            status.status = "building"
            status.message = "Building deployment package"
            self.deployments[deployment_id] = status

            # Initialize Lambda deployment service
            lambda_service = LambdaDeploymentService()

            # Update status to deploying
            status.status = "deploying"
            status.message = "Deploying to AWS Lambda"
            self.deployments[deployment_id] = status

            # Perform deployment
            result = await lambda_service.deploy_agent(request.code, config)

            # Update final status
            if result.success:
                status.status = "completed"
                status.message = result.message
                status.resource_arn = result.function_arn
                status.endpoint_url = result.api_endpoint
                status.deployment_time = result.deployment_time
                status.deployment_outputs = {
                    "function_arn": result.function_arn,
                    "api_endpoint": result.api_endpoint,
                    "function_name": request.function_name,
                    "region": request.region,
                    "memory_size": request.memory_size,
                    "timeout": request.timeout
                }
            else:
                status.status = "failed"
                status.message = result.message

            status.logs = result.logs
            status.completed_at = datetime.now().isoformat()
            self.deployments[deployment_id] = status

            logger.info(f"Lambda deployment completed: {deployment_id}, success: {result.success}")

            return DeploymentResponse(
                success=result.success,
                deployment_id=deployment_id,
                message=result.message,
                deployment_type=DeploymentType.LAMBDA,
                status=status
            )

        except ImportError as e:
            error_msg = f"Lambda deployment dependencies not available: {str(e)}"
            logger.error(error_msg)

            status.status = "failed"
            status.message = error_msg
            status.completed_at = datetime.now().isoformat()
            self.deployments[deployment_id] = status

            return DeploymentResponse(
                success=False,
                deployment_id=deployment_id,
                message=error_msg,
                status=status
            )

        except Exception as e:
            error_msg = f"Lambda deployment failed: {str(e)}"
            logger.error(error_msg, exc_info=True)

            status.status = "failed"
            status.message = error_msg
            status.completed_at = datetime.now().isoformat()
            self.deployments[deployment_id] = status

            return DeploymentResponse(
                success=False,
                deployment_id=deployment_id,
                message=error_msg,
                status=status
            )

    async def get_deployment_status(self, deployment_id: str) -> Optional[DeploymentStatus]:
        """Get deployment status by ID"""
        return self.deployments.get(deployment_id)

    async def list_deployments(self) -> Dict[str, DeploymentStatus]:
        """List all deployments"""
        return self.deployments.copy()

    async def delete_deployment(self, deployment_id: str) -> bool:
        """Delete deployment record"""
        if deployment_id in self.deployments:
            del self.deployments[deployment_id]
            return True
        return False

    async def cleanup_old_deployments(self, max_age_hours: int = 24):
        """Clean up old deployment records"""
        current_time = datetime.now()
        to_delete = []

        for deployment_id, status in self.deployments.items():
            created_time = datetime.fromisoformat(status.created_at)
            age_hours = (current_time - created_time).total_seconds() / 3600

            if age_hours > max_age_hours:
                to_delete.append(deployment_id)

        for deployment_id in to_delete:
            del self.deployments[deployment_id]

        logger.info(f"Cleaned up {len(to_delete)} old deployment records")
        return len(to_delete)

    async def deploy_to_agentcore(self, request: AgentCoreDeploymentRequest) -> DeploymentResponse:
        """Deploy Strands agent to AgentCore (placeholder implementation)"""
        deployment_id = str(uuid.uuid4())

        # Create initial deployment status
        status = DeploymentStatus(
            deployment_id=deployment_id,
            deployment_type=DeploymentType.AGENT_CORE,
            status="failed",
            message="AgentCore deployment not yet implemented",
            created_at=datetime.now().isoformat(),
            completed_at=datetime.now().isoformat()
        )

        self.deployments[deployment_id] = status

        logger.warning(f"AgentCore deployment not implemented: {deployment_id}")

        return DeploymentResponse(
            success=False,
            deployment_id=deployment_id,
            message="AgentCore deployment is not yet implemented",
            deployment_type=DeploymentType.AGENT_CORE,
            status=status
        )

    async def deploy_to_ecs_fargate(self, request: ECSFargateDeploymentRequest) -> DeploymentResponse:
        """Deploy Strands agent to ECS Fargate (placeholder implementation)"""
        deployment_id = str(uuid.uuid4())

        # Create initial deployment status
        status = DeploymentStatus(
            deployment_id=deployment_id,
            deployment_type=DeploymentType.ECS_FARGATE,
            status="failed",
            message="ECS Fargate deployment not yet implemented",
            created_at=datetime.now().isoformat(),
            completed_at=datetime.now().isoformat()
        )

        self.deployments[deployment_id] = status

        logger.warning(f"ECS Fargate deployment not implemented: {deployment_id}")

        return DeploymentResponse(
            success=False,
            deployment_id=deployment_id,
            message="ECS Fargate deployment is not yet implemented",
            deployment_type=DeploymentType.ECS_FARGATE,
            status=status
        )

    async def get_health_status(self) -> DeploymentHealthStatus:
        """Get deployment service health status"""
        try:
            available_types = [DeploymentType.LAMBDA]  # Start with Lambda as implemented
            tool_availability = {}

            # Check SAM CLI for Lambda deployments
            import subprocess
            try:
                result = subprocess.run(
                    ["sam", "--version"],
                    capture_output=True,
                    text=True,
                    check=True
                )
                tool_availability["sam_cli"] = {
                    "available": True,
                    "version": result.stdout.strip(),
                    "required_for": ["lambda"]
                }
            except (subprocess.CalledProcessError, FileNotFoundError):
                tool_availability["sam_cli"] = {
                    "available": False,
                    "version": None,
                    "required_for": ["lambda"]
                }

            # Check AWS CLI for Lambda deployments
            try:
                result = subprocess.run(
                    ["aws", "--version"],
                    capture_output=True,
                    text=True,
                    check=True
                )
                tool_availability["aws_cli"] = {
                    "available": True,
                    "version": result.stdout.strip(),
                    "required_for": ["lambda", "ecs-fargate"]
                }
            except (subprocess.CalledProcessError, FileNotFoundError):
                tool_availability["aws_cli"] = {
                    "available": False,
                    "version": None,
                    "required_for": ["lambda", "ecs-fargate"]
                }

            # Check Docker for ECS Fargate deployments
            try:
                result = subprocess.run(
                    ["docker", "--version"],
                    capture_output=True,
                    text=True,
                    check=True
                )
                tool_availability["docker"] = {
                    "available": True,
                    "version": result.stdout.strip(),
                    "required_for": ["ecs-fargate"]
                }
            except (subprocess.CalledProcessError, FileNotFoundError):
                tool_availability["docker"] = {
                    "available": False,
                    "version": None,
                    "required_for": ["ecs-fargate"]
                }

            # Determine overall service status
            lambda_ready = (
                tool_availability.get("sam_cli", {}).get("available", False) and
                tool_availability.get("aws_cli", {}).get("available", False)
            )

            if lambda_ready:
                service_status = "healthy"
            else:
                service_status = "partial"  # Some functionality available

            return DeploymentHealthStatus(
                service_status=service_status,
                active_deployments=len(self.deployments),
                available_deployment_types=available_types,
                tool_availability=tool_availability
            )

        except Exception as e:
            logger.error(f"Error checking deployment health: {e}")
            return DeploymentHealthStatus(
                service_status="unhealthy",
                active_deployments=len(self.deployments),
                available_deployment_types=[],
                tool_availability={}
            )