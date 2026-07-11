"""
AI code generation API routes (design 2.6).

- POST   /api/generate-code/stream  : SSE generation stream
- GET    /api/generate-code/status  : backend availability (shared with AI fix)
- DELETE /api/generate-code/cache   : clear generation cache
- POST   /api/fix-code/stream       : SSE AI-fix stream for failed executions
"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.utils.sse_formatter import SSEFormatter
from codegen.cache import clear_cache
from codegen.service import fix_code_events, generate_code_events, get_status

logger = logging.getLogger(__name__)

# Single router (registered once in main.py) hosting both the generate-code
# and fix-code endpoint families.
router = APIRouter(prefix="/api", tags=["codegen"])


class FlowDataModel(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]


class GenerateCodeRequest(BaseModel):
    flow_data: FlowDataModel
    graph_mode: bool = False
    template_code: Optional[str] = None


class FixCodeRequest(BaseModel):
    code: str
    error: str
    flow_data: FlowDataModel
    graph_mode: bool = False
    input_data: Optional[str] = None


def _sse_response(event_iterator) -> StreamingResponse:
    """Wrap a service event generator into an SSE StreamingResponse."""

    async def event_stream():
        try:
            async for event in event_iterator:
                yield SSEFormatter.format_json_data(
                    event["data"], event_type=event["event"]
                )
        except Exception as e:
            logger.error(f"Codegen stream error: {e}", exc_info=True)
            yield SSEFormatter.format_json_data({"message": str(e)}, event_type="error")
        finally:
            yield SSEFormatter.format_end_event()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@router.post("/generate-code/stream")
async def generate_code_stream(request: GenerateCodeRequest):
    """Generate agent code from flow data via the configured coding agent (SSE)."""
    logger.info(
        f"AI codegen request: {len(request.flow_data.nodes)} nodes, "
        f"{len(request.flow_data.edges)} edges, graph_mode={request.graph_mode}"
    )
    return _sse_response(
        generate_code_events(
            flow_data=request.flow_data.model_dump(),
            graph_mode=request.graph_mode,
            template_code=request.template_code,
        )
    )


@router.post("/fix-code/stream")
async def fix_code_stream(request: FixCodeRequest):
    """Diagnose and fix a failed execution via the configured coding agent (SSE)."""
    logger.info(
        f"AI fix request: {len(request.flow_data.nodes)} nodes, "
        f"{len(request.flow_data.edges)} edges, graph_mode={request.graph_mode}, "
        f"error_len={len(request.error)}"
    )
    return _sse_response(
        fix_code_events(
            code=request.code,
            error=request.error,
            flow_data=request.flow_data.model_dump(),
            graph_mode=request.graph_mode,
            input_data=request.input_data,
        )
    )


@router.get("/generate-code/status")
async def codegen_status():
    """Report configured backend availability (drives frontend button enable/disable)."""
    return await get_status()


@router.delete("/generate-code/cache")
async def clear_codegen_cache():
    """Delete all cached generation results. Returns the number of deleted entries."""
    try:
        deleted = clear_cache()
        return {"deleted": deleted}
    except Exception as e:
        logger.error(f"Failed to clear codegen cache: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
