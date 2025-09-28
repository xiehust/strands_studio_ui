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
    # Streaming-specific fields
    streaming_capable: Optional[bool] = None
    invoke_endpoint: Optional[str] = None
    streaming_invoke_endpoint: Optional[str] = None
    function_url: Optional[str] = None
    deployment_type: Optional[str] = None
    invoke_mode: Optional[str] = None
    # Dual-function specific fields
    python_function_arn: Optional[str] = None
    python_stream_function_arn: Optional[str] = None
    sync_function_url: Optional[str] = None
    stream_function_url: Optional[str] = None

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
        self.template_path = self.base_deployment_dir / "template_dual_function.yaml"
        self.python_handler_path = self.base_deployment_dir / "agent_handler_python.py"
        self.requirements_path = self.base_deployment_dir / "requirements.txt"
        self.package_json_path = self.base_deployment_dir / "package.json"

    def detect_streaming_capability(self, generated_code: str) -> bool:
        """
        Detect if the generated code has streaming capabilities by looking for specific patterns
        """
        # Look for the specific streaming pattern: agent.stream_async()
        has_stream_async_call = 'agent.stream_async(' in generated_code
        has_async_for_stream = 'async for' in generated_code and 'stream_async' in generated_code
        has_print_event_data = "print(event['data']" in generated_code

        # Also check for yield patterns as backup
        has_yield = 'yield' in generated_code

        streaming_capable = has_stream_async_call or has_async_for_stream or has_print_event_data or has_yield

        logger.info(f"Streaming capability detection - stream_async_call: {has_stream_async_call}, "
                   f"async_for_stream: {has_async_for_stream}, print_event_data: {has_print_event_data}, "
                   f"yield: {has_yield}, final: {streaming_capable}")
        return streaming_capable

    def get_template_path(self, streaming_capable: bool) -> Path:
        """
        Get the appropriate template based on streaming capability
        """
        if streaming_capable:
            template_path = self.base_deployment_dir / "template_dual_function.yaml"
            logger.info(f"Using dual-function template (streaming enabled)")
        else:
            template_path = self.base_deployment_dir / "template_sync_only.yaml"
            logger.info(f"Using sync-only template (streaming disabled)")

        return template_path

    def get_handler_paths(self, streaming_capable: bool) -> Path:
        """
        Get Python handler template path
        """
        python_path = self.base_deployment_dir / "agent_handler_python.py"
        logger.info(f"Using Python handler: {python_path.name}, streaming_capable={streaming_capable}")
        return python_path

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

            # Detect streaming capability and select appropriate templates
            await notify_progress("Analyzing code capabilities", "running")
            streaming_capable = self.detect_streaming_capability(generated_code)
            selected_template_path = self.get_template_path(streaming_capable)
            python_handler_path = self.get_handler_paths(streaming_capable)

            deployment_logs.append(f"Streaming capability detected: {streaming_capable}")
            deployment_logs.append(f"Using template: {selected_template_path.name}")
            deployment_logs.append(f"Using Python handler: {python_handler_path.name}")
            await notify_progress("Analyzing code capabilities", "completed", f"Dual-function setup, streaming: {streaming_capable}")

            # Validate prerequisites
            await notify_progress("Validating prerequisites", "running")
            self._validate_prerequisites()

            # Validate that selected templates exist
            if not selected_template_path.exists():
                raise RuntimeError(f"Selected template not found: {selected_template_path}")
            if not python_handler_path.exists():
                raise RuntimeError(f"Python handler template not found: {python_handler_path}")

            # Check for existing Lambda functions with same names (both sync and stream)
            await self._check_function_name_conflict(f"{config.function_name}-sync", deployment_logs)
            if streaming_capable:
                await self._check_function_name_conflict(f"{config.function_name}-stream", deployment_logs)

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
                deployment_storage_dir, generated_code, config, deployment_logs, streaming_capable
            )
            await notify_progress("Saving deployment artifacts", "completed")

            # Create temporary deployment directory for SAM operations
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                deployment_logs.append(f"Created temporary directory: {temp_path}")

                # Prepare deployment package with selected templates
                await notify_progress("Preparing deployment package", "running")
                await self._prepare_deployment_package(
                    temp_path, generated_code, config, deployment_logs,
                    selected_template_path, python_handler_path, streaming_capable
                )
                await notify_progress("Preparing deployment package", "completed")

                # Build with SAM
                await notify_progress("Building with SAM", "running")
                build_result = await self._sam_build(temp_path, deployment_logs, deployment_id, streaming_capable, config)
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
                    temp_path, config, deployment_logs, streaming_capable
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

                # Include streaming capability info in the result
                result = DeploymentResult(
                    success=True,
                    message="Deployment successful",
                    function_arn=outputs.get("function_arn"),
                    api_endpoint=outputs.get("api_endpoint"),
                    logs=deployment_logs,
                    deployment_time=deployment_time
                )

                # Add dual-function deployment information
                result.streaming_capable = streaming_capable
                result.invoke_endpoint = outputs.get("sync_function_url")      # Python BUFFERED Function URL
                result.streaming_invoke_endpoint = outputs.get("stream_function_url") # Node.js RESPONSE_STREAM Function URL
                result.deployment_type = outputs.get("deployment_type", "dual_function")
                # For backward compatibility - remove api_endpoint since we're not using API Gateway
                result.api_endpoint = None

                # Set dual-function specific fields
                result.python_function_arn = outputs.get("python_function_arn")
                result.python_stream_function_arn = outputs.get("python_stream_function_arn")
                result.sync_function_url = outputs.get("sync_function_url")
                result.stream_function_url = outputs.get("stream_function_url")

                logger.info(f"Dual-function Lambda deployment successful: {config.function_name}, streaming_capable: {streaming_capable}")

                return result

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
            logger.info("SAM CLI not found, attempting to install automatically...")
            try:
                self._auto_install_sam_cli()
                # Verify installation
                result = subprocess.run(
                    ["sam", "--version"],
                    capture_output=True,
                    text=True,
                    check=True
                )
                logger.info(f"SAM CLI successfully installed. Version: {result.stdout.strip()}")
            except Exception as e:
                raise RuntimeError(f"SAM CLI auto-installation failed: {str(e)}. Please install manually with: pip install aws-sam-cli")

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

        if not self.python_handler_path.exists():
            raise RuntimeError(f"Python handler template not found: {self.python_handler_path}")



    def _auto_install_sam_cli(self):
        """Auto-install SAM CLI using pip"""
        import platform
        import sys

        logger.info("Installing SAM CLI automatically...")

        # Detect platform and Python version
        system = platform.system().lower()
        python_version = f"{sys.version_info.major}.{sys.version_info.minor}"

        logger.info(f"Detected system: {system}, Python: {python_version}")

        # Try pip3 first, then pip
        pip_commands = []
        if sys.executable:
            # Use the same Python interpreter that's running this script
            pip_commands.append([sys.executable, "-m", "pip", "install", "aws-sam-cli"])

        pip_commands.extend([
            ["pip3", "install", "aws-sam-cli"],
            ["pip", "install", "aws-sam-cli"]
        ])

        last_error = None
        for pip_cmd in pip_commands:
            try:
                logger.info(f"Trying installation with: {' '.join(pip_cmd)}")
                result = subprocess.run(
                    pip_cmd,
                    capture_output=True,
                    text=True,
                    check=True,
                    timeout=300  # 5 minutes timeout
                )
                logger.info("SAM CLI installation completed successfully")
                logger.debug(f"Installation output: {result.stdout}")
                return

            except subprocess.TimeoutExpired:
                last_error = "Installation timed out after 5 minutes"
                logger.error(last_error)
                continue
            except subprocess.CalledProcessError as e:
                last_error = f"Installation failed with {' '.join(pip_cmd)}: {e.stderr}"
                logger.warning(last_error)
                continue
            except FileNotFoundError:
                last_error = f"Command not found: {pip_cmd[0]}"
                logger.warning(last_error)
                continue

        # If we get here, all installation attempts failed
        raise RuntimeError(f"All SAM CLI installation attempts failed. Last error: {last_error}")

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
        logs: List[str],
        template_path: Path = None,
        python_handler_path: Path = None,
        streaming_capable: bool = False
    ):
        """Prepare the dual-function deployment package in the temporary directory"""
        # Use provided template paths or fall back to defaults
        selected_template = template_path or self.template_path
        selected_python_handler = python_handler_path or self.python_handler_path

        # Copy selected SAM template
        shutil.copy2(selected_template, temp_path / "template.yaml")
        logs.append(f"Copied SAM template: {selected_template.name}")

        # Create Python function directory
        python_function_dir = temp_path / "python_function"
        python_function_dir.mkdir()

        # Copy Python requirements.txt
        shutil.copy2(self.requirements_path, python_function_dir / "requirements.txt")
        logs.append("Copied Python requirements.txt")

        # Copy the Python handler template
        shutil.copy2(selected_python_handler, python_function_dir / "agent_handler_python.py")
        logs.append(f"Copied Python handler: {selected_python_handler.name}")

        # Create generated_agent.py file for Python function
        (python_function_dir / "generated_agent.py").write_text(generated_code, encoding='utf-8')
        logs.append("Generated Python agent code file")

        # Create Python stream function directory (only if streaming is capable)
        if streaming_capable:
            python_stream_dir = temp_path / "python_stream_function"
            python_stream_dir.mkdir()

            # Copy the streaming FastAPI app files
            stream_source_dir = self.base_deployment_dir / "python_stream_function"
            shutil.copy2(stream_source_dir / "app.py", python_stream_dir / "app.py")

            # Use main requirements.txt for dependencies (not the minimal stream one)
            shutil.copy2(self.requirements_path, python_stream_dir / "requirements.txt")

            # Generate dynamic Dockerfile with user-specified runtime
            dynamic_dockerfile = self._generate_dynamic_dockerfile(config.runtime)
            (python_stream_dir / "Dockerfile").write_text(dynamic_dockerfile, encoding='utf-8')
            logs.append(f"Generated dynamic Dockerfile with runtime: {config.runtime}")

            # Create generated_agent.py file for streaming function
            (python_stream_dir / "generated_agent.py").write_text(generated_code, encoding='utf-8')
            logs.append("Generated Python stream agent code file")

        # Create samconfig.toml for deployment configuration
        samconfig_content = self._generate_samconfig(config, streaming_capable)
        (temp_path / "samconfig.toml").write_text(samconfig_content, encoding='utf-8')
        logs.append("Created SAM configuration file")



    async def _save_deployment_artifacts(
        self,
        storage_dir: Path,
        generated_code: str,
        config: LambdaDeploymentConfig,
        logs: List[str],
        streaming_capable: bool = False
    ):
        """Save deployment artifacts to persistent storage"""
        try:
            # Save the original generated code (rename to generated_agent.py for clarity)
            generated_agent_path = storage_dir / "generated_agent.py"
            generated_agent_path.write_text(generated_code, encoding='utf-8')

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
                "streaming_capable": streaming_capable,
                "created_at": datetime.now().isoformat()
            }

            with open(storage_dir / "deployment_metadata.json", 'w') as f:
                json.dump(config_data, f, indent=2)

            # Save handler files
            python_handler_path = storage_dir / "agent_handler_python.py"

            # Copy Python handler
            shutil.copy2(self.python_handler_path, python_handler_path)

            # Copy Python stream function files if streaming is enabled
            if streaming_capable:
                stream_dir = storage_dir / "python_stream_function"
                stream_dir.mkdir(exist_ok=True)
                stream_source_dir = self.base_deployment_dir / "python_stream_function"
                shutil.copy2(stream_source_dir / "app.py", stream_dir / "app.py")
                shutil.copy2(stream_source_dir / "requirements.txt", stream_dir / "requirements.txt")

                # Generate and save dynamic Dockerfile with user-specified runtime
                dynamic_dockerfile = self._generate_dynamic_dockerfile(config.runtime)
                (stream_dir / "Dockerfile").write_text(dynamic_dockerfile, encoding='utf-8')

            # Save SAM configuration
            samconfig_content = self._generate_samconfig(config, streaming_capable)
            (storage_dir / "samconfig.toml").write_text(samconfig_content, encoding='utf-8')

            # Save template file
            template_path = storage_dir / "template_dual_function.yaml"
            shutil.copy2(self.template_path, template_path)

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

    def _generate_samconfig(self, config: LambdaDeploymentConfig, streaming_capable: bool = False) -> str:
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
    "Architecture={config.architecture}",
    "StreamingCapable={'true' if streaming_capable else 'false'}"
]
image_repositories = []
"""
        return samconfig

    async def _sam_build(self, temp_path: Path, logs: List[str], deployment_id: str = None, streaming_capable: bool = False, config: LambdaDeploymentConfig = None) -> bool:
        """Run SAM build with selective resource building based on streaming capability"""

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

        # Build all resources in the selected template
        if streaming_capable:
            logs.append("Building resources: PythonSyncFunction, PythonStreamFunction (dual-function template)")
        else:
            logs.append("Building resources: PythonSyncFunction (sync-only template)")

        # Use container build first to ensure C extensions are compiled correctly
        try:
            logs.append("Using container build for better dependency compatibility...")
            await notify_progress("Starting container build for better dependency compatibility...")

            # Set Docker platform for architecture consistency
            env = os.environ.copy()
            # Use the architecture from config, default to x86_64 if not provided
            architecture = config.architecture if config else 'x86_64'
            docker_platform = 'linux/arm64' if architecture == 'arm64' else 'linux/amd64'
            env['DOCKER_DEFAULT_PLATFORM'] = docker_platform
            logs.append(f"Set DOCKER_DEFAULT_PLATFORM={docker_platform} for {architecture} architecture")

            # Build all resources in the template (template is already selected based on streaming_capable)
            build_cmd = ["sam", "build", "--use-container"]
            logs.append(f"Running: {' '.join(build_cmd)}")

            result = subprocess.run(
                build_cmd,
                cwd=temp_path,
                capture_output=True,
                text=True,
                check=True,
                env=env
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

                # Ensure consistent environment for fallback build too
                env = os.environ.copy()
                # Use the same architecture setting as container build
                architecture = config.architecture if config else 'x86_64'
                docker_platform = 'linux/arm64' if architecture == 'arm64' else 'linux/amd64'
                env['DOCKER_DEFAULT_PLATFORM'] = docker_platform

                # Build all resources in the template (same as container build)
                build_cmd = ["sam", "build"]
                logs.append(f"Fallback running: {' '.join(build_cmd)}")

                result = subprocess.run(
                    build_cmd,
                    cwd=temp_path,
                    capture_output=True,
                    text=True,
                    check=True,
                    env=env
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
        logs: List[str],
        streaming_capable: bool = False
    ) -> Dict[str, Any]:
        """Run SAM deploy"""
        try:
            # Set environment variables for API keys if provided
            env = os.environ.copy()
            if config.api_keys:
                for key, value in config.api_keys.items():
                    env[key.upper()] = value

            # Build deploy command based on whether we have container functions
            deploy_cmd = ["sam", "deploy", "--no-confirm-changeset", "--no-fail-on-empty-changeset", "--resolve-s3"]

            # Add image repository resolution for container functions
            if streaming_capable:
                # Streaming function uses container packaging, need to resolve image repos
                deploy_cmd.append("--resolve-image-repos")
                logs.append("Added --resolve-image-repos flag for container-based streaming function")
                logger.info("Using --resolve-image-repos for container function deployment")

            result = subprocess.run(
                deploy_cmd,
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
                    key = output.get("OutputKey", "")
                    key_lower = key.lower()
                    value = output.get("OutputValue", "")

                    # Dual-function outputs
                    if key == "PythonSyncFunction":
                        outputs["python_function_arn"] = value
                    elif key == "PythonStreamFunction":
                        outputs["python_stream_function_arn"] = value
                    elif key == "SyncFunctionUrl":
                        # Python BUFFERED Function URL
                        outputs["sync_function_url"] = value
                    elif key == "StreamFunctionUrl":
                        # Node.js RESPONSE_STREAM Function URL
                        outputs["stream_function_url"] = value
                    elif key == "StreamingCapable":
                        outputs["streaming_capable"] = value.lower() == "true"
                    elif key == "DeploymentType":
                        outputs["deployment_type"] = value
                    # Legacy support - use Python function as main function ARN
                    elif "pythonsyncfunction" in key_lower and "arn" in value:
                        outputs["function_arn"] = value
                    elif "function" in key_lower and "arn" in value and "function_arn" not in outputs:
                        outputs["function_arn"] = value

            logs.append(f"Retrieved stack outputs: {list(outputs.keys())}")
            logger.info(f"Stack outputs retrieved: {outputs}")
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
        """Delete a Lambda deployment with ECR cleanup"""
        logs = []
        try:
            stack_name = config.stack_name or f"strands-agent-{config.function_name.lower()}"

            # Step 1: Clean up ECR repositories first
            logs.append("Cleaning up ECR repositories...")
            await self._cleanup_ecr_repositories(stack_name, config.region, logs)

            # Step 2: Delete the main stack
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
            logs.append(f"Stack deletion initiated: {stack_name}")

            return DeploymentResult(
                success=True,
                message=f"Stack deletion initiated: {stack_name}",
                logs=logs
            )

        except Exception as e:
            error_msg = f"Failed to delete deployment: {str(e)}"
            logger.error(error_msg)
            logs.append(error_msg)
            return DeploymentResult(
                success=False,
                message=error_msg,
                logs=logs
            )

    async def _cleanup_ecr_repositories(self, stack_name: str, region: str, logs: List[str]):
        """Clean up ECR repositories associated with the stack"""
        try:
            # List ECR repositories with stack name pattern
            result = subprocess.run(
                [
                    "aws", "ecr", "describe-repositories",
                    "--region", region,
                    "--query", f"repositories[?contains(repositoryName, '{stack_name.lower().replace('-', '')}')].repositoryName",
                    "--output", "text"
                ],
                capture_output=True,
                text=True
            )

            if result.returncode == 0 and result.stdout.strip():
                repositories = result.stdout.strip().split()

                for repo in repositories:
                    try:
                        # Get all images in the repository
                        images_result = subprocess.run(
                            [
                                "aws", "ecr", "list-images",
                                "--repository-name", repo,
                                "--region", region,
                                "--query", "imageIds[*]",
                                "--output", "json"
                            ],
                            capture_output=True,
                            text=True
                        )

                        if images_result.returncode == 0 and images_result.stdout.strip() != "[]":
                            # Delete all images
                            subprocess.run(
                                [
                                    "aws", "ecr", "batch-delete-image",
                                    "--repository-name", repo,
                                    "--region", region,
                                    "--image-ids", images_result.stdout
                                ],
                                capture_output=True,
                                text=True,
                                check=True
                            )
                            logs.append(f"Cleaned up images in ECR repository: {repo}")
                            logger.info(f"ECR cleanup successful for repository: {repo}")

                    except subprocess.CalledProcessError as e:
                        logs.append(f"Warning: Failed to clean up ECR repository {repo}: {e.stderr}")
                        logger.warning(f"ECR cleanup failed for {repo}: {e.stderr}")

            else:
                logs.append("No ECR repositories found for cleanup")

        except Exception as e:
            logs.append(f"Warning: ECR cleanup failed: {str(e)}")
            logger.warning(f"ECR cleanup error: {str(e)}")

    async def _generate_handler(self, generated_code: str) -> str:
        """
        Generate Lambda handler code based on the generated agent code.
        Detects streaming patterns and creates appropriate handler.
        """
        # Detect if the code contains streaming patterns
        has_yield = 'yield' in generated_code
        has_stream_async = 'stream_async' in generated_code
        is_streaming_capable = has_yield or has_stream_async

        logger.info(f"Code analysis - has_yield: {has_yield}, has_stream_async: {has_stream_async}, streaming_capable: {is_streaming_capable}")

        handler_code = '''"""
AWS Lambda Handler for Strands Agent with Streaming Support
This handler supports both regular and streaming execution modes.
"""
import json
import os
import sys
import logging
import traceback
import asyncio
import time
import importlib
from typing import Dict, Any, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    AWS Lambda handler function with streaming support.

    Args:
        event: Lambda event containing the request data
        context: Lambda context object

    Returns:
        Dict containing the response data or streaming response

    Expected event format:
    {
        "prompt": "User input prompt",
        "input_data": "(optional) Additional input data",
        "stream": false,  # Set to true for streaming response
        "api_keys": {
            "openai_api_key": "(optional) OpenAI API key",
            "anthropic_api_key": "(optional) Anthropic API key"
        }
    }
    """
    logger.info(f"Lambda handler invoked with event keys: {list(event.keys())}")

    try:
        # Handle API Gateway event format vs direct invocation
        if 'body' in event and 'httpMethod' in event:
            # API Gateway format - extract JSON from body
            body_str = event.get('body', '')
            if body_str:
                try:
                    cleaned_body = body_str.replace('\\\\!', '!')
                    body_data = json.loads(cleaned_body)
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON in body: {body_str}, error: {str(e)}")
                    return create_error_response(400, 'Invalid JSON in request body')
            else:
                body_data = {}

            # Extract input from parsed body
            prompt = body_data.get('prompt', '')
            input_data = body_data.get('input_data')
            api_keys = body_data.get('api_keys', {})
            stream_mode = body_data.get('stream', False)
        else:
            # Direct Lambda invocation format
            prompt = event.get('prompt', '')
            input_data = event.get('input_data')
            api_keys = event.get('api_keys', {})
            stream_mode = event.get('stream', False)

        if not prompt:
            return create_error_response(400, 'Missing required field: prompt')

        logger.info(f"Processing prompt: {prompt[:100]}..." if len(prompt) > 100 else f"Processing prompt: {prompt}")
        logger.info(f"Stream mode: {stream_mode}")

        # Set API keys as environment variables if provided
        setup_api_keys(api_keys)

        # Execute based on streaming mode
        if stream_mode:
            # Streaming execution - use Lambda Response Streaming
            return execute_streaming_agent(prompt, input_data, context)
        else:
            # Regular execution
            response = execute_agent_sync(prompt, input_data)
            return create_success_response(response, context)

    except Exception as e:
        error_msg = f"Handler execution failed: {str(e)}"
        logger.error(f"{error_msg}\\n{traceback.format_exc()}")
        return create_error_response(500, error_msg, traceback.format_exc())

