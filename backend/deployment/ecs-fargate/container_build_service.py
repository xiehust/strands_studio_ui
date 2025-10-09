"""
Container Build Service for ECS Fargate Deployment
Supports cross-platform building using Docker Buildx for multi-architecture images
"""
import os
import json
import subprocess
import logging
import tempfile
import shutil
import asyncio
from typing import Dict, Any, List, Optional
from pathlib import Path
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

class ContainerBuildService:
    """Service for building and pushing multi-architecture container images"""

    def __init__(self):
        """Initialize the container build service"""
        self.ecr_client = None
        self.supported_architectures = ["linux/amd64", "linux/arm64"]
        self.build_logs = {}  # Store build logs by deployment ID

    def get_recent_build_logs(self, deployment_id: str, lines: int = 10) -> List[str]:
        """Get the most recent build log lines for a deployment"""
        if deployment_id in self.build_logs:
            log_lines = self.build_logs[deployment_id]
            return log_lines[-lines:] if len(log_lines) > lines else log_lines
        return []

    def _add_build_log(self, deployment_id: str, line: str):
        """Add a line to the build log for a deployment"""
        if deployment_id not in self.build_logs:
            self.build_logs[deployment_id] = []

        # Keep only the last 1000 lines to prevent memory issues
        if len(self.build_logs[deployment_id]) >= 1000:
            self.build_logs[deployment_id] = self.build_logs[deployment_id][-500:]

        self.build_logs[deployment_id].append(line)

    def _get_ecr_client(self, region: str):
        """Get ECR client for the specified region"""
        if not self.ecr_client:
            self.ecr_client = boto3.client('ecr', region_name=region)
        return self.ecr_client

    async def build_and_push_image(
        self,
        agent_code: str,
        service_name: str,
        architecture: str,
        region: str,
        account_id: str,
        enable_cross_compile: bool = True,
        progress_callback=None,
        deployment_id: str = None
    ) -> str:
        """
        Build and push container image with optional cross-compilation support

        Args:
            agent_code: Python code for the agent
            service_name: Name of the service (used for ECR repository)
            architecture: Target architecture (x86_64 or arm64)
            region: AWS region
            account_id: AWS account ID
            enable_cross_compile: Enable cross-platform building

        Returns:
            ECR image URI
        """
        try:
            # Helper function to notify progress
            async def notify(message):
                if progress_callback:
                    await progress_callback("Building Docker image", "running", message)

            # Create ECR repository if it doesn't exist
            await notify("Setting up ECR repository...")
            repository_name = f"strands-agent-{service_name}"
            ecr_uri = await self._ensure_ecr_repository(repository_name, region, account_id)

            # Setup build context
            await notify("Preparing build context...")
            with tempfile.TemporaryDirectory() as build_dir:
                build_path = Path(build_dir)

                # Prepare build files
                await self._prepare_build_context(build_path, agent_code, service_name)

                # Build and push image
                if enable_cross_compile:
                    await notify(f"Building multi-architecture image for {architecture}...")
                    image_uri = await self._build_multiarch_image(
                        build_path, ecr_uri, architecture, repository_name, region, progress_callback, deployment_id
                    )
                else:
                    await notify(f"Building single-architecture image for {architecture}...")
                    image_uri = await self._build_single_arch_image(
                        build_path, ecr_uri, architecture, repository_name, region, progress_callback, deployment_id
                    )

                await notify("Docker image build completed successfully!")
                logger.info(f"Successfully built and pushed image: {image_uri}")
                return image_uri

        except Exception as e:
            logger.error(f"Failed to build container image: {str(e)}")
            raise RuntimeError(f"Container build failed: {str(e)}")

    async def _ensure_ecr_repository(self, repository_name: str, region: str, account_id: str) -> str:
        """Ensure ECR repository exists and return URI"""
        ecr_client = self._get_ecr_client(region)

        # Use correct domain suffix for China regions
        domain_suffix = "amazonaws.com.cn" if region.startswith("cn-") else "amazonaws.com"
        ecr_uri = f"{account_id}.dkr.ecr.{region}.{domain_suffix}/{repository_name}"

        try:
            # Check if repository exists
            ecr_client.describe_repositories(repositoryNames=[repository_name])
            logger.info(f"ECR repository {repository_name} already exists")

        except ClientError as e:
            if e.response['Error']['Code'] == 'RepositoryNotFoundException':
                # Create repository
                logger.info(f"Creating ECR repository: {repository_name}")
                ecr_client.create_repository(
                    repositoryName=repository_name,
                    imageScanningConfiguration={'scanOnPush': True},
                    tags=[
                        {'Key': 'Service', 'Value': 'Strands-Agent'},
                        {'Key': 'ManagedBy', 'Value': 'Strands-Studio'}
                    ]
                )
                logger.info(f"ECR repository {repository_name} created successfully")
            else:
                raise

        return ecr_uri

    async def _prepare_build_context(self, build_path: Path, agent_code: str, service_name: str):
        """Prepare Docker build context with all necessary files"""

        # Copy Dockerfile
        dockerfile_source = Path(__file__).parent / "Dockerfile"
        dockerfile_dest = build_path / "Dockerfile"
        shutil.copy2(dockerfile_source, dockerfile_dest)

        # Create generated_agent.py
        agent_file = build_path / "generated_agent.py"
        with open(agent_file, 'w') as f:
            f.write(agent_code)

        # Copy agent_server.py
        server_source = Path(__file__).parent / "agent_server.py"
        server_dest = build_path / "agent_server.py"
        shutil.copy2(server_source, server_dest)

        # Copy requirements.txt from template
        requirements_template = Path(__file__).parent / "requirements.txt"
        requirements_file = build_path / "requirements.txt"
        shutil.copy2(requirements_template, requirements_file)

        logger.info(f"Build context prepared in {build_path}")

    async def _build_multiarch_image(
        self,
        build_path: Path,
        ecr_uri: str,
        target_arch: str,
        repository_name: str,
        region: str,
        notify_callback=None,
        deployment_id: str = None
    ) -> str:
        """Build multi-architecture image using Docker Buildx"""

        # Map architecture names
        platform_map = {
            "x86_64": "linux/amd64",
            "arm64": "linux/arm64"
        }

        target_platform = platform_map.get(target_arch, "linux/amd64")

        # Use deployment_id to create unique tags for each deployment
        if deployment_id:
            tag = f"{ecr_uri}:{deployment_id}-{target_arch}"
        else:
            # Fallback to timestamp-based tag to ensure uniqueness
            import time
            timestamp = int(time.time())
            tag = f"{ecr_uri}:{timestamp}-{target_arch}"

        try:
            # Helper function to notify progress
            async def notify(message):
                if notify_callback:
                    await notify_callback("Building Docker image", "running", message)

            # Ensure buildx is available
            await notify("Setting up Docker Buildx...")
            await self._setup_buildx()

            # Login to ECR
            await notify("Authenticating with ECR...")
            await self._ecr_login(region)

            # Build and push multi-arch image with optimizations
            await notify(f"Starting cross-platform build for {target_platform} (first time may take 10-15 minutes, please be patient)...")

            # Use optimized build parameters with stable cache naming
            cache_ref = f"{ecr_uri}:buildcache-{target_arch}"
            build_cmd = [
                "docker", "buildx", "build",
                "--platform", target_platform,
                "--push",
                "--tag", tag,
                "--progress", "plain",
                "--provenance=false",  # Skip provenance for speed
                "--sbom=false",        # Skip SBOM for speed
                "--build-arg", "BUILDKIT_INLINE_CACHE=1",  # Embed cache in image
                "--cache-from", f"type=registry,ref={cache_ref}",
                "--cache-to", f"type=registry,ref={cache_ref},mode=max",
                str(build_path)
            ]

            logger.info(f"Building multi-arch image with command: {' '.join(build_cmd)}")
            await notify("Running optimized Docker Buildx - cross-compilation requires QEMU emulation, first build may take 10-15 minutes...")

            try:
                # Use asyncio subprocess for non-blocking execution
                process = await asyncio.create_subprocess_exec(
                    *build_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,  # Combine stdout and stderr
                    cwd=str(build_path)
                )

                # Monitor process with real-time output parsing
                start_time = asyncio.get_event_loop().time()
                output_lines = []
                last_stage = ""

                # Read output line by line for better progress tracking
                while True:
                    try:
                        line = await asyncio.wait_for(process.stdout.readline(), timeout=30.0)
                        if not line:
                            break

                        line_str = line.decode().strip()
                        if line_str:
                            output_lines.append(line_str)
                            logger.debug(f"Docker build output: {line_str}")

                            # Store build log if deployment_id is provided
                            if deployment_id:
                                self._add_build_log(deployment_id, line_str)

                            # Parse Docker build stages for better progress info
                            if "=> [" in line_str:
                                stage_info = line_str.split("=> [")[1].split("]")[0] if "]" in line_str else ""
                                if stage_info and stage_info != last_stage:
                                    last_stage = stage_info
                                    elapsed = int(asyncio.get_event_loop().time() - start_time)
                                    mins, secs = divmod(elapsed, 60)
                                    await notify(f"Building stage: {stage_info} ({mins}m {secs}s elapsed)")

                            # Check for error patterns (but ignore cache-related errors)
                            if "ERROR" in line_str.upper() or "FAILED" in line_str.upper():
                                # Ignore cache-related errors as they're not fatal
                                if "cache importer" in line_str.lower() or "not found" in line_str.lower():
                                    logger.warning(f"Docker cache warning (non-fatal): {line_str}")
                                    await notify("Build cache not available, continuing without cache...")
                                else:
                                    # This is a real error
                                    await notify(f"Build error detected: {line_str}")
                                    logger.error(f"Docker build error: {line_str}")
                                    # Don't raise immediately, let the build continue and fail at the end

                    except asyncio.TimeoutError:
                        # No output for 30 seconds, send progress update
                        elapsed = int(asyncio.get_event_loop().time() - start_time)
                        mins, secs = divmod(elapsed, 60)
                        if last_stage:
                            await notify(f"Still building stage: {last_stage} ({mins}m {secs}s elapsed)")
                        else:
                            await notify(f"Docker Buildx still running... ({mins}m {secs}s elapsed)")

                        # Check if process is still running
                        if process.returncode is not None:
                            break

                # Wait for process to complete
                await process.wait()

                # Check final result
                if process.returncode == 0:
                    await notify("Docker Buildx completed successfully!")
                    logger.info("Docker build completed successfully")
                    if output_lines:
                        logger.info(f"Build output (last 5 lines): {output_lines[-5:]}")
                else:
                    error_output = "\n".join(output_lines[-10:]) if output_lines else "No output captured"
                    await notify(f"Docker Buildx failed with exit code {process.returncode}")
                    logger.error(f"Docker buildx failed: {error_output}")
                    raise RuntimeError(f"Multi-arch build failed (exit code {process.returncode}): {error_output}")

            except Exception as e:
                await notify(f"Docker Buildx encountered an error: {str(e)}")
                logger.error(f"Unexpected error during Docker buildx: {e}")
                raise

            return tag

        except subprocess.CalledProcessError as e:
            logger.error(f"Docker buildx failed: {e.stderr}")
            raise RuntimeError(f"Multi-arch build failed: {e.stderr}")

    async def _build_single_arch_image(
        self,
        build_path: Path,
        ecr_uri: str,
        target_arch: str,
        repository_name: str,
        region: str,
        notify_callback=None,
        deployment_id: str = None
    ) -> str:
        """Build single architecture image using standard Docker build"""

        # Use deployment_id to create unique tags for each deployment
        if deployment_id:
            tag = f"{ecr_uri}:{deployment_id}-{target_arch}"
        else:
            # Fallback to timestamp-based tag to ensure uniqueness
            import time
            timestamp = int(time.time())
            tag = f"{ecr_uri}:{timestamp}-{target_arch}"

        try:
            # Helper function to notify progress
            async def notify(message):
                if notify_callback:
                    await notify_callback("Building Docker image", "running", message)

            # Login to ECR
            await notify("Authenticating with ECR...")
            await self._ecr_login(region)

            # Build image with caching
            await notify(f"Building single-architecture image for {target_arch}...")
            build_cmd = [
                "docker", "build",
                "--tag", tag,
                "--progress", "plain",  # Get detailed progress output
                str(build_path)
            ]

            # Check if previous image exists for caching
            try:
                import subprocess
                cache_check = subprocess.run(
                    ["docker", "image", "inspect", tag],
                    capture_output=True,
                    timeout=5
                )
                if cache_check.returncode == 0:
                    build_cmd.insert(-1, "--cache-from")
                    build_cmd.insert(-1, tag)
                    await notify("Found existing image, using for faster build...")
                else:
                    await notify("No existing image found, building from scratch...")
            except Exception:
                await notify("Cache check failed, building without cache...")

            logger.info(f"Building single-arch image with command: {' '.join(build_cmd)}")
            await notify("Running Docker build with caching...")

            # Use async subprocess for consistent behavior
            process = await asyncio.create_subprocess_exec(
                *build_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(build_path)
            )

            # Monitor build progress
            start_time = asyncio.get_event_loop().time()
            output_lines = []
            last_stage = ""

            # Read output line by line
            while True:
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), timeout=15.0)
                    if not line:
                        break

                    line_str = line.decode().strip()
                    if line_str:
                        output_lines.append(line_str)
                        logger.debug(f"Docker build output: {line_str}")

                        # Store build log if deployment_id is provided
                        if deployment_id:
                            self._add_build_log(deployment_id, line_str)

                        # Parse build stages
                        if "Step " in line_str:
                            stage_info = line_str.split("Step ")[1].split(":")[0] if ":" in line_str else ""
                            if stage_info and stage_info != last_stage:
                                last_stage = stage_info
                                await notify(f"Building step {stage_info}...")

                        # Check for errors (ignore cache-related warnings)
                        if "ERROR" in line_str.upper() or "FAILED" in line_str.upper():
                            if "cache" in line_str.lower() and "not found" in line_str.lower():
                                logger.warning(f"Docker cache warning (non-fatal): {line_str}")
                                await notify("Build cache not available, continuing...")
                            else:
                                await notify(f"Build error: {line_str}")
                                logger.error(f"Docker build error: {line_str}")

                except asyncio.TimeoutError:
                    # Update progress
                    elapsed = int(asyncio.get_event_loop().time() - start_time)
                    mins, secs = divmod(elapsed, 60)
                    await notify(f"Docker build in progress ({mins}m {secs}s elapsed)...")

                    if process.returncode is not None:
                        break

            await process.wait()

            if process.returncode != 0:
                error_output = "\n".join(output_lines[-5:]) if output_lines else "No output captured"
                logger.error(f"Docker build failed: {error_output}")
                raise RuntimeError(f"Single-arch build failed: {error_output}")

            logger.info("Docker build completed successfully")
            await notify("Docker build completed successfully!")

            # Push image
            await notify("Pushing image to ECR...")
            push_cmd = ["docker", "push", tag]

            logger.info(f"Pushing image with command: {' '.join(push_cmd)}")

            # Use async subprocess for push as well
            push_process = await asyncio.create_subprocess_exec(
                *push_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT
            )

            # Monitor push progress
            push_start = asyncio.get_event_loop().time()
            push_output = []

            while True:
                try:
                    line = await asyncio.wait_for(push_process.stdout.readline(), timeout=10.0)
                    if not line:
                        break

                    line_str = line.decode().strip()
                    if line_str:
                        push_output.append(line_str)
                        # Show push progress
                        if "Pushing" in line_str or "Mounted" in line_str:
                            await notify(f"Uploading layers to ECR...")

                except asyncio.TimeoutError:
                    elapsed = int(asyncio.get_event_loop().time() - push_start)
                    await notify(f"Pushing to ECR ({elapsed}s elapsed)...")

                    if push_process.returncode is not None:
                        break

            await push_process.wait()

            if push_process.returncode != 0:
                error_output = "\n".join(push_output[-3:]) if push_output else "No output captured"
                logger.error(f"Docker push failed: {error_output}")
                raise RuntimeError(f"Failed to push image: {error_output}")

            logger.info("Docker push completed successfully")
            await notify("Image pushed to ECR successfully!")

            return tag

        except Exception as e:
            logger.error(f"Docker build/push failed: {str(e)}")
            raise RuntimeError(f"Single-arch build failed: {str(e)}")

    async def _setup_buildx(self):
        """Setup Docker Buildx for multi-platform builds"""
        try:
            # Check if buildx is available
            check_cmd = ["docker", "buildx", "version"]
            subprocess.run(check_cmd, capture_output=True, check=True)

            # Create/use buildx instance
            create_cmd = ["docker", "buildx", "create", "--name", "strands-builder", "--use"]
            subprocess.run(create_cmd, capture_output=True, check=False)  # Don't fail if exists

            # Bootstrap the builder
            bootstrap_cmd = ["docker", "buildx", "inspect", "--bootstrap"]
            subprocess.run(bootstrap_cmd, capture_output=True, check=True)

            logger.info("Docker Buildx setup completed")

        except subprocess.CalledProcessError as e:
            logger.error(f"Buildx setup failed: {e.stderr}")
            raise RuntimeError(f"Failed to setup Docker Buildx: {e.stderr}")

    async def _ecr_login(self, region: str):
        """Login to ECR registry"""
        try:
            # Get ECR login token
            ecr_client = self._get_ecr_client(region)
            response = ecr_client.get_authorization_token()

            auth_data = response['authorizationData'][0]
            token = auth_data['authorizationToken']
            registry = auth_data['proxyEndpoint']

            # Docker login
            import base64
            username, password = base64.b64decode(token).decode().split(':')

            login_cmd = [
                "docker", "login",
                "--username", username,
                "--password-stdin",
                registry
            ]

            process = subprocess.run(
                login_cmd,
                input=password,
                text=True,
                capture_output=True,
                check=True
            )

            logger.info("ECR login successful")

        except subprocess.CalledProcessError as e:
            logger.error(f"ECR login failed: {e.stderr}")
            raise RuntimeError(f"Failed to login to ECR: {e.stderr}")

    async def check_docker_availability(self) -> Dict[str, Any]:
        """Check if Docker and Buildx are available"""
        status = {
            "docker_available": False,
            "buildx_available": False,
            "platforms_supported": [],
            "error": None
        }

        try:
            # Check Docker
            docker_cmd = ["docker", "version", "--format", "json"]
            process = subprocess.run(docker_cmd, capture_output=True, text=True, check=True)
            status["docker_available"] = True

            # Check Buildx
            buildx_cmd = ["docker", "buildx", "ls"]
            process = subprocess.run(buildx_cmd, capture_output=True, text=True, check=True)
            status["buildx_available"] = True

            # Check supported platforms
            inspect_cmd = ["docker", "buildx", "inspect"]
            process = subprocess.run(inspect_cmd, capture_output=True, text=True, check=True)

            # Parse platforms from output
            for line in process.stdout.split('\n'):
                if 'Platforms:' in line:
                    platforms_str = line.split('Platforms:')[1].strip()
                    status["platforms_supported"] = [p.strip() for p in platforms_str.split(',')]
                    break

        except subprocess.CalledProcessError as e:
            status["error"] = str(e)
            logger.error(f"Docker availability check failed: {e}")

        return status