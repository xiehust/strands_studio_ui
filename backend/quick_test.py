#!/usr/bin/env python3
"""
Quick test for component registry without external dependencies
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def test_imports():
    """Test if we can import the component registry"""
    try:
        from app.services.component_registry import component_registry, STRANDS_AVAILABLE
        print(f"Component registry imported successfully")
        print(f"Strands SDK available: {STRANDS_AVAILABLE}")
        
        if STRANDS_AVAILABLE:
            print("Attempting to initialize component registry...")
            success = component_registry.initialize()
            print(f"Initialization successful: {success}")
            
            if success:
                components = component_registry.get_available_components()
                print(f"Total components discovered: {len(components)}")
                
                # Show first few components
                for i, comp in enumerate(components[:5]):
                    print(f"  {i+1}. {comp.name} ({comp.category.value}): {comp.description}")
            else:
                print("Failed to initialize component registry")
        else:
            print("Strands SDK not available - this is expected in development environment")
            print("Component registry will work with mock data")
            
    except ImportError as e:
        print(f"Import error: {e}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_imports()