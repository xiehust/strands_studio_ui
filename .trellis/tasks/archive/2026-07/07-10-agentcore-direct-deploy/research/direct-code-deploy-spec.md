# AgentCore Direct Code Deploy — implementation-ready spec (researched 2026-07-10)

## boto3 `bedrock-agentcore-control` API

### create_agent_runtime (code deploy)
```python
client = boto3.client('bedrock-agentcore-control', region_name=region)
resp = client.create_agent_runtime(
    agentRuntimeName=name,                 # [a-zA-Z][a-zA-Z0-9_]{0,47} — underscores OK, NO hyphens
    agentRuntimeArtifact={
        'codeConfiguration': {
            'code': {'s3': {'bucket': bucket_name, 'prefix': object_key}},  # bucket NAME + full key; optional versionId
            'runtime': 'PYTHON_3_13',      # PYTHON_3_10..3_14 | NODE_22 (3.10/3.11 deprecating 6/30/2026)
            'entryPoint': ['agent_runtime.py'],  # 1-2 elements; last = .py path inside zip; ['opentelemetry-instrument','x.py'] for otel
        }
    },
    roleArn=execution_role_arn,
    networkConfiguration={'networkMode': 'PUBLIC'},
    protocolConfiguration={'serverProtocol': 'HTTP'},
    environmentVariables={...},            # max 50; key ≤100 chars; value ≤5000 chars; per-version
    # optional: lifecycleConfiguration {idleRuntimeSessionTimeout, maxLifetime}, clientToken, description, tags
)
# 202 → resp: agentRuntimeArn, agentRuntimeId, agentRuntimeVersion='1', status
```

### update_agent_runtime
- URI param `agentRuntimeId` instead of name. Required: agentRuntimeId, agentRuntimeArtifact, roleArn, networkConfiguration.
- Each version is self-contained — `get_agent_runtime` first and re-send env vars/protocol/lifecycle.
- Every update creates a new immutable version; **DEFAULT endpoint auto-points to newest**.

### Polling & lookup
- `get_agent_runtime(agentRuntimeId=...)` → status: CREATING|CREATE_FAILED|UPDATING|UPDATE_FAILED|READY|DELETING; `failureReason` on failure. 50 TPS.
- Find-by-name: NO server-side filter — paginate `list_agent_runtimes` (≤100/page, 5 TPS), match `agentRuntimeName` client-side. Names unique per account+region; duplicate create → ConflictException 409.

## Zip layout
- **Vendored deps, flat Lambda-style**: wheels installed at zip root next to entrypoint file; unzipped to /var/task (first on sys.path).
- Build: `uv pip install --python-platform aarch64-manylinux2014 --python-version 3.13 --target=pkg --only-binary=:all: -r requirements.txt` then zip pkg contents + entrypoint file.
- **ARM64 only** (service validates ELF headers of .so files). AL2023 base.
- Limits: 250 MB zipped / 750 MB unzipped. Perms 644/755. Avoid __pycache__.
- Entrypoint must satisfy service contract: `BedrockAgentCoreApp` + `@app.entrypoint` + `app.run()` (or raw HTTP :8080 /invocations + /ping).

## S3
- Caller (backend AWS identity) needs `s3:GetObject` on the zip; execution role does NOT need it (doc ambiguity — adding is harmless).
- Convention: same-account same-region bucket `bedrock-agentcore-code-{account_id}-{region}`; upload with `ExtraArgs={'ExpectedBucketOwner': account_id}`.

## IAM execution role (direct-deploy variant — NO ECR)
- Trust: principal `bedrock-agentcore.amazonaws.com`, conditions `aws:SourceAccount=acct`, `ArnLike aws:SourceArn=arn:aws:bedrock-agentcore:region:acct:*`
- Perms: logs (CreateLogGroup/Stream, PutLogEvents, Describe*) on `/aws/bedrock-agentcore/runtimes/*`; xray Put/GetSampling*; `cloudwatch:PutMetricData` (namespace bedrock-agentcore); `bedrock:InvokeModel` + `InvokeModelWithResponseStream` on `arn:aws:bedrock:*::foundation-model/*` AND `arn:aws:bedrock:REGION:ACCT:*` (inference profiles).

## Invoke (unchanged from current code)
`boto3.client('bedrock-agentcore').invoke_agent_runtime(agentRuntimeArn=..., runtimeSessionId=<33+ chars>, payload=json.dumps({...}), qualifier='DEFAULT')`

## Constraints vs container
- 25 new-sessions/s per endpoint (vs 400 TPM container). 2 vCPU/8 GB. 100 MB payload, 60 min streaming, 8 h session.
- No custom OS packages. **`uvx`/`npx`/subprocess availability undocumented** → stdio MCP servers in deployed runtimes: unsupported/at-risk; surface warning at deploy time.

## Ambiguities (do not assume)
1. Cross-region/cross-account S3 — unstated; use same-account/same-region.
2. Execution-role S3 perms — evidence says caller-only; optionally add to role.
3. subprocess/uvx/npx in managed runtime — undocumented.

Sources: runtime-get-started-code-deploy-python.html, API_CreateAgentRuntime/UpdateAgentRuntime/GetAgentRuntime/ListAgentRuntimes, runtime-permissions.html, agent-runtime-versioning.html, runtime-service-contract.html, bedrock-agentcore-limits.html (docs.aws.amazon.com, fetched 2026-07-10)