def setup_api_keys(api_keys: Dict[str, str]):
    """Set up API keys as environment variables"""
    os.environ['BYPASS_TOOL_CONSENT'] = "true"

    if api_keys.get('openai_api_key'):
        os.environ['OPENAI_API_KEY'] = api_keys['openai_api_key']
        logger.info("OpenAI API key set from request")

    if api_keys.get('anthropic_api_key'):
        os.environ['ANTHROPIC_API_KEY'] = api_keys['anthropic_api_key']
        logger.info("Anthropic API key set from request")

def create_error_response(status_code: int, error_msg: str, traceback_str: str = None) -> Dict[str, Any]:
    """Create standardized error response"""
    body = {
        'success': False,
        'error': error_msg,
        'type': 'execution_error'
    }
    if traceback_str:
        body['traceback'] = traceback_str

    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(body)
    }

def create_success_response(response: str, context) -> Dict[str, Any]:
    """Create standardized success response"""
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps({
            'success': True,
            'response': response,
            'execution_context': {
                'function_name': context.function_name,
                'function_version': context.function_version,
                'request_id': context.aws_request_id,
                'memory_limit': context.memory_limit_in_mb,
                'remaining_time': context.get_remaining_time_in_millis()
            }
        })
    }

def execute_agent_sync(prompt: str, input_data: Optional[str] = None) -> str:
    """Execute agent in synchronous mode"""
    start_time = time.time()

    try:
        import generated_agent
        importlib.reload(generated_agent)

        user_input = input_data if input_data else prompt
        logger.info(f"Executing agent synchronously with input: {user_input[:100]}...")

        if hasattr(generated_agent, 'main') and callable(generated_agent.main):
            result = asyncio.run(generated_agent.main(user_input_arg=user_input))
            execution_time = time.time() - start_time
            logger.info(f"Sync execution successful in {execution_time:.2f}s")
            return str(result) if result else "Agent executed successfully (no return value)"
        elif hasattr(generated_agent, 'agent') and callable(generated_agent.agent):
            response = generated_agent.agent(user_input)
            execution_time = time.time() - start_time
            logger.info(f"Direct agent execution successful in {execution_time:.2f}s")
            return str(response)
        else:
            raise RuntimeError("Generated agent module does not have a callable 'main' function or 'agent' object")

    except Exception as e:
        execution_time = time.time() - start_time
        error_msg = f"Agent execution failed after {execution_time:.2f}s: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        raise RuntimeError(error_msg)

