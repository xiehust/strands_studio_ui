from strands import Agent, tool
from strands.models import BedrockModel
from strands_tools import calculator, file_read, shell, current_time
import json
from strands.tools.mcp import MCPClient
from mcp import stdio_client, StdioServerParameters
from mcp.client.streamable_http import streamablehttp_client
from mcp.client.sse import sse_client

@tool
def couter(text:str):
   """count the length of text"""
   return len(text)

# MCP Client Setup

# mcp_server MCP Client
mcp_server_client_4989 = MCPClient(
    lambda: streamablehttp_client("https://knowledge-mcp.global.api.aws")
)

# mcp_server MCP Client
mcp_server_client_0647 = MCPClient(lambda: stdio_client(
    StdioServerParameters(
        command="npx",
        args=["-y","tavily-mcp@latest"],
        env={"TAVILY_API_KEY":"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"}
    )
))


@tool
def math_agent_4216(user_input: str) -> str:
    """math_agent - You are a math assistant"""
    
    # Create model for math_agent
    math_agent_4216_model = BedrockModel(
        model_id="openai.gpt-oss-120b-1:0",
        temperature=0.7,
        max_tokens=4000
    )
    
    # Create agent
    agent = Agent(
        model=math_agent_4216_model,
        system_prompt="""You are a math assistant""",
        tools=[calculator]
    )
    
    # Execute and return result
    response = agent(user_input)
    return str(response)

@tool
def language_agent_0414(user_input: str) -> str:
    """language_agent - You are a language assistant"""
    
    # Create model for language_agent
    language_agent_0414_model = BedrockModel(
        model_id="openai.gpt-oss-120b-1:0",
        temperature=0.7,
        max_tokens=4000
    )
    
    # Create agent
    agent = Agent(
        model=language_agent_0414_model,
        system_prompt="""You are a language assistant""",
        tools=[couter]
    )
    
    # Execute and return result
    response = agent(user_input)
    return str(response)

@tool
def aws_agent_5915(user_input: str) -> str:
    """aws_agent - You are an AWS knowledge expert"""
    
    # Get MCP tools from global context
    global mcp_server_client_4989
    mcp_tools = []
    with mcp_server_client_4989:
        mcp_tools.extend(mcp_server_client_4989.list_tools_sync())
        
        # Create model for aws_agent
        aws_agent_5915_model = BedrockModel(
            model_id="openai.gpt-oss-120b-1:0",
            temperature=0.7,
            max_tokens=4000
        )
        
        # Create agent with MCP tools
        agent = Agent(
            model=aws_agent_5915_model,
            system_prompt="""You are an AWS knowledge expert""",
            tools=mcp_tools
        )
        
        # Execute and return result
        response = agent(user_input)
    return str(response)

# orchestrator-agent node Configuration
orchestrator_agent_node_model = BedrockModel(
    model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    temperature=0.7,
    max_tokens=4000
)

# orchestrator_agent_node will be created in main() with MCP tools

# Main execution
def main():
    global user_input, input_data, mcp_server_client_4989, mcp_server_client_0647, couter
    
    # Use MCP clients in context managers
    with mcp_server_client_4989, mcp_server_client_0647:
        # Get tools from MCP servers
        mcp_tools = []
        mcp_tools.extend(mcp_server_client_4989.list_tools_sync())
        mcp_tools.extend(mcp_server_client_0647.list_tools_sync())
        
        # Create orchestrator agent with MCP tools
        orchestrator_agent_node = Agent(
            model=orchestrator_agent_node_model,
            system_prompt="""You are a teacher assistant""",
            tools=mcp_tools + [math_agent_4216, language_agent_0414, aws_agent_5915]
        )    
        # User input - prioritize input_data from execution panel
        if input_data is not None and input_data.strip():
            user_input = input_data.strip()
        else:
            # Default fallback
            user_input = "Hello, how can you help me?"
        
        # Execute agent
        response = orchestrator_agent_node(user_input)
        print("Agent Response:", str(response))
        
        return str(response)

if __name__ == "__main__":
    main()