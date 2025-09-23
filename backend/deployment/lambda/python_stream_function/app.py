"""
FastAPI Lambda Function with Lambda Web Adapter (LWA) for Streaming
Provides SSE-based streaming for Strands Agent execution with RESPONSE_STREAM mode.
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
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Strands Agent Lambda Stream Function",
    description="Streaming Strands Agent execution with Lambda Web Adapter",
    version="1.0.0"
)

# Configure CORS - will be overridden by Lambda URL CORS settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Lambda URL CORS takes precedence
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/healthz")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "function_type": "python_stream", "invoke_mode": "RESPONSE_STREAM"}

@app.post("/invoke/stream")
async def invoke_stream_endpoint(request: Request):
    """
    Main streaming endpoint that mimics the original Lambda handler behavior.
    Returns SSE (Server-Sent Events) stream with JSON chunks.
    """
    logger.info("Python RESPONSE_STREAM handler invoked via /invoke/stream")
    logger.info(f"Request method: {request.method}")
    logger.info(f"Request headers: {dict(request.headers)}")
    logger.info(f"Request URL: {request.url}")

    try:
        # Parse request body - handle both JSON and form data
        body = {}

        # First, get raw body for debugging
        raw_body = await request.body()
        logger.info(f"Raw body length: {len(raw_body)}")
        logger.info(f"Raw body (first 200 chars): {raw_body[:200]}")

        try:
            # Parse raw body as JSON directly
            if raw_body:
                body = json.loads(raw_body.decode('utf-8'))
                logger.info(f"Successfully parsed JSON: {list(body.keys())}")
            else:
                logger.warning("Empty request body received")
                # Try query parameters as fallback
                body = dict(request.query_params)
                logger.info(f"Using query params: {list(body.keys())}")
        except Exception as json_error:
            logger.warning(f"Failed to parse JSON body: {json_error}")
            # Try query parameters as fallback
            body = dict(request.query_params)
            logger.info(f"Using query params as fallback: {list(body.keys())}")

        # Extract request parameters (same as original handler)
        prompt = body.get('prompt', '')
        input_data = body.get('input_data')
        api_keys = body.get('api_keys', {})

        # Handle api_keys if it's a string (from form data)
        if isinstance(api_keys, str):
            try:
                api_keys = json.loads(api_keys)
            except:
                api_keys = {}

        logger.info(f"Extracted prompt: '{prompt[:100]}{'...' if len(prompt) > 100 else ''}'")

        # Validate required fields
        if not prompt:
            raise HTTPException(status_code=400, detail="Missing required field: prompt")

        # Set API keys as environment variables
        setup_api_keys(api_keys)

        # Return streaming response
        return StreamingResponse(
            execute_agent_stream(prompt, input_data),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Handler execution failed: {str(e)}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Handler execution failed: {str(e)}")

async def execute_agent_stream(prompt: str, input_data: Optional[str] = None):
    """
    Execute agent in streaming mode and yield SSE-formatted chunks.
    Mimics the original streaming behavior with proper SSE format.
    """
    start_time = time.time()

    try:
        # Send initial meta frame
        yield f"data: {json.dumps({'type': 'meta', 'message': 'starting', 'invoke_mode': 'RESPONSE_STREAM'})}\n\n"

        logger.info("Starting RESPONSE_STREAM execution")

        # Import and reload generated agent
        import generated_agent
        importlib.reload(generated_agent)

        user_input = input_data if input_data else prompt
        logger.info(f"Executing agent in streaming mode with input: {user_input[:100]}...")

        # Check if agent supports streaming
        if hasattr(generated_agent, 'main') and callable(generated_agent.main):
            # Execute main function with streaming
            if hasattr(generated_agent, 'agent') and hasattr(generated_agent.agent, 'stream'):
                # Agent has streaming capability
                async for chunk in stream_agent_response(generated_agent, user_input):
                    yield f"data: {json.dumps({'type': 'delta', 'text': chunk})}\n\n"
            else:
                # Use real-time streaming execution
                async for chunk in execute_agent_with_real_streaming(generated_agent, user_input):
                    if chunk and chunk.strip():
                        yield f"data: {json.dumps({'type': 'delta', 'text': chunk})}\n\n"
                    await asyncio.sleep(0.01)  # Small delay for better streaming experience

        elif hasattr(generated_agent, 'agent') and callable(generated_agent.agent):
            # Direct agent execution - try streaming first
            if hasattr(generated_agent.agent, 'stream'):
                async for chunk in stream_agent_response(generated_agent, user_input):
                    yield f"data: {json.dumps({'type': 'delta', 'text': chunk})}\n\n"
            else:
                # Fallback: synchronous execution with stdout capture
                result = await asyncio.create_task(
                    asyncio.to_thread(lambda: generated_agent.agent(user_input))
                )
                result_str = str(result)

                # Stream result in chunks
                chunk_size = 100
                for i in range(0, len(result_str), chunk_size):
                    chunk = result_str[i:i + chunk_size]
                    yield f"data: {json.dumps({'type': 'delta', 'text': chunk})}\n\n"
                    await asyncio.sleep(0.01)
        else:
            raise RuntimeError("Generated agent module does not have a callable 'main' function or 'agent' object")

        execution_time = time.time() - start_time
        logger.info(f"RESPONSE_STREAM execution completed in {execution_time:.2f}s")

        # Send completion frame
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    except Exception as e:
        execution_time = time.time() - start_time
        error_msg = f"Agent execution failed after {execution_time:.2f}s: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())

        # Send error frame
        yield f"data: {json.dumps({'type': 'error', 'message': error_msg, 'traceback': traceback.format_exc()})}\n\n"

async def execute_agent_with_real_streaming(generated_agent, user_input: str):
    """
    Execute agent with real-time stdout capture for true streaming behavior.
    This captures print output as it happens and yields it immediately.
    """
    try:
        import io
        import threading
        from queue import Queue, Empty
        import subprocess
        import sys

        # Create a queue for real-time output
        output_queue = Queue()

        def capture_agent_output():
            """Run agent in separate thread and capture output"""
            try:
                import io
                import sys
                from contextlib import redirect_stdout

                # Custom stdout that feeds the queue
                class StreamingOutput(io.StringIO):
                    def __init__(self, queue):
                        super().__init__()
                        self.queue = queue

                    def write(self, text):
                        if text and text.strip():
                            self.queue.put(text)
                        return super().write(text)

                    def flush(self):
                        super().flush()

                # Redirect stdout to our streaming output
                streaming_stdout = StreamingOutput(output_queue)
                with redirect_stdout(streaming_stdout):
                    result = asyncio.run(generated_agent.main(user_input_arg=user_input))

                # Signal completion
                output_queue.put(None)  # End marker

                # If we got a result, also queue it
                if result and str(result).strip():
                    output_queue.put(str(result))
                    output_queue.put(None)  # End marker again

            except Exception as e:
                error_msg = f"Agent execution error: {str(e)}"
                output_queue.put(error_msg)
                output_queue.put(None)  # End marker

        # Start agent execution in background thread
        agent_thread = threading.Thread(target=capture_agent_output)
        agent_thread.daemon = True
        agent_thread.start()

        # Stream output as it becomes available
        collected_output = []

        while True:
            try:
                # Wait for output with timeout
                output = output_queue.get(timeout=1.0)

                if output is None:  # End marker
                    break

                collected_output.append(output)
                # Yield clean output without timestamps
                yield output

            except Empty:
                # No output available, continue waiting silently
                continue

        # Wait for thread to complete
        agent_thread.join(timeout=5.0)

        # If we didn't get any output, provide default message
        if not collected_output:
            yield "Agent executed successfully (no return value)"

    except Exception as e:
        logger.error(f"Real-time streaming execution failed: {str(e)}")
        logger.error(traceback.format_exc())
        yield f"Agent execution failed: {str(e)}"

async def stream_agent_response(generated_agent, user_input: str):
    """
    Stream agent response if the agent supports streaming.
    """
    try:
        if hasattr(generated_agent, 'agent') and hasattr(generated_agent.agent, 'stream'):
            # Use agent's streaming method
            async for chunk in generated_agent.agent.stream(user_input):
                if chunk:
                    yield str(chunk)
        elif hasattr(generated_agent.agent, 'invoke') and hasattr(generated_agent.agent.invoke, 'stream'):
            # Alternative streaming interface
            async for chunk in generated_agent.agent.invoke.stream({"input": user_input}):
                if chunk and hasattr(chunk, 'content'):
                    yield chunk.content
                elif chunk:
                    yield str(chunk)
        else:
            # No streaming support, fallback handled by caller
            raise NotImplementedError("Agent does not support streaming")

    except Exception as e:
        logger.warning(f"Streaming failed, falling back to sync: {str(e)}")
        raise NotImplementedError("Streaming not available")

def setup_api_keys(api_keys: Dict[str, str]):
    """Set up API keys as environment variables"""
    os.environ['BYPASS_TOOL_CONSENT'] = "true"

    if api_keys.get('openai_api_key'):
        os.environ['OPENAI_API_KEY'] = api_keys['openai_api_key']
        logger.info("OpenAI API key set from request")

    if api_keys.get('anthropic_api_key'):
        os.environ['ANTHROPIC_API_KEY'] = api_keys['anthropic_api_key']
        logger.info("Anthropic API key set from request")

# Lambda Web Adapter will handle the Lambda runtime integration
if __name__ == "__main__":
    import uvicorn
    # This will only run in local development
    uvicorn.run(app, host="0.0.0.0", port=8080)