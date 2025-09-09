"""
Pydantic models for component registry API responses
"""

from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field
from enum import Enum


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


class PortDefinitionModel(BaseModel):
    """API model for component port definition"""
    id: str = Field(..., description="Unique identifier for the port")
    name: str = Field(..., description="Human-readable name for the port")
    data_type: str = Field(..., description="Data type expected by this port")
    required: bool = Field(..., description="Whether this port is required")
    description: str = Field(..., description="Description of the port's purpose")
    port_type: PortType = Field(..., description="Whether this is an input or output port")


class ComponentSchemaModel(BaseModel):
    """API model for component configuration schema"""
    properties: Dict[str, Any] = Field(..., description="Schema properties for configuration")
    required: List[str] = Field(default_factory=list, description="List of required configuration fields")
    type: str = Field(default="object", description="Schema type")


class StrandsComponentModel(BaseModel):
    """API model for a Strands SDK component"""
    id: str = Field(..., description="Unique identifier for the component")
    name: str = Field(..., description="Human-readable name for the component")
    category: ComponentType = Field(..., description="Category/type of the component")
    description: str = Field(..., description="Description of the component's functionality")
    icon: str = Field(..., description="Icon identifier for UI representation")
    config_schema: ComponentSchemaModel = Field(..., description="Configuration schema for the component")
    default_config: Dict[str, Any] = Field(default_factory=dict, description="Default configuration values")
    ports: Dict[str, List[PortDefinitionModel]] = Field(..., description="Input and output ports for the component")
    module_path: str = Field(..., description="Python module path for the component")
    class_name: Optional[str] = Field(None, description="Class name if component is a class")
    function_name: Optional[str] = Field(None, description="Function name if component is a function")


class ComponentListResponse(BaseModel):
    """API response model for component list"""
    components: List[StrandsComponentModel] = Field(..., description="List of available components")
    total_count: int = Field(..., description="Total number of components")
    categories: Dict[str, int] = Field(..., description="Count of components by category")


class ComponentValidationRequest(BaseModel):
    """API request model for component configuration validation"""
    component_id: str = Field(..., description="ID of the component to validate")
    configuration: Dict[str, Any] = Field(..., description="Configuration to validate")


class ComponentValidationResponse(BaseModel):
    """API response model for component configuration validation"""
    valid: bool = Field(..., description="Whether the configuration is valid")
    errors: List[str] = Field(default_factory=list, description="List of validation errors")
    warnings: List[str] = Field(default_factory=list, description="List of validation warnings")


class ComponentCategoriesResponse(BaseModel):
    """API response model for component categories"""
    categories: Dict[ComponentType, List[StrandsComponentModel]] = Field(
        ..., description="Components organized by category"
    )