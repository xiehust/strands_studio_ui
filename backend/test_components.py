#!/usr/bin/env python3
"""
Test script for the Strands SDK component discovery service
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.services.component_registry import component_registry, ComponentType

def test_component_registry():
    """Test the component registry functionality"""
    print("Testing Strands SDK Component Registry")
    print("=" * 50)
    
    # Initialize the registry
    print("Initializing component registry...")
    success = component_registry.initialize()
    print(f"Initialization successful: {success}")
    
    if not success:
        print("Failed to initialize component registry")
        return
    
    # Get all components
    components = component_registry.get_available_components()
    print(f"\nTotal components discovered: {len(components)}")
    
    # Group by category
    categories = {}
    for comp in components:
        if comp.category not in categories:
            categories[comp.category] = []
        categories[comp.category].append(comp)
    
    print("\nComponents by category:")
    for category, comps in categories.items():
        print(f"  {category.value}: {len(comps)} components")
        for comp in comps[:3]:  # Show first 3 components
            print(f"    - {comp.name}: {comp.description}")
        if len(comps) > 3:
            print(f"    ... and {len(comps) - 3} more")
    
    # Test specific component retrieval
    print("\nTesting specific component retrieval:")
    test_component_id = "calculator"
    component = component_registry.get_component_by_id(test_component_id)
    if component:
        print(f"Found component: {component.name}")
        print(f"Description: {component.description}")
        print(f"Schema properties: {list(component.schema.properties.keys())}")
        print(f"Required fields: {component.schema.required}")
        print(f"Default config: {component.default_config}")
    else:
        print(f"Component '{test_component_id}' not found")
    
    # Test configuration validation
    print("\nTesting configuration validation:")
    if component:
        # Valid configuration
        valid_config = {"expression": "2 + 2"}
        validation = component_registry.validate_component_configuration(test_component_id, valid_config)
        print(f"Valid config validation: {validation}")
        
        # Invalid configuration (missing required field)
        invalid_config = {}
        validation = component_registry.validate_component_configuration(test_component_id, invalid_config)
        print(f"Invalid config validation: {validation}")

if __name__ == "__main__":
    test_component_registry()