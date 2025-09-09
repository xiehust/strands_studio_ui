"""
Alternative FastAPI application entry point using the structured approach.
This demonstrates the organized application structure.
"""

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
import uvicorn
import os
from dotenv import load_dotenv

# Import application modules
from app.core.config import settings
from app.core.logging import setup_logging, get_logger
from app.core.middleware import setup_middleware
from app.api.routes import api_router

# Load environment variables
load_dotenv()

# Setup logging
setup_logging()
logger = get_logger(__name__)

# Create FastAPI app
app = FastAPI(
    title=settings.API_TITLE,
    description=settings.API_DESCRIPTION,
    version=settings.API_VERSION,
    debug=settings.DEBUG,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# Setup middleware
setup_middleware(app)

# Include API routes
app.include_router(api_router, prefix="/api")

# Root redirect to docs
@app.get("/")
async def root():
    """Redirect root to API documentation."""
    return RedirectResponse(url="/docs")

if __name__ == "__main__":
    logger.info(f"Starting {settings.API_TITLE} on {settings.HOST}:{settings.PORT}")
    logger.info(f"Debug mode: {settings.DEBUG}")
    logger.info(f"CORS origins: {settings.get_cors_origins()}")
    
    uvicorn.run(
        "app_main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL
    )