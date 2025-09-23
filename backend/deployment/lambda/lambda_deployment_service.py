"""
Lambda Deployment Service
Handles packaging and deploying Strands agents to AWS Lambda using SAM CLI.
"""
import os
import json
import shutil
import logging
import tempfile
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

@dataclass
class LambdaDeploymentConfig:
    """Configuration for Lambda deployment"""
    function_name: str
    memory_size: int = 512
    timeout: int = 300
    runtime: str = "python3.11"
    architecture: str = "x86_64"  # or "arm64"
    region: str = "us-east-1"
    stack_name: Optional[str] = None
    api_keys: Optional[Dict[str, str]] = None
    project_id: Optional[str] = None
    version: Optional[str] = None

@dataclass
class DeploymentResult:
    """Result of a deployment operation"""
    success: bool
    message: str
    function_arn: Optional[str] = None
    api_endpoint: Optional[str] = None
    logs: Optional[List[str]] = None
    deployment_time: Optional[float] = None

class LambdaDeploymentService:
    """Service for deploying Strands agents to AWS Lambda"""

    def __init__(self, base_deployment_dir: str = None):
        """
        Initialize the Lambda deployment service.

        Args:
            base_deployment_dir: Base directory for deployment files
        """
        if base_deployment_dir is None:
            base_deployment_dir = Path(__file__).parent
        self.base_deployment_dir = Path(base_deployment_dir)
        self.template_path = self.base_deployment_dir / "template.yaml"
        self.handler_template_path = self.base_deployment_dir / "agent_handler.py"
        self.requirements_path = self.base_deployment_dir / "requirements.txt"

    async def deploy_agent(
        self,
        generated_code: str,
        config: LambdaDeploymentConfig,
        deployment_id: str = None
    ) -> DeploymentResult:
        """
        Deploy a Strands agent to AWS Lambda.

        Args:
            generated_code: The Python code generated from the visual flow
            config: Deployment configuration

        Returns:
            DeploymentResult with deployment status and details
        """
        start_time = datetime.now()
        deployment_logs = []

        logger.info(f"Starting Lambda deployment for function: {config.function_name}")

        try:
            # Helper function to send WebSocket notifications
            async def notify_progress(step: str, status: str, message: str = None):
                if deployment_id:
                    try:
                        # Import notification function dynamically
                        import sys
                        from pathlib import Path
                        main_path = Path(__file__).parent.parent.parent
                        if str(main_path) not in sys.path:
                            sys.path.insert(0, str(main_path))

                        from main import notify_deployment_progress
                        await notify_deployment_progress(deployment_id, step, status, message)
                    except Exception as e:
                        logger.warning(f"Failed to send WebSocket notification: {e}")

            # Validate prerequisites
            await notify_progress("Validating prerequisites", "running")
            self._validate_prerequisites()

            # Check for existing Lambda function with same name
            await self._check_function_name_conflict(config.function_name, deployment_logs)

            deployment_logs.append("Prerequisites validated")
            await notify_progress("Validating prerequisites", "completed")

            # Create persistent storage directory for deployment files
            project_id = config.project_id or config.function_name  # Use function_name as fallback project_id
            version = config.version or "v1.0.0"  # Default version
            storage_dir = Path("storage/deploy_history/lambda") / project_id / version
            storage_dir.mkdir(parents=True, exist_ok=True)
            deployment_logs.append(f"Created storage directory: {storage_dir}")

            # Create deployment-specific directory using provided deployment_id or generate one
            if deployment_id:
                storage_deployment_id = f"deployment-{deployment_id[:8]}"
            else:
                storage_deployment_id = f"deployment-{int(datetime.now().timestamp() * 1000)}"
            deployment_storage_dir = storage_dir / storage_deployment_id
            deployment_storage_dir.mkdir(exist_ok=True)

            # Save deployment code and metadata
            await notify_progress("Saving deployment artifacts", "running")
            await self._save_deployment_artifacts(
                deployment_storage_dir, generated_code, config, deployment_logs
            )
            await notify_progress("Saving deployment artifacts", "completed")

            # Create temporary deployment directory for SAM operations
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                deployment_logs.append(f"Created temporary directory: {temp_path}")

                # Prepare deployment package
                await notify_progress("Preparing deployment package", "running")
                await self._prepare_deployment_package(
                    temp_path, generated_code, config, deployment_logs
                )
                await notify_progress("Preparing deployment package", "completed")

                # Build with SAM
                await notify_progress("Building with SAM", "running")
                build_result = await self._sam_build(temp_path, deployment_logs, deployment_id)
                if not build_result:
                    await notify_progress("Building with SAM", "error", "SAM build failed")
                    return DeploymentResult(
                        success=False,
                        message="SAM build failed",
                        logs=deployment_logs
                    )
                await notify_progress("Building with SAM", "completed")

                # Deploy with SAM
                await notify_progress("Deploying to AWS", "running")
                deploy_result = await self._sam_deploy(
                    temp_path, config, deployment_logs
                )
                if not deploy_result["success"]:
                    await notify_progress("Deploying to AWS", "error", deploy_result["message"])
                    return DeploymentResult(
                        success=False,
                        message=deploy_result["message"],
                        logs=deployment_logs
                    )
                await notify_progress("Deploying to AWS", "completed")

                # Get deployment outputs
                outputs = await self._get_stack_outputs(config, deployment_logs)

                deployment_time = (datetime.now() - start_time).total_seconds()
                deployment_logs.append(f"Deployment completed in {deployment_time:.2f}s")

                # Save deployment results
                await self._save_deployment_result(
                    deployment_storage_dir, outputs, deployment_logs, deployment_time
                )

                logger.info(f"Lambda deployment successful: {config.function_name}")

                return DeploymentResult(
                    success=True,
                    message="Deployment successful",
                    function_arn=outputs.get("function_arn"),
                    api_endpoint=outputs.get("api_endpoint"),
                    logs=deployment_logs,
                    deployment_time=deployment_time
                )

        except Exception as e:
            error_msg = f"Deployment failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            deployment_logs.append(error_msg)

            return DeploymentResult(
                success=False,
                message=error_msg,
                logs=deployment_logs,
                deployment_time=(datetime.now() - start_time).total_seconds()
            )

    def _validate_prerequisites(self):
        """Validate that required tools are available"""
        # Check SAM CLI
        try:
            result = subprocess.run(
                ["sam", "--version"],
                capture_output=True,
                text=True,
                check=True
            )
            logger.info(f"SAM CLI version: {result.stdout.strip()}")
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise RuntimeError("SAM CLI is not installed or not in PATH")

        # Check AWS CLI
        try:
            result = subprocess.run(
                ["aws", "--version"],
                capture_output=True,
                text=True,
                check=True
            )
            logger.info(f"AWS CLI version: {result.stdout.strip()}")
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise RuntimeError("AWS CLI is not installed or not in PATH")

        # Check required template files
        if not self.template_path.exists():
            raise RuntimeError(f"SAM template not found: {self.template_path}")

        if not self.handler_template_path.exists():
            raise RuntimeError(f"Handler template not found: {self.handler_template_path}")

    async def _check_function_name_conflict(self, function_name: str, logs: List[str]):
        """Check if Lambda function with the same name already exists"""
        try:
            result = subprocess.run(
                ["aws", "lambda", "get-function", "--function-name", function_name],
                capture_output=True,
                text=True,
                check=False  # Don't raise exception on non-zero exit
            )

            if result.returncode == 0:
                # Function exists
                error_msg = f"Lambda function '{function_name}' already exists. Please choose a different name or delete the existing function first."
                logs.append(error_msg)
                logger.error(error_msg)
                raise RuntimeError(error_msg)
            elif "ResourceNotFoundException" in result.stderr:
                # Function doesn't exist, which is what we want
                logs.append(f"Function name '{function_name}' is available")
                logger.info(f"Function name '{function_name}' is available for deployment")
            else:
                # Some other error occurred
                logger.warning(f"Could not check function name availability: {result.stderr}")
                logs.append(f"Warning: Could not verify function name availability: {result.stderr}")

        except Exception as e:
            logger.warning(f"Failed to check function name conflict: {str(e)}")
            logs.append(f"Warning: Could not check for function name conflicts: {str(e)}")

    async def _prepare_deployment_package(
        self,
        temp_path: Path,
        generated_code: str,
        config: LambdaDeploymentConfig,
        logs: List[str]
    ):
        """Prepare the deployment package in the temporary directory"""
        # Copy SAM template
        shutil.copy2(self.template_path, temp_path / "template.yaml")
        logs.append("Copied SAM template")

        # Create agent_function directory
        agent_function_dir = temp_path / "agent_function"
        agent_function_dir.mkdir()

        # Copy requirements.txt
        shutil.copy2(self.requirements_path, agent_function_dir / "requirements.txt")

        # Generate the handler with injected code
        handler_content = await self._generate_handler(generated_code)
        (agent_function_dir / "agent_handler.py").write_text(handler_content, encoding='utf-8')
        logs.append("Generated Lambda handler with injected Strands code")

        # Create samconfig.toml for deployment configuration
        samconfig_content = self._generate_samconfig(config)
        (temp_path / "samconfig.toml").write_text(samconfig_content, encoding='utf-8')
        logs.append("Created SAM configuration file")

    async def _generate_handler(self, generated_code: str) -> str:
        """Generate the Lambda handler with injected Strands agent code"""
        # Read the handler template
        handler_template = self.handler_template_path.read_text(encoding='utf-8')

        # Extract the main function and agent setup from generated code
        injected_code = self._extract_agent_code(generated_code)

        # Replace the placeholder in the handler template
        placeholder = "        # This is a placeholder - the actual generated code will be injected here"
        end_placeholder = "        # Default simple agent for testing"

        if placeholder in handler_template:
            # Find the placeholder and replace with injected code
            parts = handler_template.split(placeholder)
            if len(parts) == 2:
                # Find the end of the placeholder section
                second_parts = parts[1].split(end_placeholder)
                if len(second_parts) >= 2:
                    # Replace the section between placeholders
                    handler_content = (
                        parts[0] +
                        "        # Generated Strands agent code\n" +
                        injected_code +
                        "\n        # End of generated code\n        " +
                        end_placeholder +
                        end_placeholder.join(second_parts[1:])
                    )
                else:
                    # Fallback: just add the code after placeholder
                    handler_content = (
                        parts[0] +
                        "        # Generated Strands agent code\n" +
                        injected_code +
                        "\n        # End of generated code" +
                        parts[1]
                    )
            else:
                # Fallback: append code at the end of function
                handler_content = handler_template.replace(
                    placeholder,
                    "        # Generated Strands agent code\n" + injected_code
                )
        else:
            # Fallback: append code at the end of the execute function
            handler_content = handler_template + "\n# Injected code:\n" + injected_code

        return handler_content

    def _extract_agent_code(self, generated_code: str) -> str:
        """Extract and adapt the agent code for Lambda execution"""
        lines = generated_code.split('\n')
        agent_config_lines = []
        main_function_lines = []
        in_main_function = False
        indent_level = 8  # Lambda handler indentation level

        for line in lines:
            # Skip import lines - they're already in the handler template
            if line.strip().startswith(('import ', 'from ')):
                continue

            # Skip the main function definition and if __name__ == "__main__" blocks
            if 'async def main(' in line or 'def main(' in line or 'if __name__ == "__main__":' in line:
                in_main_function = True
                continue

            if in_main_function and line.strip() == '':
                continue

            if in_main_function and not line.startswith('    '):
                in_main_function = False

            if in_main_function:
                # Skip problematic global statements since variables are in local scope
                stripped_line = line.strip()
                if stripped_line.startswith('global ') and 'agent' in stripped_line:
                    continue
                # Remove one level of indentation and add Lambda handler indentation
                if line.startswith('    '):
                    main_function_lines.append(' ' * indent_level + line[4:])
                elif line.strip():
                    main_function_lines.append(' ' * indent_level + line)
            elif not in_main_function and line.strip() and not line.startswith('#'):
                # Include tool definitions and agent configurations
                agent_config_lines.append(' ' * indent_level + line)

        # Build the final extracted code with proper order
        extracted_lines = []

        # First: Add agent configuration (tools, agent setup)
        extracted_lines.extend(agent_config_lines)

        # Second: Add variable setup for main function code
        extracted_lines.extend([
            ' ' * indent_level + '# Set up variables for extracted main function code',
            ' ' * indent_level + 'user_input_arg = input_data if input_data else prompt',
            ' ' * indent_level + 'messages_arg = None  # Not available in lambda context',
            ' ' * indent_level + 'user_input = user_input_arg',
            ' ' * indent_level + ''
        ])

        # Third: Add extracted main function code
        extracted_lines.extend(main_function_lines)

        # Fourth: Add fallback execution logic
        extracted_lines.extend([
            ' ' * indent_level + '',
            ' ' * indent_level + '# Return the response from main function code or fallback',
            ' ' * indent_level + 'if "response" in locals():',
            ' ' * (indent_level + 4) + 'return str(response)',
            ' ' * indent_level + 'elif "agent" in locals():',
            ' ' * (indent_level + 4) + '# Fallback: use agent directly',
            ' ' * (indent_level + 4) + 'response = agent(user_input)',
            ' ' * (indent_level + 4) + 'return str(response)',
            ' ' * indent_level + 'else:',
            ' ' * (indent_level + 4) + 'return f"No agent or response found. Received: {user_input}"'
        ])

        return '\n'.join(extracted_lines)

    async def _save_deployment_artifacts(
        self,
        storage_dir: Path,
        generated_code: str,
        config: LambdaDeploymentConfig,
        logs: List[str]
    ):
        """Save deployment artifacts to persistent storage"""
        try:
            # Save the original generated code
            (storage_dir / "deployment_code.py").write_text(generated_code, encoding='utf-8')

            # Save deployment configuration as JSON
            config_data = {
                "function_name": config.function_name,
                "memory_size": config.memory_size,
                "timeout": config.timeout,
                "runtime": config.runtime,
                "architecture": config.architecture,
                "region": config.region,
                "stack_name": config.stack_name,
                "enable_api_gateway": getattr(config, 'enable_api_gateway', True),
                "enable_function_url": getattr(config, 'enable_function_url', False),
                "api_keys": config.api_keys if config.api_keys else {},
                "created_at": datetime.now().isoformat()
            }

            with open(storage_dir / "deployment_metadata.json", 'w') as f:
                json.dump(config_data, f, indent=2)

            # Generate and save the Lambda handler that will be deployed
            handler_content = await self._generate_handler(generated_code)
            (storage_dir / "agent_handler.py").write_text(handler_content, encoding='utf-8')

            # Save SAM configuration
            samconfig_content = self._generate_samconfig(config)
            (storage_dir / "samconfig.toml").write_text(samconfig_content, encoding='utf-8')

            # Copy requirements.txt
            if self.requirements_path.exists():
                shutil.copy2(self.requirements_path, storage_dir / "requirements.txt")

            # Copy SAM template
            if self.template_path.exists():
                shutil.copy2(self.template_path, storage_dir / "template.yaml")

            logs.append(f"Saved deployment artifacts to {storage_dir}")
            logger.info(f"Deployment artifacts saved to: {storage_dir}")

        except Exception as e:
            error_msg = f"Failed to save deployment artifacts: {str(e)}"
            logs.append(error_msg)
            logger.error(error_msg)

    async def _save_deployment_result(
        self,
        storage_dir: Path,
        outputs: Dict[str, str],
        logs: List[str],
        deployment_time: float
    ):
        """Save deployment results to persistent storage"""
        try:
            result_data = {
                "success": True,
                "outputs": outputs,
                "deployment_time": deployment_time,
                "completed_at": datetime.now().isoformat(),
                "logs": logs
            }

            with open(storage_dir / "deployment_result.json", 'w') as f:
                json.dump(result_data, f, indent=2)

            # Also save logs as text file
            with open(storage_dir / "deployment_logs.txt", 'w') as f:
                f.write('\n'.join(logs))

            logger.info(f"Deployment result saved to: {storage_dir}")

        except Exception as e:
            error_msg = f"Failed to save deployment result: {str(e)}"
            logger.error(error_msg)

    def _generate_samconfig(self, config: LambdaDeploymentConfig) -> str:
        """Generate SAM configuration file"""
        stack_name = config.stack_name or f"strands-agent-{config.function_name.lower()}"

        samconfig = f"""version = 0.1
[default]
[default.deploy]
[default.deploy.parameters]
stack_name = "{stack_name}"
s3_bucket = ""  # SAM will create a bucket if not specified
s3_prefix = "strands-agent"
region = "{config.region}"
confirm_changeset = false
capabilities = "CAPABILITY_IAM"
parameter_overrides = [
    "FunctionName={config.function_name}",
    "MemorySize={config.memory_size}",
    "Timeout={config.timeout}",
    "Runtime={config.runtime}",
    "Architecture={config.architecture}"
]
image_repositories = []
"""
        return samconfig

    async def _sam_build(self, temp_path: Path, logs: List[str], deployment_id: str = None) -> bool:
        """Run SAM build with container build for better dependency compatibility"""

        # Helper function to send progress notifications
        async def notify_progress(message: str):
            if deployment_id:
                try:
                    import sys
                    from pathlib import Path
                    main_path = Path(__file__).parent.parent.parent
                    if str(main_path) not in sys.path:
                        sys.path.insert(0, str(main_path))

                    from main import notify_deployment_progress
                    await notify_deployment_progress(deployment_id, "Building with SAM", "running", message)
                except Exception as e:
                    logger.warning(f"Failed to send SAM build progress notification: {e}")

        # Use container build first to ensure C extensions are compiled correctly
        try:
            logs.append("Using container build for better dependency compatibility...")
            await notify_progress("Starting container build for better dependency compatibility...")

            result = subprocess.run(
                ["sam", "build", "--use-container"],
                cwd=temp_path,
                capture_output=True,
                text=True,
                check=True
            )
            logs.append("SAM container build successful")
            logger.info("SAM container build completed successfully")
            return True
        except subprocess.CalledProcessError as container_error:
            error_msg = f"Container build failed: {container_error.stderr}"
            logs.append(error_msg)
            logs.append("Falling back to regular build...")
            logger.warning(f"Container build failed, falling back to regular build: {container_error.stderr}")
            await notify_progress("Container build failed, trying regular build...")

            # Fallback to regular SAM build
            try:
                await notify_progress("Starting regular SAM build (this may take several minutes)...")

                result = subprocess.run(
                    ["sam", "build"],
                    cwd=temp_path,
                    capture_output=True,
                    text=True,
                    check=True
                )
                logs.append("SAM build successful")
                logger.info("SAM build completed successfully")
                return True
            except subprocess.CalledProcessError as e:
                error_msg = f"Both container and regular SAM builds failed: {e.stderr}"
                logs.append(error_msg)
                logger.error(error_msg)
                return False

    async def _sam_deploy(
        self,
        temp_path: Path,
        config: LambdaDeploymentConfig,
        logs: List[str]
    ) -> Dict[str, Any]:
        """Run SAM deploy"""
        try:
            # Set environment variables for API keys if provided
            env = os.environ.copy()
            if config.api_keys:
                for key, value in config.api_keys.items():
                    env[key.upper()] = value

            result = subprocess.run(
                ["sam", "deploy", "--no-confirm-changeset", "--no-fail-on-empty-changeset", "--resolve-s3"],
                cwd=temp_path,
                capture_output=True,
                text=True,
                check=True,
                env=env
            )
            logs.append("SAM deploy successful")
            logger.info("SAM deploy completed successfully")
            return {"success": True, "message": "Deploy successful"}
        except subprocess.CalledProcessError as e:
            error_msg = f"SAM deploy failed: {e.stderr}"
            logs.append(error_msg)
            logger.error(error_msg)
            return {"success": False, "message": error_msg}

    async def _get_stack_outputs(
        self,
        config: LambdaDeploymentConfig,
        logs: List[str]
    ) -> Dict[str, str]:
        """Get CloudFormation stack outputs"""
        try:
            stack_name = config.stack_name or f"strands-agent-{config.function_name.lower()}"
            result = subprocess.run(
                [
                    "aws", "cloudformation", "describe-stacks",
                    "--stack-name", stack_name,
                    "--region", config.region,
                    "--query", "Stacks[0].Outputs",
                    "--output", "json"
                ],
                capture_output=True,
                text=True,
                check=True
            )

            outputs_raw = json.loads(result.stdout)
            outputs = {}

            if outputs_raw:
                for output in outputs_raw:
                    key = output.get("OutputKey", "").lower()
                    value = output.get("OutputValue", "")

                    if "function" in key:
                        outputs["function_arn"] = value
                    elif "api" in key:
                        outputs["api_endpoint"] = value

            logs.append(f"Retrieved stack outputs: {list(outputs.keys())}")
            return outputs

        except Exception as e:
            error_msg = f"Failed to get stack outputs: {str(e)}"
            logs.append(error_msg)
            logger.warning(error_msg)
            return {}

    async def delete_deployment(
        self,
        config: LambdaDeploymentConfig
    ) -> DeploymentResult:
        """Delete a Lambda deployment"""
        try:
            stack_name = config.stack_name or f"strands-agent-{config.function_name.lower()}"

            result = subprocess.run(
                [
                    "aws", "cloudformation", "delete-stack",
                    "--stack-name", stack_name,
                    "--region", config.region
                ],
                capture_output=True,
                text=True,
                check=True
            )

            logger.info(f"Initiated stack deletion: {stack_name}")

            return DeploymentResult(
                success=True,
                message=f"Stack deletion initiated: {stack_name}",
                logs=[f"Deleting stack: {stack_name}"]
            )

        except Exception as e:
            error_msg = f"Failed to delete deployment: {str(e)}"
            logger.error(error_msg)
            return DeploymentResult(
                success=False,
                message=error_msg,
                logs=[error_msg]
            )

    async def get_function_logs(
        self,
        config: LambdaDeploymentConfig,
        max_items: int = 100
    ) -> Dict[str, Any]:
        """Get Lambda function logs"""
        try:
            result = subprocess.run(
                [
                    "aws", "logs", "describe-log-streams",
                    "--log-group-name", f"/aws/lambda/{config.function_name}",
                    "--region", config.region,
                    "--order-by", "LastEventTime",
                    "--descending",
                    "--max-items", str(max_items)
                ],
                capture_output=True,
                text=True,
                check=True
            )

            log_streams = json.loads(result.stdout)
            return {
                "success": True,
                "log_streams": log_streams.get("logStreams", [])
            }

        except Exception as e:
            logger.error(f"Failed to get function logs: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }