"""
AgentCore deployment configuration classes and utilities
"""
from dataclasses import dataclass, asdict
from typing import Dict, Any, Optional, List
from enum import Enum

class DeploymentMethod(str, Enum):
    """Available AgentCore deployment methods"""
    SDK = "sdk"  # Using bedrock-agentcore-starter-toolkit
    MANUAL = "manual"  # Manual deployment with boto3

class NetworkMode(str, Enum):
    """AgentCore network modes"""
    PUBLIC = "PUBLIC"
    PRIVATE = "PRIVATE"

@dataclass
class AgentCoreDeploymentConfig:
    """Configuration for AgentCore deployment"""
    # Required fields
    agent_runtime_name: str  # Internal field name for compatibility
    
    # Basic configuration
    region: str = "us-east-1"
    deployment_method: DeploymentMethod = DeploymentMethod.SDK
    network_mode: NetworkMode = NetworkMode.PUBLIC
    
    # Container configuration (for manual deployment)
    container_uri: Optional[str] = None
    
    # IAM configuration
    role_arn: Optional[str] = None
    
    # Environment and API keys
    api_keys: Optional[Dict[str, str]] = None
    environment_variables: Optional[Dict[str, str]] = None
    
    # Resource configuration
    timeout_seconds: int = 300
    startup_timeout: int = 60
    
    # Metadata
    tags: Optional[Dict[str, str]] = None
    streaming_capable: Optional[bool] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary"""
        return asdict(self)
    
    def get_environment_variables(self) -> Dict[str, str]:
        """Get all environment variables including API keys"""
        env_vars = {}
        
        # Add custom environment variables
        if self.environment_variables:
            env_vars.update(self.environment_variables)
        
        # Add API keys as environment variables
        if self.api_keys:
            for key, value in self.api_keys.items():
                env_key = key.upper()
                if not env_key.endswith('_API_KEY'):
                    env_key += '_API_KEY'
                env_vars[env_key] = value
        
        # Add AgentCore specific environment variables
        env_vars['BYPASS_TOOL_CONSENT'] = "true"
        env_vars['PYTHONUNBUFFERED'] = "1"
        
        return env_vars
    
    def get_tags(self) -> Dict[str, str]:
        """Get resource tags with defaults"""
        default_tags = {
            "Project": "StrandsStudio",
            "DeploymentType": "AgentCore",
            "DeploymentMethod": self.deployment_method.value
        }
        
        if self.tags:
            default_tags.update(self.tags)
        
        return default_tags
    
    def validate(self) -> List[str]:
        """Validate configuration and return list of errors"""
        errors = []
        
        # Validate agent runtime name
        if not self.agent_runtime_name:
            errors.append("agent_runtime_name is required")
        elif len(self.agent_runtime_name) > 63:
            errors.append("agent_runtime_name must be 63 characters or less")
        elif not self.agent_runtime_name.replace('-', '').replace('_', '').isalnum():
            errors.append("agent_runtime_name must contain only alphanumeric characters, hyphens, and underscores")
        
        # Validate manual deployment requirements
        if self.deployment_method == DeploymentMethod.MANUAL:
            if not self.container_uri:
                errors.append("container_uri is required for manual deployment")
        
        # Validate timeout values
        if self.timeout_seconds < 30 or self.timeout_seconds > 900:
            errors.append("timeout_seconds must be between 30 and 900")
        
        if self.startup_timeout < 10 or self.startup_timeout > 300:
            errors.append("startup_timeout must be between 10 and 300")
        
        return errors

@dataclass
class AgentCoreDeploymentResult:
    """Result of an AgentCore deployment operation"""
    success: bool
    message: str
    agent_runtime_arn: Optional[str] = None
    agent_runtime_name: Optional[str] = None
    invoke_endpoint: Optional[str] = None
    logs: Optional[List[str]] = None
    deployment_time: Optional[float] = None
    deployment_outputs: Optional[Dict[str, Any]] = None
    streaming_capable: Optional[bool] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary"""
        return asdict(self)
