"""
API endpoints for Strands SDK component discovery and management
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import JSONResponse

from ..services.component_registry import component_registry, ComponentType
from ..models.components import (
    ComponentListResponse,
    StrandsComponentModel,
    ComponentValidationRequest,
    ComponentValidationResponse,
    ComponentCategoriesResponse,
    PortDefinitionModel,
    ComponentSchemaModel
)

router = APIRouter()


def get_component_registry():
    """Dependency to get the component registry service"""
    if not component_registry._initialized:
        if not component_registry.initialize():
            raise HTTPException(
                status_code=503,
                detail="Component registry failed to initialize. Strands SDK may not be available."
            )
    return component_registry


@router.get("/", response_model=ComponentListResponse)
async def get_components(
    category: Optional[ComponentType] = Query(None, description="Filter components by category"),
    search: Optional[str] = Query(None, description="Search components by name or description"),
    registry = Depends(get_component_registry)
):
    """
    Get all available Strands SDK components with optional filtering
    
    This endpoint returns a list of all discovered components from the Strands SDK,
    including their metadata, configuration schemas, and port definitions.
    """
    try:
        # Get components based on category filter
        if category:
            components = registry.get_components_by_category(category)
        else:
            components = registry.get_available_components()
        
        # Apply search filter if provided
        if search:
            search_lower = search.lower()
            components = [
                comp for comp in components
                if search_lower in comp.name.lower() or search_lower in comp.description.lower()
            ]
        
        # Convert to API models
        component_models = []
        for comp in components:
            # Convert ports to API models
            ports_model = {}
            for port_type, port_list in comp.ports.items():
                ports_model[port_type] = [
                    PortDefinitionModel(
                        id=port.id,
                        name=port.name,
                        data_type=port.data_type,
                        required=port.required,
                        description=port.description,
                        port_type=port.port_type
                    ) for port in port_list
                ]
            
            component_model = StrandsComponentModel(
                id=comp.id,
                name=comp.name,
                category=comp.category,
                description=comp.description,
                icon=comp.icon,
                config_schema=ComponentSchemaModel(
                    properties=comp.schema.properties,
                    required=comp.schema.required,
                    type=comp.schema.type
                ),
                default_config=comp.default_config,
                ports=ports_model,
                module_path=comp.module_path,
                class_name=comp.class_name,
                function_name=comp.function_name
            )
            component_models.append(component_model)
        
        # Calculate category counts
        all_components = registry.get_available_components()
        categories = {}
        for comp in all_components:
            categories[comp.category.value] = categories.get(comp.category.value, 0) + 1
        
        return ComponentListResponse(
            components=component_models,
            total_count=len(component_models),
            categories=categories
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve components: {str(e)}")


@router.get("/categories", response_model=ComponentCategoriesResponse)
async def get_components_by_categories(
    registry = Depends(get_component_registry)
):
    """
    Get components organized by categories
    
    Returns all components grouped by their category type (agent, tool, model, etc.)
    """
    try:
        categories_dict = {}
        
        for category in ComponentType:
            components = registry.get_components_by_category(category)
            
            # Convert to API models
            component_models = []
            for comp in components:
                # Convert ports to API models
                ports_model = {}
                for port_type, port_list in comp.ports.items():
                    ports_model[port_type] = [
                        PortDefinitionModel(
                            id=port.id,
                            name=port.name,
                            data_type=port.data_type,
                            required=port.required,
                            description=port.description,
                            port_type=port.port_type
                        ) for port in port_list
                    ]
                
                component_model = StrandsComponentModel(
                    id=comp.id,
                    name=comp.name,
                    category=comp.category,
                    description=comp.description,
                    icon=comp.icon,
                    config_schema=ComponentSchemaModel(
                        properties=comp.schema.properties,
                        required=comp.schema.required,
                        type=comp.schema.type
                    ),
                    default_config=comp.default_config,
                    ports=ports_model,
                    module_path=comp.module_path,
                    class_name=comp.class_name,
                    function_name=comp.function_name
                )
                component_models.append(component_model)
            
            categories_dict[category] = component_models
        
        return ComponentCategoriesResponse(categories=categories_dict)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve components by categories: {str(e)}")


@router.get("/{component_id}", response_model=StrandsComponentModel)
async def get_component(
    component_id: str,
    registry = Depends(get_component_registry)
):
    """
    Get a specific component by its ID
    
    Returns detailed information about a single component including its
    configuration schema and port definitions.
    """
    try:
        component = registry.get_component_by_id(component_id)
        
        if not component:
            raise HTTPException(status_code=404, detail=f"Component '{component_id}' not found")
        
        # Convert ports to API models
        ports_model = {}
        for port_type, port_list in component.ports.items():
            ports_model[port_type] = [
                PortDefinitionModel(
                    id=port.id,
                    name=port.name,
                    data_type=port.data_type,
                    required=port.required,
                    description=port.description,
                    port_type=port.port_type
                ) for port in port_list
            ]
        
        return StrandsComponentModel(
            id=component.id,
            name=component.name,
            category=component.category,
            description=component.description,
            icon=component.icon,
            config_schema=ComponentSchemaModel(
                properties=component.schema.properties,
                required=component.schema.required,
                type=component.schema.type
            ),
            default_config=component.default_config,
            ports=ports_model,
            module_path=component.module_path,
            class_name=component.class_name,
            function_name=component.function_name
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve component: {str(e)}")


@router.post("/validate", response_model=ComponentValidationResponse)
async def validate_component_configuration(
    request: ComponentValidationRequest,
    registry = Depends(get_component_registry)
):
    """
    Validate a component's configuration against its schema
    
    This endpoint validates the provided configuration against the component's
    schema definition and returns any validation errors or warnings.
    """
    try:
        validation_result = registry.validate_component_configuration(
            request.component_id,
            request.configuration
        )
        
        return ComponentValidationResponse(
            valid=validation_result["valid"],
            errors=validation_result.get("errors", []),
            warnings=validation_result.get("warnings", [])
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to validate configuration: {str(e)}")


@router.post("/refresh")
async def refresh_component_registry(
    registry = Depends(get_component_registry)
):
    """
    Refresh the component registry by re-discovering all components
    
    This endpoint forces a re-initialization of the component registry,
    useful when new tools or components have been installed.
    """
    try:
        # Reset the registry
        registry._components.clear()
        registry._initialized = False
        
        # Re-initialize
        success = registry.initialize()
        
        if not success:
            raise HTTPException(
                status_code=503,
                detail="Failed to refresh component registry"
            )
        
        component_count = len(registry.get_available_components())
        
        return JSONResponse(
            content={
                "message": "Component registry refreshed successfully",
                "component_count": component_count
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to refresh registry: {str(e)}")


@router.get("/health/status")
async def get_registry_status():
    """
    Get the health status of the component registry
    
    Returns information about the registry's initialization status and
    availability of the Strands SDK.
    """
    try:
        from ..services.component_registry import STRANDS_AVAILABLE
        
        status = {
            "strands_sdk_available": STRANDS_AVAILABLE,
            "registry_initialized": component_registry._initialized,
            "component_count": len(component_registry._components) if component_registry._initialized else 0
        }
        
        if not STRANDS_AVAILABLE:
            status["message"] = "Strands SDK is not available. Please install strands-agents and strands-agents-tools."
        elif not component_registry._initialized:
            status["message"] = "Component registry not initialized. Call /components/ to initialize."
        else:
            status["message"] = "Component registry is healthy and operational."
        
        return JSONResponse(content=status)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get registry status: {str(e)}")