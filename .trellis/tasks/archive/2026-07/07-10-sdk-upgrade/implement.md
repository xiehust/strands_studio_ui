# Implementation plan — SDK dependency upgrade

Branch: feature branch off `main` (shared by all three child tasks; this task lands first).

## Checklist

### Step 1 — Dependency bumps
- [ ] Edit `backend/pyproject.toml` per design §1 (bump strands/tools/bedrock-agentcore/mcp/boto3, remove starter-toolkit, dedupe tools entries)
- [ ] `cd backend && uv lock` — if resolution fails on `[mem0_memory]` extra, record the error and decide per design risk note
- [ ] `uv sync`
- [ ] Align `backend/requirements.txt`
- [ ] Validate: `uv run python -c "import strands, importlib.metadata as m; print(m.version('strands-agents'), m.version('strands-agents-tools'), m.version('bedrock-agentcore'), m.version('mcp'))"`
- [ ] Validate imports: the full import line from prd AC #2

### Step 2 — Keep backend bootable without starter-toolkit
- [ ] Grep `bedrock_agentcore_starter_toolkit` and toolkit-CLI subprocess usage in `backend/` active path; guard imports in `agentcore_deployment_service.py` so module import never fails (deploy endpoint returns explicit 503 "deployment engine migration in progress" if hit before sibling task lands)
- [ ] `uv run uvicorn main:app --port 8000` starts; `curl localhost:8000/health` OK

### Step 3 — Template requirements
- [ ] Rewrite `backend/deployment/agentcore/requirements.txt` per design §3
- [ ] `grep -rn "bedrock-agentcore<=" backend/` returns nothing

### Step 4 — Env hardening
- [ ] Locate subprocess spawn sites in `backend/main.py` (execute, execute/stream, conversation) — inject `BYPASS_TOOL_CONSENT=true`, `STRANDS_NON_INTERACTIVE=true` into child env
- [ ] `agent_runtime_template.py`: `os.environ.setdefault` both vars near top; replace claude-3-haiku fallback ids with `us.anthropic.claude-haiku-4-5-20251001-v1:0`

### Step 5 — Model catalog + default extraction
- [ ] Create `src/lib/models.ts` (or similar) exporting `DEFAULT_MODEL_ID = 'global.anthropic.claude-sonnet-4-6'` + the model catalog list
- [ ] Verify intended new model ids exist: `aws bedrock list-foundation-models --region us-west-2 --query "modelSummaries[?contains(modelId,'claude')].modelId"` (adjust list to reality; keep only verified ids)
- [ ] `property-panel.tsx` consumes catalog; `flow-editor.tsx` + both code generators import `DEFAULT_MODEL_ID` (replace all 9 hardcoded fallback sites)
- [ ] `npm run build` + `npm run lint`

### Step 6 — Regression (real execution; needs AWS creds in env)
- [ ] Start backend; use `test_request.json`/crafted payloads against `/api/execute`: (a) single agent (b) agent+calculator tool
- [ ] `/api/execute/stream`: streaming agent — chunks arrive, newline handling intact
- [ ] Swarm flow payload and Graph-mode flow payload execute successfully
- [ ] `/api/conversations`: two-turn chat works
- [ ] MCP: generate MCP-node code via the frontend generator (or fixture), `uv run python -m py_compile` it
- [ ] Saved-project compat: load an existing project JSON (from repo storage/ or crafted with old model id) — loads, keeps old model id

### Step 7 — Wrap
- [ ] `npm run lint`, `npm run build`, backend boot re-check — full-scope quality pass
- [ ] Update CLAUDE.md version references (brief)
- [ ] Commit (no push until parent integration)

## Validation commands
```bash
cd backend && uv lock && uv sync
uv run python -c "from strands import Agent, tool; from strands.models import BedrockModel; from strands.models.openai import OpenAIModel; from strands.multiagent import GraphBuilder, Swarm; from strands.tools.mcp import MCPClient; from strands_tools import calculator, file_read, shell, current_time, http_request, editor, retrieve, mem0_memory; print('ok')"
uv run uvicorn main:app --host 127.0.0.1 --port 8000  # + /health
npm run build && npm run lint
```

## Rollback points
- After Step 1: lockfile revert restores previous state
- Steps are commit-sized; each independently revertable
