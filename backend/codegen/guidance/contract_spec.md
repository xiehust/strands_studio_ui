# Generated Code Contract Specification

Every generated `generated_agent.py` MUST satisfy ALL rules in this document.
These are hard requirements — the file is consumed verbatim by three independent
runtime paths (local execution, chat conversation subprocess, AWS AgentCore
deployment). Violating any rule breaks at least one of them. A deterministic
validation pipeline (AST checks, lint, import smoke test) rejects non-conforming
output.

## 1. Module-level async `main` with exact signature

The file must define, at module top level:

```python
async def main(user_input_arg: str = None, messages_arg: str = None):
```

- The parameter names `user_input_arg` and `messages_arg` are exact and
  mandatory (a deployment runtime introspects them with `inspect.signature`).
- Both parameters must have `None` defaults so `main()` is callable with no
  arguments.
- `main()` must **return the final result as a string** AND **print** the
  output (callers use both: the in-process path reads the return value, the
  subprocess path reads stdout).

## 2. CLI entrypoint with `--user-input` / `--messages`

The file must end with an `if __name__ == "__main__":` guard that parses both
flags with argparse and runs main:

```python
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Execute Strands Agent')
    parser.add_argument('--user-input', type=str, help='User input prompt')
    parser.add_argument('--messages', type=str, help='JSON string of conversation messages')

    args = parser.parse_args()

    user_input_param = args.user_input
    messages_param = args.messages

    asyncio.run(main(user_input_param, messages_param))
```

## 3. Input priority: `--messages` > `--user-input` > default

Inside `main()`, resolve the effective input in this exact priority order:

```python
if messages_arg is not None and messages_arg.strip():
    try:
        messages_list = json.loads(messages_arg)
        user_input = messages_list          # full conversation history
    except (json.JSONDecodeError, KeyError, TypeError):
        user_input = "Hello, how can you help me?"
elif user_input_arg is not None and user_input_arg.strip():
    user_input = user_input_arg.strip()
else:
    user_input = "Hello, how can you help me?"
```

The `--messages` value is a JSON array in this schema (Bedrock Converse-style):

```json
[
  {"role": "user", "content": [{"text": "First question"}]},
  {"role": "assistant", "content": [{"text": "First answer"}]},
  {"role": "user", "content": [{"text": "Follow-up question"}]}
]
```

- Regular agents, orchestrators, and graphs accept the full `messages_list`
  directly as input (`agent(messages_list)` / `graph(messages_list)`).
- **Swarm exception**: `Swarm.__call__` only accepts `str | list[ContentBlock]`,
  so for swarms use the last message's content instead:
  `user_input = messages_list[-1]['content']`.

## 4. Every `Agent(...)` must pass `callback_handler=None`

Every single `Agent(...)` constructor call in the file — top-level agents,
agents created inside `@tool` wrapper functions, agents created inside `main()`
with MCP context — must include the keyword argument `callback_handler=None`.
Without it, Strands installs a default printing handler that duplicates
streamed output. No exceptions.

## 5. Streaming consistency (string-sniffed by the platform)

The frontend and backend detect streaming by literally searching the code text
for the string `stream_async`. Therefore:

- If ANY agent in the flow has `"streaming": true` in its node data, execution
  of that agent MUST use the streaming pattern and print chunks incrementally:

```python
    # Execute agent with streaming
    async for event in my_agent.stream_async(user_input):
        if "data" in event:
            print(event['data'], end='', flush=True)
```

  (In streaming mode `main()` prints chunks; it does not need to return the
  accumulated text, though returning it is allowed.)

- If NO agent has `"streaming": true`, the string `stream_async` MUST NOT
  appear anywhere in the file — not in code, not in comments, not in strings.
  Use synchronous execution instead:

```python
    response = my_agent(user_input)
    print(str(response))
    return str(response)
```

Swarm and graph executions are always synchronous (never `stream_async`).

## 6. Import must be side-effect free

`import generated_agent` must succeed without executing the workflow, making
network calls, spawning processes, or blocking. Allowed at module top level:

- imports
- constants
- `def` / `class` / `@tool`-decorated functions
- model construction (`BedrockModel(...)`, `OpenAIModel(...)`,
  `OpenAIResponsesModel(...)`)
- agent construction (`Agent(...)`), `Swarm(...)` construction
- `MCPClient(...)` construction (stores the transport factory; it does NOT
  connect — connections only happen inside `with client:` blocks)
- `GraphBuilder()` setup calls (`builder.add_node(...)`, `builder.add_edge(...)`,
  `builder.set_entry_point(...)`, `graph = builder.build()`)

Forbidden at module top level:

- calling `main()` or `asyncio.run(...)` (only inside the `__main__` guard)
- invoking any agent / swarm / graph
- entering an MCP client context (`with client:` belongs inside `main()` or a
  `@tool` function)
- `parser.parse_args()` (only inside the `__main__` guard)
- reading stdin, `input()`, `sys.exit()`

## 7. Required imports

Always include (matching what the code actually uses):

```python
from strands import Agent, tool
from strands.models import BedrockModel
import json
import os
import asyncio
import argparse
```

Conditionally include:

- `from strands_tools import calculator, file_read, shell, current_time, http_request, editor, retrieve` — when built-in tools are used
- `from strands.models.openai import OpenAIModel` — OpenAI provider
- `from strands.models.openai_responses import OpenAIResponsesModel` — Amazon Bedrock (Mantle) provider
- `from strands.multiagent import Swarm` — swarm nodes
- `from strands.multiagent import GraphBuilder` — graph mode
- MCP tools:
  ```python
  from strands.tools.mcp import MCPClient
  from mcp import stdio_client, StdioServerParameters
  from mcp.client.streamable_http import streamablehttp_client
  from mcp.client.sse import sse_client
  ```

## 8. Secrets

Never hardcode API keys or credentials. Even if the flow JSON contains an
`apiKey` field, always read from environment variables in generated code:

- OpenAI: `"api_key": os.environ.get("OPENAI_API_KEY")`
- Amazon Bedrock (Mantle): `"api_key": os.environ.get("BEDROCK_API_KEY")`
- AWS Bedrock (`BedrockModel`): no key argument — uses ambient AWS credentials.

## 9. General code quality

- Target Python 3.12+ (the runtime is 3.13); standard library + `strands`,
  `strands_tools`, `mcp` only. No other third-party imports.
- The file must be plain Python source — no markdown code fences, no
  surrounding prose.
- Python identifiers derived from node labels: lowercase the label and replace
  every non-alphanumeric character with `_`, collapsing repeats
  (e.g. `"Research Agent"` → `research_agent`). Keep names unique.
