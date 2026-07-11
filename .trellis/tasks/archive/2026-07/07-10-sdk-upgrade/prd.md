# Upgrade Strands/AgentCore SDK dependencies

## Goal

Bring all AI-agent SDK dependencies from Sept-2025 versions to current (July 2026), fix the version-pinning inconsistencies across deployment templates, harden generated code for new tool-consent behavior, and refresh the model catalog — with full regression verification of every code-generation path.

## Requirements

### R1 — Backend dependency bumps (`backend/pyproject.toml` + `uv lock`)
- `strands-agents[openai]>=1.46.0`
- `strands-agents-tools[mem0_memory]>=0.8.3` (collapse the duplicate `strands-agents-tools` entries into one)
- `bedrock-agentcore>=1.17.0,<2` (1.4.8/1.5.0 are yanked — the floor already avoids them)
- `mcp>=1.23.0` (required by strands-agents>=1.27)
- `fastapi>=0.115`, `uvicorn>=0.34`, `pydantic>=2.10`, `boto3>=1.40` floors kept/raised to current
- **Remove `bedrock-agentcore-starter-toolkit`** from pyproject (CVE-2026-4269; replacement lands in child task `07-10-agentcore-direct-deploy`; until that task lands the old deploy path may be broken — acceptable since tasks ship together on one branch)
- `backend/requirements.txt` (legacy pip path) updated to match or reduced to a pointer to pyproject

### R2 — Deployment template requirements files
- `backend/deployment/agentcore/requirements.txt`: **remove `bedrock-agentcore<=0.1.3` ceiling** → `bedrock-agentcore>=1.17.0,<2`; pin `strands-agents>=1.46.0`, `strands-agents-tools>=0.8.3`; drop `bedrock-agentcore-starter-toolkit` and `docker` if no longer used by the new deploy path
- Lambda/ECS template requirements: left as-is (targets being hidden by sibling task), except nothing may pin a version that breaks `uv lock` of the main backend

### R3 — Generated-code hardening (code generators + backend execution env)
- Backend execution service and AgentCore runtime template set `BYPASS_TOOL_CONSENT=true` and `STRANDS_NON_INTERACTIVE=true` in the child-process/runtime environment (tools 0.8.x consent prompts would hang headless runs)
- No change to emitted Strands API surface (verified compatible), but audit that generated code never passes `retry_strategy=None` and never relies on SDK default model id

### R4 — Model catalog refresh (frontend)
- `property-panel.tsx` model list: add current generation (global/us/eu `anthropic.claude-sonnet-4-6`, keep haiku-4-5, sonnet-4-5; add opus if Bedrock-available), keep existing entries that are still valid Bedrock IDs
- Default model id changes from `us.anthropic.claude-3-7-sonnet-20250219-v1:0` to `global.anthropic.claude-sonnet-4-6` in: `flow-editor.tsx` node default, all fallbacks in `code-generator.ts` / `graph-code-generator.ts`
- `agent_runtime_template.py` fallback `claude-3-haiku-20240307` replaced with a current haiku id

### R5 — Toolkit deprecation-banner tolerance (transitional)
- Any code parsing CLI/toolkit output must not break on the 0.3.x deprecation banner (moot once direct-deploy child lands; verify nothing else imports the toolkit)

## Acceptance Criteria

- [ ] `cd backend && uv lock && uv sync` succeeds; `uv run python -c "import strands, strands_tools, bedrock_agentcore; ..."` prints versions strands-agents==1.46.x, tools==0.8.3, bedrock-agentcore==1.17.x
- [ ] `uv run python -c "from strands import Agent, tool; from strands.models import BedrockModel; from strands.models.openai import OpenAIModel; from strands.multiagent import GraphBuilder, Swarm; from strands.tools.mcp import MCPClient; from strands_tools import calculator, file_read, shell, current_time, http_request, editor, retrieve, mem0_memory"` succeeds
- [ ] Backend starts (`uv run uvicorn main:app`) and `/health` responds
- [ ] Regression: generate + execute via `/api/execute` for (a) single agent, (b) single agent with built-in tool (calculator), (c) streaming agent via `/api/execute/stream`, (d) swarm flow, (e) graph-mode flow, (f) conversation via `/api/conversations` — all return successful results with real Bedrock calls
- [ ] MCP path: generated MCP code imports resolve against mcp>=1.23 (`stdio_client`, `streamablehttp_client`, `sse_client`) — compile-check generated code at minimum
- [ ] No requirements file in the repo still references `bedrock-agentcore<=0.1.3` or `bedrock-agentcore-starter-toolkit` (except hidden Lambda/ECS templates, which are out of scope)
- [ ] Frontend `npm run build` passes with the new model catalog; new default model appears on newly created agent nodes; previously saved projects with old model ids still load and keep their ids

## Constraints / Non-goals

- No new SDK features adopted here (structured output, managed MCP, etc. are future tasks)
- Do not touch deployment service logic (sibling task owns it)
- Existing generated-code style (callback_handler=None, context-manager MCP) stays as-is
