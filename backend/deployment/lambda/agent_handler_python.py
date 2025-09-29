"""
AWS Lambda Handler for Strands Agent - Python BUFFERED Mode
Supports non-streaming execution with 6MB response limit.
Uses Function URL InvokeMode=BUFFERED for optimal performance.
"""
import json
import os
import sys
import logging
import traceback
import asyncio
import time
import importlib
from typing import Dict, Any, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    AWS Lambda handler for Python BUFFERED mode (non-streaming).

    Function URL event format (HTTP v2.0):
    - event.body: JSON string containing the request payload
    - event.headers: HTTP headers
    - event.requestContext: Request context information

    Args:
        event: Function URL event containing the request data
        context: Lambda context object

    Returns:
        Dict containing HTTP response with statusCode, headers, and body

    Expected request payload:
    {
        "prompt": "User input prompt",
        "input_data": "(optional) Additional input data",
        "api_keys": {
            "openai_api_key": "(optional) OpenAI API key",
            "anthropic_api_key": "(optional) Anthropic API key"
        }
    }
    """
    # Log request information for debugging
    logger.info(f"Python BUFFERED handler invoked")
    logger.info(f"Event keys: {list(event.keys())}")
    logger.info(f"HTTP Method: {event.get('requestContext', {}).get('http', {}).get('method', 'UNKNOWN')}")
    logger.info(f"Content-Type: {event.get('headers', {}).get('content-type', 'UNKNOWN')}")
    logger.info(f"Content-Length: {len(event.get('body', ''))}")
    logger.info(f"IsBase64Encoded: {event.get('isBase64Encoded', False)}")

    try:
        # Handle CORS preflight requests
        if event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
            return create_cors_response()

        # Parse Function URL event (HTTP v2.0 format)
        if 'body' in event:
            try:
                # Parse JSON from body string
                body_str = event['body']
                if not body_str:
                    # Try to get prompt from query parameters as fallback
                    query_params = event.get('queryStringParameters') or {}
                    prompt = query_params.get('prompt', '')
                    if not prompt:
                        return create_error_response(400, 'Missing request body and prompt query parameter')

                    # Create minimal payload from query parameters
                    parsed_body = {
                        'prompt': prompt,
                        'input_data': query_params.get('input_data'),
                        'api_keys': {}
                    }
                else:
                    parsed_body = json.loads(body_str)

            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON in body: {body_str[:200]}..., error: {str(e)}")
                return create_error_response(400, f'Invalid JSON in request body: {str(e)}')
        else:
            # Direct invocation format (for testing)
            parsed_body = event

        # Extract request parameters
        prompt = parsed_body.get('prompt', '')
        input_data = parsed_body.get('input_data')
        api_keys = parsed_body.get('api_keys', {})

        logger.info(f"Extracted prompt: '{prompt[:100]}{'...' if len(prompt) > 100 else ''}'")

        # Validate required fields
        if not prompt:
            return create_error_response(400, 'Missing required field: prompt')

        # Set API keys as environment variables
        setup_api_keys(api_keys)

        # Execute agent synchronously (BUFFERED mode)
        logger.info("Starting BUFFERED execution")
        start_time = time.time()

        try:
            response = execute_agent_sync(prompt, input_data)
            execution_time = time.time() - start_time

            logger.info(f"BUFFERED execution completed in {execution_time:.2f}s")
            logger.info(f"Response length: {len(str(response))} characters")

            # Check response size (6MB limit for BUFFERED mode)
            response_str = str(response)
            if len(response_str.encode('utf-8')) > 6 * 1024 * 1024:
                logger.warning("Response exceeds 6MB limit, truncating...")
                response_str = response_str[:6 * 1024 * 1024 - 1000] + "\n\n[Response truncated due to 6MB BUFFERED mode limit]"

            return create_success_response(response_str, context, {
                'execution_time': execution_time,
                'function_type': 'python_buffered',
                'invoke_mode': 'BUFFERED',
                'max_response_size': '6MB'
            })

        except Exception as e:
            execution_time = time.time() - start_time
            error_msg = f"Agent execution failed after {execution_time:.2f}s: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return create_error_response(500, error_msg, traceback.format_exc())

    except Exception as e:
        error_msg = f"Handler execution failed: {str(e)}"
        logger.error(f"{error_msg}\n{traceback.format_exc()}")
        return create_error_response(500, error_msg, traceback.format_exc())

def create_cors_response() -> Dict[str, Any]:
    """Create CORS preflight response"""
    return {
        'statusCode': 200,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
            'Access-Control-Max-Age': '3600'
        },
        'body': ''
    }

def setup_api_keys(api_keys: Dict[str, str]):
    """Set up API keys as environment variables"""
    os.environ['BYPASS_TOOL_CONSENT'] = "true"

    if api_keys.get('openai_api_key'):
        os.environ['OPENAI_API_KEY'] = api_keys['openai_api_key']
        logger.info("OpenAI API key set from request")

    if api_keys.get('anthropic_api_key'):
        os.environ['ANTHROPIC_API_KEY'] = api_keys['anthropic_api_key']
        logger.info("Anthropic API key set from request")

def create_error_response(status_code: int, error_msg: str, traceback_str: str = None) -> Dict[str, Any]:
    """Create standardized error response for Function URL"""
    body = {
        'success': False,
        'error': error_msg,
        'type': 'execution_error',
        'function_type': 'python_buffered',
        'invoke_mode': 'BUFFERED'
    }
    if traceback_str:
        body['traceback'] = traceback_str

    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
        },
        'body': json.dumps(body)
    }

def create_success_response(response: str, context, extra_info: Dict[str, Any] = None) -> Dict[str, Any]:
    """Create standardized success response for Function URL"""
    body = {
        'success': True,
        'response': response,
        'function_type': 'python_buffered',
        'invoke_mode': 'BUFFERED',
        'execution_context': {
            'function_name': context.function_name,
            'function_version': context.function_version,
            'request_id': context.aws_request_id,
            'memory_limit': context.memory_limit_in_mb,
            'remaining_time': context.get_remaining_time_in_millis()
        }
    }

    if extra_info:
        body.update(extra_info)

    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
        },
        'body': json.dumps(body)
    }

def execute_agent_sync(prompt: str, input_data: Optional[str] = None) -> str:
    """
    Execute agent in synchronous mode.
    This is optimized for BUFFERED Function URL mode.
    """
    try:
        import generated_agent
        importlib.reload(generated_agent)

        user_input = input_data if input_data else prompt
        logger.info(f"Executing agent synchronously with input: {user_input[:100]}...")

        if hasattr(generated_agent, 'main') and callable(generated_agent.main):
            # Execute main function and capture both return value and stdout
            import io
            import sys
            from contextlib import redirect_stdout

            # Capture stdout during execution
            captured_output = io.StringIO()
            with redirect_stdout(captured_output):
                result = asyncio.run(generated_agent.main(user_input_arg=user_input))

            # Get captured stdout
            stdout_content = captured_output.getvalue().strip()

            # Return result if available, otherwise return captured stdout, otherwise default message
            if result:
                return str(result)
            elif stdout_content:
                return stdout_content
            else:
                return "Agent executed successfully (no return value)"

        elif hasattr(generated_agent, 'agent') and callable(generated_agent.agent):
            # Direct agent execution
            response = generated_agent.agent(user_input)
            return str(response)

        else:
            raise RuntimeError("Generated agent module does not have a callable 'main' function or 'agent' object")

    except Exception as e:
        logger.error(f"Agent execution error: {str(e)}")
        logger.error(traceback.format_exc())
        raise RuntimeError(f"Agent execution failed: {str(e)}")