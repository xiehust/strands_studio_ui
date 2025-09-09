"""
Middleware configuration for the FastAPI application.
"""

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import time
import logging
from typing import Callable
from .config import settings

logger = logging.getLogger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for request/response logging."""
    
    async def dispatch(self, request: Request, call_next: Callable) -> JSONResponse:
        start_time = time.time()
        
        # Log request
        logger.info(f"Request: {request.method} {request.url}")
        
        try:
            response = await call_next(request)
            process_time = time.time() - start_time
            
            # Log response
            logger.info(
                f"Response: {response.status_code} - "
                f"Time: {process_time:.4f}s - "
                f"Path: {request.url.path}"
            )
            
            # Add timing header
            response.headers["X-Process-Time"] = str(process_time)
            return response
            
        except Exception as e:
            process_time = time.time() - start_time
            logger.error(f"Request failed: {str(e)} - Time: {process_time:.4f}s")
            raise


class ErrorHandlingMiddleware(BaseHTTPMiddleware):
    """Middleware for global error handling."""
    
    async def dispatch(self, request: Request, call_next: Callable) -> JSONResponse:
        try:
            return await call_next(request)
        except HTTPException:
            # Re-raise HTTP exceptions (they're handled by FastAPI)
            raise
        except Exception as e:
            logger.error(f"Unhandled error: {str(e)}", exc_info=True)
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Internal server error",
                    "message": "An unexpected error occurred",
                    "detail": str(e) if settings.DEBUG else None
                }
            )


def setup_middleware(app: FastAPI) -> None:
    """Configure middleware for the FastAPI application."""
    
    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.get_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Custom middleware
    app.add_middleware(ErrorHandlingMiddleware)
    app.add_middleware(LoggingMiddleware)