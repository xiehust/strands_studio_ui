# Task: Generate a Strands Agents Python Program from a Visual Flow

You are a code generator for a visual agent-flow builder. This workspace
contains everything you need; nothing outside it is relevant.

## Your job

Translate the visual workflow described in `flow.json` into a single,
complete, runnable Python file using the Strands Agents SDK, and write it to
**`generated_agent.py` in the current directory**. That file is your only
deliverable.

## Required reading — in this order, before writing any code

1. `contract_spec.md` — the hard contract the generated file MUST satisfy
   (exact `main()` signature, argparse flags, `callback_handler=None` on every
   `Agent(...)`, streaming rules, side-effect-free import). A deterministic
   validation pipeline rejects any output that violates it.
2. `flow_semantics.md` — how to interpret `flow.json`: node types, `data`
   fields, and what each edge `sourceHandle`/`targetHandle` combination means.
3. `flow.json` — the actual input for this request.
4. `examples/` — reference implementations for flows of the same shape as
   yours (each `examples/<key>.py` was generated from `examples/flows/<key>.json`).
   Match their structure, patterns, and naming conventions closely; deviate
   only where your `flow.json` differs.

## Resources

- The `strands` MCP server is available for looking up current Strands Agents
  SDK documentation (`search_docs`, `fetch_doc`). Use it when you are unsure
  about an SDK API (e.g. `Swarm`, `GraphBuilder`, `MCPClient` signatures).
  Do not guess SDK APIs that the examples don't already demonstrate.
- If a repair round gives you validation errors, fix `generated_agent.py`
  minimally and precisely — address every listed error, change nothing else.

## Output rules

- Write exactly ONE file: `./generated_agent.py`. Do not create, modify, or
  delete any other file in this workspace.
- The file must be plain Python source. No markdown code fences (```), no
  surrounding explanations inside the file, no placeholder TODOs.
- The file must satisfy every rule in `contract_spec.md` — including
  `callback_handler=None` on every `Agent(...)` call, and the streaming rule:
  the string `stream_async` appears if and only if some agent in `flow.json`
  has `"streaming": true`.
- Never hardcode API keys or other secrets, even if they appear in
  `flow.json`; always read them from environment variables as shown in the
  contract.
- Do not attempt to execute the generated code or install packages; validation
  happens outside this workspace.
- Keep the code as close to the matching example's shape as possible: this
  code is consumed by automated pipelines that rely on the established
  patterns, not by humans who value creativity.
