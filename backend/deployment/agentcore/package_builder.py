"""
AgentCore Direct Code Deploy - Package Builder

Builds the deployment zip for AWS Bedrock AgentCore direct code deploy:
- Vendors Python dependencies for the managed runtime platform
  (aarch64-manylinux2014, Python 3.13, wheels only) using uv
- Caches vendored dependency sets by requirements-content hash
- Assembles a flat, Lambda-style zip: dependencies + entrypoint at the root

Limits enforced (per AgentCore direct code deploy spec):
- 250 MB zipped
- 750 MB unzipped
"""
import asyncio
import hashlib
import logging
import os
import shutil
import zipfile
from pathlib import Path
from typing import Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# AgentCore direct code deploy runtime target
TARGET_PYTHON_PLATFORM = "aarch64-manylinux2014"
TARGET_PYTHON_VERSION = "3.13"

# Service limits
MAX_ZIP_SIZE_BYTES = 250 * 1024 * 1024      # 250 MB zipped
MAX_UNZIPPED_SIZE_BYTES = 750 * 1024 * 1024  # 750 MB unzipped

# Studio skill library root (backend/storage/skills); skills referenced by the
# flow are copied into the zip under `skills/{name}/` so the generated code's
# `Path(__file__).parent / "skills"` fallback resolves them inside the runtime.
DEFAULT_SKILLS_ROOT = Path(__file__).parent.parent.parent / "storage" / "skills"

# Optional async callback: (message) -> None
LogCallback = Optional[Callable[[str], Awaitable[None]]]


class PackageBuildError(RuntimeError):
    """Raised when the deployment package cannot be built"""


