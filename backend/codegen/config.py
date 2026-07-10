"""
Centralized configuration for the codegen module.

All environment variable reads live here so future backends (Codex / Kiro)
only need to extend this file and the registry.
"""
import os
from pathlib import Path

# Directory layout
CODEGEN_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CODEGEN_DIR.parent
GUIDANCE_DIR = CODEGEN_DIR / "guidance"
CACHE_DIR = BACKEND_DIR / "storage" / "codegen_cache"

# The single file every backend must produce inside its workspace
GENERATED_FILENAME = "generated_agent.py"

# Default model matches the project-wide default (src/lib/models.ts DEFAULT_MODEL_ID)
DEFAULT_CODEGEN_MODEL = "global.anthropic.claude-sonnet-4-6"

# Hard cap on agent turns to prevent runaway sessions
CODEGEN_MAX_TURNS = 30

# Import smoke test timeout (seconds)
IMPORT_SMOKE_TIMEOUT_S = 20


def get_backend_name() -> str:
    """Selected coding agent backend (env CODEGEN_BACKEND, default 'claude')."""
    return os.getenv("CODEGEN_BACKEND", "claude").strip().lower()


def get_model() -> str:
    """Model id used by the coding agent (env CODEGEN_MODEL)."""
    return os.getenv("CODEGEN_MODEL", DEFAULT_CODEGEN_MODEL).strip()


def get_timeout_s() -> float:
    """End-to-end generation timeout in seconds (env CODEGEN_TIMEOUT_S, default 180)."""
    try:
        return float(os.getenv("CODEGEN_TIMEOUT_S", "180"))
    except ValueError:
        return 180.0


def get_max_repair_rounds() -> int:
    """Maximum validation repair rounds (env CODEGEN_MAX_REPAIR_ROUNDS, default 2)."""
    try:
        return int(os.getenv("CODEGEN_MAX_REPAIR_ROUNDS", "2"))
    except ValueError:
        return 2


def get_guidance_version() -> str:
    """Content of guidance/VERSION (part of the cache key). '0' if missing."""
    version_file = GUIDANCE_DIR / "VERSION"
    try:
        return version_file.read_text(encoding="utf-8").strip()
    except OSError:
        return "0"
