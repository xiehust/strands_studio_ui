"""
Storage data models for the Strands UI Backend
"""
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field, validator
import uuid


class StorageMetadata(BaseModel):
    """Metadata for stored artifacts"""
    project_id: str
    version: str
    execution_id: str
    timestamp: datetime = Field(default_factory=datetime.now)
    file_type: str  # 'generate.py', 'flow.json', 'result.json', 'metadata.json'
    file_size: int
    file_path: str
    checksum: Optional[str] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "project_id": "my-project",
                "version": "1.0.0",
                "execution_id": "exec-123",
                "timestamp": "2024-09-11T10:30:00.000Z",
                "file_type": "generate.py",
                "file_size": 1024,
                "file_path": "storage/my-project/1.0.0/exec-123/generate.py",
                "checksum": "sha256:abc123..."
            }
        }


class ArtifactRequest(BaseModel):
    """Request model for saving artifacts"""
    project_id: str = Field(..., description="Project identifier")
    version: str = Field(..., description="Project version")
    execution_id: str = Field(..., description="Execution identifier")
    content: str = Field(..., description="File content to save")
    file_type: str = Field(..., description="Type of file (generate.py, flow.json, etc.)")
    
    @validator('project_id', 'version', 'execution_id')
    def validate_identifiers(cls, v):
        """Sanitize identifiers for filesystem use"""
        if not v or not isinstance(v, str):
            raise ValueError("Identifier must be a non-empty string")

        # Sanitize the identifier for filesystem use
        # Replace common unsafe characters with safe alternatives
        sanitized = v.replace(' ', '_')  # Replace spaces with underscores
        sanitized = sanitized.replace('(', '[')  # Replace ( with [
        sanitized = sanitized.replace(')', ']')  # Replace ) with ]
        sanitized = sanitized.replace('/', '-')  # Replace / with -
        sanitized = sanitized.replace('\\', '-')  # Replace \ with -
        sanitized = sanitized.replace(':', '-')  # Replace : with -
        sanitized = sanitized.replace('*', '-')  # Replace * with -
        sanitized = sanitized.replace('?', '-')  # Replace ? with -
        sanitized = sanitized.replace('"', "'")  # Replace " with '
        sanitized = sanitized.replace('<', '[')  # Replace < with [
        sanitized = sanitized.replace('>', ']')  # Replace > with ]
        sanitized = sanitized.replace('|', '-')  # Replace | with -

        # Ensure we don't have empty string after sanitization
        if not sanitized.strip():
            raise ValueError("Identifier becomes empty after sanitization")

        return sanitized
    
    @validator('file_type')
    def validate_file_type(cls, v):
        """Validate file type"""
        allowed_types = {'generate.py', 'flow.json', 'result.json', 'metadata.json'}
        if v not in allowed_types:
            raise ValueError(f"File type must be one of: {', '.join(allowed_types)}")
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "project_id": "my-project",
                "version": "1.0.0",
                "execution_id": "exec-123",
                "content": "# Generated Python code\\nprint('Hello World')",
                "file_type": "generate.py"
            }
        }


class ArtifactResponse(BaseModel):
    """Response model for artifact operations"""
    success: bool
    message: str
    metadata: Optional[StorageMetadata] = None
    file_path: Optional[str] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "Artifact saved successfully",
                "metadata": {
                    "project_id": "my-project",
                    "version": "1.0.0",
                    "execution_id": "exec-123",
                    "timestamp": "2024-09-11T10:30:00.000Z",
                    "file_type": "generate.py",
                    "file_size": 1024,
                    "file_path": "storage/my-project/1.0.0/exec-123/generate.py"
                },
                "file_path": "storage/my-project/1.0.0/exec-123/generate.py"
            }
        }


class ProjectInfo(BaseModel):
    """Information about a stored project"""
    project_id: str
    versions: List[str]
    latest_version: str
    created_at: datetime
    updated_at: datetime
    total_size: int
    execution_count: int
    
    class Config:
        json_schema_extra = {
            "example": {
                "project_id": "my-project",
                "versions": ["1.0.0", "1.0.1", "1.1.0"],
                "latest_version": "1.1.0",
                "created_at": "2024-09-11T10:00:00.000Z",
                "updated_at": "2024-09-11T10:30:00.000Z",
                "total_size": 5120,
                "execution_count": 3
            }
        }


class VersionInfo(BaseModel):
    """Information about a project version"""
    project_id: str
    version: str
    executions: List[str]
    created_at: datetime
    updated_at: datetime
    artifact_count: int
    total_size: int
    
    class Config:
        json_schema_extra = {
            "example": {
                "project_id": "my-project",
                "version": "1.0.0",
                "executions": ["exec-123", "exec-456"],
                "created_at": "2024-09-11T10:00:00.000Z",
                "updated_at": "2024-09-11T10:15:00.000Z",
                "artifact_count": 8,
                "total_size": 2048
            }
        }


class ExecutionInfo(BaseModel):
    """Information about an execution"""
    project_id: str
    version: str
    execution_id: str
    artifacts: List[StorageMetadata]
    created_at: datetime
    total_size: int
    
    class Config:
        json_schema_extra = {
            "example": {
                "project_id": "my-project",
                "version": "1.0.0",
                "execution_id": "exec-123",
                "artifacts": [],
                "created_at": "2024-09-11T10:00:00.000Z",
                "total_size": 1024
            }
        }


class StorageStats(BaseModel):
    """Storage system statistics"""
    total_projects: int
    total_versions: int
    total_executions: int
    total_artifacts: int
    total_size: int
    oldest_artifact: Optional[datetime] = None
    newest_artifact: Optional[datetime] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "total_projects": 5,
                "total_versions": 12,
                "total_executions": 25,
                "total_artifacts": 100,
                "total_size": 10485760,
                "oldest_artifact": "2024-09-10T08:00:00.000Z",
                "newest_artifact": "2024-09-11T10:30:00.000Z"
            }
        }


class RetrieveArtifactRequest(BaseModel):
    """Request model for retrieving artifacts"""
    project_id: str = Field(..., description="Project identifier")
    version: str = Field(..., description="Project version")
    execution_id: str = Field(..., description="Execution identifier")
    file_type: str = Field(..., description="Type of file to retrieve")
    
    @validator('project_id', 'version', 'execution_id')
    def validate_identifiers(cls, v):
        """Validate that identifiers are safe for filesystem use"""
        if not v or not isinstance(v, str):
            raise ValueError("Identifier must be a non-empty string")
        return v
    
    @validator('file_type')
    def validate_file_type(cls, v):
        """Validate file type"""
        allowed_types = {'generate.py', 'flow.json', 'result.json', 'metadata.json'}
        if v not in allowed_types:
            raise ValueError(f"File type must be one of: {', '.join(allowed_types)}")
        return v


class ArtifactContent(BaseModel):
    """Response model for artifact content"""
    content: str
    metadata: StorageMetadata
    
    class Config:
        json_schema_extra = {
            "example": {
                "content": "# Generated Python code\\nprint('Hello World')",
                "metadata": {
                    "project_id": "my-project",
                    "version": "1.0.0",
                    "execution_id": "exec-123",
                    "timestamp": "2024-09-11T10:30:00.000Z",
                    "file_type": "generate.py",
                    "file_size": 1024,
                    "file_path": "storage/my-project/1.0.0/exec-123/generate.py"
                }
            }
        }