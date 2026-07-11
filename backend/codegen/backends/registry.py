"""
Backend registry: name -> CodingAgentBackend class (design 2.1).

Future backends (Codex / Kiro) add one module + one entry here;
the service layer stays unchanged.
"""
from typing import Dict, Type

from codegen import config
from codegen.backends.base import CodingAgentBackend
from codegen.backends.claude_sdk import ClaudeSdkBackend

_BACKENDS: Dict[str, Type[CodingAgentBackend]] = {
    "claude": ClaudeSdkBackend,
    # future: "codex": CodexBackend, "kiro": KiroBackend
}


class UnknownBackendError(ValueError):
    """Raised when CODEGEN_BACKEND names a backend that is not registered."""
    pass


def available_backends() -> list[str]:
    return sorted(_BACKENDS.keys())


def get_backend(name: str | None = None) -> CodingAgentBackend:
    """Instantiate the selected backend (new instance per generation request).

    Raises UnknownBackendError with the list of registered backends when the
    configured name is unknown.
    """
    backend_name = name or config.get_backend_name()
    backend_cls = _BACKENDS.get(backend_name)
    if backend_cls is None:
        raise UnknownBackendError(
            f"Unknown codegen backend '{backend_name}'. "
            f"Available backends: {', '.join(available_backends())}. "
            f"Set the CODEGEN_BACKEND environment variable to one of these."
        )
    return backend_cls()
