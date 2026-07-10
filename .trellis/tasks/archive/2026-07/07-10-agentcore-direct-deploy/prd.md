# AgentCore direct code deploy via boto3; hide Lambda/ECS

## Goal

Replace the deprecated starter-toolkit CLI deployment path (`agentcore launch` subprocess + hand-written `.bedrock_agentcore.yaml` + CodeBuild ARM64 container) with **boto3 `bedrock-agentcore-control` direct code deploy**: package generated agent code as a zip, upload to S3, `CreateAgentRuntime`/`UpdateAgentRuntime` with a code configuration. Simultaneously hide the Lambda and ECS Fargate deployment targets from the product (user decision: not to be re-opened; keep code, disable access).

Depends on `07-10-sdk-upgrade` (SDK pins, starter-toolkit removal from pyproject).

## Requirements

### R1 — New deployment engine (backend `deployment/agentcore/`)
- New service module implementing direct code deploy with boto3:
  1. Wrap generated flow code with the existing `code_adapter.py` → `agent_runtime.py` entrypoint (`BedrockAgentCoreApp`, `@app.entrypoint`, yield-streaming) — entrypoint contract unchanged on bedrock-agentcore 1.17
  2. Build a zip: entrypoint + generated code + dependencies per AgentCore direct-code-deploy packaging spec (research exact layout: requirements installed into the zip vs runtime-managed; ARM64 wheels consideration; 250 MB limit)
  3. Ensure/create S3 artifact bucket (region-scoped, name deterministic per account) and upload zip
  4. IAM execution role: reuse existing role-creation logic if present, else create/ensure a role trusting `bedrock-agentcore.amazonaws.com` with logs/bedrock permissions
  5. `create_agent_runtime` (new) or `update_agent_runtime` (existing runtime with same agent name — preserve current "auto-update-on-conflict" semantics), network mode PUBLIC, protocol HTTP
  6. Poll runtime status until READY/FAILED with timeout; stream progress logs to the existing deployment progress channel (frontend already displays step progress)
- Environment variables (API keys, BYPASS_TOOL_CONSENT, etc.) passed through runtime environment configuration
- Existing invoke path (`agentcore_invoke_service.py`, boto3 `invoke_agent_runtime`) unchanged — verify streaming + non-streaming still work against a direct-code runtime
- Deployment history records keep the same schema (`/api/deployment-history`), `deployment_outputs` populated with agent runtime ARN/id/endpoint
- Remove runtime dependency on: starter-toolkit import/subprocess, `.bedrock_agentcore.yaml` generation, Docker/CodeBuild, `dockerfile_template` (file may remain, unused)

### R2 — Hide Lambda/ECS targets
- Frontend: deployment target selector shows only AgentCore (remove/hide Lambda + ECS options); invoke panel hides Lambda/ECS deployment entries behind the same flag; no dead UI states
- Backend: Lambda/ECS deployment + invoke routes gated by a feature flag (env var, default off) returning 501/disabled error when off; deployment-history entries of type lambda/ecs are still readable (history view must not crash on legacy records)
- Code under `deployment/lambda/` and `deployment/ecs-fargate/` is retained untouched

### R3 — Docs/config cleanup
- CLAUDE.md deployment sections updated (AgentCore = direct code deploy via boto3; Lambda/ECS marked disabled)
- Any startup scripts / README references to `agentcore` CLI removed from the active path

## Acceptance Criteria

- [ ] From the UI, deploying a single-agent flow to AgentCore completes without Docker/CodeBuild present on the host, and the runtime reaches READY (real AWS deploy, us-west-2 or configured region)
- [ ] The deployed runtime is invocable from the Invoke panel: non-streaming and streaming responses both render correctly
- [ ] Re-deploying the same agent name updates the existing runtime (no duplicate runtimes; conflict handled)
- [ ] Deployment appears in deployment history with ARN and status; legacy history records (incl. old lambda/ecs entries) still render
- [ ] A flow with an OpenAI-provider agent deploys with its env vars set on the runtime
- [ ] Lambda/ECS invisible in all UI surfaces; calling their API routes directly returns a disabled/501 response; flag can re-enable them
- [ ] `grep -r bedrock_agentcore_starter_toolkit backend/ --include=*.py` (outside deployment/lambda, deployment/ecs-fargate) returns nothing on the active code path
- [ ] `npm run build`, `npm run lint`, backend startup all pass

## Constraints / Non-goals

- Container-based AgentCore deploy is dropped, not preserved (direct code deploy only); if a flow's dependency set can't fit direct deploy limits, surface a clear error — no fallback build pipeline
- No changes to code generation for local execution
- MCP-over-stdio tools inside a deployed runtime: keep current behavior/limitations; document if direct-code runtime can't run stdio MCP servers (research and note in design.md)
- No new AgentCore features (memory, gateway, identity) in this task
