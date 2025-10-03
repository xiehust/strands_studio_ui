"""
Deployment models for different deployment targets
"""
from typing import Dict, List, Optional, Any, Union, Literal
from pydantic import BaseModel, Field, field_validator
from enum import Enum

class DeploymentType(str, Enum):
    """Available deployment types"""
    LAMBDA = "lambda"
    AGENT_CORE = "agentcore"
    ECS_FARGATE = "ecs-fargate"

# Base models
class BaseDeploymentRequest(BaseModel):
    """Base deployment request with common fields"""
    code: str = Field(..., description="Generated Strands agent code")
    project_id: Optional[str] = Field(None, description="Project identifier")
    version: Optional[str] = Field(None, description="Project version")
    api_keys: Optional[Dict[str, str]] = Field(None, description="API keys for the agent")
    deployment_id: Optional[str] = Field(None, description="Optional deployment ID from frontend")

# Lambda-specific models
class LambdaDeploymentRequest(BaseDeploymentRequest):
    """Request model for AWS Lambda deployment"""
    deployment_type: Literal[DeploymentType.LAMBDA] = DeploymentType.LAMBDA

    # Lambda-specific configuration
    function_name: str = Field(..., description="Lambda function name")
    memory_size: int = Field(512, ge=128, le=10240, description="Memory in MB")
    timeout: int = Field(300, ge=3, le=900, description="Timeout in seconds")
    runtime: str = Field("python3.11", description="Python runtime version")
    architecture: str = Field("x86_64", description="Processor architecture (x86_64/arm64)")
    region: str = Field("us-east-1", description="AWS region")
    stack_name: Optional[str] = Field(None, description="CloudFormation stack name")

    # Lambda-specific features (Fixed: Only Function URL is supported)
    enable_api_gateway: bool = Field(False, description="Create API Gateway trigger")
    enable_function_url: bool = Field(True, description="Enable Lambda function URL")
    vpc_config: Optional[Dict[str, Any]] = Field(None, description="VPC configuration")
    environment_variables: Optional[Dict[str, str]] = Field(None, description="Environment variables")

# AgentCore-specific models
class AgentCoreDeploymentRequest(BaseDeploymentRequest):
    """Request model for AWS Bedrock AgentCore deployment"""
    deployment_type: Literal[DeploymentType.AGENT_CORE] = DeploymentType.AGENT_CORE

    # 必须的参数
    agent_name: str = Field(..., description="Agent 名称", min_length=1, max_length=63)
    execute_role: str = Field(..., description="AgentCore 执行角色 ARN", min_length=1)

    # 可选参数（有合理默认值）
    region: str = Field("us-east-1", description="AWS 区域")

    @field_validator('agent_name')
    @classmethod
    def validate_agent_name(cls, v: str) -> str:
        """
        Validate and normalize agent name:
        - Replace hyphens (-) with underscores (_)
        - Ensure it meets AWS AgentCore naming requirements
        """
        if not v:
            raise ValueError("Agent name cannot be empty")

        # Replace hyphens with underscores
        normalized_name = v.replace('-', '_')

        # Additional validation for AWS AgentCore naming requirements
        if not normalized_name.replace('_', '').replace('-', '').isalnum():
            raise ValueError("Agent name can only contain alphanumeric characters, hyphens, and underscores")

        return normalized_name

