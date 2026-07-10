"""
AgentCore Deployment Service (direct code deploy)

Deploys Strands agents to AWS Bedrock AgentCore using boto3
`bedrock-agentcore-control` direct code deploy:

  generated flow code (shipped VERBATIM as generated_agent.py)
    + agent_runtime_template.py entrypoint (imports generated_agent lazily)
    -> package builder (vendored ARM64 deps + both .py files at zip root)
    -> S3 artifact bucket upload
    -> IAM execution role (ensured via boto3)
    -> create_agent_runtime | update_agent_runtime
    -> poll until READY / FAILED

No Docker, CodeBuild, starter-toolkit CLI, or generated-code text surgery involved.
"""
import asyncio
import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

import boto3
from botocore.exceptions import ClientError

try:
    # Try relative import first (when used as a package)
    from .agentcore_config import (
        AgentCoreDeploymentConfig,
        AgentCoreDeploymentResult,
        NetworkMode
    )
    from .package_builder import AgentCorePackageBuilder, PackageBuildError
except ImportError:
    # Fall back to absolute import (when used dynamically)
    from agentcore_config import (
        AgentCoreDeploymentConfig,
        AgentCoreDeploymentResult,
        NetworkMode
    )
    from package_builder import AgentCorePackageBuilder, PackageBuildError

logger = logging.getLogger(__name__)

# IAM role reused from the previous deployment engine (compatible trust policy)
DEFAULT_ROLE_NAME = "AmazonBedrockAgentCoreRuntimeDefaultServiceRole"
DEFAULT_ROLE_PATH = "/service-role/"
DEFAULT_POLICY_NAME = "AmazonBedrockAgentCoreRuntimeDefaultPolicy"

# Runtime status polling
POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 600
TERMINAL_FAILURE_STATUSES = {"CREATE_FAILED", "UPDATE_FAILED", "DELETING"}

# create_agent_runtime retries for IAM eventual consistency
CREATE_RETRY_ATTEMPTS = 6
CREATE_RETRY_DELAY_SECONDS = 10


