"""
AWS Bedrock AgentCore Runtime entrypoint for Strands Studio (direct code deploy).

The generated flow code is shipped VERBATIM alongside this file as
`generated_agent.py` (its `if __name__ == "__main__":` guard means nothing runs
on import) and imported lazily at invocation time. No text splicing of the
generated code is performed.

Contract with generated code (see src/lib/code-generator.ts):
- `async def main(user_input_arg: str = None, messages_arg: str = None)`
- sync flows: main() returns str(response) (and also prints it)
- streaming flows: main() prints chunks as they arrive
  (`print(event['data'], end='', flush=True)`) and returns None
"""
import asyncio
import contextlib
import inspect
import io
import json
import logging
import os
import traceback
from typing import Any, Dict, Optional

# Harden runtime: skip strands tool consent prompts (would hang headless runs)
os.environ.setdefault('BYPASS_TOOL_CONSENT', 'true')
os.environ.setdefault('STRANDS_NON_INTERACTIVE', 'true')

# Import AgentCore Runtime SDK
from bedrock_agentcore.runtime import BedrockAgentCoreApp

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AgentCore app
app = BedrockAgentCoreApp()

# Sentinel pushed into the stream queue when the agent task completes
_SENTINEL = object()


class _QueueWriter:
    """
    File-like stdout replacement that pushes every write() into an asyncio.Queue.

    Each write() call is forwarded immediately (chunks are small text pieces with
    no trailing newlines, so batching on newline would stall the stream). Writes
    are marshalled onto the event loop thread, so prints from worker threads
    (e.g. tool execution) are safe too.
    """

    def __init__(self, queue: "asyncio.Queue", loop: asyncio.AbstractEventLoop):
        self._queue = queue
        self._loop = loop

    def write(self, text: str) -> int:
        if text:
            try:
                self._loop.call_soon_threadsafe(self._queue.put_nowait, text)
            except RuntimeError:
                # Event loop already closed - drop the chunk
                pass
        return len(text)

    def flush(self) -> None:
        pass

    def isatty(self) -> bool:
        return False


def _load_generated_main():
    """Import the generated agent module and return its main() function."""
    # Lazy import so that import-time errors surface as invocation errors
    # (with traceback) instead of killing the runtime at startup.
    import generated_agent

    main_func = getattr(generated_agent, 'main', None)
    if main_func is None:
        raise RuntimeError(
            "generated_agent.py does not define a main() function. "
            "The deployed flow code is incompatible with this runtime entrypoint."
        )
    if not (inspect.iscoroutinefunction(main_func) or inspect.isasyncgenfunction(main_func)):
        raise RuntimeError(
            "generated_agent.main is not an async function. "
            "Expected 'async def main(user_input_arg=None, messages_arg=None)'."
        )
    return main_func


def _build_main_kwargs(main_func, prompt: str, messages_arg: Optional[str]) -> Dict[str, Any]:
    """Build kwargs for main() based on its actual signature (tolerates no-arg mains)."""
    try:
        params = inspect.signature(main_func).parameters
    except (TypeError, ValueError):
        params = {}
    kwargs: Dict[str, Any] = {}
    if 'user_input_arg' in params:
        kwargs['user_input_arg'] = prompt or None
    if 'messages_arg' in params:
        kwargs['messages_arg'] = messages_arg
    return kwargs


async def _execute_sync(prompt: str, messages_arg: Optional[str]) -> str:
    """
    Run the generated agent non-streaming.

    Response resolution: main()'s return value if it is a non-empty string,
    otherwise whatever the agent printed to stdout during execution.
    """
    main_func = _load_generated_main()
    kwargs = _build_main_kwargs(main_func, prompt, messages_arg)

    buffer = io.StringIO()
    if inspect.isasyncgenfunction(main_func):
        parts = []
        with contextlib.redirect_stdout(buffer):
            async for chunk in main_func(**kwargs):
                if chunk is not None:
                    parts.append(str(chunk))
        result: Any = ''.join(parts)
    else:
        with contextlib.redirect_stdout(buffer):
            result = await main_func(**kwargs)

    if isinstance(result, str) and result.strip():
        response = result
    else:
        response = buffer.getvalue()

    return json.dumps({
        'success': True,
        'response': response
    })


