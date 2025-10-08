"""
ECS Fargate Deployment Service
Handles containerization and deployment of Strands agents to AWS ECS Fargate.
Supports both direct API and CloudFormation deployment methods with cross-compilation.
"""
import os
import json
import shutil
import logging
import tempfile
import subprocess
import asyncio
import platform
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict
from enum import Enum
import boto3
from botocore.exceptions import ClientError, BotoCoreError

from container_build_service import ContainerBuildService

logger = logging.getLogger(__name__)

class DeploymentMethod(Enum):
    """Deployment method options"""
    CLOUDFORMATION = "cloudformation"

@dataclass
class ECSDeploymentConfig:
    """Configuration for ECS Fargate deployment"""
    service_name: str
    cpu: int = 1024  # 1 vCPU
    memory: int = 2048  # 2 GB (minimum for 1024 CPU)
    architecture: str = "x86_64"
    region: str = "us-east-1"
    container_name: str = "strands-agent"
    container_port: int = 8000
    desired_count: int = 1
    # ALB and logging are always enabled
    health_check_path: str = "/health"
    project_id: Optional[str] = None
    version: Optional[str] = None
    assign_public_ip: bool = True

    # Container build options
    enable_cross_compile: bool = True
    container_image: Optional[str] = None  # If provided, skip building

    # Advanced options
    vpc_id: Optional[str] = None
    subnet_ids: Optional[List[str]] = None
    security_group_ids: Optional[List[str]] = None
    execution_role_arn: Optional[str] = None
    task_role_arn: Optional[str] = None

    # CloudFormation specific
    stack_name: Optional[str] = None
    streaming_capable: bool = False

    # API Keys
    api_keys: Optional[Dict[str, str]] = None

@dataclass
class ECSDeploymentResult:
    """Result of an ECS deployment operation"""
    success: bool
    message: str
    service_arn: Optional[str] = None
    service_name: Optional[str] = None
    cluster_arn: Optional[str] = None
    task_definition_arn: Optional[str] = None
    load_balancer_dns: Optional[str] = None
    service_endpoint: Optional[str] = None
    logs: Optional[List[str]] = None
    deployment_time: Optional[float] = None
    deployment_outputs: Optional[Dict[str, Any]] = None
    streaming_capable: Optional[bool] = None

    # CloudFormation specific
    stack_name: Optional[str] = None
    stack_id: Optional[str] = None
    stack_status: Optional[str] = None

