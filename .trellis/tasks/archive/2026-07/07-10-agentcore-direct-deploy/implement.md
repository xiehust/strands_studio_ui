# Implementation plan — AgentCore direct deploy + hide Lambda/ECS

Prereq: `07-10-sdk-upgrade` complete on the shared feature branch. Real AWS account needed for Steps 4–6 validation (region from env, default us-west-2).

## Checklist

### Step 1 — Package builder
- [ ] New module (e.g. `backend/deployment/agentcore/package_builder.py`): vendored-dep install (uv, aarch64-manylinux2014, py3.13, --only-binary), dep cache by requirements hash, zip assembly (deps+entrypoint at root, perms, size pre-flight)
- [ ] Update `backend/deployment/agentcore/requirements.txt` usage: this file becomes the runtime-deps manifest for the zip (verify pins post-sdk-upgrade; remove anything unneeded in-runtime, e.g. docker, toolkit)
- [ ] Unit-ish check: build a zip from a minimal generated agent; `unzip -l` shows strands/, bedrock_agentcore/, agent_runtime.py at root; size logged

### Step 2 — Deploy engine
- [ ] Rework `agentcore_deployment_service.py`: keep `deploy_agent(...)` signature + progress-log streaming; replace internals with S3 ensure/upload → IAM ensure (boto3) → find-by-name → create/update → poll READY; env-var merge + validation; MCP-stdio warning; deployment_outputs keys preserved (check `agentcore-deploy-panel.tsx` reader first)
- [ ] Delete CLI/YAML/dockerfile/CodeBuild helpers (single dedicated commit)
- [ ] `grep -rn "bedrock_agentcore_starter_toolkit\|agentcore launch\|\.bedrock_agentcore\.yaml" backend/ --include=*.py` → no active-path hits

### Step 3 — Feature flag + routes
- [ ] `backend/app/routers/deployment.py`: `ENABLE_LEGACY_DEPLOY_TARGETS` gate (FastAPI dependency → 501) on lambda/ecs deploy+invoke+delete routes; `/types` returns agentcore-only when off; combined `/` deploy route rejects lambda/ecs requests when off
- [ ] Deployment-history GET endpoints: verify legacy records still serialize

### Step 4 — Frontend
- [ ] `deploy-panel.tsx`: drop target selector, render AgentCore panel directly (keep legacy panel files unimported)
- [ ] `invoke-panel.tsx`: agentcore-only listing; confirm no crash with legacy history records present
- [ ] `npm run build` + `npm run lint`

### Step 5 — Real-deploy validation (needs AWS creds)
- [ ] Deploy a single-agent flow from the UI → runtime READY without Docker/CodeBuild; record timing (first vs cached-dep deploy)
- [ ] Invoke panel: non-streaming + streaming both work against the deployed runtime
- [ ] Re-deploy same agent name → update path (new version, DEFAULT endpoint follows, no duplicate runtime)
- [ ] OpenAI-provider agent deploy → env var visible in runtime (invoke succeeds)
- [ ] Deployment history shows record with ARN; legacy records render
- [ ] Direct route probe: `curl -X POST :8000/api/deployment/lambda ...` → 501; set `ENABLE_LEGACY_DEPLOY_TARGETS=true` → routes respond again
- [ ] Cleanup: delete test runtimes (`delete_agentcore_agent` route) to avoid cost

### Step 6 — Wrap
- [ ] Full-scope quality pass: backend boot, lint, build, re-run local execute regression quickly (no regression from service rework)
- [ ] Update CLAUDE.md deployment sections (AgentCore direct code deploy; Lambda/ECS disabled via flag)
- [ ] Commit

## Validation commands
```bash
cd backend && uv run uvicorn main:app --port 8000
curl -s localhost:8000/api/deployment/types | jq   # agentcore only
npm run build && npm run lint
```

## Rollback points
- CLI-path deletion is one commit → revertable independently
- Flag default can be flipped to re-expose Lambda/ECS without code changes
