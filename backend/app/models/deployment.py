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

    # Lambda-specific features
    enable_api_gateway: bool = Field(True, description="Create API Gateway trigger")
    enable_function_url: bool = Field(False, description="Enable Lambda function URL")
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

# ECS Fargate-specific models (待实现)
class ECSFargateDeploymentRequest(BaseDeploymentRequest):
    """Request model for ECS Fargate deployment (待实现)"""
    deployment_type: Literal[DeploymentType.ECS_FARGATE] = DeploymentType.ECS_FARGATE

    # TODO: 添加 ECS Fargate 特定的配置参数
    # 示例字段（实际实现时需要根据需求定义）:
    # - cluster_name: str
    # - service_name: str
    # - task_definition_family: str
    # - cpu: int
    # - memory: int
    # - subnet_ids: List[str]
    # - security_group_ids: List[str]
    pass

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