async def _execute_streaming(prompt: str, messages_arg: Optional[str]):
    """
    Run the generated agent with streaming.

    The generated main() prints chunks as they arrive; stdout is redirected into
    an asyncio.Queue and each chunk is yielded as a contentBlockDelta-shaped dict
    (BedrockAgentCoreApp serializes yielded objects). This shape is what the
    Strands Studio invoke service (_extract_text_from_data) parses.
    """
    try:
        main_func = _load_generated_main()
        kwargs = _build_main_kwargs(main_func, prompt, messages_arg)

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        writer = _QueueWriter(queue, loop)

        if inspect.isasyncgenfunction(main_func):
            async def _run():
                with contextlib.redirect_stdout(writer):
                    async for chunk in main_func(**kwargs):
                        if chunk:
                            queue.put_nowait(str(chunk))
        else:
            async def _run():
                with contextlib.redirect_stdout(writer):
                    await main_func(**kwargs)

        task = asyncio.create_task(_run())
        # The done callback runs on the loop after every already-scheduled
        # call_soon_threadsafe write, so the sentinel lands after all chunks.
        task.add_done_callback(lambda _t: queue.put_nowait(_SENTINEL))

        while True:
            chunk = await queue.get()
            if chunk is _SENTINEL:
                break
            yield {"event": {"contentBlockDelta": {"delta": {"text": chunk}}}}

        # Drain any stragglers (e.g. late writes from worker threads)
        while not queue.empty():
            chunk = queue.get_nowait()
            if chunk is not _SENTINEL:
                yield {"event": {"contentBlockDelta": {"delta": {"text": chunk}}}}

        exc = task.exception()
        if exc is not None:
            logger.error(f"Streaming agent execution failed: {exc}")
            yield {
                "error": str(exc),
                "type": "streaming_error",
                "traceback": ''.join(traceback.format_exception(type(exc), exc, exc.__traceback__))
            }

    except Exception as e:
        logger.error(f"Streaming setup failed: {e}\n{traceback.format_exc()}")
        yield {
            "error": str(e),
            "type": "streaming_error",
            "traceback": traceback.format_exc()
        }


@app.entrypoint
async def invoke(payload: Dict[str, Any]) -> Any:
    """
    AgentCore entrypoint for Strands agent execution.

    Expected payload format:
    {
        "prompt": "User input prompt",          # or "user_input"
        "messages": [...],                       # (optional) conversation history
        "api_keys": {
            "openai_api_key": "(optional)",
            "anthropic_api_key": "(optional)"
        },
        "streaming": false                       # (optional) enable streaming response
    }
    """
    logger.info(f"AgentCore invoke called with payload keys: {list(payload.keys())}")

    try:
        # Extract input from payload
        prompt = payload.get('prompt') or payload.get('user_input') or ''
        messages = payload.get('messages')
        api_keys = payload.get('api_keys', {}) or {}
        streaming = bool(payload.get('streaming', False))

        # Normalize messages to the JSON string the generated main() expects
        if isinstance(messages, str):
            messages_arg = messages if messages.strip() else None
        elif messages:
            messages_arg = json.dumps(messages)
        else:
            messages_arg = None

        if not prompt and not messages_arg:
            error_response = {
                'error': "Missing required field: provide 'prompt' (or 'user_input') or 'messages'",
                'type': 'validation_error'
            }
            if streaming:
                async def error_stream():
                    yield error_response
                return error_stream()
            return json.dumps(error_response)

        if prompt:
            logger.info(
                f"Processing prompt: {prompt[:100]}..." if len(prompt) > 100
                else f"Processing prompt: {prompt}"
            )

        # Set API keys as environment variables if provided
        if api_keys.get('openai_api_key'):
            os.environ['OPENAI_API_KEY'] = api_keys['openai_api_key']
            logger.info("OpenAI API key set from request")

        if api_keys.get('anthropic_api_key'):
            os.environ['ANTHROPIC_API_KEY'] = api_keys['anthropic_api_key']
            logger.info("Anthropic API key set from request")

        # Execute the generated Strands agent
        if streaming:
            return _execute_streaming(prompt, messages_arg)
        return await _execute_sync(prompt, messages_arg)

    except Exception as e:
        error_msg = f"Execution failed: {str(e)}"
        logger.error(f"{error_msg}\n{traceback.format_exc()}")

        error_response = {
            'error': error_msg,
            'type': 'execution_error',
            'traceback': traceback.format_exc()
        }

        if payload.get('streaming'):
            async def error_stream():
                yield error_response
            return error_stream()
        return json.dumps(error_response)


if __name__ == "__main__":
    app.run()
