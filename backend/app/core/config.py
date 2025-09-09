"""
Configuration management for the Agent Builder API.
"""

import os
from typing import List
from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    """Application settings."""
    
    # API Configuration
    API_TITLE: str = "Agent Builder API"
    API_DESCRIPTION: str = "Backend API for the visual agent builder using Strands Agent SDK"
    API_VERSION: str = "1.0.0"
    
    # Server Configuration
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False
    
    # CORS Configuration
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"
    
    # Logging Configuration
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "backend.log"
    
    # Storage Configuration
    STORAGE_PATH: str = "storage"
    WORKFLOWS_PATH: str = "storage/workflows"
    

    
    def get_cors_origins(self) -> List[str]:
        """Get CORS origins as a list."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]
    
    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, v):
        """Parse debug flag from string."""
        if isinstance(v, str):
            return v.lower() in ("true", "1", "yes", "on")
        return v
    
    model_config = {
        "env_file": ".env",
        "case_sensitive": True,
        "extra": "ignore"
    }


# Global settings instance
settings = Settings()