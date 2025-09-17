"""
Deployment models for different deployment targets
"""
from typing import Dict, List, Optional, Any, Union, Literal
from pydantic import BaseModel, Field
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

# AgentCore-specific models (待实现)
class AgentCoreDeploymentRequest(BaseDeploymentRequest):
    """Request model for AgentCore deployment (待实现)"""
    deployment_type: Literal[DeploymentType.AGENT_CORE] = DeploymentType.AGENT_CORE

    # TODO: 添加 AgentCore 特定的配置参数
    # 示例字段（实际实现时需要根据 AgentCore API 规范定义）:
    # - agent_name: str
    # - namespace: str
    # - replicas: int
    # - agentcore_endpoint: str
    # - agentcore_token: str
    pass

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