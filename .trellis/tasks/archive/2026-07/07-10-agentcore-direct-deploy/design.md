# Design — AgentCore direct code deploy via boto3; hide Lambda/ECS

Spec basis: `research/direct-code-deploy-spec.md` (exact boto3 shapes, zip layout, IAM, limits). Depends on `07-10-sdk-upgrade` (starter-toolkit removed from pyproject).

## Architecture decision

Replace the subprocess-CLI pipeline (`agentcore launch` + hand-written `.bedrock_agentcore.yaml` + CodeBuild ARM64 container) with an in-process boto3 pipeline:

```
generated flow code
  → code_adapter.py (existing, unchanged contract) → agent_runtime.py entrypoint
  → build zip: vendored ARM64 deps + entrypoint            [new: package builder]
  → ensure S3 bucket + upload                              [new]
  → ensure IAM execution role                              [rework: boto3, no script]
  → create_agent_runtime | update_agent_runtime            [new]
  → poll get_agent_runtime until READY/FAILED              [new]
  → deployment-history record (existing schema)
```

Invoke path (`agentcore_invoke_service.py`, data-plane `invoke_agent_runtime`) is already boto3 — unchanged.

## Components

### 1. `backend/deployment/agentcore/direct_deploy_service.py` (new; replaces the CLI path inside `AgentCoreDeploymentService` — keep the class name/entry signature `deploy_agent(...)` so router code barely changes, but reimplement internals; delete-dead CLI helpers rather than keeping both paths)

**Naming**: AgentCore runtime names allow `[a-zA-Z][a-zA-Z0-9_]{0,47}` (no hyphens). Sanitize current agent names the same way the old service did (verify existing sanitizer, keep identical output so re-deploys map to the same runtime).

**Package builder** (the core new piece):
- Workspace per deployment: `backend/deployment/agentcore/deployments/{deployment_id}/` (reuse existing dir convention)
- Write `agent_runtime.py` (from code_adapter) + any aux files
- Vendor deps: `uv pip install --python-platform aarch64-manylinux2014 --python-version 3.13 --target=pkg --only-binary=:all: -r requirements.txt` — requirements from the template `requirements.txt` (post-sdk-upgrade pins) minus toolkit/docker; run via `asyncio.create_subprocess_exec`, stream progress to deployment logs
- **Dependency cache**: hash(requirements.txt content) → cached `pkg/` dir; copy-on-build. First deploy vendors (~1–2 min), subsequent deploys reuse (seconds). Cache under `deployments/_dep_cache/{hash}/`
- Zip: deps at root + entrypoint at root; skip `__pycache__`, `*.dist-info/RECORD` OK; enforce 644/755 perms; fail with clear error if zip >250 MB or unzipped >750 MB
- `zipfile` stdlib, deterministic-ish; entrypoint = `['agent_runtime.py']`, runtime = `PYTHON_3_13`

**S3**: bucket `bedrock-agentcore-code-{account_id}-{region}` — head_bucket, create if missing (with region LocationConstraint); upload key `strands-studio/{agent_name}/{deployment_id}.zip` with `ExpectedBucketOwner`

**IAM**: `_ensure_iam_role_exists` reworked to pure boto3 (no shell script): role `strands-studio-agentcore-role-{region}` (check existing name convention first — reuse if the old role name is compatible so existing users don't get duplicate roles). Trust: `bedrock-agentcore.amazonaws.com` + SourceAccount/SourceArn conditions. Inline policy: logs/xray/cloudwatch/bedrock:InvokeModel* per research doc (no ECR). Wait-after-create (IAM eventual consistency: retry create_agent_runtime on `ValidationException`/assume-role failures with backoff ~10s×6)

**Create-or-update**: paginate `list_agent_runtimes`, match `agentRuntimeName`. Found → `get_agent_runtime` then `update_agent_runtime` (re-send full config: artifact, roleArn, network, protocol, env vars). Not found → `create_agent_runtime`. Poll `get_agent_runtime` every 5 s (≤10 min) until READY / CREATE_FAILED / UPDATE_FAILED; surface `failureReason` into deployment logs.

**Env vars**: merge user-provided (OPENAI_API_KEY etc.) + `BYPASS_TOOL_CONSENT=true`, `STRANDS_NON_INTERACTIVE=true`; validate ≤50 entries / ≤5000 char values before calling API.

**MCP stdio warning**: `uvx`/`npx` availability in managed runtime is undocumented → if generated code contains `stdio_client(`, prepend a deployment-log warning ("stdio MCP servers may not work in AgentCore direct-code runtime; HTTP/SSE MCP recommended"). Do not block.

**deployment_outputs**: `{agent_runtime_arn, agent_runtime_id, agent_runtime_version, region, s3_key, status}` — keep key names the frontend already reads (`agentcore-deploy-panel.tsx` reads `deployment_result.status.deployment_outputs`; verify exact keys during implementation and preserve).

### 2. Feature flag for Lambda/ECS
- Backend: `ENABLE_LEGACY_DEPLOY_TARGETS` env (default unset/false). In `backend/app/routers/deployment.py`, gate `/lambda*`, `/ecs*`, `/ecs-fargate*` routes with a dependency raising HTTP 501 `{"detail": "Deployment target disabled"}` when off. `/types` endpoint returns only agentcore when off. Deployment-history read paths untouched (legacy lambda/ecs records still render).
- Frontend: `deploy-panel.tsx` — remove the 3-target selector UI, render `AgentCoreDeployPanel` directly (keep `lambda-deploy-panel.tsx`/`ecs-deploy-panel.tsx` files; just unimported). `invoke-panel.tsx` — filter deployment list to agentcore type but render legacy records read-only if present (decide during impl: simplest is filter-out; history panel still shows all).

### 3. Removals from active path
- `agentcore_deployment_service.py`: CLI subprocess (`agentcore launch`), `.bedrock_agentcore.yaml` generation, dockerfile generation/fix helpers, CodeBuild parsing, `_deploy_manually`/`_build_and_push_image` (container path) — deleted or clearly quarantined; `dockerfile_template` left on disk unused
- `docker` python dep already dropped by sdk-upgrade task

## Failure modes & handling
- uv not present on host → clear error at deploy start (uv is already a project prerequisite)
- Non-wheel dep (`--only-binary` fails) → surface resolver stderr into deployment logs
- Zip too large → pre-flight size check, actionable error listing biggest packages
- create_agent_runtime ConflictException race → fall back to lookup+update
- READY timeout → mark failed, include last status + failureReason

## Rollback
Feature-branch commits per component (packager / deployer / routes / frontend). Old CLI path is deleted in a single dedicated commit so `git revert` can resurrect it if direct deploy proves unviable in validation.
