"""
Component Registry Service for Strands Agent SDK Discovery

This service introspects the Strands Agent SDK to discover available components,
extract their metadata, and categorize them for the visual agent builder.
"""

import inspect
import importlib
import logging
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass
from enum import Enum
import pkgutil
import sys

# Strands SDK imports
try:
    import strands
    import strands_tools
    from strands import Agent
    # Try to import models individually to handle different SDK versions
    try:
        from strands.models import BedrockModel
    except ImportError:
        BedrockModel = None
    try:
        from strands.models.openai import OpenAIModel
    except ImportError:
        try:
            from strands.models import OpenAIModel
        except ImportError:
            OpenAIModel = None
    try:
        from strands.models import AnthropicModel
    except ImportError:
        AnthropicModel = None
    STRANDS_AVAILABLE = True
except ImportError as e:
    logging.warning(f"Strands SDK not available: {e}")
    STRANDS_AVAILABLE = False
    BedrockModel = None
    OpenAIModel = None
    AnthropicModel = None


class ComponentType(str, Enum):
    """Types of components available in Strands SDK"""
    AGENT = "agent"
    TOOL = "tool"
    MODEL = "model"
    PROVIDER = "provider"
    WORKFLOW = "workflow"


class PortType(str, Enum):
    """Types of ports for component connections"""
    INPUT = "input"
    OUTPUT = "output"


@dataclass
class PortDefinition:
    """Definition of a component port"""
    id: str
    name: str
    data_type: str
    required: bool
    description: str
    port_type: PortType


@dataclass
class ComponentSchema:
    """Schema definition for a component's configuration"""
    properties: Dict[str, Any]
    required: List[str]
    type: str = "object"


@dataclass
class StrandsComponent:
    """Represents a discovered Strands SDK component"""
    id: str
    name: str
    category: ComponentType
    description: str
    icon: str
    schema: ComponentSchema
    default_config: Dict[str, Any]
    ports: Dict[str, List[PortDefinition]]
    module_path: str
    class_name: Optional[str] = None
    function_name: Optional[str] = None


