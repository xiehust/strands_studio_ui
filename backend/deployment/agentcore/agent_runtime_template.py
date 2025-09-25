"""
AWS Bedrock AgentCore Runtime Template for Strands Agent
This template serves as the entry point for Strands Agent execution in AgentCore.
"""
import json
import os
import logging
import traceback
import asyncio
from typing import Dict, Any, Optional, AsyncGenerator

# Import AgentCore Runtime SDK
from bedrock_agentcore.runtime import BedrockAgentCoreApp

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AgentCore app
app = BedrockAgentCoreApp()

@app.entrypoint
async def invoke(payload: Dict[str, Any]) -> Any:
    """
    AgentCore entrypoint function for Strands Agent execution.
    
    Args:
        payload: AgentCore payload containing the request data
        
    Returns:
        Agent response (string for sync, generator for streaming)
        
    Expected payload format:
    {
        "prompt": "User input prompt",
        "input_data": "(optional) Additional input data",
        "api_keys": {
            "openai_api_key": "(optional) OpenAI API key",
            "anthropic_api_key": "(optional) Anthropic API key"
        },
        "streaming": false  # (optional) Enable streaming response
    }
    """
    logger.info(f"AgentCore invoke called with payload keys: {list(payload.keys())}")
    
    try:
        # Extract input from payload
        prompt = payload.get('prompt', '')
        input_data = payload.get('input_data')
        api_keys = payload.get('api_keys', {})
        streaming = payload.get('streaming', False)
        
        if not prompt:
            error_response = {
                'error': 'Missing required field: prompt',
                'type': 'validation_error'
            }
            if streaming:
                async def error_stream():
                    yield json.dumps(error_response)
                return error_stream()
            else:
                return json.dumps(error_response)
        
        logger.info(f"Processing prompt: {prompt[:100]}..." if len(prompt) > 100 else f"Processing prompt: {prompt}")
        
        # Set API keys as environment variables if provided
        if api_keys.get('openai_api_key'):
            os.environ['OPENAI_API_KEY'] = api_keys['openai_api_key']
            logger.info("OpenAI API key set from request")
            
        if api_keys.get('anthropic_api_key'):
            os.environ['ANTHROPIC_API_KEY'] = api_keys['anthropic_api_key']
            logger.info("Anthropic API key set from request")
        
        # Execute the Strands agent
        if streaming:
            return execute_strands_agent_streaming(prompt, input_data)
        else:
            response = await execute_strands_agent(prompt, input_data)
            return json.dumps({
                'success': True,
                'response': response
            })
            
    except Exception as e:
        error_msg = f"Execution failed: {str(e)}"
        logger.error(f"{error_msg}\n{traceback.format_exc()}")
        
        error_response = {
            'error': error_msg,
            'type': 'execution_error',
            'traceback': traceback.format_exc()
        }
        
        if streaming:
            async def error_stream():
                yield json.dumps(error_response)
            return error_stream()
        else:
            return json.dumps(error_response)

async def execute_strands_agent(prompt: str, input_data: Optional[str] = None) -> str:
    """
    Execute the Strands agent with the generated code (sync version).
    This function will be populated with the actual generated agent code.
    
    Args:
        prompt: User input prompt
        input_data: Optional additional input data
        
    Returns:
        Agent response as string
    """
    try:
        # Import Strands dependencies
        from strands import Agent, tool
        from strands.models import BedrockModel
        from strands_tools import calculator, file_read, shell, current_time
        
        # Import OpenAI model if needed
        try:
            from strands.models.openai import OpenAIModel
        except ImportError:
            OpenAIModel = None
            logger.warning("OpenAI model not available")
            
        # Import MCP dependencies if needed
        try:
            from strands.tools.mcp import MCPClient
            from mcp import stdio_client, StdioServerParameters
            from mcp.client.streamable_http import streamablehttp_client
            from mcp.client.sse import sse_client
        except ImportError:
            logger.warning("MCP dependencies not available")
            
        # Set bypass tool consent
        os.environ['BYPASS_TOOL_CONSENT'] = "true"
        
        # This is a placeholder - the actual generated code will be injected here
        # The generated code should define the main agent and its execution logic
        
        # Default simple agent for testing
        model = BedrockModel(
            model_id="us.anthropic.claude-3-haiku-20240307-v1:0",
            temperature=0.7,
            max_tokens=4000
        )
        
        agent = Agent(
            model=model,
            system_prompt="You are a helpful AI assistant.",
            tools=[calculator, current_time],
            callback_handler=None  # Prevent streaming duplication
        )
        
        # Use input_data if provided, otherwise use prompt
        user_input = input_data if input_data else prompt
        response = agent(user_input)
        
        return str(response)
        
    except Exception as e:
        logger.error(f"Error in execute_strands_agent: {e}")
        raise e

async def execute_strands_agent_streaming(prompt: str, input_data: Optional[str] = None) -> AsyncGenerator[str, None]:
    """
    Execute the Strands agent with streaming response.
    This function will be populated with the actual generated agent code.
    
    Args:
        prompt: User input prompt
        input_data: Optional additional input data
        
    Yields:
        Agent response chunks as strings
    """
    try:
        # Import Strands dependencies
        from strands import Agent, tool
        from strands.models import BedrockModel
        from strands_tools import calculator, file_read, shell, current_time
        
        # Set bypass tool consent
        os.environ['BYPASS_TOOL_CONSENT'] = "true"
        
        # This is a placeholder - the actual generated streaming code will be injected here
        
        # Default streaming agent for testing
        model = BedrockModel(
            model_id="us.anthropic.claude-3-haiku-20240307-v1:0",
            temperature=0.7,
            max_tokens=4000
        )
        
        agent = Agent(
            model=model,
            system_prompt="You are a helpful AI assistant.",
            tools=[calculator, current_time],
            callback_handler=None  # Prevent streaming duplication
        )
        
        # Use input_data if provided, otherwise use prompt
        user_input = input_data if input_data else prompt
        
        # Stream the response
        async for chunk in agent.stream_async(user_input):
            yield json.dumps({'chunk': str(chunk)})
            
    except Exception as e:
        logger.error(f"Error in execute_strands_agent_streaming: {e}")
        yield json.dumps({'error': str(e), 'type': 'streaming_error'})

if __name__ == "__main__":
    app.run()
