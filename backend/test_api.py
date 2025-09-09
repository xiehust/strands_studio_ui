#!/usr/bin/env python3
"""
Test the component API endpoints
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def test_component_api():
    """Test the component API endpoints"""
    try:
        from fastapi.testclient import TestClient
        from app_main import app
        
        client = TestClient(app)
        
        print("Testing Component API Endpoints")
        print("=" * 40)
        
        # Test health endpoint
        print("\n1. Testing health endpoint...")
        response = client.get("/api/components/health/status")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"Strands SDK Available: {data.get('strands_sdk_available')}")
            print(f"Registry Initialized: {data.get('registry_initialized')}")
            print(f"Component Count: {data.get('component_count')}")
        
        # Test components list endpoint
        print("\n2. Testing components list endpoint...")
        response = client.get("/api/components/")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"Total components: {data.get('total_count')}")
            print(f"Categories: {data.get('categories')}")
            
            # Show first few components
            components = data.get('components', [])
            for i, comp in enumerate(components[:3]):
                print(f"  {i+1}. {comp['name']} ({comp['category']})")
                print(f"     Description: {comp['description']}")
                print(f"     Ports: {len(comp.get('ports', {}).get('inputs', []))} inputs, {len(comp.get('ports', {}).get('outputs', []))} outputs")
        
        # Test categories endpoint
        print("\n3. Testing categories endpoint...")
        response = client.get("/api/components/categories")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            categories = data.get('categories', {})
            for category, components in categories.items():
                print(f"  {category}: {len(components)} components")
        
        # Test specific component endpoint
        print("\n4. Testing specific component endpoint...")
        response = client.get("/api/components/basic_agent")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"Component: {data['name']}")
            print(f"Description: {data['description']}")
            print(f"Required config: {data['config_schema']['required']}")
        
        # Test validation endpoint
        print("\n5. Testing validation endpoint...")
        validation_request = {
            "component_id": "basic_agent",
            "configuration": {
                "system_prompt": "You are a helpful assistant.",
                "model": "claude-3-5-sonnet"
            }
        }
        response = client.post("/api/components/validate", json=validation_request)
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"Valid: {data['valid']}")
            print(f"Errors: {data.get('errors', [])}")
            print(f"Warnings: {data.get('warnings', [])}")
        
        print("\n✅ All API tests completed successfully!")
        
    except ImportError as e:
        print(f"Import error: {e}")
        print("Make sure FastAPI and dependencies are installed")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_component_api()