def execute_streaming_agent(prompt: str, input_data: Optional[str], context) -> Dict[str, Any]:
    """
    Execute agent in streaming mode using Lambda Response Streaming.
    This function should be called when stream=true in the event.
    """
    start_time = time.time()

    try:
        import generated_agent
        importlib.reload(generated_agent)

        user_input = input_data if input_data else prompt
        logger.info(f"Attempting streaming execution with input: {user_input[:100]}...")

        # First, check if the generated code contains streaming patterns
        import inspect
        source_code = ""
        try:
            source_code = inspect.getsource(generated_agent)
            has_stream_async = 'stream_async' in source_code
            has_yield = 'yield' in source_code
            logger.info(f"Generated code analysis - has_stream_async: {has_stream_async}, has_yield: {has_yield}")
        except Exception as e:
            logger.warning(f"Could not analyze source code: {e}")
            has_stream_async = False
            has_yield = False

        # Check if we have streaming capability
        if hasattr(generated_agent, 'main') and callable(generated_agent.main):
            # Try to detect streaming by analyzing the main function or running it
            try:
                # If the code contains stream_async, we need to capture print output in real-time
                if has_stream_async:
                    logger.info("Detected stream_async pattern, using print capture method")
                    return execute_stream_async_agent(user_input, generated_agent, context, start_time)

                # Try to check if main function is a generator
                result = generated_agent.main(user_input_arg=user_input)

                # Check if it's an async generator or contains streaming
                if inspect.isasyncgen(result) or inspect.isgenerator(result):
                    logger.info("Detected async generator pattern")
                    # This is a streaming agent - collect all chunks
                    chunks = []
                    try:
                        if inspect.isasyncgen(result):
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            async def collect_chunks():
                                async for chunk in result:
                                    if chunk:
                                        chunks.append(str(chunk))
                            loop.run_until_complete(collect_chunks())
                        else:
                            for chunk in result:
                                if chunk:
                                    chunks.append(str(chunk))
                    except Exception as e:
                        logger.warning(f"Error collecting streaming chunks: {e}")
                        # Fallback to regular execution
                        return execute_fallback_streaming(user_input, context)

                    # Return combined chunks as response
                    final_response = ''.join(chunks)
                    execution_time = time.time() - start_time
                    logger.info(f"Streaming simulation successful in {execution_time:.2f}s")

                    return {
                        'statusCode': 200,
                        'headers': {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        },
                        'body': json.dumps({
                            'success': True,
                            'response': final_response,
                            'streaming_simulated': True,
                            'chunks_collected': len(chunks),
                            'execution_time': execution_time,
                            'execution_context': {
                                'function_name': context.function_name,
                                'request_id': context.aws_request_id,
                                'remaining_time': context.get_remaining_time_in_millis()
                            }
                        })
                    }
                else:
                    # Not a generator, check if we still have streaming patterns in the code
                    if has_stream_async or has_yield:
                        logger.info("Found streaming patterns but main function didn't return generator, using fallback streaming")
                        # Still attempt streaming with print capture for stream_async
                        return execute_stream_async_agent(user_input, generated_agent, context, start_time)

                    # Truly non-streaming code - await the result if it's a coroutine
                    if inspect.iscoroutine(result):
                        final_result = asyncio.run(result)
                    else:
                        final_result = result

                    execution_time = time.time() - start_time
                    logger.info(f"Non-streaming execution completed in {execution_time:.2f}s")

                    return {
                        'statusCode': 200,
                        'headers': {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        },
                        'body': json.dumps({
                            'success': True,
                            'response': str(final_result) if final_result else "Agent executed successfully",
                            'streaming_requested': True,
                            'streaming_available': False,
                            'message': 'Generated code does not contain streaming patterns (stream_async or yield)',
                            'execution_time': execution_time,
                            'execution_context': {
                                'function_name': context.function_name,
                                'request_id': context.aws_request_id,
                                'remaining_time': context.get_remaining_time_in_millis()
                            }
                        })
                    }
            except Exception as e:
                logger.warning(f"Error in main function execution: {e}")
                return execute_fallback_streaming(user_input, context)
        else:
            return execute_fallback_streaming(user_input, context)

    except Exception as e:
        execution_time = time.time() - start_time
        error_msg = f"Streaming execution failed after {execution_time:.2f}s: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        return create_error_response(500, error_msg, traceback.format_exc())

