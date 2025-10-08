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

# Import deployment services
from deployment.agentcore.agentcore_deployment_service import AgentCoreDeploymentService

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
        deployment_id = request.deployment_id if request.deployment_id else str(uuid.uuid4())

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

        # Notify WebSocket clients about deployment start
        try:
            # Import the notify function
            import sys
            from pathlib import Path

            # Add main module to path to access the notify function
            main_path = Path(__file__).parent.parent.parent
            if str(main_path) not in sys.path:
                sys.path.insert(0, str(main_path))

            from main import notify_deployment_progress
            await notify_deployment_progress(deployment_id, "Preparing deployment package", "running")
        except Exception as e:
            logger.warning(f"Failed to send WebSocket notification: {e}")

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
                api_keys=request.api_keys,
                project_id=request.project_id,
                version=request.version
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
            result = await lambda_service.deploy_agent(request.code, config, deployment_id)

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
                    "timeout": request.timeout,
                    # Lambda deployment specific fields
                    "streaming_capable": getattr(result, 'streaming_capable', None),
                    "deployment_type": getattr(result, 'deployment_type', None),
                    "python_function_arn": getattr(result, 'python_function_arn', None),
                    "python_stream_function_arn": getattr(result, 'python_stream_function_arn', None),
                    "sync_function_url": getattr(result, 'sync_function_url', None),
                    "stream_function_url": getattr(result, 'stream_function_url', None)
                }
            else:
                status.status = "failed"
                status.message = result.message

            status.logs = result.logs
            status.completed_at = datetime.now().isoformat()
            self.deployments[deployment_id] = status

            # Save to persistent deployment history for Lambda deployments
            try:
                import httpx

                # Create deployment history item data
                history_item_data = {
                    "deployment_id": deployment_id,
                    "project_id": request.project_id or request.function_name,  # Use function_name as fallback project_id
                    "version": request.version or 'v1.0.0',
                    "deployment_target": 'lambda',
                    "agent_name": request.function_name,
                    "region": request.region,
                    "execute_role": None,  # Lambda doesn't use execute_role
                    "api_keys": request.api_keys or {},
                    "code": request.code,
                    "deployment_result": status.deployment_outputs or {},
                    "deployment_logs": '\n'.join(result.logs) if result.logs else '',
                    "success": result.success,
                    "error_message": None if result.success else result.message,
                    "created_at": status.created_at,
                    # Lambda deployment specific fields
                    "streaming_capable": getattr(result, 'streaming_capable', None),
                    "python_function_arn": getattr(result, 'python_function_arn', None),
                    "python_stream_function_arn": getattr(result, 'python_stream_function_arn', None),
                    "sync_function_url": getattr(result, 'sync_function_url', None),
                    "stream_function_url": getattr(result, 'stream_function_url', None),
                    # File paths - will be populated after successful deployment
                    "generated_agent_file": f"storage/deploy_history/lambda/{request.function_name}/{request.version or 'v1.0.0'}/deployment-{deployment_id[:8]}/generated_agent.py" if result.success else None,
                    "python_handler_file": f"storage/deploy_history/lambda/{request.function_name}/{request.version or 'v1.0.0'}/deployment-{deployment_id[:8]}/agent_handler_python.py" if result.success else None,
                    "nodejs_handler_file": f"storage/deploy_history/lambda/{request.function_name}/{request.version or 'v1.0.0'}/deployment-{deployment_id[:8]}/agent_handler_nodejs.js" if result.success else None
                }

                # Call the deployment history API endpoint directly
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        "http://localhost:8000/api/deployment-history",
                        json=history_item_data,
                        timeout=10.0
                    )

                    if response.status_code == 200:
                        logger.info(f"Lambda deployment saved to persistent storage: {deployment_id}")
                    else:
                        logger.error(f"Failed to save deployment history: HTTP {response.status_code}")

            except Exception as e:
                logger.error(f"Failed to save Lambda deployment to persistent storage: {e}")

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

    async def delete_ecs_fargate_stack(self, stack_name: str, region: str = "us-east-1") -> Dict[str, Any]:
        """Delete ECS Fargate CloudFormation stack"""
        logger.info(f"Starting ECS Fargate stack deletion: {stack_name}")

        try:
            # Import CloudFormation deployment service dynamically
            import sys
            from pathlib import Path

            # Add deployment module to path
            deployment_path = Path(__file__).parent.parent.parent / "deployment" / "ecs-fargate"
            if str(deployment_path) not in sys.path:
                sys.path.insert(0, str(deployment_path))

            from ecs_deployment_service import ECSDeploymentService

            # Create deployment service
            deployment_service = ECSDeploymentService()

            # Execute stack deletion
            deletion_result = await deployment_service.delete_stack(stack_name, region)

            logger.info(f"ECS Fargate stack deletion result: {deletion_result['success']}")
            return deletion_result

        except Exception as e:
            error_msg = f"ECS Fargate stack deletion failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return {
                "success": False,
                "message": error_msg,
                "stack_name": stack_name,
                "logs": [error_msg]
            }

    async def deploy_to_agentcore(self, request: AgentCoreDeploymentRequest) -> DeploymentResponse:
        """Deploy Strands agent to AWS Bedrock AgentCore"""
        deployment_id = str(uuid.uuid4())

        # Create initial deployment status
        status = DeploymentStatus(
            deployment_id=deployment_id,
            deployment_type=DeploymentType.AGENT_CORE,
            status="pending",
            message="AgentCore deployment initiated",
            created_at=datetime.now().isoformat()
        )

        self.deployments[deployment_id] = status

        logger.info(f"Starting AgentCore deployment: {deployment_id}")

        try:
            # Import AgentCore deployment service dynamically to avoid startup dependency
            import sys
            from pathlib import Path

            # Add deployment module to path
            deployment_path = Path(__file__).parent.parent.parent / "deployment" / "agentcore"
            if str(deployment_path) not in sys.path:
                sys.path.insert(0, str(deployment_path))

            # Import AgentCore deployment service
            from agentcore_deployment_service import (
                AgentCoreDeploymentService
            )
            from agentcore_config import (
                AgentCoreDeploymentConfig,
                DeploymentMethod,
                NetworkMode
            )

            # Create deployment config with simplified parameters and smart defaults
            config = AgentCoreDeploymentConfig(
                agent_runtime_name=request.agent_name,  # Use agent_name (normalized)
                region=request.region,
                deployment_method=DeploymentMethod.SDK,  # Always use SDK method
                network_mode=NetworkMode.PUBLIC,        # Default to PUBLIC
                api_keys=request.api_keys,              # Pass through API keys if provided
                streaming_capable=getattr(request, 'streaming_capable', None),  # Pass through streaming capability
                # All other parameters use defaults or are auto-generated
            )

            # Update status to building
            status.status = "building"
            status.message = "Building deployment package"
            self.deployments[deployment_id] = status

            # Initialize AgentCore deployment service
            agentcore_service = AgentCoreDeploymentService()

            # Update status to deploying
            status.status = "deploying"
            status.message = "Deploying to AWS Bedrock AgentCore"
            self.deployments[deployment_id] = status

            # Perform deployment
            result = await agentcore_service.deploy_agent(request.code, config)

            # Update final status
            if result.success:
                status.status = "completed"
                status.message = result.message
                status.resource_arn = result.agent_runtime_arn
                status.endpoint_url = result.invoke_endpoint
                status.deployment_time = result.deployment_time
                status.deployment_outputs = {
                    "agent_runtime_arn": result.agent_runtime_arn,
                    "agent_runtime_name": result.agent_runtime_name,
                    "invoke_endpoint": result.invoke_endpoint,
                    "deployment_method": "sdk",  # Always use SDK method in simplified API
                    "region": request.region,
                    "network_mode": "PUBLIC",  # Default network mode in simplified API
                    "streaming_capable": result.streaming_capable
                }
            else:
                status.status = "failed"
                status.message = result.message

            status.logs = result.logs
            status.completed_at = datetime.now().isoformat()
            self.deployments[deployment_id] = status

            logger.info(f"AgentCore deployment completed: {deployment_id}, success: {result.success}")

            return DeploymentResponse(
                success=result.success,
                deployment_id=deployment_id,
                message=result.message,
                deployment_type=DeploymentType.AGENT_CORE,
                status=status
            )

        except Exception as e:
            error_msg = f"AgentCore deployment failed: {str(e)}"
            logger.error(error_msg, exc_info=True)

            status.status = "failed"
            status.message = error_msg
            status.completed_at = datetime.now().isoformat()
            self.deployments[deployment_id] = status

            return DeploymentResponse(
                success=False,
                deployment_id=deployment_id,
                message=error_msg,
                deployment_type=DeploymentType.AGENT_CORE,
                status=status
            )

    async def deploy_to_ecs_fargate(self, request: ECSFargateDeploymentRequest) -> DeploymentResponse:
        """Deploy Strands agent to ECS Fargate"""
        deployment_id = request.deployment_id if request.deployment_id else str(uuid.uuid4())

        # Create initial deployment status
        status = DeploymentStatus(
            deployment_id=deployment_id,
            deployment_type=DeploymentType.ECS_FARGATE,
            status="pending",
            message="ECS Fargate deployment initiated",
            created_at=datetime.now().isoformat()
        )

        self.deployments[deployment_id] = status

        logger.info(f"Starting ECS Fargate deployment: {deployment_id}")

        # Notify WebSocket clients about deployment start immediately
        try:
            from main import notify_deployment_progress
            await notify_deployment_progress(deployment_id, "Initializing ECS deployment", "running",
                                           f"Starting deployment for service: {request.service_name}")
        except Exception as e:
            logger.warning(f"Failed to send WebSocket notification: {e}")

        try:
            # Import ECS deployment service dynamically
            import sys
            from pathlib import Path

            # Add deployment module to path
            deployment_path = Path(__file__).parent.parent.parent / "deployment" / "ecs-fargate"
            if str(deployment_path) not in sys.path:
                sys.path.insert(0, str(deployment_path))

            from ecs_deployment_service import (
                ECSDeploymentService,
                ECSDeploymentConfig
            )

            # Create deployment config
            config = ECSDeploymentConfig(
                service_name=request.service_name,
                cpu=request.cpu,
                memory=request.memory,
                architecture=request.architecture,
                region=request.region,
                container_name=request.container_name,
                container_port=request.container_port,
                vpc_id=request.vpc_id,
                subnet_ids=request.subnet_ids,
                security_group_ids=request.security_group_ids,
                assign_public_ip=request.assign_public_ip,
                desired_count=request.desired_count,
                health_check_path=request.health_check_path,
                project_id=request.project_id,
                version=request.version,
                execution_role_arn=request.execution_role_arn,
                task_role_arn=request.task_role_arn,
                api_keys=request.api_keys  # Pass API keys to ECS config
            )

            # Create ECS deployment service
            deployment_service = ECSDeploymentService()

            # Execute deployment
            deployment_result = await deployment_service.deploy_agent(
                generated_code=request.code,
                config=config,
                deployment_id=deployment_id
            )

            # Update deployment status
            if deployment_result.success:
                status.status = "completed"
                status.message = deployment_result.message
                status.endpoint_url = deployment_result.service_endpoint
                status.resource_arn = deployment_result.service_arn
                status.deployment_outputs = deployment_result.deployment_outputs
                status.logs = deployment_result.logs
                status.deployment_time = deployment_result.deployment_time
                status.completed_at = datetime.now().isoformat()

                logger.info(f"ECS Fargate deployment successful: {deployment_id}")

                return DeploymentResponse(
                    success=True,
                    deployment_id=deployment_id,
                    message=deployment_result.message,
                    deployment_type=DeploymentType.ECS_FARGATE,
                    status=status
                )
            else:
                status.status = "failed"
                status.message = deployment_result.message
                status.logs = deployment_result.logs
                status.completed_at = datetime.now().isoformat()

                logger.error(f"ECS Fargate deployment failed: {deployment_id}: {deployment_result.message}")

                return DeploymentResponse(
                    success=False,
                    deployment_id=deployment_id,
                    message=deployment_result.message,
                    deployment_type=DeploymentType.ECS_FARGATE,
                    status=status
                )

        except Exception as e:
            error_msg = f"ECS Fargate deployment failed: {str(e)}"
            logger.error(error_msg, exc_info=True)

            status.status = "failed"
            status.message = error_msg
            status.completed_at = datetime.now().isoformat()

            # Notify failure
            try:
                from main import notify_deployment_progress
                await notify_deployment_progress(deployment_id, "Deployment failed", "error", str(e))
            except:
                pass

            return DeploymentResponse(
                success=False,
                deployment_id=deployment_id,
                message=error_msg,
                deployment_type=DeploymentType.ECS_FARGATE,
                status=status
            )

    async def get_health_status(self) -> DeploymentHealthStatus:
        """Get deployment service health status"""
        try:
            available_types = [DeploymentType.LAMBDA]  # Lambda is implemented
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
                    "required_for": ["lambda", "agentcore", "ecs-fargate"]
                }
            except (subprocess.CalledProcessError, FileNotFoundError):
                tool_availability["aws_cli"] = {
                    "available": False,
                    "version": None,
                    "required_for": ["lambda", "agentcore", "ecs-fargate"]
                }

            # Check bedrock-agentcore for AgentCore deployments
            try:
                import bedrock_agentcore
                tool_availability["bedrock_agentcore"] = {
                    "available": True,
                    "version": getattr(bedrock_agentcore, '__version__', 'unknown'),
                    "required_for": ["agentcore"]
                }
            except ImportError:
                tool_availability["bedrock_agentcore"] = {
                    "available": False,
                    "version": None,
                    "required_for": ["agentcore"]
                }

            # Check Docker for ECS Fargate and AgentCore manual deployments
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
                    "required_for": ["ecs-fargate", "agentcore-manual"]
                }
            except (subprocess.CalledProcessError, FileNotFoundError):
                tool_availability["docker"] = {
                    "available": False,
                    "version": None,
                    "required_for": ["ecs-fargate", "agentcore-manual"]
                }

            # Determine overall service status
            lambda_ready = (
                tool_availability.get("sam_cli", {}).get("available", False) and
                tool_availability.get("aws_cli", {}).get("available", False)
            )

            agentcore_ready = (
                tool_availability.get("aws_cli", {}).get("available", False) and
                tool_availability.get("bedrock_agentcore", {}).get("available", False)
            )

            # Add AgentCore to available types if tools are ready
            if agentcore_ready:
                available_types.append(DeploymentType.AGENT_CORE)

            if lambda_ready and agentcore_ready:
                service_status = "healthy"
            elif lambda_ready or agentcore_ready:
                service_status = "partial"
            else:
                service_status = "degraded"  # Limited functionality available

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