class AgentCoreDeploymentService:
    """Service for deploying Strands agents to AWS Bedrock AgentCore (direct code deploy)"""

    def __init__(self, base_deployment_dir: str = None):
        """
        Initialize the AgentCore deployment service.

        Args:
            base_deployment_dir: Base directory for deployment files
        """
        if base_deployment_dir is None:
            base_deployment_dir = Path(__file__).parent
        self.base_deployment_dir = Path(base_deployment_dir)
        self.runtime_template_path = self.base_deployment_dir / "agent_runtime_template.py"
        self.requirements_path = self.base_deployment_dir / "requirements.txt"
        self.deployments_dir = self.base_deployment_dir / "deployments"
        self.package_builder = AgentCorePackageBuilder(self.deployments_dir)

    async def deploy_agent(
        self,
        generated_code: str,
        config: AgentCoreDeploymentConfig,
        deployment_id: Optional[str] = None
    ) -> AgentCoreDeploymentResult:
        """
        Deploy a Strands agent to AWS Bedrock AgentCore via direct code deploy.

        Args:
            generated_code: The Python code generated from the visual flow
            config: Deployment configuration
            deployment_id: Optional deployment ID used for progress streaming

        Returns:
            AgentCoreDeploymentResult with deployment status and details
        """
        start_time = datetime.now()
        deployment_logs: List[str] = []
        deployment_id = deployment_id or str(uuid.uuid4())

        async def log(message: str, status: str = "running", step: str = None):
            deployment_logs.append(message)
            logger.info(f"[agentcore-deploy {deployment_id[:8]}] {message}")
            await self._notify_progress(deployment_id, step or message, status)

        agent_name = self._sanitize_runtime_name(config.agent_runtime_name)
        config.agent_runtime_name = agent_name
        logger.info(f"Starting AgentCore direct code deployment for agent: {agent_name}")

        try:
            # Validate configuration
            config_errors = config.validate()
            if config_errors:
                error_msg = f"Configuration validation failed: {', '.join(config_errors)}"
                return AgentCoreDeploymentResult(
                    success=False,
                    message=error_msg,
                    logs=deployment_logs
                )

            region = config.region or "us-east-1"
            account_id = self._get_aws_account_id(region)
            await log("Prerequisites validated")

            # Warn about stdio MCP servers (undocumented support in managed runtime)
            if "stdio_client(" in generated_code:
                await log(
                    "Warning: this flow uses stdio MCP servers (stdio_client). "
                    "stdio MCP servers may not work in the AgentCore direct-code runtime; "
                    "HTTP/SSE MCP servers are recommended for deployed agents."
                )

            # Determine streaming capability from the generated code itself
            streaming_capable = (
                config.streaming_capable
                if config.streaming_capable is not None
                else ("stream_async" in generated_code)
            )

            # 1. Assemble source files. Two supported shapes:
            #    a) Code already contains its own @app.entrypoint (e.g. converted by
            #       the deploy panel) -> ship VERBATIM as the entrypoint itself.
            #    b) Raw generated flow code -> ship VERBATIM as generated_agent.py
            #       (its __main__ guard means nothing runs on import) next to the
            #       static entrypoint template, which imports it lazily at invoke
            #       time. No text surgery of the generated code is performed.
            await log("Preparing AgentCore entrypoint and agent module",
                      step="Generating AgentCore entrypoint")
            if "@app.entrypoint" in generated_code and "BedrockAgentCoreApp" in generated_code:
                source_files = {"agent_runtime.py": generated_code}
                await log("Code already contains @app.entrypoint, shipping as entrypoint verbatim")
            else:
                entrypoint_code = self.runtime_template_path.read_text(encoding="utf-8")
                source_files = {
                    "agent_runtime.py": entrypoint_code,
                    "generated_agent.py": generated_code,
                }
                await log("Shipping generated code verbatim as generated_agent.py with static entrypoint")

            # 2. Build the deployment package zip
            await log("Building deployment package (vendored dependencies + entrypoint)",
                      step="Building deployment package")
            workspace_dir = self.deployments_dir / deployment_id
            requirements_content = self.requirements_path.read_text(encoding="utf-8")

            async def package_log(message: str):
                await log(message, step="Building deployment package")

            zip_path = await self.package_builder.build_package(
                workspace_dir=workspace_dir,
                source_files=source_files,
                requirements_content=requirements_content,
                log=package_log,
            )

            # 3. Ensure S3 artifact bucket and upload
            await log("Uploading deployment package to S3", step="Uploading package to S3")
            bucket_name = f"bedrock-agentcore-code-{account_id}-{region}"
            s3_key = f"strands-studio/{agent_name}/{deployment_id}.zip"
            await asyncio.to_thread(
                self._ensure_bucket_and_upload, region, account_id, bucket_name, s3_key, zip_path
            )
            await log(f"Uploaded package to s3://{bucket_name}/{s3_key}")

            # 4. Ensure IAM execution role
            await log("Ensuring IAM execution role", step="Ensuring IAM execution role")
            role_arn, role_created = await asyncio.to_thread(
                self._ensure_iam_role, region, account_id, config.role_arn
            )
            await log(f"Using execution role: {role_arn}")

            # 5. Create or update the agent runtime
            await log("Creating or updating AgentCore runtime", step="Creating AgentCore runtime")
            env_vars = config.get_environment_variables()
            runtime_info = await self._create_or_update_runtime(
                region=region,
                agent_name=agent_name,
                bucket_name=bucket_name,
                s3_key=s3_key,
                role_arn=role_arn,
                network_mode=config.network_mode.value if config.network_mode else "PUBLIC",
                env_vars=env_vars,
                wait_for_iam=role_created,
                log=log,
            )

            # 6. Poll runtime status until READY / FAILED
            await log("Waiting for runtime to become READY", step="Waiting for runtime READY")
            final_status = await self._poll_runtime_status(
                region, runtime_info["agent_runtime_id"], log
            )

            deployment_time = (datetime.now() - start_time).total_seconds()

            if final_status["status"] != "READY":
                failure_reason = final_status.get("failure_reason") or "unknown"
                error_msg = (
                    f"AgentCore runtime deployment failed: status={final_status['status']}, "
                    f"reason={failure_reason}"
                )
                await log(error_msg, status="error", step="Waiting for runtime READY")
                return AgentCoreDeploymentResult(
                    success=False,
                    message=error_msg,
                    agent_runtime_arn=runtime_info.get("agent_runtime_arn"),
                    agent_runtime_name=agent_name,
                    logs=deployment_logs,
                    deployment_time=deployment_time,
                )

            invoke_endpoint = (
                f"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/"
                f"{runtime_info['agent_runtime_id']}/invocations"
            )

            outputs = {
                "agent_runtime_arn": runtime_info["agent_runtime_arn"],
                "agent_runtime_id": runtime_info["agent_runtime_id"],
                "agent_runtime_version": runtime_info.get("agent_runtime_version"),
                "agent_runtime_name": agent_name,
                "invoke_endpoint": invoke_endpoint,
                "deployment_method": "direct-code-deploy",
                "region": region,
                "network_mode": config.network_mode.value if config.network_mode else "PUBLIC",
                "s3_bucket": bucket_name,
                "s3_key": s3_key,
                "status": final_status["status"],
                "streaming_capable": streaming_capable,
            }

            action = runtime_info.get("action", "created")
            success_msg = (
                f"AgentCore runtime {action} and READY: {runtime_info['agent_runtime_arn']} "
                f"(version {runtime_info.get('agent_runtime_version', '?')})"
            )
            await log(success_msg, status="completed", step="Deployment completed")
            deployment_logs.append(f"Deployment completed in {deployment_time:.2f}s")

            return AgentCoreDeploymentResult(
                success=True,
                message=success_msg,
                agent_runtime_arn=runtime_info["agent_runtime_arn"],
                agent_runtime_name=agent_name,
                invoke_endpoint=invoke_endpoint,
                logs=deployment_logs,
                deployment_time=deployment_time,
                deployment_outputs=outputs,
                streaming_capable=streaming_capable
            )

        except PackageBuildError as e:
            error_msg = f"Deployment package build failed: {str(e)}"
            logger.error(error_msg)
            deployment_logs.append(error_msg)
            await self._notify_progress(deployment_id, "Building deployment package", "error", error_msg)
            return AgentCoreDeploymentResult(
                success=False,
                message=error_msg,
                logs=deployment_logs,
                deployment_time=(datetime.now() - start_time).total_seconds()
            )
        except Exception as e:
            error_msg = f"Deployment failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            deployment_logs.append(error_msg)
            await self._notify_progress(deployment_id, "Deployment failed", "error", error_msg)
            return AgentCoreDeploymentResult(
                success=False,
                message=error_msg,
                logs=deployment_logs,
                deployment_time=(datetime.now() - start_time).total_seconds()
            )

    # ------------------------------------------------------------------
    # Naming / progress helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _sanitize_runtime_name(name: str) -> str:
        """
        Sanitize a runtime name to match AgentCore pattern [a-zA-Z][a-zA-Z0-9_]{0,47}.
        Matches the previous engine's behavior (hyphens -> underscores) so re-deploys
        of existing agents map to the same runtime.
        """
        if not name:
            return "agent_runtime"
        sanitized = name.replace('-', '_')
        sanitized = re.sub(r'[^a-zA-Z0-9_]', '_', sanitized)
        if not sanitized[0].isalpha():
            sanitized = f"a{sanitized}"
        return sanitized[:48]

    @staticmethod
    async def _notify_progress(deployment_id: str, step: str, status: str, message: str = None):
        """Stream progress to the existing WebSocket deployment progress channel."""
        try:
            import sys
            from pathlib import Path as _Path
            main_path = _Path(__file__).parent.parent.parent
            if str(main_path) not in sys.path:
                sys.path.insert(0, str(main_path))
            from main import notify_deployment_progress
            await notify_deployment_progress(deployment_id, step, status, message)
        except Exception as e:
            logger.debug(f"Progress notification skipped: {e}")

    # ------------------------------------------------------------------
    # AWS helpers
    # ------------------------------------------------------------------

    def _get_aws_account_id(self, region: str) -> str:
        """Get AWS account ID using boto3."""
        sts_client = boto3.client('sts', region_name=region)
        return sts_client.get_caller_identity()['Account']

    def _ensure_bucket_and_upload(
        self,
        region: str,
        account_id: str,
        bucket_name: str,
        s3_key: str,
        zip_path: Path
    ) -> None:
        """Ensure the artifact bucket exists (region-scoped) and upload the zip."""
        s3_client = boto3.client('s3', region_name=region)

        try:
            s3_client.head_bucket(Bucket=bucket_name, ExpectedBucketOwner=account_id)
            logger.info(f"S3 bucket exists: {bucket_name}")
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            if error_code in ('404', 'NoSuchBucket'):
                logger.info(f"Creating S3 bucket: {bucket_name}")
                create_kwargs: Dict[str, Any] = {'Bucket': bucket_name}
                if region != 'us-east-1':
                    create_kwargs['CreateBucketConfiguration'] = {'LocationConstraint': region}
                s3_client.create_bucket(**create_kwargs)
                s3_client.get_waiter('bucket_exists').wait(Bucket=bucket_name)
            else:
                raise

        s3_client.upload_file(
            str(zip_path),
            bucket_name,
            s3_key,
            ExtraArgs={'ExpectedBucketOwner': account_id}
        )
        logger.info(f"Uploaded {zip_path} to s3://{bucket_name}/{s3_key}")

    def _ensure_iam_role(
        self,
        region: str,
        account_id: str,
        role_hint: Optional[str]
    ) -> tuple:
        """
        Ensure the AgentCore execution role exists (pure boto3, no shell script).

        Args:
            role_hint: A role ARN (used directly), a role name (looked up),
                       or None (default role ensured/created)

        Returns:
            (role_arn, created) - created is True if the role was just created
        """
        iam_client = boto3.client('iam', region_name=region)

        # Explicit ARN provided - use directly
        if role_hint and role_hint.startswith('arn:'):
            return role_hint, False

        role_name = role_hint or DEFAULT_ROLE_NAME

        try:
            response = iam_client.get_role(RoleName=role_name)
            role_arn = response['Role']['Arn']
            logger.info(f"IAM role already exists: {role_arn}")
            return role_arn, False
        except ClientError as e:
            if e.response['Error']['Code'] != 'NoSuchEntity':
                raise
            if role_hint and role_hint != DEFAULT_ROLE_NAME:
                # User explicitly named a non-default role that doesn't exist - fail clearly
                raise RuntimeError(
                    f"Execution role '{role_name}' not found. Provide an existing role "
                    f"name/ARN or use the default role name to auto-create it."
                )
            role_name = DEFAULT_ROLE_NAME

        logger.info(f"Creating IAM role: {role_name}")

        trust_policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "AssumeRolePolicy",
                    "Effect": "Allow",
                    "Principal": {"Service": "bedrock-agentcore.amazonaws.com"},
                    "Action": "sts:AssumeRole",
                    "Condition": {
                        "StringEquals": {"aws:SourceAccount": account_id},
                        "ArnLike": {
                            "aws:SourceArn": f"arn:aws:bedrock-agentcore:{region}:{account_id}:*"
                        }
                    }
                }
            ]
        }

        permissions_policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "CloudWatchLogs",
                    "Effect": "Allow",
                    "Action": [
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:PutLogEvents",
                        "logs:DescribeLogStreams",
                        "logs:DescribeLogGroups"
                    ],
                    "Resource": [
                        f"arn:aws:logs:{region}:{account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
                        f"arn:aws:logs:{region}:{account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*",
                        f"arn:aws:logs:{region}:{account_id}:log-group:*"
                    ]
                },
                {
                    "Sid": "XRay",
                    "Effect": "Allow",
                    "Action": [
                        "xray:PutTraceSegments",
                        "xray:PutTelemetryRecords",
                        "xray:GetSamplingRules",
                        "xray:GetSamplingTargets"
                    ],
                    "Resource": "*"
                },
                {
                    "Sid": "CloudWatchMetrics",
                    "Effect": "Allow",
                    "Action": "cloudwatch:PutMetricData",
                    "Resource": "*",
                    "Condition": {
                        "StringEquals": {"cloudwatch:namespace": "bedrock-agentcore"}
                    }
                },
                {
                    "Sid": "WorkloadAccessToken",
                    "Effect": "Allow",
                    "Action": [
                        "bedrock-agentcore:GetWorkloadAccessToken",
                        "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
                        "bedrock-agentcore:GetWorkloadAccessTokenForUserId"
                    ],
                    "Resource": [
                        f"arn:aws:bedrock-agentcore:{region}:{account_id}:workload-identity-directory/default",
                        f"arn:aws:bedrock-agentcore:{region}:{account_id}:workload-identity-directory/default/workload-identity/*"
                    ]
                },
                {
                    "Sid": "BedrockModelInvocation",
                    "Effect": "Allow",
                    "Action": [
                        "bedrock:InvokeModel",
                        "bedrock:InvokeModelWithResponseStream"
                    ],
                    "Resource": [
                        "arn:aws:bedrock:*::foundation-model/*",
                        f"arn:aws:bedrock:{region}:{account_id}:*"
                    ]
                }
            ]
        }

        response = iam_client.create_role(
            RoleName=role_name,
            Path=DEFAULT_ROLE_PATH,
            AssumeRolePolicyDocument=json.dumps(trust_policy),
            Description="Service role for Amazon Bedrock AgentCore Runtime - auto-created by Strands Studio",
            MaxSessionDuration=3600
        )
        role_arn = response['Role']['Arn']

        iam_client.put_role_policy(
            RoleName=role_name,
            PolicyName=DEFAULT_POLICY_NAME,
            PolicyDocument=json.dumps(permissions_policy)
        )

        logger.info(f"Created IAM role: {role_arn}")
        return role_arn, True

    async def _create_or_update_runtime(
        self,
        region: str,
        agent_name: str,
        bucket_name: str,
        s3_key: str,
        role_arn: str,
        network_mode: str,
        env_vars: Dict[str, str],
        wait_for_iam: bool,
        log: Callable[..., Awaitable[None]],
    ) -> Dict[str, Any]:
        """
        Create a new agent runtime or update an existing one with the same name
        (preserves the previous engine's auto-update-on-conflict semantics).
        """
        client = boto3.client('bedrock-agentcore-control', region_name=region)

        artifact = {
            'codeConfiguration': {
                'code': {'s3': {'bucket': bucket_name, 'prefix': s3_key}},
                'runtime': 'PYTHON_3_13',
                'entryPoint': ['agent_runtime.py'],
            }
        }
        runtime_config = {
            'agentRuntimeArtifact': artifact,
            'roleArn': role_arn,
            'networkConfiguration': {'networkMode': network_mode},
            'protocolConfiguration': {'serverProtocol': 'HTTP'},
        }
        if env_vars:
            runtime_config['environmentVariables'] = env_vars

        # Look up existing runtime by name (no server-side filter; paginate client-side)
        existing = await asyncio.to_thread(self._find_runtime_by_name, client, agent_name)

        if existing:
            await log(
                f"Runtime '{agent_name}' exists ({existing['agentRuntimeId']}), updating with new package"
            )
            response = await asyncio.to_thread(
                lambda: client.update_agent_runtime(
                    agentRuntimeId=existing['agentRuntimeId'],
                    **runtime_config
                )
            )
            return {
                "action": "updated",
                "agent_runtime_arn": response.get('agentRuntimeArn', existing.get('agentRuntimeArn')),
                "agent_runtime_id": existing['agentRuntimeId'],
                "agent_runtime_version": response.get('agentRuntimeVersion'),
            }

        # Create new runtime, retrying on IAM eventual-consistency validation errors
        attempts = CREATE_RETRY_ATTEMPTS if wait_for_iam else 3
        last_error: Optional[Exception] = None
        for attempt in range(1, attempts + 1):
            try:
                response = await asyncio.to_thread(
                    lambda: client.create_agent_runtime(
                        agentRuntimeName=agent_name,
                        **runtime_config
                    )
                )
                return {
                    "action": "created",
                    "agent_runtime_arn": response['agentRuntimeArn'],
                    "agent_runtime_id": response['agentRuntimeId'],
                    "agent_runtime_version": response.get('agentRuntimeVersion'),
                }
            except ClientError as e:
                error_code = e.response['Error']['Code']
                error_message = e.response['Error'].get('Message', '')

                if error_code == 'ConflictException':
                    # Race: runtime created concurrently - fall back to lookup + update
                    await log("Runtime already exists (conflict), falling back to update")
                    existing = await asyncio.to_thread(self._find_runtime_by_name, client, agent_name)
                    if existing:
                        response = await asyncio.to_thread(
                            lambda: client.update_agent_runtime(
                                agentRuntimeId=existing['agentRuntimeId'],
                                **runtime_config
                            )
                        )
                        return {
                            "action": "updated",
                            "agent_runtime_arn": response.get('agentRuntimeArn', existing.get('agentRuntimeArn')),
                            "agent_runtime_id": existing['agentRuntimeId'],
                            "agent_runtime_version": response.get('agentRuntimeVersion'),
                        }
                    raise

                is_iam_propagation = (
                    error_code in ('ValidationException', 'AccessDeniedException')
                    and ('assume' in error_message.lower() or 'role' in error_message.lower())
                )
                if is_iam_propagation and attempt < attempts:
                    last_error = e
                    await log(
                        f"IAM role not yet propagated (attempt {attempt}/{attempts}), "
                        f"retrying in {CREATE_RETRY_DELAY_SECONDS}s..."
                    )
                    await asyncio.sleep(CREATE_RETRY_DELAY_SECONDS)
                    continue
                raise

        raise RuntimeError(f"create_agent_runtime failed after {attempts} attempts: {last_error}")

    @staticmethod
    def _find_runtime_by_name(client, agent_name: str) -> Optional[Dict[str, Any]]:
        """Paginate list_agent_runtimes and match agentRuntimeName client-side."""
        next_token = None
        while True:
            kwargs = {'maxResults': 100}
            if next_token:
                kwargs['nextToken'] = next_token
            response = client.list_agent_runtimes(**kwargs)
            for runtime in response.get('agentRuntimes', []):
                if runtime.get('agentRuntimeName') == agent_name:
                    return runtime
            next_token = response.get('nextToken')
            if not next_token:
                return None

    async def _poll_runtime_status(
        self,
        region: str,
        agent_runtime_id: str,
        log: Callable[..., Awaitable[None]],
    ) -> Dict[str, Any]:
        """Poll get_agent_runtime until READY or a terminal failure status (or timeout)."""
        client = boto3.client('bedrock-agentcore-control', region_name=region)
        elapsed = 0
        last_status = None

        while elapsed <= POLL_TIMEOUT_SECONDS:
            response = await asyncio.to_thread(
                lambda: client.get_agent_runtime(agentRuntimeId=agent_runtime_id)
            )
            status = response.get('status')
            if status != last_status:
                await log(f"Runtime status: {status}")
                last_status = status

            if status == 'READY':
                return {"status": "READY"}
            if status in TERMINAL_FAILURE_STATUSES:
                return {
                    "status": status,
                    "failure_reason": response.get('failureReason')
                }

            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            elapsed += POLL_INTERVAL_SECONDS

        return {
            "status": f"TIMEOUT (last status: {last_status})",
            "failure_reason": (
                f"Runtime did not reach READY within {POLL_TIMEOUT_SECONDS}s "
                f"(last status: {last_status})"
            )
        }

    # ------------------------------------------------------------------
    # Deletion (unchanged data-plane behavior)
    # ------------------------------------------------------------------

    async def delete_deployment(
        self,
        agent_runtime_arn: str,
        region: str
    ) -> AgentCoreDeploymentResult:
        """Delete an AgentCore deployment by ARN"""
        try:
            client = boto3.client('bedrock-agentcore-control', region_name=region)

            # Extract the runtime ID from the ARN
            # ARN format: arn:aws:bedrock-agentcore:region:account:runtime/agent-name-id
            if not agent_runtime_arn.startswith('arn:aws:bedrock-agentcore:'):
                raise ValueError("Invalid AgentCore ARN format")

            # The AWS API expects just the runtime ID part (without the full ARN)
            # Extract everything after 'runtime/' in the ARN
            arn_parts = agent_runtime_arn.split(':')
            if len(arn_parts) >= 6 and arn_parts[5].startswith('runtime/'):
                agent_runtime_id = arn_parts[5][8:]  # Remove 'runtime/' prefix
            else:
                raise ValueError(f"Invalid AgentCore ARN - missing runtime part. ARN: {agent_runtime_arn}")

            logger.info(f"Deleting AgentRuntime with ID: {agent_runtime_id}")

            # Delete the AgentRuntime using the correct parameter name
            client.delete_agent_runtime(agentRuntimeId=agent_runtime_id)

            logger.info(f"Successfully initiated AgentRuntime deletion: {agent_runtime_id}")

            return AgentCoreDeploymentResult(
                success=True,
                message=f"AgentRuntime deletion initiated: {agent_runtime_id}",
                logs=[f"Deleting AgentRuntime: {agent_runtime_id}"]
            )

        except ClientError as e:
            error_code = e.response['Error']['Code']
            runtime_identifier = agent_runtime_arn

            # Handle ResourceNotFoundException - resource already deleted
            if error_code == 'ResourceNotFoundException':
                logger.info(f"AgentRuntime {runtime_identifier} not found - likely already deleted")
                return AgentCoreDeploymentResult(
                    success=True,
                    message=f"AgentRuntime was already deleted: {runtime_identifier}",
                    logs=[f"AgentRuntime {runtime_identifier} not found in AWS (already deleted)"]
                )

            # Handle ConflictException - resource is being deleted
            if error_code == 'ConflictException':
                logger.info(f"AgentRuntime {runtime_identifier} is currently being deleted")
                return AgentCoreDeploymentResult(
                    success=True,
                    message=f"AgentRuntime deletion already in progress: {runtime_identifier}",
                    logs=[f"AgentRuntime {runtime_identifier} is already being deleted"]
                )

            # Handle other AWS errors
            error_msg = f"AWS API error ({error_code}): {e.response['Error'].get('Message', str(e))}"
            logger.error(error_msg)
            return AgentCoreDeploymentResult(
                success=False,
                message=error_msg,
                logs=[error_msg]
            )

        except Exception as e:
            error_msg = f"Failed to delete deployment: {str(e)}"
            logger.error(error_msg)
            return AgentCoreDeploymentResult(
                success=False,
                message=error_msg,
                logs=[error_msg]
            )
