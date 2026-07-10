# flow.json Semantics

`flow.json` describes a visual agent workflow as a node/edge graph. Your job is
to translate it into Strands Agents Python code that satisfies
`contract_spec.md`.

## Top-level structure

```json
{
  "nodes": [ { "id": "...", "type": "...", "position": {...}, "data": {...} } ],
  "edges": [ { "id": "...", "source": "...", "target": "...", "sourceHandle": "...", "targetHandle": "..." } ],
  "graph_mode": false
}
```

- `position`, `width`, `height`, `selected`, `dragging` on nodes are canvas
  layout only — **ignore them**, they never affect code.
- `graph_mode: true` switches the whole flow to DAG orchestration with
  `strands.multiagent.GraphBuilder` (see "Graph mode" below).
- Edge `sourceHandle` / `targetHandle` carry the connection semantics — they
  are the most important routing signal in the file.

## Node types and their `data` fields

Unset fields fall back to the defaults shown in parentheses.

### `agent` — a single AI agent

| Field | Meaning |
|---|---|
| `label` | Display name; sanitize to derive the Python variable name |
| `modelProvider` | `"AWS Bedrock"` (default) \| `"OpenAI"` \| `"Amazon Bedrock (Mantle)"` |
| `modelId` | Bedrock model id (e.g. `global.anthropic.claude-sonnet-4-6`); used when provider is AWS Bedrock |
| `modelName` | Model identifier used for the OpenAI and Mantle providers (e.g. `gpt-4o`) |
| `systemPrompt` | System prompt string (`"You are a helpful AI assistant."`) |
| `temperature` | 0–1 float (0.7) |
| `maxTokens` | int (4000) |
| `streaming` | bool (false). If true AND this agent is the execution agent → use `stream_async` (contract rule 5) |
| `thinkingEnabled` | bool (false). Enables extended thinking / reasoning |
| `reasoningEffort` | `"low"|"medium"|"high"|"xhigh"|"max"` (`"medium"`; legacy `"minimal"` normalizes to `"low"`); only meaningful with `thinkingEnabled` on non-Bedrock providers |
| `apiKey` | Never emit its value — always read keys from env (contract rule 8) |
| `baseUrl` | Optional custom endpoint (OpenAI); auto-set regional endpoint for Mantle |
| `region` | Mantle only; informational (already baked into `baseUrl`) |

Model construction per provider:

- **AWS Bedrock** → `BedrockModel(model_id=<modelId>, temperature=..., max_tokens=...)`.
  With `thinkingEnabled`: add
  `additional_request_fields={"thinking": {"type": "adaptive"}}` and pin
  `temperature=1`.
- **OpenAI** → `OpenAIModel(client_args={"api_key": os.environ.get("OPENAI_API_KEY")[, "base_url": <baseUrl>]}, model_id=<modelName>, params={"max_tokens": ..., "temperature": ...})`.
  With `thinkingEnabled`: add `"reasoning_effort": <reasoningEffort>` to params.
- **Amazon Bedrock (Mantle)** → `OpenAIResponsesModel(client_args={"api_key": os.environ.get("BEDROCK_API_KEY"), "base_url": <baseUrl>}, model_id=<modelName>, params={"max_output_tokens": <maxTokens>, ...})`.
  With `thinkingEnabled`: use `"reasoning": {"effort": <reasoningEffort>}` in
  params and OMIT temperature; otherwise use `"temperature": <temperature>`.

### `orchestrator-agent` — coordinates sub-agents

All `agent` fields, plus:

| Field | Meaning |
|---|---|
| `coordinationPrompt` | Extra coordination instructions. When present, the effective system prompt is `systemPrompt + "\n\nCoordination Instructions: " + coordinationPrompt` |

Each connected sub-agent (see edge semantics) is wrapped as a `@tool` function
(the "agent-as-tool" pattern) and passed in the orchestrator's `tools=[...]`
list. Sub-agent tool function names follow
`{sanitized_label}_{last 4 chars of the sub-agent node id}` to stay unique.

### `swarm` — self-organizing multi-agent group

| Field | Meaning |
|---|---|
| `label` | Swarm name → Python variable |
| `maxHandoffs` (20) | `max_handoffs` |
| `maxIterations` (20) | `max_iterations` |
| `executionTimeout` (900) | `execution_timeout` (seconds, emit as float) |
| `nodeTimeout` (300) | `node_timeout` (seconds, emit as float) |
| `repetitiveHandoffDetectionWindow` (0) | `repetitive_handoff_detection_window` |
| `repetitiveHandoffMinUniqueAgents` (0) | `repetitive_handoff_min_unique_agents` |
| `entryPointAgentId` (null) | Node id of the member agent to use as `entry_point=<agent_var>` (omit when null) |

Build with `strands.multiagent.Swarm([member_agents...], ...)`. Member agents
MUST be constructed with a `name="<label>"` argument (the swarm coordinates by
name). Tools attach to individual member agents, never to the swarm itself.
Swarm results: `result.status`, `result.node_history`, `result.results[node_id].result`.

### `input` — user input source

| Field | Meaning |
|---|---|
| `inputType` | `"user-prompt"` (default) \| `"data"` \| `"variable"` — all currently behave the same |

No code is generated for input nodes. Their single purpose: the agent /
orchestrator / swarm that an input node connects to is the **execution
target** — the node whose invocation `main()` performs with the user input.

### `output` — result display

Display-only; no code is generated. It marks which node's result is the flow's
final output (the execution target prints/returns its result).

### `tool` — built-in Strands tool

| Field | Meaning |
|---|---|
| `toolName` | One of `calculator`, `file_read` (alias `file_reader`), `shell`, `current_time`, `http_request`, `editor`, `retrieve` |
| `toolType` | Always `"built-in"` |
| `label`, `description` | Informational only |

