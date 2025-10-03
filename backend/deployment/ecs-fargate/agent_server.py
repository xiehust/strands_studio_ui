"""
Strands Agent HTTP Server for ECS Fargate Deployment
Provides HTTP endpoints for both synchronous and streaming agent execution.
"""
import os
import json
import logging
import asyncio
import traceback
import sys
from typing import Dict, Any, Optional, AsyncGenerator
from contextlib import asynccontextmanager
from io import StringIO

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Request models
class AgentRequest(BaseModel):
    """Request model for agent invocation"""
    prompt: str
    input_data: Optional[str] = None
    api_keys: Optional[Dict[str, str]] = None
    user_input: Optional[str] = None  # Alternative field name for compatibility
    messages: Optional[list] = None   # For conversation history

class HealthResponse(BaseModel):
    """Health check response model"""
    status: str
    service: str
    version: str
    timestamp: str

# Global variables for agent execution
agent_code_loaded = False
agent_main_function = None

def load_agent_code():
    """Load the generated agent code dynamically"""
    global agent_code_loaded, agent_main_function

    if agent_code_loaded:
        return

    try:
        # Import the generated agent code
        import generated_agent

        # Get the main function from generated code
        if hasattr(generated_agent, 'main'):
            agent_main_function = generated_agent.main
            logger.info("Agent main function loaded successfully")
        else:
            logger.error("Generated agent code does not have a 'main' function")
            raise ImportError("Generated agent code does not have a 'main' function")

        agent_code_loaded = True
        logger.info("Agent code loaded successfully")

    except ImportError as e:
        logger.error(f"Failed to import generated agent code: {e}")
        raise RuntimeError(f"Failed to load agent code: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan management"""
    # Startup
    logger.info("Starting Strands Agent Server...")
    try:
        load_agent_code()
        logger.info("Agent server startup completed")
    except Exception as e:
        logger.error(f"Failed to start agent server: {e}")
        raise

    yield

    # Shutdown
    logger.info("Shutting down Strands Agent Server...")

# Create FastAPI app
app = FastAPI(
    title="Strands Agent Server",
    description="HTTP server for Strands Agent execution in ECS Fargate",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

def setup_api_keys(api_keys: Optional[Dict[str, str]]):
    """Set API keys as environment variables"""
    if not api_keys:
        return

    for key, value in api_keys.items():
        if value:  # Only set non-empty values
            env_key = key.upper()
            if not env_key.endswith('_API_KEY'):
                env_key += '_API_KEY'
            os.environ[env_key] = value
            logger.info(f"Set environment variable: {env_key}")

def extract_prompt_and_input(request: AgentRequest) -> tuple[str, Optional[str]]:
    """Extract prompt and input data from request, handling multiple field names"""
    # Primary prompt field
    prompt = request.prompt

    # Fallback to user_input if prompt is empty
    if not prompt and request.user_input:
        prompt = request.user_input

    # Input data
    input_data = request.input_data

    return prompt, input_data

async def execute_agent(prompt: str, input_data: Optional[str] = None, messages: Optional[list] = None) -> str:
    """Execute the agent synchronously and capture all output"""
    if not agent_main_function:
        raise RuntimeError("Agent code not loaded")

    try:
        # Capture stdout to get print statements from agent
        old_stdout = sys.stdout
        captured_output = StringIO()
        sys.stdout = captured_output

        try:
            # Prepare arguments for the main function
            logger.info(f"Executing agent with prompt: {prompt[:100]}...")
            logger.info(f"Has messages: {bool(messages)}")

            if messages:
                # Pass conversation history if provided
                result = await agent_main_function(user_input_arg=prompt, messages_arg=json.dumps(messages))
            else:
                # Standard execution
                result = await agent_main_function(user_input_arg=prompt, messages_arg=None)

            # Get captured output
            output_text = captured_output.getvalue()

            logger.info(f"Agent result type: {type(result)}")
            logger.info(f"Agent result: {str(result)[:200] if result else 'None'}")
            logger.info(f"Captured output: {output_text[:200] if output_text else 'None'}")

            # Return captured output if available, otherwise the result
            if output_text.strip():
                logger.info("Returning captured output")
                return output_text.strip()
            elif result is not None:
                logger.info("Returning agent result")
                return str(result)
            else:
                logger.warning("Agent produced no output or result")
                return "Agent executed successfully (no output)"

        finally:
            # Always restore stdout
            sys.stdout = old_stdout

    except Exception as e:
        # Restore stdout in case of exception
        sys.stdout = old_stdout
        logger.error(f"Agent execution failed: {e}")
        logger.error(traceback.format_exc())
        raise RuntimeError(f"Agent execution failed: {str(e)}")

async def execute_agent_streaming(prompt: str, input_data: Optional[str] = None, messages: Optional[list] = None) -> AsyncGenerator[str, None]:
    """
    Execute agent in streaming mode and yield chunks (based on Lambda implementation).
    Mimics the Lambda streaming behavior with proper agent execution.
    """
    try:
        logger.info(f"Starting streaming execution with prompt: {prompt[:100]}...")
        logger.info(f"Has messages: {bool(messages)}")

        # Import and reload generated agent (like Lambda does)
        import generated_agent
        import importlib
        importlib.reload(generated_agent)

        user_input = input_data if input_data else prompt
        logger.info(f"Executing agent in streaming mode with input: {user_input[:100]}...")

        # Check if agent supports streaming (following Lambda's priority order)
        if hasattr(generated_agent, 'main') and callable(generated_agent.main):
            # Execute main function with streaming
            if hasattr(generated_agent, 'agent') and hasattr(generated_agent.agent, 'stream'):
                # Agent has streaming capability
                async for chunk in stream_agent_response(generated_agent, user_input):
                    yield chunk
            else:
                # Use real-time streaming execution (Lambda's approach)
                async for chunk in execute_agent_with_real_streaming(generated_agent, user_input, messages):
                    if chunk and chunk.strip():
                        yield chunk
                    await asyncio.sleep(0.01)  # Small delay for better streaming experience

        elif hasattr(generated_agent, 'agent') and callable(generated_agent.agent):
            # Direct agent execution - try streaming first
            if hasattr(generated_agent.agent, 'stream'):
                async for chunk in stream_agent_response(generated_agent, user_input):
                    yield chunk
            else:
                # Fallback: synchronous execution with chunking
                result = await asyncio.create_task(
                    asyncio.to_thread(lambda: generated_agent.agent(user_input))
                )
                result_str = str(result)

                # Stream result in chunks (Lambda's approach)
                chunk_size = 100
                for i in range(0, len(result_str), chunk_size):
                    chunk = result_str[i:i + chunk_size]
                    yield chunk
                    await asyncio.sleep(0.01)
        else:
            raise RuntimeError("Generated agent module does not have a callable 'main' function or 'agent' object")

        logger.info("Streaming execution completed successfully")

    except Exception as e:
        logger.error(f"Streaming agent execution failed: {e}")
        logger.error(traceback.format_exc())
        yield f"Error: Agent execution failed: {str(e)}"


async def execute_agent_with_real_streaming(generated_agent, user_input: str, messages: Optional[list] = None):
    """
    Execute agent with real-time stdout capture for true streaming behavior.
    Based on Lambda's implementation but adapted for ECS.
    """
    try:
        import threading
        from queue import Queue, Empty
        from contextlib import redirect_stdout

        # Create a queue for real-time output
        output_queue = Queue()

        def capture_agent_output():
            """Run agent in separate thread and capture output"""
            try:
                # Custom stdout that feeds the queue
                class StreamingOutput(StringIO):
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
                    # Call main function with appropriate parameters
                    if messages:
                        result = asyncio.run(generated_agent.main(user_input_arg=user_input, messages_arg=json.dumps(messages)))
                    else:
                        result = asyncio.run(generated_agent.main(user_input_arg=user_input, messages_arg=None))

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
                # Yield clean output
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
    Based on Lambda's implementation.
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

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    from datetime import datetime

    return HealthResponse(
        status="healthy",
        service="strands-agent-server",
        version="1.0.0",
        timestamp=datetime.utcnow().isoformat()
    )

@app.post("/invoke")
async def invoke_agent(request: AgentRequest):
    """Synchronous agent invocation endpoint"""
    try:
        # Setup API keys
        setup_api_keys(request.api_keys)

        # Extract prompt and input
        prompt, input_data = extract_prompt_and_input(request)

        if not prompt:
            raise HTTPException(status_code=400, detail="Missing required field: prompt or user_input")

        logger.info(f"Synchronous invocation - prompt: {prompt[:100]}...")

        # Execute agent
        result = await execute_agent(prompt, input_data, request.messages)

        return {
            "success": True,
            "response": result,
            "type": "sync"
        }

    except Exception as e:
        logger.error(f"Synchronous invocation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/invoke-stream")
async def stream_agent(request: AgentRequest):
    """Streaming agent invocation endpoint"""
    try:
        # Setup API keys
        setup_api_keys(request.api_keys)

        # Extract prompt and input
        prompt, input_data = extract_prompt_and_input(request)

        if not prompt:
            raise HTTPException(status_code=400, detail="Missing required field: prompt or user_input")

        logger.info(f"Streaming invocation - prompt: {prompt[:100]}...")

        async def generate_stream():
            """Generate SSE stream"""
            try:
                async for chunk in execute_agent_streaming(prompt, input_data, request.messages):
                    if chunk:
                        # Format as Server-Sent Events
                        yield f"data: {json.dumps({'type': 'delta', 'text': chunk})}\n\n"

                # Send completion signal
                yield f"data: {json.dumps({'type': 'done'})}\n\n"

            except Exception as e:
                # Send error
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        return StreamingResponse(
            generate_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"  # Disable nginx buffering
            }
        )

    except Exception as e:
        logger.error(f"Streaming invocation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "strands-agent-server",
        "version": "1.0.0",
        "status": "running",
        "endpoints": [
            "/health - Health check",
            "/invoke - Synchronous agent invocation",
            "/invoke-stream - Streaming agent invocation"
        ]
    }

if __name__ == "__main__":
    # Get configuration from environment
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))

    logger.info(f"Starting Strands Agent Server on {host}:{port}")

    # Run the server
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        access_log=True
    )