# ECS Fargate-specific models
class ECSFargateDeploymentRequest(BaseDeploymentRequest):
    """Request model for ECS Fargate deployment"""
    deployment_type: Literal[DeploymentType.ECS_FARGATE] = DeploymentType.ECS_FARGATE

    # Required fields
    service_name: str = Field(..., description="ECS service name", min_length=1, max_length=255)

    # Container configuration with preset values
    cpu: int = Field(1024, description="CPU units (256, 512, 1024, 2048, 4096)")
    memory: int = Field(2048, description="Memory in MB (512, 1024, 2048, 4096, 8192)")
    architecture: str = Field("x86_64", description="Architecture (x86_64, arm64)")

    # AWS configuration
    region: str = Field("us-east-1", description="AWS region")

    # Container settings
    container_name: str = Field("strands-agent", description="Container name")
    container_port: int = Field(8000, description="Container port")

    # Derived fields (auto-generated if not provided)
    cluster_name: Optional[str] = Field(None, description="ECS cluster name (auto-generated if not provided)")
    task_definition_family: Optional[str] = Field(None, description="Task definition family (auto-generated if not provided)")

    # Network configuration (simplified for initial implementation)
    vpc_id: Optional[str] = Field(None, description="VPC ID (will use default VPC if not provided)")
    subnet_ids: Optional[List[str]] = Field(None, description="Subnet IDs (will use default subnets if not provided)")
    security_group_ids: Optional[List[str]] = Field(None, description="Security group IDs (will create default if not provided)")
    assign_public_ip: bool = Field(True, description="Assign public IP to tasks")

    # Service configuration
    desired_count: int = Field(1, ge=1, le=10, description="Number of tasks to run")
    enable_logging: bool = Field(True, description="Enable CloudWatch logging")

    # Load balancer configuration
    enable_load_balancer: bool = Field(True, description="Create Application Load Balancer")
    health_check_path: str = Field("/health", description="Health check endpoint path")

    # Advanced options (for future implementation)
    enable_autoscaling: bool = Field(False, description="Enable auto scaling (not implemented yet)")
    min_capacity: int = Field(1, ge=1, description="Minimum capacity for auto scaling")
    max_capacity: int = Field(10, ge=1, le=100, description="Maximum capacity for auto scaling")
    target_cpu_utilization: int = Field(70, ge=30, le=90, description="Target CPU utilization for auto scaling")

    # IAM roles (optional, will use defaults if not provided)
    execution_role_arn: Optional[str] = Field(None, description="ECS task execution role ARN")
    task_role_arn: Optional[str] = Field(None, description="ECS task role ARN")

    @field_validator('cpu')
    @classmethod
    def validate_cpu(cls, v: int) -> int:
        """Validate CPU units against Fargate supported values"""
        valid_cpu_values = [256, 512, 1024, 2048, 4096]
        if v not in valid_cpu_values:
            raise ValueError(f"CPU must be one of {valid_cpu_values}")
        return v

    @field_validator('memory')
    @classmethod
    def validate_memory(cls, v: int) -> int:
        """Validate memory against Fargate supported values"""
        # Basic validation - more complex CPU/Memory combinations handled in service
        if v < 512 or v > 30720:
            raise ValueError("Memory must be between 512 MB and 30720 MB")
        return v

    @field_validator('service_name')
    @classmethod
    def validate_service_name(cls, v: str) -> str:
        """Validate and normalize service name for AWS compatibility"""
        if not v:
            raise ValueError("Service name cannot be empty")

        # Replace invalid characters with hyphens
        normalized_name = ''.join(c if c.isalnum() else '-' for c in v)
        normalized_name = normalized_name.strip('-')

        if len(normalized_name) < 1 or len(normalized_name) > 255:
            raise ValueError("Service name must be 1-255 characters after normalization")

        return normalized_name

# Union type for all deployment requests
DeploymentRequest = Union[LambdaDeploymentRequest, AgentCoreDeploymentRequest, ECSFargateDeploymentRequest]

# Common response models
class DeploymentStatus(BaseModel):
    """Deployment status model"""
    deployment_id: str
    deployment_type: DeploymentType
    status: str = Field(..., description="pending, building, deploying, completed, failed")
    message: str

    # Common deployment outputs (populated based on deployment type)
    endpoint_url: Optional[str] = Field(None, description="Primary endpoint URL")
    resource_arn: Optional[str] = Field(None, description="AWS resource ARN (Lambda/ECS)")

    # Deployment metadata
    logs: Optional[List[str]] = None
    created_at: str
    completed_at: Optional[str] = None
    deployment_time: Optional[float] = None

    # Type-specific outputs (stored as flexible dict)
    deployment_outputs: Optional[Dict[str, Any]] = Field(None, description="Type-specific deployment outputs")

