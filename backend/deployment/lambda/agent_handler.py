"""
AWS Lambda Handler for Strands Agent
This handler serves as the entry point for Strands Agent execution in AWS Lambda.
"""
import json
import os
import logging
import traceback
from typing import Dict, Any, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    AWS Lambda handler function for Strands Agent execution.

    Args:
        event: Lambda event containing the request data
        context: Lambda context object

    Returns:
        Dict containing the response data

    Expected event format:
    {
        "prompt": "User input prompt",
        "input_data": "(optional) Additional input data",
        "api_keys": {
            "openai_api_key": "(optional) OpenAI API key",
            "anthropic_api_key": "(optional) Anthropic API key"
        }
    }
    """
    logger.info(f"Lambda handler invoked with event keys: {list(event.keys())}")

    try:
        # Extract input from event
        prompt = event.get('prompt', '')
        input_data = event.get('input_data')
        api_keys = event.get('api_keys', {})

        if not prompt:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({
                    'error': 'Missing required field: prompt'
                })
            }

        logger.info(f"Processing prompt: {prompt[:100]}..." if len(prompt) > 100 else f"Processing prompt: {prompt}")

        # Set API keys as environment variables if provided
        if api_keys.get('openai_api_key'):
            os.environ['OPENAI_API_KEY'] = api_keys['openai_api_key']
            logger.info("OpenAI API key set from request")

        if api_keys.get('anthropic_api_key'):
            os.environ['ANTHROPIC_API_KEY'] = api_keys['anthropic_api_key']
            logger.info("Anthropic API key set from request")

        # Execute the Strands agent
        response = execute_strands_agent(prompt, input_data)

        logger.info("Agent execution completed successfully")

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'success': True,
                'response': response,
                'execution_context': {
                    'function_name': context.function_name,
                    'function_version': context.function_version,
                    'request_id': context.aws_request_id,
                    'memory_limit': context.memory_limit_in_mb,
                    'remaining_time': context.get_remaining_time_in_millis()
                }
            })
        }

    except ImportError as e:
        error_msg = f"Missing dependencies: {str(e)}"
        logger.error(error_msg)
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': error_msg,
                'type': 'dependency_error'
            })
        }

    except Exception as e:
        error_msg = f"Execution failed: {str(e)}"
        logger.error(f"{error_msg}\n{traceback.format_exc()}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': error_msg,
                'type': 'execution_error',
                'traceback': traceback.format_exc()
            })
        }

def execute_strands_agent(prompt: str, input_data: Optional[str] = None) -> str:
    """
    Execute the Strands agent with the generated code.
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
            tools=[calculator, current_time]
        )

        # Use input_data if provided, otherwise use prompt
        user_input = input_data if input_data else prompt
        response = agent(user_input)

        return str(response)

    except Exception as e:
        logger.error(f"Error in execute_strands_agent: {e}")
        raise e