class AgentCorePackageBuilder:
    """Builds AgentCore direct-code-deploy zip packages with a vendored-dependency cache."""

    def __init__(self, deployments_dir: Path):
        """
        Args:
            deployments_dir: Base directory for deployment workspaces
                             (dep cache lives in `<deployments_dir>/_dep_cache`)
        """
        self.deployments_dir = Path(deployments_dir)
        self.dep_cache_dir = self.deployments_dir / "_dep_cache"
        self._vendor_lock = asyncio.Lock()

    async def build_package(
        self,
        workspace_dir: Path,
        source_files: Dict[str, str],
        requirements_content: str,
        log: LogCallback = None,
        skill_names: Optional[List[str]] = None,
        skills_root: Optional[Path] = None,
    ) -> Path:
        """
        Build the deployment zip.

        Args:
            workspace_dir: Per-deployment workspace directory (created if missing)
            source_files: Mapping of filename -> source content, placed at the zip
                          root (must include the entrypoint file, e.g. agent_runtime.py)
            requirements_content: requirements.txt content for vendored dependencies
            log: Optional async progress log callback
            skill_names: Studio skill library skills referenced by the flow; each is
                         copied into the zip as `skills/{name}/`. Missing skills are
                         logged as warnings and skipped (never block the deploy).
            skills_root: Skill library root (defaults to backend/storage/skills)

        Returns:
            Path to the built zip file
        """
        workspace_dir = Path(workspace_dir)
        workspace_dir.mkdir(parents=True, exist_ok=True)

        # Persist inputs for debugging/reproducibility
        source_paths: List[Path] = []
        for filename, content in source_files.items():
            source_path = workspace_dir / filename
            source_path.write_text(content, encoding="utf-8")
            source_paths.append(source_path)
        (workspace_dir / "requirements.txt").write_text(requirements_content, encoding="utf-8")

        # Resolve skill directories to bundle under skills/{name}/
        skill_dirs: List[Path] = []
        root = Path(skills_root) if skills_root else DEFAULT_SKILLS_ROOT
        for skill_name in skill_names or []:
            skill_dir = root / skill_name
            if skill_dir.is_dir():
                skill_dirs.append(skill_dir)
                await self._log(log, f"Bundling skill '{skill_name}' into deployment package")
            else:
                await self._log(
                    log,
                    f"Warning: skill '{skill_name}' referenced by the flow was not found "
                    f"in the skill library ({root}); deploying without it",
                )

        # Vendor dependencies (cached by requirements hash)
        pkg_dir = await self._ensure_vendored_deps(requirements_content, log)

        # Assemble zip
        zip_path = workspace_dir / "deployment_package.zip"
        await self._log(log, "Assembling deployment package zip...")
        unzipped_size = await asyncio.to_thread(
            self._assemble_zip, zip_path, pkg_dir, source_paths, skill_dirs
        )

        zip_size = zip_path.stat().st_size
        await self._log(
            log,
            f"Package built: {zip_size / (1024 * 1024):.1f} MB zipped, "
            f"{unzipped_size / (1024 * 1024):.1f} MB unzipped",
        )

        # Pre-flight size checks
        if zip_size > MAX_ZIP_SIZE_BYTES:
            raise PackageBuildError(
                f"Deployment package is {zip_size / (1024 * 1024):.1f} MB zipped, exceeding the "
                f"250 MB AgentCore direct-code-deploy limit. Largest dependencies: "
                f"{self._largest_packages(pkg_dir)}. Reduce the dependency set to proceed "
                f"(container-based deploy is no longer supported)."
            )
        if unzipped_size > MAX_UNZIPPED_SIZE_BYTES:
            raise PackageBuildError(
                f"Deployment package is {unzipped_size / (1024 * 1024):.1f} MB unzipped, exceeding "
                f"the 750 MB AgentCore direct-code-deploy limit. Largest dependencies: "
                f"{self._largest_packages(pkg_dir)}."
            )

        return zip_path

    async def _ensure_vendored_deps(self, requirements_content: str, log: LogCallback) -> Path:
        """Return a directory with dependencies vendored for the target platform (cached)."""
        cache_key = hashlib.sha256(
            f"{TARGET_PYTHON_PLATFORM}|{TARGET_PYTHON_VERSION}|{requirements_content}".encode("utf-8")
        ).hexdigest()[:16]
        cached_pkg_dir = self.dep_cache_dir / cache_key / "pkg"

        async with self._vendor_lock:
            if cached_pkg_dir.is_dir() and any(cached_pkg_dir.iterdir()):
                await self._log(log, f"Reusing cached vendored dependencies ({cache_key})")
                return cached_pkg_dir

            uv_path = shutil.which("uv")
            if not uv_path:
                raise PackageBuildError(
                    "uv is not installed or not on PATH. uv is required to vendor "
                    "dependencies for AgentCore direct code deploy."
                )

            await self._log(
                log,
                f"Vendoring dependencies for {TARGET_PYTHON_PLATFORM} / Python "
                f"{TARGET_PYTHON_VERSION} (first deploy with this dependency set may take a while)...",
            )

            build_dir = self.dep_cache_dir / f"{cache_key}.building"
            if build_dir.exists():
                shutil.rmtree(build_dir)
            build_pkg_dir = build_dir / "pkg"
            build_pkg_dir.mkdir(parents=True, exist_ok=True)
            requirements_path = build_dir / "requirements.txt"
            requirements_path.write_text(requirements_content, encoding="utf-8")

            cmd = [
                uv_path, "pip", "install",
                "--python-platform", TARGET_PYTHON_PLATFORM,
                "--python-version", TARGET_PYTHON_VERSION,
                "--target", str(build_pkg_dir),
                "--only-binary=:all:",
                "-r", str(requirements_path),
            ]
            logger.info(f"Running dependency vendoring: {' '.join(cmd)}")

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            output_lines: List[str] = []
            assert process.stdout is not None
            async for raw_line in process.stdout:
                line = raw_line.decode("utf-8", errors="replace").rstrip()
                if line:
                    output_lines.append(line)
                    logger.debug(f"uv: {line}")
            returncode = await process.wait()

            if returncode != 0:
                shutil.rmtree(build_dir, ignore_errors=True)
                tail = "\n".join(output_lines[-25:])
                raise PackageBuildError(
                    f"Dependency vendoring failed (uv exit code {returncode}). "
                    f"A dependency may not provide {TARGET_PYTHON_PLATFORM} wheels "
                    f"(source builds are not supported for direct code deploy).\n"
                    f"uv output (tail):\n{tail}"
                )

            # Publish to cache location (atomic-ish rename)
            final_dir = self.dep_cache_dir / cache_key
            if final_dir.exists():
                shutil.rmtree(final_dir)
            build_dir.rename(final_dir)

            await self._log(log, f"Vendored dependencies cached ({cache_key})")
            return final_dir / "pkg"

    @staticmethod
    def _assemble_zip(
        zip_path: Path,
        pkg_dir: Path,
        extra_files: List[Path],
        skill_dirs: Optional[List[Path]] = None,
    ) -> int:
        """
        Write the deployment zip: vendored deps at root + extra files at root
        + skill directories under `skills/{name}/`.
        Skips __pycache__ / *.pyc / .studio-meta.json. Enforces 644/755 permissions.

        Returns:
            Total unzipped size in bytes
        """
        total_size = 0
        if zip_path.exists():
            zip_path.unlink()

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            for root, dirs, files in os.walk(pkg_dir):
                dirs[:] = [d for d in dirs if d != "__pycache__"]
                for filename in sorted(files):
                    if filename.endswith(".pyc"):
                        continue
                    file_path = Path(root) / filename
                    arcname = str(file_path.relative_to(pkg_dir))
                    total_size += AgentCorePackageBuilder._write_zip_entry(zf, file_path, arcname)

            for extra in extra_files:
                total_size += AgentCorePackageBuilder._write_zip_entry(zf, extra, extra.name)

            for skill_dir in skill_dirs or []:
                for root, dirs, files in os.walk(skill_dir):
                    dirs[:] = [d for d in dirs if d != "__pycache__"]
                    for filename in sorted(files):
                        if filename.endswith(".pyc") or filename == ".studio-meta.json":
                            continue
                        file_path = Path(root) / filename
                        arcname = f"skills/{skill_dir.name}/{file_path.relative_to(skill_dir)}"
                        total_size += AgentCorePackageBuilder._write_zip_entry(zf, file_path, arcname)

        return total_size

    @staticmethod
    def _write_zip_entry(zf: zipfile.ZipFile, file_path: Path, arcname: str) -> int:
        """Add a single file to the zip with normalized (644/755) permissions."""
        data = file_path.read_bytes()
        info = zipfile.ZipInfo(arcname)
        # Preserve executability (e.g. vendored .so loaders / bin scripts), else 644
        is_executable = os.access(file_path, os.X_OK)
        mode = 0o755 if is_executable else 0o644
        info.external_attr = (mode | 0o100000) << 16  # regular file with mode
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, data)
        return len(data)

    @staticmethod
    def _largest_packages(pkg_dir: Path, top_n: int = 5) -> str:
        """Human-readable list of the largest top-level vendored packages."""
        sizes = []
        try:
            for entry in pkg_dir.iterdir():
                if entry.is_dir():
                    size = sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
                else:
                    size = entry.stat().st_size
                sizes.append((size, entry.name))
        except OSError:
            return "unknown"
        sizes.sort(reverse=True)
        return ", ".join(f"{name} ({size / (1024 * 1024):.0f} MB)" for size, name in sizes[:top_n])

    @staticmethod
    async def _log(log: LogCallback, message: str) -> None:
        logger.info(message)
        if log:
            try:
                await log(message)
            except Exception as e:  # progress reporting must never fail the build
                logger.warning(f"Progress log callback failed: {e}")
