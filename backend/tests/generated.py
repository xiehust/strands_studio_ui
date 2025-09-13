from strands import Agent, tool
from strands.models import BedrockModel
from strands_tools import calculator, file_read, shell, current_time
import json
import os
import asyncio
from strands.tools.mcp import MCPClient
from mcp import stdio_client, StdioServerParameters
from mcp.client.streamable_http import streamablehttp_client
from mcp.client.sse import sse_client
from strands.models.openai import OpenAIModel

@tool
def query_order(order_id:str):
  """query order status
  Arg: order_id
  Return: order status
  """
  return "Shipped"

# MCP Client Setup

# mcp_server MCP Client
mcp_server_client_1510 = MCPClient(
    lambda: streamablehttp_client("https://knowledge-mcp.global.api.aws")
)


@tool
def aws_agent_9392(user_input: str) -> str:
    """aws agent - You are an aws knowledge expert, can answer questions about IT/ Cloud/ AWS"""
    
    # Get MCP tools from global context
    global mcp_server_client_1510
    mcp_tools = []
    try:
        with mcp_server_client_1510:
            mcp_tools.extend(mcp_server_client_1510.list_tools_sync())
            print(f"aws agent mcp_tools:{mcp_tools}")
            # Create model for aws agent
            aws_agent_9392_model = BedrockModel(
                model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
                temperature=0.7,
                max_tokens=4000
            )
            
            # Create agent with MCP tools
            agent = Agent(
                model=aws_agent_9392_model,
                system_prompt="""You are an aws knowledge expert, can answer questions about IT/ Cloud/ AWS""",
                tools=mcp_tools
            )
            
            # Execute and return result
            response = agent(user_input)
            print(f"aws agent:{response}")
    except Exception as e:
        print(f"============={str(e)}")
    return str(response)

@tool
def calc_agent_6364(user_input: str) -> str:
    """calc Agent - You are a calculation expert"""
    
    # Create model for calc Agent
    calc_agent_6364_model = OpenAIModel(
            client_args={
                "api_key": os.environ.get("OPENAI_API_KEY"),
                "base_url": "https://api.siliconflow.cn/v1"
            },
            model_id="Qwen/Qwen3-30B-A3B-Instruct-2507",
            params={
                "max_tokens": 4000,
                "temperature": 0.7,
            }
        )
    
    # Create agent
    agent = Agent(
        model=calc_agent_6364_model,
        system_prompt="""You are a calculation expert""",
        tools=[calculator]
    )
    
    # Execute and return result
    response = agent(user_input)
    return str(response)

@tool
def agent_0393(user_input: str) -> str:
    """Agent - You are an order query agent"""
    
    # Create model for Agent
    agent_0393_model = BedrockModel(
            model_id="us.amazon.nova-pro-v1:0",
            temperature=0.7,
            max_tokens=4000
        )
    
    # Create agent
    agent = Agent(
        model=agent_0393_model,
        system_prompt="""You are an order query agent""",
        tools=[query_order]
    )
    
    # Execute and return result
    response = agent(user_input)
    return str(response)

@tool
def cs_agent_9779(user_input: str) -> str:
    """cs_agent - A customer service agent, handle customer complaints"""
    
    # Create model for cs_agent
    cs_agent_9779_model = BedrockModel(
            model_id="us.amazon.nova-pro-v1:0",
            temperature=0.7,
            max_tokens=4000
        )
    
    # Create agent
    agent = Agent(
        model=cs_agent_9779_model,
        system_prompt="""A customer service agent, handle customer complaints"""
    )
    
    # Execute and return result
    response = agent(user_input)
    return str(response)

@tool
def manager1_node_8684(user_input: str) -> str:
    """manager1_node - You are an orchestrator for knowledges of AWS and Math calculation, you are powered with specialized..."""
    
    # Create model for manager1_node
    manager1_node_8684_model = BedrockModel(
            model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
            temperature=0.7,
            max_tokens=4000
        )
    
    # Create orchestrator agent
    agent = Agent(
        model=manager1_node_8684_model,
        system_prompt="""You are an orchestrator for knowledges of AWS and Math calculation, you are powered with specialized agents""",
        tools=[aws_agent_9392, calc_agent_6364]
    )
    
    # Execute and return result
    response = agent(user_input)
    return str(response)

@tool
def manager2_agent_node_7359(user_input: str) -> str:
    """manager2-agent node - You are customer service orchestrator agent, you are powered with specialized agents"""
    
    # Create model for manager2-agent node
    manager2_agent_node_7359_model = BedrockModel(
            model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
            temperature=0.7,
            max_tokens=4000
        )
    
    # Create orchestrator agent
    agent = Agent(
        model=manager2_agent_node_7359_model,
        system_prompt="""You are customer service orchestrator agent, you are powered with specialized agents""",
        tools=[agent_0393, cs_agent_9779]
    )
    
    # Execute and return result
    response = agent(user_input)
    return str(response)

# manager1_node Configuration
manager1_node_model = BedrockModel(
    model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    temperature=0.7,
    max_tokens=4000
)

# manager1_node will be created in main() with MCP tools

# director-agent node Configuration
director_agent_node_model = BedrockModel(
    model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    temperature=0.7,
    max_tokens=4000
)

director_agent_node = Agent(
    model=director_agent_node_model,
    system_prompt="""You are an orchestrator, you are powered with specialized agents""",
    tools=[manager1_node_8684, manager2_agent_node_7359]
)

# manager2-agent node Configuration
manager2_agent_node_model = BedrockModel(
    model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    temperature=0.7,
    max_tokens=4000
)

manager2_agent_node = Agent(
    model=manager2_agent_node_model,
    system_prompt="""You are customer service orchestrator agent, you are powered with specialized agents""",
    tools=[agent_0393, cs_agent_9779]
)

# Main execution
async def main():
    global user_input, input_data, mcp_server_client_1510, query_order
    input_data = "explain what is aws private link"
    # Use MCP clients in context managers

    # Create orchestrator agent with MCP tools
    director_agent_node = Agent(
        model=director_agent_node_model,
        system_prompt="""You are an orchestrator, you are powered with specialized agents""",
        tools=[manager1_node_8684, manager2_agent_node_7359]
    )    
    # User input - prioritize input_data from execution panel
    if input_data is not None and input_data.strip():
        user_input = input_data.strip()
    else:
        # Default fallback
        user_input = "Hello, how can you help me?"
    
    # Execute agent (sync execution)
    response = director_agent_node(user_input)
    print("Agent Response:", str(response))
    
    return str(response)

if __name__ == "__main__":
    asyncio.run(main())