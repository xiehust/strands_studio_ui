"""
Health check API endpoints.
"""

from fastapi import APIRouter, Depends
from ..models.api import HealthResponse, HealthStatus
from ..core.config import settings
import time
import psutil
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# Track application start time
start_time = time.time()


def get_system_info() -> dict:
    """Get system information for health check."""
    try:
        return {
            "cpu_percent": psutil.cpu_percent(interval=1),
            "memory_percent": psutil.virtual_memory().percent,
            "disk_percent": psutil.disk_usage('/').percent,
        }
    except Exception as e:
        logger.warning(f"Could not get system info: {e}")
        return {}


@router.get("/", response_model=HealthResponse)
async def root_health():
    """Root endpoint health check."""
    uptime = time.time() - start_time
    
    return HealthResponse(
        status=HealthStatus.HEALTHY,
        service="agent-builder-api",
        version=settings.api_version,
        uptime=uptime
    )


@router.get("/health", response_model=HealthResponse)
async def detailed_health():
    """Detailed health check with system information."""
    uptime = time.time() - start_time
    system_info = get_system_info()
    
    # Determine health status based on system metrics
    status = HealthStatus.HEALTHY
    if system_info.get("memory_percent", 0) > 90:
        status = HealthStatus.DEGRADED
    if system_info.get("cpu_percent", 0) > 95:
        status = HealthStatus.DEGRADED
    
    return HealthResponse(
        status=status,
        service="agent-builder-api",
        version=settings.api_version,
        uptime=uptime,
        details={
            "system": system_info,
            "config": {
                "debug": settings.debug,
                "log_level": settings.log_level,
                "storage_path": settings.storage_path
            }
        }
    )