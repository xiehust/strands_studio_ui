"""
Codegen orchestration service (design 1 + 2.6).

Pipeline: cache lookup -> workspace build -> backend.generate -> validation
-> repair loop (<= CODEGEN_MAX_REPAIR_ROUNDS, same agent session) -> fallback
to template code -> cache write (source=agent only).

Exposes an async generator of SSE-ready event dicts:
  {"event": "progress"|"agent_activity"|"validation"|"done"|"error", "data": {...}}
"""
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, Optional

from codegen import cache, config
from codegen.backends import registry
from codegen.backends.base import GenerationTask
from codegen.backends.registry import UnknownBackendError
from codegen.validators import validate_generated_code
from codegen.workspace_builder import build_workspace, cleanup_workspace

logger = logging.getLogger(__name__)

GENERATED_FILENAME = config.GENERATED_FILENAME


async def get_status() -> Dict[str, Any]:
    """Availability of the configured coding agent backend (for R10 UI gating)."""
    backend_name = config.get_backend_name()
    try:
        backend = registry.get_backend()
    except UnknownBackendError as e:
        return {"backend": backend_name, "available": False, "reason": str(e)}

    try:
        available, reason = await backend.check_available()
    except Exception as e:
        logger.error(f"Backend availability check failed: {e}", exc_info=True)
        return {"backend": backend.name, "available": False, "reason": str(e)}
    finally:
        await backend.close()

    return {"backend": backend.name, "available": available, "reason": reason or None}


class _EventEmitter:
    """Bridges the worker coroutine to the SSE generator via a queue."""

    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()

    async def emit(self, event: str, data: Dict[str, Any]) -> None:
        await self.queue.put({"event": event, "data": data})

    async def close(self) -> None:
        await self.queue.put(None)


async def _run_generation(
    emitter: _EventEmitter,
    flow_data: dict,
    graph_mode: bool,
    template_code: Optional[str],
    cache_key: str,
    started_at: float,
) -> None:
    """Generate + validate + repair. Emits validation/done events; raises on hard failure."""

    def duration_ms() -> int:
        return int((time.monotonic() - started_at) * 1000)

    backend = registry.get_backend()

    available, reason = await backend.check_available()
    if not available:
        raise RuntimeError(f"Codegen backend '{backend.name}' unavailable: {reason}")

    await emitter.emit("progress", {"message": "Building agent workspace"})
    workspace = build_workspace(flow_data, graph_mode)

    async def on_progress(summary: str) -> None:
        await emitter.emit("agent_activity", {"summary": summary})

    try:
        max_rounds = config.get_max_repair_rounds()
        task = GenerationTask(
            flow_data=flow_data,
            graph_mode=graph_mode,
            template_code=template_code,
        )

        report = None
        for round_index in range(max_rounds + 1):  # round 0 = initial generation
            if round_index == 0:
                await emitter.emit(
                    "progress",
                    {"message": f"Generating code with backend '{backend.name}'"},
                )
            else:
                await emitter.emit(
                    "progress",
                    {
                        "message": (
                            f"Validation failed, repair round "
                            f"{round_index}/{max_rounds}"
                        )
                    },
                )

            await backend.generate(workspace, task, on_progress)

            await emitter.emit("progress", {"message": "Validating generated code"})
            report = await validate_generated_code(workspace, flow_data)
            await emitter.emit(
                "validation",
                {"round": round_index, "errors": report.to_dict()["errors"]},
            )

            if report.passed:
                break

            # Prepare the repair round against the same agent session
            current_code = ""
            generated_file = workspace / GENERATED_FILENAME
            if generated_file.exists():
                current_code = generated_file.read_text(encoding="utf-8")
            task = GenerationTask(
                flow_data=flow_data,
                graph_mode=graph_mode,
                template_code=template_code,
                previous_code=current_code,
                validation_errors=report.error_messages(),
            )

        validation_report = report.to_dict() if report else {"passed": False, "errors": []}

        if report and report.passed:
            code = (workspace / GENERATED_FILENAME).read_text(encoding="utf-8")
            cache.put_cached(
                cache_key,
                {
                    "code": code,
                    "validation_report": validation_report,
                    "backend": backend.name,
                    "model": config.get_model(),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            await emitter.emit(
                "done",
                {
                    "code": code,
                    "source": "agent",
                    "validation_report": validation_report,
                    "duration_ms": duration_ms(),
                },
            )
            return

        # Repair rounds exhausted
        if template_code:
            logger.warning(
                "AI codegen failed validation after repair rounds; "
                "falling back to template code"
            )
            await emitter.emit(
                "done",
                {
                    "code": template_code,
                    "source": "fallback",
                    "validation_report": validation_report,
                    "fallback_reason": (
                        f"Generated code failed validation after "
                        f"{max_rounds} repair round(s)"
                    ),
                    "duration_ms": duration_ms(),
                },
            )
            return

        raise RuntimeError(
            f"Generated code failed validation after {max_rounds} repair "
            f"round(s) and no template code was provided as fallback: "
            f"{'; '.join((report.error_messages() if report else [])[:5])}"
        )
    finally:
        await backend.close()
        cleanup_workspace(workspace)


async def generate_code_events(
    flow_data: dict,
    graph_mode: bool = False,
    template_code: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Async generator of SSE events for one generation request."""
    started_at = time.monotonic()

    def duration_ms() -> int:
        return int((time.monotonic() - started_at) * 1000)

    # Backend / model resolved up front (also part of the cache key)
    backend_name = config.get_backend_name()
    model = config.get_model()
    cache_key = cache.compute_cache_key(flow_data, graph_mode, backend_name, model)

    # Cache fast path — no agent invocation
    cached = cache.get_cached(cache_key)
    if cached is not None:
        yield {"event": "progress", "data": {"message": "Cache hit, returning cached code"}}
        yield {
            "event": "done",
            "data": {
                "code": cached["code"],
                "source": "cache",
                "validation_report": cached.get("validation_report"),
                "duration_ms": duration_ms(),
            },
        }
        return

    emitter = _EventEmitter()
    timeout_s = config.get_timeout_s()

    async def worker() -> None:
        try:
            await asyncio.wait_for(
                _run_generation(
                    emitter, flow_data, graph_mode, template_code,
                    cache_key, started_at,
                ),
                timeout=timeout_s,
            )
        except asyncio.TimeoutError:
            if template_code:
                await emitter.emit(
                    "done",
                    {
                        "code": template_code,
                        "source": "fallback",
                        "validation_report": None,
                        "fallback_reason": f"Code generation timed out after {timeout_s:.0f}s",
                        "duration_ms": duration_ms(),
                    },
                )
            else:
                await emitter.emit(
                    "error",
                    {"message": f"Code generation timed out after {timeout_s:.0f}s"},
                )
        except UnknownBackendError as e:
            await emitter.emit("error", {"message": str(e)})
        except Exception as e:
            logger.error(f"Code generation failed: {e}", exc_info=True)
            if template_code:
                await emitter.emit(
                    "done",
                    {
                        "code": template_code,
                        "source": "fallback",
                        "validation_report": None,
                        "fallback_reason": str(e),
                        "duration_ms": duration_ms(),
                    },
                )
            else:
                await emitter.emit("error", {"message": str(e)})
        finally:
            await emitter.close()

    worker_task = asyncio.create_task(worker())
    try:
        while True:
            item = await emitter.queue.get()
            if item is None:
                break
            yield item
    finally:
        if not worker_task.done():
            worker_task.cancel()
        try:
            await worker_task
        except (asyncio.CancelledError, Exception):
            pass
