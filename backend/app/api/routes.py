"""
Main API router configuration.
"""

from fastapi import APIRouter
from .health import router as health_router
from .components import router as components_router

# Create main API router
api_router = APIRouter()

# Include sub-routers
api_router.include_router(
    health_router,
    tags=["health"]
)

api_router.include_router(
    components_router,
    prefix="/components",
    tags=["components"]
)

# Future routers will be added here:
# api_router.include_router(workflows_router, prefix="/workflows", tags=["workflows"])
# api_router.include_router(execution_router, prefix="/execution", tags=["execution"])