class DeploymentResponse(BaseModel):
    """Response model for deployment operations"""
    success: bool
    deployment_id: str
    message: str
    deployment_type: DeploymentType
    status: DeploymentStatus

# AgentCore invoke models
class AgentCoreInvokeRequest(BaseModel):
    """Request model for invoking AgentCore agent"""
    agent_runtime_arn: str = Field(..., description="AgentCore runtime ARN")
    runtime_session_id: str = Field(..., description="Runtime session ID (must be 33+ characters)", min_length=33)
    payload: Dict[str, Any] = Field(..., description="Input payload for the agent")
    qualifier: str = Field("DEFAULT", description="Agent qualifier")
    region: str = Field("us-east-1", description="AWS region")
    enable_stream: bool = Field(False, description="Enable streaming response")

class AgentCoreInvokeResponse(BaseModel):
    """Response model for AgentCore agent invocation"""
    success: bool = Field(..., description="Whether the invocation was successful")
    response_data: Union[str,Optional[Dict[str, Any]]] = Field(None, description="Agent response data")
    error: Optional[str] = Field(None, description="Error message if invocation failed")
    execution_time: Optional[float] = Field(None, description="Execution time in seconds")

# Lambda invoke models
class LambdaInvokeRequest(BaseModel):
    """Request model for invoking Lambda function"""
    function_arn: str = Field(..., description="Lambda function ARN")
    payload: Dict[str, Any] = Field(..., description="Input payload for the Lambda function")
    region: str = Field("us-east-1", description="AWS region")
    invocation_type: str = Field("RequestResponse", description="Invocation type (RequestResponse, Event)")

class LambdaInvokeResponse(BaseModel):
    """Response model for Lambda function invocation"""
    success: bool = Field(..., description="Whether the invocation was successful")
    response_data: Union[str, Dict[str, Any]] = Field(None, description="Lambda response data")
    error: Optional[str] = Field(None, description="Error message if invocation failed")
    execution_time: Optional[float] = Field(None, description="Execution time in seconds")
    status_code: Optional[int] = Field(None, description="HTTP status code from Lambda")
    execution_context: Optional[Dict[str, Any]] = Field(None, description="Lambda execution context")

# ECS invoke models
class ECSInvokeRequest(BaseModel):
    """Request model for invoking ECS service"""
    service_endpoint: str = Field(..., description="ECS service ALB endpoint URL")
    payload: Dict[str, Any] = Field(..., description="Input payload for the ECS service")
    region: str = Field("us-east-1", description="AWS region")
    enable_stream: bool = Field(False, description="Enable streaming response")

class ECSInvokeResponse(BaseModel):
    """Response model for ECS service invocation"""
    success: bool = Field(..., description="Whether the invocation was successful")
    response_data: Union[str, Dict[str, Any]] = Field(None, description="ECS service response data")
    error: Optional[str] = Field(None, description="Error message if invocation failed")
    execution_time: Optional[float] = Field(None, description="Execution time in seconds")
    status_code: Optional[int] = Field(None, description="HTTP status code from ECS service")
    execution_context: Optional[Dict[str, Any]] = Field(None, description="ECS service execution context")

# Health check model
class DeploymentHealthStatus(BaseModel):
    """Health status for deployment service"""
    service_status: str = Field(..., description="overall, lambda, agentcore, ecs-fargate")
    active_deployments: int
    available_deployment_types: List[DeploymentType]
    tool_availability: Dict[str, Dict[str, Any]] = Field(
        ...,
        description="Availability of deployment tools (SAM CLI, Docker, etc.)"
    )