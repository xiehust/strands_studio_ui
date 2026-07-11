# Design — SDK dependency upgrade

## Scope boundary

Pure dependency + template + catalog upgrade. No SDK feature adoption, no deployment-service logic changes (sibling task), no UI redesign (sibling task). The emitted Python API surface stays byte-identical except for env-var hardening and model-id defaults.

## Verified compatibility basis (research 2026-07-10)

All APIs emitted by `code-generator.ts` / `graph-code-generator.ts` and used by `backend/main.py` were verified unchanged in strands-agents 1.46.0: `Agent(model, system_prompt, tools, callback_handler=None, name=)`, `BedrockModel(model_id, temperature, max_tokens, additional_request_fields)`, `OpenAIModel(client_args, model_id, params)`, `GraphBuilder.add_node/add_edge/set_entry_point/build`, `Swarm(...)` kwargs incl. `entry_point/max_handoffs/max_iterations/execution_timeout/node_timeout/repetitive_handoff_*`, `MCPClient(transport, startup_timeout=)` + `list_tools_sync()`, `agent.stream_async()` `"data"` event key, multiagent result `.status/.results[id].result/.node_history`. strands_tools names `calculator/file_read/shell/current_time/http_request/editor/retrieve/mem0_memory` unchanged. `BedrockAgentCoreApp`/`@app.entrypoint`/`app.run()` unchanged in bedrock-agentcore 1.17.0.

Therefore: **no code-generator structural changes**; risk concentrates in (a) dependency resolution, (b) runtime behavior of hardened tools, (c) the removed starter-toolkit import inside `agentcore_deployment_service.py`.

## Changes by file

1. `backend/pyproject.toml`
   - deps: `strands-agents[openai]>=1.46.0`, single `strands-agents-tools[mem0_memory]>=0.8.3` entry, `bedrock-agentcore>=1.17.0,<2`, `mcp>=1.23.0`, keep fastapi/uvicorn/websockets/pydantic/etc floors, `boto3>=1.40.0` added explicitly (currently transitive)
   - **remove** `bedrock-agentcore-starter-toolkit`
   - `uv lock` regenerate; `uv sync`
2. `backend/requirements.txt` — align pins with pyproject (kept because `npm run setup:backend` references it)
3. `backend/deployment/agentcore/requirements.txt` — `bedrock-agentcore>=1.17.0,<2` (ceiling removed), `strands-agents[openai]>=1.46.0`, `strands-agents-tools>=0.8.3`, keep boto3/botocore floors; remove `bedrock-agentcore-starter-toolkit` and `docker`
4. `backend/deployment/agentcore/agentcore_deployment_service.py` — transitional only: guard/remove the `import bedrock_agentcore` version-logging and any starter-toolkit import so the backend still boots with the package gone. Full rewrite belongs to the sibling task; here we only keep the module importable (deploy endpoint may return a clear "deployment engine being replaced" error if invoked in the window between tasks — both tasks merge in one PR, so users never see it).
5. Env hardening — set `BYPASS_TOOL_CONSENT=true`, `STRANDS_NON_INTERACTIVE=true`:
   - `backend/main.py`: in the subprocess env for `/api/execute`, `/api/execute/stream`, conversation execution (wherever generated code is spawned)
   - `backend/deployment/agentcore/agent_runtime_template.py` or its env plumbing: ensure the runtime env includes these (can also be set at deploy time by sibling task; set in-template via `os.environ.setdefault` for robustness)
6. Model catalog:
   - `src/components/property-panel.tsx`: add `global./us./eu.anthropic.claude-sonnet-4-6` (new default), `global./us./eu.anthropic.claude-opus-4-8` if Bedrock-available (verify id format during implementation; skip if unverifiable), keep existing 4.5/4.x entries; leave 3.7 entries for backward compat (existing projects)
   - default-model constant: `flow-editor.tsx:204`, `code-generator.ts` (7 fallback sites), `graph-code-generator.ts` fallbacks → extract to one shared constant `DEFAULT_MODEL_ID` in a lib module, imported everywhere (removes the 9-site duplication)
   - `agent_runtime_template.py` fallbacks (lines ~145, 192) → `us.anthropic.claude-haiku-4-5-20251001-v1:0`
7. `CLAUDE.md` — version notes updated (small; final doc pass happens in parent wrap-up)

## Risks & mitigations

- **uv resolution conflicts** (e.g. mem0 extra vs new pydantic): if `[mem0_memory]` extra blocks resolution, escalate — options: drop extra (mem0_memory tool import becomes optional) — decide with evidence from the resolver error.
- **tools 0.8.x consent prompts**: mitigated by env vars; regression tests (c)–(f) in prd cover the hang scenario (shell/calculator run headless).
- **ConcurrencyException (strands 1.22+)**: generated code runs one-shot per subprocess → not affected. `backend/main.py` in-process execution paths: audit that no Agent instance is shared across concurrent requests; if conversation service reuses instances, note and fix minimally.
- **Bedrock model availability**: model catalog additions verified against `aws bedrock list-foundation-models` in the implementation environment before finalizing the list.

## Rollback

Single commit on the feature branch; revert restores old lockfile. No data-format changes.