def execute_stream_async_agent(user_input: str, generated_agent, context, start_time: float) -> Dict[str, Any]:
    """
    Execute agent with stream_async pattern using print capture method
    Similar to backend/main.py streaming logic
    """
    try:
        import io
        import sys
        from queue import Queue
        import threading

        logger.info("Setting up streaming execution with print capture")

        # Create a queue to capture print output
        output_queue = Queue()
        captured_output = []
        capture_complete = threading.Event()

        # Custom print function to capture streaming output
        original_print = print
        def streaming_print(*args, **kwargs):
            if args:
                output = str(args[0])
                # Put output in queue for collection
                output_queue.put(output)
                captured_output.append(output)

        # Replace print function temporarily
        import builtins
        builtins.print = streaming_print

        try:
            # Execute the main function
            result = asyncio.run(generated_agent.main(user_input_arg=user_input))

            # Mark capture as complete
            capture_complete.set()

            # Collect any remaining output
            while not output_queue.empty():
                try:
                    output = output_queue.get_nowait()
                    if output not in captured_output:
                        captured_output.append(output)
                except:
                    break

            # Combine all captured output
            if captured_output:
                final_response = ''.join(captured_output)
                logger.info(f"Captured {len(captured_output)} streaming chunks")
            else:
                final_response = str(result) if result else "Agent executed successfully"
                logger.info("No streaming output captured, using final result")

            execution_time = time.time() - start_time
            logger.info(f"Stream_async execution successful in {execution_time:.2f}s")

            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({
                    'success': True,
                    'response': final_response,
                    'streaming_captured': True,
                    'chunks_captured': len(captured_output),
                    'execution_time': execution_time,
                    'execution_context': {
                        'function_name': context.function_name,
                        'request_id': context.aws_request_id,
                        'remaining_time': context.get_remaining_time_in_millis()
                    }
                })
            }

        finally:
            # Restore original print function
            builtins.print = original_print

    except Exception as e:
        logger.error(f"Error in stream_async execution: {e}")
        logger.error(traceback.format_exc())

        # Restore original print function in case of error
        try:
            import builtins
            builtins.print = print
        except:
            pass

        return execute_fallback_streaming(user_input, context)