Import from `strands_tools` and pass the bare name in the agent's
`tools=[...]` list. Unknown names fall back to `calculator`.

### `custom-tool` — user-provided Python function

| Field | Meaning |
|---|---|
| `pythonCode` | A complete Python function definition (with type hints and docstring) |
| `label` | Informational only |

Emit the function VERBATIM at module level, prefixed with the `@tool`
decorator. Extract the function name from the `def` line and pass it in the
connected agent's `tools=[...]` list. If `pythonCode` is empty, emit a
placeholder `custom_tool(input_text: str) -> str` function.

### `mcp-tool` — MCP server connection

| Field | Meaning |
|---|---|
| `serverName` | Used to build the client variable name |
| `transportType` | `"stdio"` \| `"streamable_http"` \| `"sse"` |
| `command`, `args`, `env` | stdio transport: subprocess command, argument list, optional env dict |
| `url` | HTTP/SSE transport: server URL |
| `headers` | HTTP/SSE transport: optional headers dict |
| `timeout` (30) | Pass as `startup_timeout=` to `MCPClient` |
| `argsText`, `envText`, `headersText` | Raw editor text mirrors of `args`/`env`/`headers` — ignore, use the parsed fields |
| `label`, `description` | Informational only |

Client variable naming convention:
`{serverName lowercased, non-alphanumeric → _}_client_{last 4 chars of node id}`.

Construction per transport (at module level — constructing does not connect):

```python
# stdio
x_client_1234 = MCPClient(
    lambda: stdio_client(StdioServerParameters(command="uvx", args=[...], env={...})),
    startup_timeout=30
)
# streamable_http
x_client_1234 = MCPClient(lambda: streamablehttp_client("http://host/mcp"), startup_timeout=30)
# sse
x_client_1234 = MCPClient(lambda: sse_client("http://host/sse"), startup_timeout=30)
```

Usage: agents with MCP tools must be created INSIDE the client context, so the
agent construction moves into `main()` (or into the sub-agent's `@tool`
function for orchestrator sub-agents):

```python
with x_client_1234:
    mcp_tools = []
    mcp_tools.extend(x_client_1234.list_tools_sync())
    my_agent = Agent(model=my_agent_model, system_prompt=..., tools=mcp_tools + [other_tools], callback_handler=None)
    ...execute inside the with block...
```

Each MCP server node connects to exactly one agent (enforced by the editor).

## Edge semantics (`sourceHandle` → `targetHandle`)

| Edge | Meaning |
|---|---|
| `input.output` → `agent\|orchestrator-agent\|swarm.user-input` | This node is the **execution target**: `main()` invokes it with the resolved user input |
| `tool.tool-output` → `agent\|orchestrator-agent.tools` | Attach built-in tool to the agent's `tools` list |
| `custom-tool.tool-output` → `agent\|orchestrator-agent.tools` | Attach custom `@tool` function |
| `mcp-tool.mcp-tools` → `agent\|orchestrator-agent.tools` | Attach MCP server's tools (context-manager pattern above) |
| `orchestrator-agent.sub-agents` → `agent.orchestrator-input` | Target agent is a sub-agent: wrap as `@tool` function, add to orchestrator's tools |
| `orchestrator-agent.sub-agents` → `orchestrator-agent.orchestrator-input` | Hierarchical: the target orchestrator itself becomes a `@tool` of the source orchestrator |
| `swarm.sub-agents` → `agent.orchestrator-input` | Target agent is a swarm member (construct with `name=`, include in the `Swarm([...])` list) |
| `agent\|orchestrator-agent\|swarm.output` → `output.input` | Marks the final result sink (no code) |
| `agent\|orchestrator-agent\|swarm.output` → `agent\|orchestrator-agent\|swarm.user-input` | **Graph mode only**: dependency edge — target depends on source's output |

Direction note: `sub-agents` edges point FROM the coordinator TO its members
(source = orchestrator/swarm, target = member agent).

## Graph mode (`graph_mode: true`)

Use `strands.multiagent.GraphBuilder`:

1. Construct every agent/orchestrator/swarm node as a named `Agent`
   (`name="<label>"`, `callback_handler=None`) at module level.
2. `builder = GraphBuilder()`; `builder.add_node(agent_var, "<sanitized_label>")`
   for each node.
3. For every dependency edge (`output` → `user-input` between agent-like
   nodes): `builder.add_edge("<source_id>", "<target_id>")` — the target
   executes after (and receives) the source's output.
4. Entry points = agent-like nodes with NO incoming dependency edges:
   `builder.set_entry_point("<node_id>")`. Input nodes only ever connect to
   entry points.
5. `graph = builder.build()`; execute inside `main()` with
   `result = graph(user_input)`. Result fields: `result.status`,
   `result.execution_order` (list of nodes with `.node_id`),
   `result.total_nodes`, `result.completed_nodes`, `result.failed_nodes`,
   `result.execution_time`, `result.results` (dict node_id →
   object with `.result`). Return `str(result)`.

Graph execution is always synchronous — never `stream_async` in graph mode.

## Execution target selection

The execution target is the agent-like node that an `input` node connects to
via `user-input`. In non-graph mode there is exactly one such target and
`main()` invokes only it (sub-agents and swarm members are invoked indirectly).
In graph mode, `main()` invokes the built `graph` object instead.

## Naming conventions (match the golden examples)

- Variable from label: lowercase, replace non-alphanumerics with `_`, collapse
  repeated `_` (e.g. `"Research Swarm"` → `research_swarm`).
- Model variable: `<agent_var>_model`.
- Agent-as-tool function: `<agent_var>_<last 4 chars of node id>`.
- MCP client: `<server_var>_client_<last 4 chars of node id>`.
