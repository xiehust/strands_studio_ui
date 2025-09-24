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
        config: LambdaDeploymentConfig
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
            # Validate prerequisites
            self._validate_prerequisites()
            deployment_logs.append("Prerequisites validated")

            # Create temporary deployment directory
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                deployment_logs.append(f"Created temporary directory: {temp_path}")

                # Prepare deployment package
                await self._prepare_deployment_package(
                    temp_path, generated_code, config, deployment_logs
                )

                # Build with SAM
                build_result = await self._sam_build(temp_path, deployment_logs)
                if not build_result:
                    return DeploymentResult(
                        success=False,
                        message="SAM build failed",
                        logs=deployment_logs
                    )

                # Deploy with SAM
                deploy_result = await self._sam_deploy(
                    temp_path, config, deployment_logs
                )
                if not deploy_result["success"]:
                    return DeploymentResult(
                        success=False,
                        message=deploy_result["message"],
                        logs=deployment_logs
                    )

                # Get deployment outputs
                outputs = await self._get_stack_outputs(config, deployment_logs)

                deployment_time = (datetime.now() - start_time).total_seconds()
                deployment_logs.append(f"Deployment completed in {deployment_time:.2f}s")

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
        extracted_lines = []
        in_main_function = False
        indent_level = 8  # Lambda handler indentation level

        for line in lines:
            # Skip import lines - they're already in the handler template
            if line.strip().startswith(('import ', 'from ')):
                continue

            # Skip the main function definition and if __name__ == "__main__" blocks
            if 'async def main():' in line or 'if __name__ == "__main__":' in line:
                in_main_function = True
                continue

            if in_main_function and line.strip() == '':
                continue

            if in_main_function and not line.startswith('    '):
                in_main_function = False

            if in_main_function:
                # Remove one level of indentation and add Lambda handler indentation
                if line.startswith('    '):
                    extracted_lines.append(' ' * indent_level + line[4:])
                elif line.strip():
                    extracted_lines.append(' ' * indent_level + line)
            elif not in_main_function and line.strip() and not line.startswith('#'):
                # Include tool definitions and agent configurations
                extracted_lines.append(' ' * indent_level + line)

        # Add return statement adaptation
        extracted_lines.extend([
            ' ' * indent_level + '# Import required modules for execution',
            ' ' * indent_level + 'import asyncio',
            ' ' * indent_level + 'import inspect',
            ' ' * indent_level + '',
            ' ' * indent_level + '# Use input_data if provided, otherwise use prompt',
            ' ' * indent_level + 'user_input = input_data if input_data else prompt',
            ' ' * indent_level + '',
            ' ' * indent_level + '# Execute the main agent (assuming it exists)',
            ' ' * indent_level + 'if "main" in locals() and callable(locals()["main"]):',
            ' ' * (indent_level + 4) + 'if inspect.iscoroutinefunction(locals()["main"]):',
            ' ' * (indent_level + 8) + 'response = asyncio.run(locals()["main"]())',
            ' ' * (indent_level + 4) + 'else:',
            ' ' * (indent_level + 8) + 'response = locals()["main"]()',
            ' ' * (indent_level + 4) + 'return str(response)',
            ' ' * indent_level + 'else:',
            ' ' * (indent_level + 4) + '# Fallback: return user input echo',
            ' ' * (indent_level + 4) + 'return f"Received: {user_input}"'
        ])

        return '\n'.join(extracted_lines)

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

    async def _sam_build(self, temp_path: Path, logs: List[str]) -> bool:
        """Run SAM build with fallback to container build"""
        # First try regular SAM build
        try:
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
            if "Binary validation failed" in str(e.stderr):
                logs.append("Local Python version incompatible, trying container build...")
                logger.info("Falling back to container build due to Python version mismatch")

                # Try container build as fallback
                try:
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
                    error_msg = f"SAM container build also failed: {container_error.stderr}"
                    logs.append(error_msg)
                    logger.error(error_msg)
                    return False
            else:
                error_msg = f"SAM build failed: {e.stderr}"
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