from strands import Agent, tool
from strands.models import BedrockModel, CacheConfig
from strands_tools import calculator, file_read, shell, current_time, http_request, editor, retrieve
import json
import os
import asyncio
import argparse
from strands.tools.mcp import MCPClient
from mcp import stdio_client, StdioServerParameters
from mcp.client.streamable_http import streamablehttp_client
from mcp.client.sse import sse_client

# MCP Client Setup

# docs_server MCP Client
docs_server_client_6003 = MCPClient(
    lambda: streamablehttp_client("http://localhost:8811/mcp"),
    startup_timeout=30
)


# Docs Agent Configuration
docs_agent_model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-6",
    temperature=0.7,
    max_tokens=4000
)

# Main execution
async def main(user_input_arg: str = None, messages_arg: str = None):
    global docs_server_client_6003

    # Use MCP clients in context managers (only those connected to execution agent)
    with docs_server_client_6003:
        # Get tools from MCP servers
        mcp_tools = []
        mcp_tools.extend(docs_server_client_6003.list_tools_sync())
        
        # Create agent with MCP tools
        docs_agent = Agent(
            model=docs_agent_model,
            system_prompt="""You are a documentation assistant. Use the available MCP tools to search and fetch documentation before answering.""",
            tools=mcp_tools,
            callback_handler=None
        )
        # User input from command-line arguments with priority: --messages > --user-input > default
        if messages_arg is not None and messages_arg.strip():
            # Parse messages JSON and pass full conversation history to agent
            try:
                messages_list = json.loads(messages_arg)
                # Pass the full messages list to the agent
                user_input = messages_list
            except (json.JSONDecodeError, KeyError, TypeError):
                user_input = "Hello, how can you help me?"
        elif user_input_arg is not None and user_input_arg.strip():
            user_input = user_input_arg.strip()
        else:
            # Default fallback when no input provided
            user_input = "Hello, how can you help me?"
        # Execute agent (sync execution)
        response = docs_agent(user_input)
        print(str(response))
        
        return str(response)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Execute Strands Agent')
    parser.add_argument('--user-input', type=str, help='User input prompt')
    parser.add_argument('--messages', type=str, help='JSON string of conversation messages')

    args = parser.parse_args()

    user_input_param = args.user_input
    messages_param = args.messages

    asyncio.run(main(user_input_param, messages_param))
