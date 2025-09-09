"""
FastAPI backend for the Agent Builder application.
Provides API endpoints for workflow management, code generation, and agent execution.
"""

import logging
import time
import traceback
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("backend.log") if os.getenv("DEBUG", "false").lower() == "true" else logging.NullHandler()
    ]
)

logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Agent Builder API",
    description="Backend API for the visual agent builder using Strands Agent SDK",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

# Configure CORS for React frontend
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request timing middleware
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Add processing time header to responses."""
    start_time = time.perf_counter()
    
    # Log incoming request
    logger.info(f"Incoming request: {request.method} {request.url}")
    
    try:
        response = await call_next(request)
        process_time = time.perf_counter() - start_time
        response.headers["X-Process-Time"] = str(process_time)
        
        # Log response
        logger.info(f"Request completed: {request.method} {request.url} - {response.status_code} - {process_time:.4f}s")
        
        return response
    except Exception as e:
        process_time = time.perf_counter() - start_time
        logger.error(f"Request failed: {request.method} {request.url} - {str(e)} - {process_time:.4f}s")
        raise

# Global exception handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handle HTTP exceptions with consistent error format."""
    logger.warning(f"HTTP exception: {exc.status_code} - {exc.detail} - {request.method} {request.url}")
    
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "type": "http_error",
                "status_code": exc.status_code,
                "message": exc.detail,
                "path": str(request.url.path),
                "method": request.method
            }
        },
        headers=getattr(exc, "headers", None)
    )

@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Handle Starlette HTTP exceptions."""
    logger.warning(f"Starlette HTTP exception: {exc.status_code} - {exc.detail} - {request.method} {request.url}")
    
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "type": "http_error",
                "status_code": exc.status_code,
                "message": exc.detail,
                "path": str(request.url.path),
                "method": request.method
            }
        }
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Handle request validation errors with detailed information."""
    logger.warning(f"Validation error: {exc.errors()} - {request.method} {request.url}")
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {
                "type": "validation_error",
                "status_code": 422,
                "message": "Request validation failed",
                "details": exc.errors(),
                "path": str(request.url.path),
                "method": request.method
            }
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handle unexpected exceptions."""
    error_id = f"error_{int(time.time())}"
    logger.error(f"Unexpected error [{error_id}]: {str(exc)} - {request.method} {request.url}")
    logger.error(f"Traceback [{error_id}]: {traceback.format_exc()}")
    
    # Don't expose internal error details in production
    if os.getenv("DEBUG", "false").lower() == "true":
        error_detail = str(exc)
        traceback_info = traceback.format_exc()
    else:
        error_detail = "An internal server error occurred"
        traceback_info = None
    
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": {
                "type": "internal_error",
                "status_code": 500,
                "message": error_detail,
                "error_id": error_id,
                "path": str(request.url.path),
                "method": request.method,
                "traceback": traceback_info
            }
        }
    )

# Health check endpoints
@app.get("/")
async def root() -> Dict[str, Any]:
    """Root endpoint for basic health check."""
    return {
        "message": "Agent Builder API is running",
        "version": "1.0.0",
        "status": "healthy"
    }

@app.get("/api/health")
async def health_check() -> Dict[str, Any]:
    """Detailed health check endpoint."""
    return {
        "status": "healthy",
        "service": "agent-builder-api",
        "version": "1.0.0",
        "timestamp": time.time(),
        "environment": {
            "debug": os.getenv("DEBUG", "false").lower() == "true",
            "log_level": os.getenv("LOG_LEVEL", "INFO"),
            "cors_origins": cors_origins
        }
    }

@app.get("/api/status")
async def status_check() -> Dict[str, Any]:
    """System status endpoint with more detailed information."""
    try:
        # Basic system checks
        import sys
        import platform
        
        return {
            "status": "operational",
            "service": "agent-builder-api",
            "version": "1.0.0",
            "timestamp": time.time(),
            "system": {
                "python_version": sys.version,
                "platform": platform.platform(),
                "architecture": platform.architecture()[0]
            },
            "environment": {
                "debug": os.getenv("DEBUG", "false").lower() == "true",
                "log_level": os.getenv("LOG_LEVEL", "INFO")
            }
        }
    except Exception as e:
        logger.error(f"Status check failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service status check failed"
        )

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    debug_mode = os.getenv("DEBUG", "false").lower() == "true"
    
    logger.info(f"Starting Agent Builder API on port {port}")
    logger.info(f"Debug mode: {debug_mode}")
    logger.info(f"CORS origins: {cors_origins}")
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=debug_mode,
        log_level=os.getenv("LOG_LEVEL", "info").lower()
    )