class ComponentRegistryService:
    """Service for discovering and managing Strands SDK components"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self._components: Dict[str, StrandsComponent] = {}
        self._initialized = False
        
    def initialize(self) -> bool:
        """Initialize the component registry by discovering all available components"""
        try:
            if STRANDS_AVAILABLE:
                self.logger.info("Initializing Strands SDK component registry")
            else:
                self.logger.warning("Strands SDK not available - initializing with mock components for development")
            
            # Discover core agent components
            self._discover_agent_components()
            
            # Discover tool components
            self._discover_tool_components()
            
            # Discover model providers
            self._discover_model_providers()
            
            # Discover workflow components
            self._discover_workflow_components()
            
            self._initialized = True
            self.logger.info(f"Component registry initialized with {len(self._components)} components")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to initialize component registry: {e}")
            return False
    
    def get_available_components(self) -> List[StrandsComponent]:
        """Get all available components"""
        if not self._initialized:
            self.initialize()
        return list(self._components.values())
    
    def get_components_by_category(self, category: ComponentType) -> List[StrandsComponent]:
        """Get components filtered by category"""
        if not self._initialized:
            self.initialize()
        return [comp for comp in self._components.values() if comp.category == category]
    
    def get_component_by_id(self, component_id: str) -> Optional[StrandsComponent]:
        """Get a specific component by ID"""
        if not self._initialized:
            self.initialize()
        return self._components.get(component_id)
    
    def _discover_agent_components(self):
        """Discover core agent components"""
        self.logger.debug("Discovering agent components")
        
        # Basic Agent component
        agent_component = StrandsComponent(
            id="basic_agent",
            name="Basic Agent",
            category=ComponentType.AGENT,
            description="A basic Strands agent that can process queries and use tools",
            icon="user-circle",
            schema=ComponentSchema(
                properties={
                    "system_prompt": {
                        "type": "string",
                        "description": "System prompt to guide the agent's behavior",
                        "default": "You are a helpful assistant."
                    },
                    "model": {
                        "type": "string",
                        "description": "Model to use for the agent",
                        "enum": ["claude-3-5-sonnet", "gpt-4", "bedrock"],
                        "default": "claude-3-5-sonnet"
                    },
                    "max_tokens": {
                        "type": "integer",
                        "description": "Maximum tokens for responses",
                        "default": 1000,
                        "minimum": 1,
                        "maximum": 4000
                    }
                },
                required=["system_prompt"]
            ),
            default_config={
                "system_prompt": "You are a helpful assistant.",
                "model": "claude-3-5-sonnet",
                "max_tokens": 1000
            },
            ports={
                "inputs": [
                    PortDefinition(
                        id="query",
                        name="Query",
                        data_type="string",
                        required=True,
                        description="Input query for the agent",
                        port_type=PortType.INPUT
                    ),
                    PortDefinition(
                        id="tools",
                        name="Tools",
                        data_type="array",
                        required=False,
                        description="Tools available to the agent",
                        port_type=PortType.INPUT
                    )
                ],
                "outputs": [
                    PortDefinition(
                        id="response",
                        name="Response",
                        data_type="string",
                        required=True,
                        description="Agent's response",
                        port_type=PortType.OUTPUT
                    )
                ]
            },
            module_path="strands",
            class_name="Agent"
        )
        
        self._components[agent_component.id] = agent_component
    
    def _discover_tool_components(self):
        """Discover available tools from strands_tools"""
        self.logger.debug("Discovering tool components")
        
        # Comprehensive tools based on the official Strands documentation
        common_tools = [
            {
                "id": "calculator",
                "name": "Calculator",
                "description": "Performs mathematical calculations and symbolic math operations",
                "icon": "calculator",
                "function_name": "calculator",
                "schema_props": {
                    "expression": {
                        "type": "string",
                        "description": "Mathematical expression to evaluate",
                        "required": True
                    }
                }
            },
            {
                "id": "file_read",
                "name": "File Read",
                "description": "Reads content from files with various modes and options including recursive searching",
                "icon": "file-text",
                "function_name": "file_read",
                "schema_props": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file to read",
                        "required": True
                    },
                    "mode": {
                        "type": "string",
                        "description": "Reading mode",
                        "enum": ["full", "lines", "search", "chunk"],
                        "default": "full"
                    },
                    "recursive": {
                        "type": "boolean",
                        "description": "Enable recursive file searching",
                        "default": True
                    }
                }
            },
            {
                "id": "file_write",
                "name": "File Write",
                "description": "Writes content to files with various options",
                "icon": "edit",
                "function_name": "file_write",
                "schema_props": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file to write",
                        "required": True
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write to the file",
                        "required": True
                    }
                }
            },
            {
                "id": "http_request",
                "name": "HTTP Request",
                "description": "Makes HTTP requests with comprehensive authentication support",
                "icon": "globe",
                "function_name": "http_request",
                "schema_props": {
                    "method": {
                        "type": "string",
                        "description": "HTTP method",
                        "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"],
                        "default": "GET"
                    },
                    "url": {
                        "type": "string",
                        "description": "URL to request",
                        "required": True
                    },
                    "headers": {
                        "type": "object",
                        "description": "HTTP headers",
                        "default": {}
                    }
                }
            },
            {
                "id": "shell",
                "name": "Shell",
                "description": "Executes shell commands with user confirmation",
                "icon": "terminal",
                "function_name": "shell",
                "schema_props": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute",
                        "required": True
                    }
                }
            },
            {
                "id": "python_repl",
                "name": "Python REPL",
                "description": "Executes Python code snippets securely",
                "icon": "code",
                "function_name": "python_repl",
                "schema_props": {
                    "code": {
                        "type": "string",
                        "description": "Python code to execute",
                        "required": True
                    }
                }
            },
            {
                "id": "current_time",
                "name": "Current Time",
                "description": "Gets the current time in specified timezone",
                "icon": "clock",
                "function_name": "current_time",
                "schema_props": {
                    "timezone": {
                        "type": "string",
                        "description": "Timezone for the time",
                        "default": "UTC"
                    }
                }
            },
            {
                "id": "batch",
                "name": "Batch Tool",
                "description": "Calls multiple other tools in parallel for efficient execution",
                "icon": "layers",
                "function_name": "batch",
                "schema_props": {
                    "invocations": {
                        "type": "array",
                        "description": "List of tool invocations to execute in parallel",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Tool name to invoke"},
                                "arguments": {"type": "object", "description": "Arguments for the tool"}
                            }
                        },
                        "required": True
                    }
                }
            },
            {
                "id": "memory",
                "name": "Memory Tool",
                "description": "Manages documents in Amazon Bedrock Knowledge Bases for retrieval and storage",
                "icon": "database",
                "function_name": "memory",
                "schema_props": {
                    "action": {
                        "type": "string",
                        "description": "Action to perform",
                        "enum": ["store", "retrieve", "list", "delete"],
                        "required": True
                    },
                    "query": {
                        "type": "string",
                        "description": "Query for retrieval operations"
                    }
                }
            },
            {
                "id": "use_aws",
                "name": "AWS Operations",
                "description": "Interact with AWS services like S3, EC2, and others",
                "icon": "cloud",
                "function_name": "use_aws",
                "schema_props": {
                    "service_name": {
                        "type": "string",
                        "description": "AWS service name (e.g., s3, ec2)",
                        "required": True
                    },
                    "operation_name": {
                        "type": "string",
                        "description": "AWS operation to perform",
                        "required": True
                    },
                    "parameters": {
                        "type": "object",
                        "description": "Parameters for the AWS operation",
                        "default": {}
                    },
                    "region": {
                        "type": "string",
                        "description": "AWS region",
                        "default": "us-east-1"
                    }
                }
            },
            {
                "id": "browser",
                "name": "Browser Tool",
                "description": "Controls a browser for web automation and scraping",
                "icon": "monitor",
                "function_name": "browser",
                "schema_props": {
                    "action": {
                        "type": "object",
                        "description": "Browser action to perform",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": ["navigate", "initSession", "click", "type", "screenshot"]
                            },
                            "url": {"type": "string"},
                            "session_name": {"type": "string"}
                        },
                        "required": True
                    }
                }
            },
            {
                "id": "workflow",
                "name": "Workflow Management",
                "description": "Defines, executes, and manages multi-step automated workflows",
                "icon": "workflow",
                "function_name": "workflow",
                "schema_props"
        
        for tool_def in common_tools:
            tool_component = StrandsComponent(
                id=tool_def["id"],
                name=tool_def["name"],
                category=ComponentType.TOOL,
                description=tool_def["description"],
                icon=tool_def["icon"],
                schema=ComponentSchema(
                    properties=tool_def["schema_props"],
                    required=[k for k, v in tool_def["schema_props"].items() if v.get("required", False)]
                ),
                default_config={k: v.get("default") for k, v in tool_def["schema_props"].items() if "default" in v},
                ports={
                    "inputs": [
                        PortDefinition(
                            id="input",
                            name="Input",
                            data_type="object",
                            required=True,
                            description="Tool input parameters",
                            port_type=PortType.INPUT
                        )
                    ],
                    "outputs": [
                        PortDefinition(
                            id="result",
                            name="Result",
                            data_type="string",
                            required=True,
                            description="Tool execution result",
                            port_type=PortType.OUTPUT
                        )
                    ]
                },
                module_path="strands_tools",
                function_name=tool_def["function_name"]
            )
            
            self._components[tool_component.id] = tool_component
    
    def _discover_model_providers(self):
        """Discover available model providers"""
        self.logger.debug("Discovering model providers")
        
        model_providers = [
            {
                "id": "anthropic_claude",
                "name": "Anthropic Claude",
                "description": "Claude models from Anthropic",
                "icon": "brain",
                "class_name": "AnthropicModel",
                "schema_props": {
                    "model_id": {
                        "type": "string",
                        "description": "Claude model identifier",
                        "enum": ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
                        "default": "claude-3-5-sonnet-20241022"
                    },
                    "max_tokens": {
                        "type": "integer",
                        "description": "Maximum tokens for responses",
                        "default": 1000,
                        "minimum": 1,
                        "maximum": 4000
                    },
                    "temperature": {
                        "type": "number",
                        "description": "Sampling temperature",
                        "default": 0.7,
                        "minimum": 0.0,
                        "maximum": 1.0
                    }
                }
            },
            {
                "id": "openai_gpt",
                "name": "OpenAI GPT",
                "description": "GPT models from OpenAI",
                "icon": "cpu",
                "class_name": "OpenAIModel",
                "schema_props": {
                    "model_id": {
                        "type": "string",
                        "description": "GPT model identifier",
                        "enum": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
                        "default": "gpt-4o"
                    },
                    "max_tokens": {
                        "type": "integer",
                        "description": "Maximum tokens for responses",
                        "default": 1000,
                        "minimum": 1,
                        "maximum": 4000
                    },
                    "temperature": {
                        "type": "number",
                        "description": "Sampling temperature",
                        "default": 0.7,
                        "minimum": 0.0,
                        "maximum": 1.0
                    }
                }
            },
            {
                "id": "bedrock_model",
                "name": "Amazon Bedrock",
                "description": "Models available through Amazon Bedrock",
                "icon": "cloud",
                "class_name": "BedrockModel",
                "schema_props": {
                    "model_id": {
                        "type": "string",
                        "description": "Bedrock model identifier",
                        "default": "us.anthropic.claude-3-5-sonnet-20241022-v2:0"
                    },
                    "max_tokens": {
                        "type": "integer",
                        "description": "Maximum tokens for responses",
                        "default": 1000,
                        "minimum": 1,
                        "maximum": 4000
                    }
                }
            }
        ]
        
        for model_def in model_providers:
            model_component = StrandsComponent(
                id=model_def["id"],
                name=model_def["name"],
                category=ComponentType.MODEL,
                description=model_def["description"],
                icon=model_def["icon"],
                schema=ComponentSchema(
                    properties=model_def["schema_props"],
                    required=["model_id"]
                ),
                default_config={k: v.get("default") for k, v in model_def["schema_props"].items() if "default" in v},
                ports={
                    "inputs": [
                        PortDefinition(
                            id="config",
                            name="Configuration",
                            data_type="object",
                            required=True,
                            description="Model configuration parameters",
                            port_type=PortType.INPUT
                        )
                    ],
                    "outputs": [
                        PortDefinition(
                            id="model",
                            name="Model",
                            data_type="model",
                            required=True,
                            description="Configured model instance",
                            port_type=PortType.OUTPUT
                        )
                    ]
                },
                module_path="strands.models",
                class_name=model_def["class_name"]
            )
            
            self._components[model_component.id] = model_component
    
    def _discover_workflow_components(self):
        """Discover workflow-related components"""
        self.logger.debug("Discovering workflow components")
        
        # Workflow orchestrator component
        workflow_component = StrandsComponent(
            id="workflow_orchestrator",
            name="Workflow Orchestrator",
            category=ComponentType.WORKFLOW,
            description="Orchestrates multi-agent workflows and task dependencies",
            icon="workflow",
            schema=ComponentSchema(
                properties={
                    "workflow_type": {
                        "type": "string",
                        "description": "Type of workflow execution",
                        "enum": ["sequential", "parallel", "graph"],
                        "default": "sequential"
                    },
                    "max_concurrent": {
                        "type": "integer",
                        "description": "Maximum concurrent tasks for parallel execution",
                        "default": 3,
                        "minimum": 1,
                        "maximum": 10
                    }
                },
                required=["workflow_type"]
            ),
            default_config={
                "workflow_type": "sequential",
                "max_concurrent": 3
            },
            ports={
                "inputs": [
                    PortDefinition(
                        id="tasks",
                        name="Tasks",
                        data_type="array",
                        required=True,
                        description="List of tasks to execute",
                        port_type=PortType.INPUT
                    ),
                    PortDefinition(
                        id="agents",
                        name="Agents",
                        data_type="array",
                        required=True,
                        description="Agents to use for task execution",
                        port_type=PortType.INPUT
                    )
                ],
                "outputs": [
                    PortDefinition(
                        id="results",
                        name="Results",
                        data_type="array",
                        required=True,
                        description="Workflow execution results",
                        port_type=PortType.OUTPUT
                    )
                ]
            },
            module_path="strands_tools",
            function_name="workflow"
        )
        
        self._components[workflow_component.id] = workflow_component
    
    def validate_component_configuration(self, component_id: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """Validate a component's configuration against its schema"""
        component = self.get_component_by_id(component_id)
        if not component:
            return {"valid": False, "errors": [f"Component {component_id} not found"]}
        
        errors = []
        warnings = []
        
        # Check required fields
        for required_field in component.schema.required:
            if required_field not in config:
                errors.append(f"Required field '{required_field}' is missing")
        
        # Validate field types and constraints
        for field_name, field_value in config.items():
            if field_name in component.schema.properties:
                field_schema = component.schema.properties[field_name]
                
                # Type validation
                expected_type = field_schema.get("type")
                if expected_type == "string" and not isinstance(field_value, str):
                    errors.append(f"Field '{field_name}' must be a string")
                elif expected_type == "integer" and not isinstance(field_value, int):
                    errors.append(f"Field '{field_name}' must be an integer")
                elif expected_type == "number" and not isinstance(field_value, (int, float)):
                    errors.append(f"Field '{field_name}' must be a number")
                
                # Range validation
                if expected_type in ["integer", "number"]:
                    if "minimum" in field_schema and field_value < field_schema["minimum"]:
                        errors.append(f"Field '{field_name}' must be >= {field_schema['minimum']}")
                    if "maximum" in field_schema and field_value > field_schema["maximum"]:
                        errors.append(f"Field '{field_name}' must be <= {field_schema['maximum']}")
                
                # Enum validation
                if "enum" in field_schema and field_value not in field_schema["enum"]:
                    errors.append(f"Field '{field_name}' must be one of: {field_schema['enum']}")
            else:
                warnings.append(f"Unknown field '{field_name}' in configuration")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }


# Global instance
component_registry = ComponentRegistryService()