def execute_fallback_streaming(user_input: str, context) -> Dict[str, Any]:
    """Fallback streaming execution when main streaming fails"""
    try:
        # Just execute synchronously and return as if it was streamed
        response = execute_agent_sync(user_input, None)
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'success': True,
                'response': response,
                'streaming_fallback': True,
                'execution_context': {
                    'function_name': context.function_name,
                    'request_id': context.aws_request_id,
                    'remaining_time': context.get_remaining_time_in_millis()
                }
            })
        }
    except Exception as e:
        error_msg = f"Fallback streaming execution failed: {str(e)}"
        logger.error(error_msg)
        return create_error_response(500, error_msg)
'''

        return handler_code

    def _generate_dynamic_dockerfile(self, runtime: str) -> str:
        """
        Generate Dockerfile content with dynamic Python runtime version

        Args:
            runtime: Python runtime version (e.g., 'python3.12', 'python3.11')

        Returns:
            Dockerfile content as string
        """
        # Extract version number from runtime (e.g., 'python3.12' -> '3.12')
        version = runtime.replace('python', '') if runtime.startswith('python') else '3.12'

        dockerfile_content = f"""# Use multi-arch ECR image for Lambda Web Adapter (no manual arch handling needed)
FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 as adapter

# Python runtime version dynamically set from user configuration: {runtime}
FROM python:{version}-slim

# Copy Lambda Web Adapter from ECR multi-arch image
COPY --from=adapter /lambda-adapter /opt/extensions/lambda-adapter
RUN chmod +x /opt/extensions/lambda-adapter

# Set working directory
WORKDIR /var/task

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .
COPY generated_agent.py .

# Set environment variables for Lambda Web Adapter
ENV AWS_LWA_PORT=8080
ENV AWS_LWA_INVOKE_MODE=response_stream

# LWA runs as extension, not ENTRYPOINT - Lambda will auto-inject it
# Start FastAPI with uvicorn
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
"""
        return dockerfile_content

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