class ECSDeploymentService:
    """Unified service for deploying Strands agents to AWS ECS Fargate with cross-compilation support"""

    def __init__(self, base_deployment_dir: str = None):
        """
        Initialize the ECS deployment service.

        Args:
            base_deployment_dir: Base directory for deployment templates
        """
        if base_deployment_dir is None:
            base_deployment_dir = Path(__file__).parent
        self.base_deployment_dir = Path(base_deployment_dir)

        # Template paths
        self.cloudformation_template_path = self.base_deployment_dir / "cloudformation-template.yaml"
        self.dockerfile_path = self.base_deployment_dir / "Dockerfile"
        self.agent_server_template_path = self.base_deployment_dir / "agent_server.py"
        self.requirements_path = self.base_deployment_dir / "requirements.txt"

        # AWS clients cache
        self.clients = {}

        # Container build service for cross-compilation
        self.container_build_service = ContainerBuildService()

    def _get_client(self, service_name: str, region: str):
        """Get or create AWS client for specified service and region"""
        client_key = f"{service_name}_{region}"
        if client_key not in self.clients:
            self.clients[client_key] = boto3.client(service_name, region_name=region)
        return self.clients[client_key]

    def detect_streaming_capability(self, generated_code: str) -> bool:
        """
        Detect if the generated code has streaming capabilities
        """
        # Look for streaming patterns
        has_stream_async_call = 'agent.stream_async(' in generated_code
        has_async_for_stream = 'async for' in generated_code and 'stream_async' in generated_code
        has_yield = 'yield' in generated_code

        streaming_capable = has_stream_async_call or has_async_for_stream or has_yield

        logger.info(f"ECS streaming capability detection - stream_async_call: {has_stream_async_call}, "
                   f"async_for_stream: {has_async_for_stream}, yield: {has_yield}, final: {streaming_capable}")
        return streaming_capable

    def should_use_cross_compilation(self, target_architecture: str) -> bool:
        """
        Determine if cross-compilation is needed based on host vs target architecture
        """
        # Get host architecture
        host_machine = platform.machine().lower()

        # Normalize architecture names
        if host_machine in ['x86_64', 'amd64']:
            host_arch = 'x86_64'
        elif host_machine in ['aarch64', 'arm64']:
            host_arch = 'arm64'
        else:
            # Unknown architecture, assume cross-compilation needed
            logger.warning(f"Unknown host architecture: {host_machine}, assuming cross-compilation needed")
            return True

        # Normalize target architecture
        target_arch = target_architecture.lower()
        if target_arch not in ['x86_64', 'arm64']:
            logger.warning(f"Unknown target architecture: {target_architecture}, assuming cross-compilation needed")
            return True

        needs_cross_compilation = host_arch != target_arch
        logger.info(f"Cross-compilation check: host={host_arch}, target={target_arch}, needs_cross_compilation={needs_cross_compilation}")

        return needs_cross_compilation

    async def deploy_agent(
        self,
        generated_code: str,
        config: ECSDeploymentConfig,
        deployment_id: str = None
    ) -> ECSDeploymentResult:
        """
        Deploy a Strands agent to AWS ECS Fargate.

        Args:
            generated_code: The Python code generated from the visual flow
            config: Deployment configuration
            deployment_id: Optional deployment ID for WebSocket notifications

        Returns:
            ECSDeploymentResult with deployment status and details
        """
        # Generate stack name
        if not config.stack_name:
            # Use shorter prefix and ensure target group name (stack_name + "-tg") is <= 32 chars
            # Max stack name length = 32 - 3 ("-tg") = 29 characters
            short_prefix = "sae"  # strands-agent-ecs abbreviated
            max_service_name_length = 29 - len(short_prefix) - 1  # -1 for the dash
            service_name = config.service_name[:max_service_name_length] if len(config.service_name) > max_service_name_length else config.service_name
            config.stack_name = f"{short_prefix}-{service_name}"

        # Detect streaming capability
        config.streaming_capable = self.detect_streaming_capability(generated_code)

        # Automatically determine if cross-compilation is needed
        config.enable_cross_compile = self.should_use_cross_compilation(config.architecture)

        logger.info(f"Starting ECS Fargate CloudFormation deployment: {config.service_name}")
        logger.info(f"Deployment configuration: CPU={config.cpu}, Memory={config.memory}, "
                   f"Architecture={config.architecture}, CrossCompile={config.enable_cross_compile}, "
                   f"Region={config.region}, DesiredCount={config.desired_count} (ALB and Logging always enabled)")

        return await self._deploy_with_cloudformation(generated_code, config, deployment_id)

    async def _deploy_with_cloudformation(
        self,
        generated_code: str,
        config: ECSDeploymentConfig,
        deployment_id: str = None
    ) -> ECSDeploymentResult:
        """Deploy using CloudFormation method"""
        start_time = datetime.now()
        deployment_logs = []

        try:
            # Helper function to send WebSocket notifications
            async def notify_progress(step: str, status: str, message: str = None):
                if deployment_id:
                    try:
                        # Import notification function dynamically to avoid circular imports
                        import sys
                        if '/home/ubuntu/strands_studio_ui/backend' not in sys.path:
                            sys.path.append('/home/ubuntu/strands_studio_ui/backend')

                        from main import notify_deployment_progress
                        await notify_deployment_progress(deployment_id, step, status, message)
                    except Exception as e:
                        logger.warning(f"Failed to send WebSocket notification: {e}")

            # Send immediate deployment start notification
            await notify_progress("Starting ECS deployment", "running",
                                f"Deploying to cluster: {config.stack_name}")

            # Step 1: Validate prerequisites
            await notify_progress("Validating prerequisites", "running")
            logger.info(f"Validating prerequisites for {config.service_name}")
            self._validate_prerequisites(config)
            deployment_logs.append("Prerequisites validated")
            logger.info("Prerequisites validation completed successfully")
            await notify_progress("Validating prerequisites", "completed")

            # Step 2: Analyze code capabilities
            await notify_progress("Analyzing code capabilities", "running")
            logger.info(f"Analyzing code capabilities for streaming detection")
            deployment_logs.append(f"Streaming capability detected: {config.streaming_capable}")
            logger.info(f"Code analysis completed - streaming_capable: {config.streaming_capable}")
            await notify_progress("Analyzing code capabilities", "completed")

            # Step 3: Build and push Docker image
            await notify_progress("Building Docker image", "running", "Preparing build context...")
            image_uri = await self._build_and_push_image(generated_code, config, deployment_logs, notify_progress, deployment_id)
            deployment_logs.append(f"Docker image built and pushed: {image_uri}")
            await notify_progress("Building Docker image", "completed", f"Image ready: {image_uri.split('/')[-1]}")

            # Step 4: Deploy CloudFormation stack
            deploy_step_name = f"Deploying CloudFormation stack '{config.stack_name}'"
            await notify_progress(deploy_step_name, "running", f"Creating/updating stack: {config.stack_name}")
            stack_result = await self._deploy_cloudformation_stack(image_uri, config, deployment_logs, notify_progress, deploy_step_name)
            deployment_logs.append("CloudFormation stack deployed successfully")
            await notify_progress(deploy_step_name, "completed", f"Stack '{config.stack_name}' deployed successfully")

            # Step 5: Wait for stack completion (skip if no changes)
            if stack_result.get('no_changes'):
                await notify_progress("Waiting for stack completion", "completed", f"Stack '{config.stack_name}' already up-to-date - no provisioning needed")
            else:
                await notify_progress("Waiting for stack completion", "running", f"Provisioning AWS resources for stack: {config.stack_name}")
                await self._wait_for_stack_completion(config.stack_name, config.region, deployment_logs, notify_progress)
                await notify_progress("Waiting for stack completion", "completed", f"All resources created successfully for stack: {config.stack_name}")

            # Step 6: Get stack outputs
            await notify_progress("Retrieving deployment outputs", "running")
            stack_outputs = await self._get_stack_outputs(config.stack_name, config.region)
            deployment_logs.append("Retrieved stack outputs")
            await notify_progress("Retrieving deployment outputs", "completed")

            deployment_time = (datetime.now() - start_time).total_seconds()
            deployment_logs.append(f"CloudFormation ECS deployment completed in {deployment_time:.2f}s")

            logger.info(f"CloudFormation ECS Fargate deployment successful: {config.service_name}")

            # Create enhanced success message with cluster name and endpoint (sync or stream based on capability)
            cluster_name = stack_outputs.get('ClusterName', config.service_name)
            service_endpoint = stack_outputs.get('ServiceEndpoint', '')

            if service_endpoint:
                if config.streaming_capable:
                    # Stream-only mode: main endpoint is the stream URL
                    endpoint_url = f"{service_endpoint}/invoke-stream"
                    success_message = f"""🚀 ECS Cluster: {cluster_name}

📡 Stream Endpoint: {endpoint_url}"""
                else:
                    # Sync-only mode: main endpoint is the sync URL
                    endpoint_url = f"{service_endpoint}/invoke"
                    success_message = f"""🚀 ECS Cluster: {cluster_name}

📡 Sync Endpoint: {endpoint_url}"""
            else:
                success_message = f"🚀 ECS Cluster: {cluster_name} - Deployment completed successfully"

            # Save deployment to structured storage (like Lambda)
            await self._save_deployment_to_storage(deployment_id, config, generated_code, deployment_logs, stack_outputs, True)

            return ECSDeploymentResult(
                success=True,
                message=success_message,
                stack_name=config.stack_name,
                stack_id=stack_result.get('stack_id'),
                stack_status=stack_result.get('stack_status'),
                service_arn=stack_outputs.get('ServiceArn'),
                service_name=stack_outputs.get('ServiceName'),
                cluster_arn=stack_outputs.get('ClusterArn'),
                task_definition_arn=stack_outputs.get('TaskDefinitionArn'),
                load_balancer_dns=stack_outputs.get('LoadBalancerDNS'),
                service_endpoint=stack_outputs.get('ServiceEndpoint'),
                logs=deployment_logs,
                deployment_time=deployment_time,
                deployment_outputs=stack_outputs,
                streaming_capable=config.streaming_capable
            )

        except Exception as e:
            error_msg = f"CloudFormation ECS deployment failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            deployment_logs.append(error_msg)

            # Save failed deployment to structured storage
            await self._save_deployment_to_storage(deployment_id, config, generated_code, deployment_logs, {}, False, str(e))

            # Notify failure
            if deployment_id:
                try:
                    from main import notify_deployment_progress
                    await notify_deployment_progress(deployment_id, "Deployment failed", "error", str(e))
                except:
                    pass

            return ECSDeploymentResult(
                success=False,
                message=error_msg,
                stack_name=config.stack_name,
                logs=deployment_logs,
                deployment_time=(datetime.now() - start_time).total_seconds()
            )


    def _validate_prerequisites(self, config: ECSDeploymentConfig):
        """Validate that required tools and permissions are available"""
        # Check Docker
        try:
            result = subprocess.run(
                ["docker", "--version"],
                capture_output=True,
                text=True,
                check=True
            )
            logger.info(f"Docker version: {result.stdout.strip()}")
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise RuntimeError("Docker is not installed or not in PATH")

        # Check AWS CLI
        try:
            result = subprocess.run(
                ["aws", "--version"],
                capture_output=True,
                text=True,
                check=True
            )
            logger.info(f"AWS CLI version: {result.stdout.strip()}")
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise RuntimeError("AWS CLI is not installed or not in PATH")

        # Validate CPU/Memory combination for Fargate
        self._validate_fargate_cpu_memory(config.cpu, config.memory)

        # Validate configuration
        self._validate_configuration(config)

    def _validate_fargate_cpu_memory(self, cpu: int, memory: int):
        """Validate CPU/Memory combination against Fargate requirements"""
        # Fargate CPU/Memory combinations
        valid_combinations = {
            256: [512, 1024, 2048],
            512: [1024, 2048, 3072, 4096],
            1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
            2048: [4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384],
            4096: list(range(8192, 30721, 1024))  # 8192 to 30720 in 1024 increments
        }

        if cpu not in valid_combinations:
            raise ValueError(f"Invalid CPU value: {cpu}. Must be one of {list(valid_combinations.keys())}")

        if memory not in valid_combinations[cpu]:
            raise ValueError(f"Invalid memory value {memory} for CPU {cpu}. Valid values: {valid_combinations[cpu]}")

    def _validate_configuration(self, config: ECSDeploymentConfig):
        """Validate deployment configuration"""
        # Validate container port
        if not (1 <= config.container_port <= 65535):
            raise ValueError(f"Invalid container port {config.container_port}. Must be between 1 and 65535")

        # Validate service name
        if not config.service_name or len(config.service_name) > 32:
            raise ValueError("Service name must be provided and not exceed 32 characters")

        # Validate region
        if not config.region:
            raise ValueError("AWS region must be specified")

        # Validate stack name
        if not config.stack_name:
            raise ValueError("Stack name must be specified")

    async def _build_and_push_image(self, generated_code: str, config: ECSDeploymentConfig, logs: List[str], notify_progress, deployment_id: str = None) -> str:
        """Build Docker image with cross-compilation support and push to ECR"""
        try:
            # Check if container image is already provided
            if config.container_image:
                logs.append(f"Using provided container image: {config.container_image}")
                await notify_progress("Building Docker image", "running", f"Using provided image: {config.container_image}")
                return config.container_image

            # Get AWS account ID for ECR URI
            await notify_progress("Building Docker image", "running", "Getting AWS account information...")
            sts_client = boto3.client('sts', region_name=config.region)
            account_id = sts_client.get_caller_identity()['Account']
            logs.append(f"AWS Account ID: {account_id}")

            # Check Docker availability if cross-compilation is enabled
            if config.enable_cross_compile:
                await notify_progress("Building Docker image", "running", "Checking Docker Buildx availability...")
                docker_status = await self.container_build_service.check_docker_availability()

                if not docker_status["docker_available"]:
                    logs.append("Docker not available, falling back to single-arch build")
                    config.enable_cross_compile = False
                elif not docker_status["buildx_available"]:
                    logs.append("Docker Buildx not available, falling back to single-arch build")
                    config.enable_cross_compile = False
                else:
                    logs.append(f"Docker Buildx available with platforms: {docker_status.get('platforms_supported', [])}")

            # Build and push image using container build service
            if config.enable_cross_compile:
                await notify_progress("Building Docker image", "running",
                                   f"Building multi-architecture image for {config.architecture} (first time may take 10-15 minutes, please be patient)...")
            else:
                await notify_progress("Building Docker image", "running",
                                   f"Building single-architecture image for {config.architecture}...")

            # Create enhanced progress callback that includes build logs
            async def enhanced_notify_progress(step, status, message=""):
                # Get recent build logs if available
                build_logs = []
                if deployment_id:
                    build_logs = self.container_build_service.get_recent_build_logs(deployment_id, 10)

                # Call original notify with enhanced message
                if build_logs and step == "Building Docker image" and status == "running":
                    log_tail = "\n".join(build_logs[-3:]) if len(build_logs) > 0 else ""
                    enhanced_message = f"{message}"
                    if log_tail:
                        enhanced_message += f"\n\nRecent build output:\n{log_tail}"
                    await notify_progress(step, status, enhanced_message)
                else:
                    await notify_progress(step, status, message)

            image_uri = await self.container_build_service.build_and_push_image(
                agent_code=generated_code,
                service_name=config.service_name,
                architecture=config.architecture,
                region=config.region,
                account_id=account_id,
                enable_cross_compile=config.enable_cross_compile,
                progress_callback=enhanced_notify_progress,
                deployment_id=deployment_id
            )

            logs.append(f"Successfully built and pushed image: {image_uri}")
            await notify_progress("Building Docker image", "completed", f"Image ready: {image_uri.split('/')[-1]}")

            return image_uri

        except Exception as e:
            logs.append(f"Container build failed: {str(e)}")
            await notify_progress("Building Docker image", "failed", f"Build failed: {str(e)}")
            raise RuntimeError(f"Failed to build container image: {str(e)}")

    async def _deploy_cloudformation_stack(self, image_uri: str, config: ECSDeploymentConfig, logs: List[str], notify_progress, deploy_step_name: str = "Deploying CloudFormation stack") -> Dict[str, Any]:
        """Deploy CloudFormation stack"""
        try:
            cf_client = self._get_client('cloudformation', config.region)
            await notify_progress(deploy_step_name, "running", f"Reading CloudFormation template for stack: {config.stack_name}")

            # Read CloudFormation template
            with open(self.cloudformation_template_path, 'r') as f:
                template_body = f.read()

            # Prepare parameters
            await notify_progress(deploy_step_name, "running", "Preparing stack parameters...")
            parameters = [
                {'ParameterKey': 'ServiceName', 'ParameterValue': config.service_name},
                {'ParameterKey': 'ContainerImage', 'ParameterValue': image_uri},
                {'ParameterKey': 'CPU', 'ParameterValue': str(config.cpu)},
                {'ParameterKey': 'Memory', 'ParameterValue': str(config.memory)},
                {'ParameterKey': 'Region', 'ParameterValue': config.region},
                {'ParameterKey': 'ContainerName', 'ParameterValue': config.container_name},
                {'ParameterKey': 'ContainerPort', 'ParameterValue': str(config.container_port)},
                {'ParameterKey': 'DesiredCount', 'ParameterValue': str(config.desired_count)},
                # ALB and logging are always enabled in the simplified template
                {'ParameterKey': 'HealthCheckPath', 'ParameterValue': config.health_check_path},
                {'ParameterKey': 'AssignPublicIp', 'ParameterValue': 'ENABLED' if config.assign_public_ip else 'DISABLED'},
                {'ParameterKey': 'StreamingCapable', 'ParameterValue': str(config.streaming_capable).lower()},
                {'ParameterKey': 'Architecture', 'ParameterValue': config.architecture},
            ]
            await notify_progress(deploy_step_name, "running", f"Configured {len(parameters)} base parameters")

            # Add optional parameters
            optional_params = []
            if config.project_id:
                parameters.append({'ParameterKey': 'ProjectId', 'ParameterValue': config.project_id})
                optional_params.append(f"ProjectId={config.project_id}")
            if config.version:
                parameters.append({'ParameterKey': 'Version', 'ParameterValue': config.version})
                optional_params.append(f"Version={config.version}")
            if config.vpc_id:
                parameters.append({'ParameterKey': 'VpcId', 'ParameterValue': config.vpc_id})
                optional_params.append(f"VpcId={config.vpc_id}")
            if config.subnet_ids:
                subnet_str = ','.join(config.subnet_ids)
                parameters.append({'ParameterKey': 'SubnetIds', 'ParameterValue': subnet_str})
                optional_params.append(f"SubnetIds={subnet_str}")
            if config.security_group_ids:
                sg_str = ','.join(config.security_group_ids)
                parameters.append({'ParameterKey': 'SecurityGroupIds', 'ParameterValue': sg_str})
                optional_params.append(f"SecurityGroupIds={sg_str}")
            if config.execution_role_arn:
                parameters.append({'ParameterKey': 'ExecutionRoleArn', 'ParameterValue': config.execution_role_arn})
                optional_params.append(f"ExecutionRoleArn={config.execution_role_arn}")
            if config.task_role_arn:
                parameters.append({'ParameterKey': 'TaskRoleArn', 'ParameterValue': config.task_role_arn})
                optional_params.append(f"TaskRoleArn={config.task_role_arn}")

            # Add API key parameters if provided
            if config.api_keys:
                # Check for OpenAI API key (support both formats: OPENAI_API_KEY and openai_api_key)
                openai_key = config.api_keys.get('OPENAI_API_KEY') or config.api_keys.get('openai_api_key')
                if openai_key and openai_key.strip():
                    parameters.append({'ParameterKey': 'OpenAIApiKey', 'ParameterValue': openai_key})
                    optional_params.append("OpenAIApiKey=***REDACTED***")  # Don't log the actual key

                # Check for Anthropic API key (support both formats: ANTHROPIC_API_KEY and anthropic_api_key)
                anthropic_key = config.api_keys.get('ANTHROPIC_API_KEY') or config.api_keys.get('anthropic_api_key')
                if anthropic_key and anthropic_key.strip():
                    parameters.append({'ParameterKey': 'AnthropicApiKey', 'ParameterValue': anthropic_key})
                    optional_params.append("AnthropicApiKey=***REDACTED***")  # Don't log the actual key

            if optional_params:
                await notify_progress(deploy_step_name, "running", f"Added {len(optional_params)} optional parameters")
                logger.info(f"Optional parameters: {', '.join(optional_params)}")
            else:
                await notify_progress(deploy_step_name, "running", "Using default values for optional parameters")
                logger.info("No optional parameters provided, using defaults")

            # If no VPC ID provided, get the default VPC
            if not config.vpc_id:
                await notify_progress(deploy_step_name, "running", "Getting default VPC information...")
                ec2_client = self._get_client('ec2', config.region)
                vpcs_response = ec2_client.describe_vpcs(Filters=[{'Name': 'isDefault', 'Values': ['true']}])
                if vpcs_response['Vpcs']:
                    default_vpc_id = vpcs_response['Vpcs'][0]['VpcId']
                    config.vpc_id = default_vpc_id
                    parameters.append({'ParameterKey': 'VpcId', 'ParameterValue': default_vpc_id})
                    logs.append(f"Using default VPC: {default_vpc_id}")
                    await notify_progress(deploy_step_name, "running", f"Found default VPC: {default_vpc_id}")
                else:
                    raise RuntimeError("No default VPC found in this region")

            # If no subnet IDs provided, get default subnets
            if not config.subnet_ids:
                await notify_progress(deploy_step_name, "running", "Getting default subnet information...")
                subnets_response = ec2_client.describe_subnets(
                    Filters=[
                        {'Name': 'vpc-id', 'Values': [config.vpc_id]},
                        {'Name': 'default-for-az', 'Values': ['true']}
                    ]
                )
                if subnets_response['Subnets']:
                    default_subnet_ids = [subnet['SubnetId'] for subnet in subnets_response['Subnets']]
                    config.subnet_ids = default_subnet_ids
                    subnet_str = ','.join(default_subnet_ids)
                    parameters.append({'ParameterKey': 'SubnetIds', 'ParameterValue': subnet_str})
                    logs.append(f"Using default subnets: {subnet_str}")
                    await notify_progress(deploy_step_name, "running", f"Found {len(default_subnet_ids)} default subnets")
                else:
                    raise RuntimeError("No default subnets found in the VPC")

            logger.info(f"CloudFormation parameters prepared: {len(parameters)} total parameters")
            # Log parameter keys (but not sensitive values)
            param_keys = [p['ParameterKey'] for p in parameters]
            logger.info(f"Parameter keys being passed to CloudFormation: {param_keys}")

            # Check if stack exists and handle failed stacks
            await notify_progress(deploy_step_name, "running", f"Checking if stack '{config.stack_name}' exists...")
            try:
                response = cf_client.describe_stacks(StackName=config.stack_name)
                stack = response['Stacks'][0]
                stack_status = stack['StackStatus']

                # Handle failed stacks - delete them and recreate
                if stack_status in ['CREATE_FAILED', 'ROLLBACK_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE']:
                    logs.append(f"Stack {config.stack_name} is in failed state ({stack_status}), deleting and recreating...")
                    await notify_progress(deploy_step_name, "running", f"Stack '{config.stack_name}' in failed state - cleaning up...")

                    # Delete the failed stack
                    cf_client.delete_stack(StackName=config.stack_name)

                    # Wait for deletion to complete
                    deletion_wait_time = 0
                    max_deletion_wait = 600  # 10 minutes
                    while deletion_wait_time < max_deletion_wait:
                        try:
                            cf_client.describe_stacks(StackName=config.stack_name)
                            await asyncio.sleep(30)
                            deletion_wait_time += 30
                            await notify_progress(deploy_step_name, "running", f"Waiting for stack deletion ({deletion_wait_time//60}m {deletion_wait_time%60}s)...")
                        except ClientError as delete_e:
                            if 'does not exist' in str(delete_e):
                                break
                            else:
                                raise

                    stack_exists = False
                    logs.append(f"Failed stack deleted, creating new stack: {config.stack_name}")
                    await notify_progress(deploy_step_name, "running", f"Stack cleaned up - preparing new creation...")
                else:
                    stack_exists = True
                    logs.append(f"Stack {config.stack_name} exists with status {stack_status}, updating...")
                    await notify_progress(deploy_step_name, "running", f"Found existing stack '{config.stack_name}' ({stack_status}) - preparing update...")

            except ClientError as e:
                if 'does not exist' in str(e):
                    stack_exists = False
                    logs.append(f"Creating new stack: {config.stack_name}")
                    await notify_progress(deploy_step_name, "running", f"Stack '{config.stack_name}' doesn't exist - preparing creation...")
                else:
                    raise

            # Deploy or update stack
            if stack_exists:
                await notify_progress(deploy_step_name, "running", "Submitting stack update to CloudFormation...")
                try:
                    response = cf_client.update_stack(
                        StackName=config.stack_name,
                        TemplateBody=template_body,
                        Parameters=parameters,
                        Capabilities=['CAPABILITY_NAMED_IAM']
                    )
                    stack_id = response['StackId']
                    logs.append(f"Stack update initiated: {stack_id}")
                    await notify_progress(deploy_step_name, "running", "Stack update submitted successfully")
                except ClientError as e:
                    if 'No updates are to be performed' in str(e):
                        # Stack is already up-to-date, this is not an error
                        logs.append("Stack is already up-to-date - no changes needed")
                        await notify_progress(deploy_step_name, "running", "Stack is already up-to-date")

                        # Get existing stack info
                        stack_info = cf_client.describe_stacks(StackName=config.stack_name)
                        stack_id = stack_info['Stacks'][0]['StackId']

                        return {
                            'stack_id': stack_id,
                            'stack_status': 'UPDATE_COMPLETE',  # Treat as already complete
                            'no_changes': True
                        }
                    else:
                        raise
            else:
                await notify_progress(deploy_step_name, "running", "Submitting stack creation to CloudFormation...")
                response = cf_client.create_stack(
                    StackName=config.stack_name,
                    TemplateBody=template_body,
                    Parameters=parameters,
                    Capabilities=['CAPABILITY_NAMED_IAM'],
                    EnableTerminationProtection=False
                )
                stack_id = response['StackId']
                logs.append(f"Stack creation initiated: {stack_id}")
                await notify_progress(deploy_step_name, "running", "Stack creation submitted successfully")

            return {
                'stack_id': stack_id,
                'stack_status': 'CREATE_IN_PROGRESS' if not stack_exists else 'UPDATE_IN_PROGRESS'
            }

        except ClientError as e:
            # Handle specific AWS client errors
            if 'No updates are to be performed' in str(e):
                # This should have been handled above, but just in case
                logs.append("Stack is already up-to-date - no changes needed")
                stack_info = cf_client.describe_stacks(StackName=config.stack_name)
                stack_id = stack_info['Stacks'][0]['StackId']
                return {
                    'stack_id': stack_id,
                    'stack_status': 'UPDATE_COMPLETE',
                    'no_changes': True
                }
            else:
                logs.append(f"CloudFormation deployment failed: {str(e)}")
                raise RuntimeError(f"Failed to deploy CloudFormation stack: {str(e)}")
        except Exception as e:
            logs.append(f"CloudFormation deployment failed: {str(e)}")
            raise RuntimeError(f"Failed to deploy CloudFormation stack: {str(e)}")

    async def _wait_for_stack_completion(self, stack_name: str, region: str, logs: List[str], notify_progress):
        """Wait for CloudFormation stack to complete"""
        try:
            cf_client = self._get_client('cloudformation', region)

            max_wait_time = 1800  # 30 minutes
            wait_interval = 30    # 30 seconds
            elapsed_time = 0

            logs.append("Waiting for CloudFormation stack to complete...")
            await notify_progress("Waiting for stack completion", "running", "Starting to monitor stack deployment progress...")

            while elapsed_time < max_wait_time:
                try:
                    response = cf_client.describe_stacks(StackName=stack_name)
                    stack = response['Stacks'][0]
                    status = stack['StackStatus']

                    logs.append(f"Stack status: {status}")

                    # Provide detailed progress messages based on status
                    if status in ['CREATE_IN_PROGRESS', 'UPDATE_IN_PROGRESS']:
                        minutes_elapsed = int(elapsed_time // 60)
                        seconds_elapsed = int(elapsed_time % 60)

                        # Provide different messages based on elapsed time
                        if minutes_elapsed == 0:
                            await notify_progress("Waiting for stack completion", "running",
                                               f"Creating AWS resources ({seconds_elapsed}s)...")
                        elif minutes_elapsed == 1:
                            await notify_progress("Waiting for stack completion", "running",
                                               f"Setting up VPC and networking ({minutes_elapsed}m {seconds_elapsed}s)...")
                        elif minutes_elapsed <= 3:
                            await notify_progress("Waiting for stack completion", "running",
                                               f"Creating ECS cluster and service ({minutes_elapsed}m {seconds_elapsed}s)...")
                        elif minutes_elapsed <= 5:
                            await notify_progress("Waiting for stack completion", "running",
                                               f"Configuring load balancer and security groups ({minutes_elapsed}m {seconds_elapsed}s)...")
                        elif minutes_elapsed <= 8:
                            await notify_progress("Waiting for stack completion", "running",
                                               f"Starting ECS tasks and health checks ({minutes_elapsed}m {seconds_elapsed}s)...")
                        elif minutes_elapsed <= 12:
                            await notify_progress("Waiting for stack completion", "running",
                                               f"Finalizing deployment and running health checks ({minutes_elapsed}m {seconds_elapsed}s)...")
                        else:
                            await notify_progress("Waiting for stack completion", "running",
                                               f"Deployment taking longer than expected ({minutes_elapsed}m {seconds_elapsed}s)...")
                    elif status in ['CREATE_COMPLETE', 'UPDATE_COMPLETE']:
                        logs.append("CloudFormation stack deployment completed successfully")
                        await notify_progress("Waiting for stack completion", "running", "Stack deployment completed - all resources ready!")
                        return
                    elif status in ['CREATE_FAILED', 'UPDATE_FAILED', 'ROLLBACK_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE']:
                        # Get stack events for error details
                        logger.error(f"Stack {stack_name} failed with status: {status}. Getting detailed events...")
                        events = cf_client.describe_stack_events(StackName=stack_name)

                        # Get all failed events, not just the last 3
                        failed_events = [e for e in events['StackEvents']
                                       if e.get('ResourceStatus', '').endswith('_FAILED')]

                        # Also get cancelled events (which indicate dependency failures)
                        cancelled_events = [e for e in events['StackEvents']
                                          if 'CANCELLED' in e.get('ResourceStatus', '')]

                        error_details = []

                        # Include failed events
                        for event in failed_events[:5]:  # Get up to 5 failed events
                            resource_id = event.get('LogicalResourceId', 'Unknown')
                            reason = event.get('ResourceStatusReason', 'No reason provided')
                            status_detail = event.get('ResourceStatus', 'Unknown')
                            timestamp = event.get('Timestamp', 'Unknown time').strftime('%Y-%m-%d %H:%M:%S') if hasattr(event.get('Timestamp', ''), 'strftime') else str(event.get('Timestamp', 'Unknown time'))
                            error_details.append(f"[{timestamp}] {resource_id} ({status_detail}): {reason}")

                        # Include cancelled events
                        for event in cancelled_events[:5]:  # Get up to 5 cancelled events
                            resource_id = event.get('LogicalResourceId', 'Unknown')
                            reason = event.get('ResourceStatusReason', 'Resource creation cancelled')
                            status_detail = event.get('ResourceStatus', 'Unknown')
                            timestamp = event.get('Timestamp', 'Unknown time').strftime('%Y-%m-%d %H:%M:%S') if hasattr(event.get('Timestamp', ''), 'strftime') else str(event.get('Timestamp', 'Unknown time'))
                            error_details.append(f"[{timestamp}] {resource_id} ({status_detail}): {reason}")

                        # Log all events for debugging
                        logger.error(f"Stack {stack_name} - Found {len(failed_events)} failed events and {len(cancelled_events)} cancelled events")
                        for detail in error_details:
                            logger.error(f"Stack event: {detail}")

                        error_msg = f"Stack deployment failed with status: {status} for stack: {stack_name}"
                        if error_details:
                            error_msg += f"\n\nDetailed Events:\n" + '\n'.join(error_details)
                        else:
                            error_msg += "\nNo detailed error events found in stack history."

                        # Add stack console URL for easy debugging
                        error_msg += f"\n\nCheck CloudFormation console: https://console.aws.amazon.com/cloudformation/home?region={region}#/stacks/stackinfo?stackId={stack_name}"

                        raise RuntimeError(error_msg)
                    elif 'ROLLBACK' in status:
                        minutes_elapsed = int(elapsed_time // 60)
                        await notify_progress("Waiting for stack completion", "running",
                                           f"Stack rolling back due to errors ({minutes_elapsed}m elapsed)...")

                    await asyncio.sleep(wait_interval)
                    elapsed_time += wait_interval

                except ClientError as e:
                    if 'does not exist' in str(e):
                        raise RuntimeError(f"Stack {stack_name} was deleted during deployment")
                    else:
                        raise

            raise RuntimeError(f"Stack deployment timed out after {max_wait_time} seconds")

        except Exception as e:
            logs.append(f"Error waiting for stack completion: {str(e)}")
            raise

    async def _get_stack_outputs(self, stack_name: str, region: str) -> Dict[str, Any]:
        """Get CloudFormation stack outputs"""
        try:
            cf_client = self._get_client('cloudformation', region)
            response = cf_client.describe_stacks(StackName=stack_name)
            stack = response['Stacks'][0]

            outputs = {}
            for output in stack.get('Outputs', []):
                outputs[output['OutputKey']] = output['OutputValue']

            return outputs

        except Exception as e:
            logger.error(f"Failed to get stack outputs: {str(e)}")
            return {}

    async def delete_stack(self, stack_name: str, region: str = "us-east-1") -> Dict[str, Any]:
        """
        Delete CloudFormation stack and all associated resources.

        Args:
            stack_name: Name of the CloudFormation stack to delete
            region: AWS region

        Returns:
            Dict with deletion results
        """
        deletion_results = {
            "success": True,
            "message": "",
            "stack_name": stack_name,
            "logs": []
        }

        try:
            cf_client = self._get_client('cloudformation', region)

            # Check if stack exists
            try:
                cf_client.describe_stacks(StackName=stack_name)
            except ClientError as e:
                if 'does not exist' in str(e):
                    deletion_results["message"] = f"Stack {stack_name} does not exist"
                    deletion_results["logs"].append(f"Stack {stack_name} not found")
                    return deletion_results
                else:
                    raise

            # Delete stack
            cf_client.delete_stack(StackName=stack_name)
            deletion_results["logs"].append(f"Initiated deletion of stack: {stack_name}")

            # Wait for deletion to complete
            max_wait_time = 1800  # 30 minutes
            wait_interval = 30    # 30 seconds
            elapsed_time = 0

            while elapsed_time < max_wait_time:
                try:
                    response = cf_client.describe_stacks(StackName=stack_name)
                    stack = response['Stacks'][0]
                    status = stack['StackStatus']

                    deletion_results["logs"].append(f"Stack deletion status: {status}")

                    if status == 'DELETE_COMPLETE':
                        deletion_results["message"] = f"Stack {stack_name} deleted successfully"
                        deletion_results["logs"].append("Stack deletion completed successfully")
                        return deletion_results

                    if status == 'DELETE_FAILED':
                        raise RuntimeError(f"Stack deletion failed with status: {status}")

                    await asyncio.sleep(wait_interval)
                    elapsed_time += wait_interval

                except ClientError as e:
                    if 'does not exist' in str(e):
                        deletion_results["message"] = f"Stack {stack_name} deleted successfully"
                        deletion_results["logs"].append("Stack deletion completed")
                        return deletion_results
                    else:
                        raise

            raise RuntimeError(f"Stack deletion timed out after {max_wait_time} seconds")

        except Exception as e:
            deletion_results["success"] = False
            deletion_results["message"] = f"Failed to delete stack: {str(e)}"
            deletion_results["logs"].append(f"Stack deletion failed: {str(e)}")
            return deletion_results

    async def _save_deployment_to_storage(
        self,
        deployment_id: str,
        config: ECSDeploymentConfig,
        generated_code: str,
        deployment_logs: List[str],
        deployment_outputs: Dict[str, Any],
        success: bool,
        error_message: str = None
    ):
        """
        Save deployment to structured storage following Lambda's pattern:
        storage/deploy_history/ecs-fargate/<service_name>/v1.0.0/<deployment_id>/
        """
        try:
            # Create storage directory structure (like Lambda)
            storage_base = Path("storage/deploy_history/ecs-fargate")
            deployment_dir = storage_base / config.service_name / "v1.0.0" / deployment_id
            deployment_dir.mkdir(parents=True, exist_ok=True)

            # Save deployment metadata (like Lambda's deployment_metadata.json)
            metadata = {
                "deployment_id": deployment_id,
                "deployment_target": "ecs-fargate",
                "agent_name": config.service_name,
                "region": config.region,
                "success": success,
                "error_message": error_message,
                "created_at": datetime.now().isoformat(),
                "streaming_capable": config.streaming_capable,
                "stack_name": config.stack_name,
                "cluster_arn": deployment_outputs.get('ClusterArn'),
                "service_arn": deployment_outputs.get('ServiceArn'),
                "service_endpoint": deployment_outputs.get('ServiceEndpoint'),
                "load_balancer_dns": deployment_outputs.get('LoadBalancerDNS'),
                "task_definition_arn": deployment_outputs.get('TaskDefinitionArn'),
                "cpu": config.cpu,
                "memory": config.memory,
                "architecture": config.architecture,
                "desired_count": config.desired_count,
                "health_check_path": config.health_check_path
            }

            with open(deployment_dir / "deployment_metadata.json", "w") as f:
                json.dump(metadata, f, indent=2)

            # Save deployment code (like Lambda's deployment_code.py)
            with open(deployment_dir / "deployment_code.py", "w") as f:
                f.write(generated_code)

            # Save deployment logs (like Lambda's deployment_logs.txt)
            with open(deployment_dir / "deployment_logs.txt", "w") as f:
                f.write("\n".join(deployment_logs))

            # Save deployment outputs (like Lambda's deployment_result.json)
            with open(deployment_dir / "deployment_result.json", "w") as f:
                json.dump(deployment_outputs, f, indent=2)

            logger.info(f"ECS deployment saved to storage: {deployment_dir}")

        except Exception as e:
            logger.error(f"Failed to save ECS deployment to storage: {e}")
            # Don't fail the deployment if storage fails