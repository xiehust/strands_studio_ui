"""
AI code generation API routes (design 2.6).

- POST   /api/generate-code/stream  : SSE generation stream
- GET    /api/generate-code/status  : backend availability
- DELETE /api/generate-code/cache   : clear generation cache
"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.utils.sse_formatter import SSEFormatter
from codegen.cache import clear_cache
from codegen.service import generate_code_events, get_status

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/generate-code", tags=["codegen"])


class FlowDataModel(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]


class GenerateCodeRequest(BaseModel):
    flow_data: FlowDataModel
    graph_mode: bool = False
    template_code: Optional[str] = None


@router.post("/stream")
async def generate_code_stream(request: GenerateCodeRequest):
    """Generate agent code from flow data via the configured coding agent (SSE)."""
    logger.info(
        f"AI codegen request: {len(request.flow_data.nodes)} nodes, "
        f"{len(request.flow_data.edges)} edges, graph_mode={request.graph_mode}"
    )

    async def event_stream():
        try:
            async for event in generate_code_events(
                flow_data=request.flow_data.model_dump(),
                graph_mode=request.graph_mode,
                template_code=request.template_code,
            ):
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


@router.get("/status")
async def codegen_status():
    """Report configured backend availability (drives frontend button enable/disable)."""
    return await get_status()


@router.delete("/cache")
async def clear_codegen_cache():
    """Delete all cached generation results. Returns the number of deleted entries."""
    try:
        deleted = clear_cache()
        return {"deleted": deleted}
    except Exception as e:
        logger.error(f"Failed to clear codegen cache: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
