#!/usr/bin/env python3

import requests
import json

def test_mcp_tool_integration():
    print("Testing MCP tool integration...")
    
    # Test code with MCP tool and environment variables
    test_code = '''
from strands import Agent, tool
from strands.models import BedrockModel
from strands_tools import calculator, file_read, shell, current_time
from strands.tools.mcp import MCPClient
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client
from mcp.client.sse import sse_client
from mcp.shared.cli import StdioServerParameters
import json

# MCP Client Setup

# weather_server MCP Client
weather_server_client = MCPClient(lambda: stdio_client(
    StdioServerParameters(
        command="uvx",
        args=["weather-server@latest"],
        env={"API_KEY": "test-key", "DEBUG": "true"}
    )
))

# Test Agent Configuration
test_agent_model = BedrockModel(
    model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    temperature=0.7,
    max_tokens=4000
)

test_agent = Agent(
    model=test_agent_model,
    system_prompt="""You are a helpful assistant with weather tools.""",
    tools=[calculator, *weather_server_client.list_tools()]
)

# Main execution
def main():
    # Access the global agent variable
    global test_agent, weather_server_client
    
    # Use MCP clients in context managers
    with weather_server_client.connect():
        
        # User input from connected input node
        user_input = "What's the weather like in San Francisco?"
        
        # Execute agent
        response = test_agent(user_input)
        print("Agent Response:", str(response))
        
        return str(response)

if __name__ == "__main__":
    main()
'''

    try:
        print("=== Testing MCP integration endpoint ===")
        response = requests.post(
            "http://localhost:8000/api/execute",
            json={"code": test_code},
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ MCP integration endpoint is accessible")
            print("Execution result:")
            if result['result']['success']:
                print("✅ Code executed successfully")
                print("Output:", result['result']['output'])
            else:
                print("⚠️ Code execution failed (expected if MCP server not available)")
                print("Error:", result['result']['error'])
        else:
            print(f"❌ FAILURE: Status {response.status_code}")
            print("Response:", response.text)
            
    except Exception as e:
        print(f"❌ ERROR: {e}")

if __name__ == "__main__":
    test_mcp_tool_integration()