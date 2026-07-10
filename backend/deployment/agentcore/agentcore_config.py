"""
AgentCore deployment configuration classes and utilities (direct code deploy)
"""
from dataclasses import dataclass, asdict
from typing import Dict, Any, Optional, List
from enum import Enum

class NetworkMode(str, Enum):
    """AgentCore network modes"""
    PUBLIC = "PUBLIC"
    PRIVATE = "PRIVATE"

@dataclass
class AgentCoreDeploymentConfig:
    """Configuration for AgentCore direct code deployment"""
    # Required fields
    agent_runtime_name: str

    # Basic configuration
    region: str = "us-east-1"
    network_mode: NetworkMode = NetworkMode.PUBLIC

    # IAM configuration (role ARN or role name; default role is ensured if unset)
    role_arn: Optional[str] = None

    # Environment and API keys
    api_keys: Optional[Dict[str, str]] = None
    environment_variables: Optional[Dict[str, str]] = None

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
        env_vars['STRANDS_NON_INTERACTIVE'] = "true"
        env_vars['PYTHONUNBUFFERED'] = "1"

        # Drop empty values (AgentCore rejects empty env var values)
        return {k: v for k, v in env_vars.items() if v is not None and str(v).strip()}

    def get_tags(self) -> Dict[str, str]:
        """Get resource tags with defaults"""
        default_tags = {
            "Project": "StrandsStudio",
            "DeploymentType": "AgentCore",
            "DeploymentMethod": "direct-code-deploy"
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

        # Validate environment variable limits (AgentCore: max 50 entries, 100-char keys, 5000-char values)
        env_vars = self.get_environment_variables()
        if len(env_vars) > 50:
            errors.append(f"Too many environment variables ({len(env_vars)}); AgentCore allows at most 50")
        for key, value in env_vars.items():
            if len(key) > 100:
                errors.append(f"Environment variable key too long (>100 chars): {key[:50]}...")
            if len(str(value)) > 5000:
                errors.append(f"Environment variable value too long (>5000 chars) for key: {key}")

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
