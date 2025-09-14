"""
Storage service for managing artifacts in the Strands UI Backend
"""
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import aiofiles
from fastapi import HTTPException

from ..models.storage import (
    ArtifactRequest,
    ArtifactResponse,
    StorageMetadata,
    ProjectInfo,
    VersionInfo,
    ExecutionInfo,
    StorageStats,
    ArtifactContent
)
from ..utils.path_utils import (
    build_storage_path,
    ensure_directory_exists,
    is_safe_path,
    calculate_content_checksum,
    calculate_file_checksum,
    get_file_extension,
    validate_file_type
)

logger = logging.getLogger(__name__)


class StorageService:
    """Service for managing artifact storage"""
    
    def __init__(self, base_storage_dir: str = "storage"):
        """
        Initialize the storage service
        
        Args:
            base_storage_dir: Base directory for storage
        """
        self.base_dir = Path(base_storage_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Storage service initialized with base directory: {self.base_dir}")
    
    async def save_artifact(self, request: ArtifactRequest) -> ArtifactResponse:
        """
        Save an artifact to storage
        
        Args:
            request: Artifact save request
            
        Returns:
            Response with operation result and metadata
        """
        try:
            # logger.info(f"Saving artifact: {request.project_id}/{request.version}/{request.execution_id}/{request.file_type}")
            
            # Validate file type
            if not validate_file_type(request.file_type):
                raise HTTPException(status_code=400, detail=f"Invalid file type: {request.file_type}")
            
            # Build storage path
            storage_path = build_storage_path(
                self.base_dir,
                request.project_id,
                request.version,
                request.execution_id
            )
            
            # Ensure directory exists
            ensure_directory_exists(storage_path)
            
            # Create file path
            file_name = request.file_type
            if not file_name.endswith(get_file_extension(request.file_type)):
                file_name += get_file_extension(request.file_type)
            
            file_path = storage_path / file_name
            
            # Ensure the path is safe
            if not is_safe_path(file_path, self.base_dir):
                raise HTTPException(status_code=400, detail="Invalid file path")
            
            # Calculate checksum before writing
            checksum = calculate_content_checksum(request.content)
            
            # Write file asynchronously
            async with aiofiles.open(file_path, 'w', encoding='utf-8') as f:
                await f.write(request.content)
            
            # Get file size
            file_size = file_path.stat().st_size
            
            # Create metadata
            try:
                relative_path = str(file_path.relative_to(Path.cwd()))
            except ValueError:
                # If the file is not relative to the current working directory, use the absolute path
                relative_path = str(file_path)
                
            metadata = StorageMetadata(
                project_id=request.project_id,
                version=request.version,
                execution_id=request.execution_id,
                timestamp=datetime.now(),
                file_type=request.file_type,
                file_size=file_size,
                file_path=relative_path,
                checksum=checksum
            )
            
            # Save metadata
            await self._save_metadata(storage_path, metadata)
            
            # logger.info(f"Artifact saved successfully: {file_path}")
            
            return ArtifactResponse(
                success=True,
                message="Artifact saved successfully",
                metadata=metadata,
                file_path=relative_path
            )
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error saving artifact: {e}")
            return ArtifactResponse(
                success=False,
                message=f"Failed to save artifact: {str(e)}"
            )
    
    async def retrieve_artifact(self, project_id: str, version: str, execution_id: str, file_type: str) -> ArtifactContent:
        """
        Retrieve an artifact from storage
        
        Args:
            project_id: Project identifier
            version: Project version
            execution_id: Execution identifier
            file_type: Type of file to retrieve
            
        Returns:
            Artifact content and metadata
        """
        try:
            logger.info(f"Retrieving artifact: {project_id}/{version}/{execution_id}/{file_type}")
            
            # Validate file type
            if not validate_file_type(file_type):
                raise HTTPException(status_code=400, detail=f"Invalid file type: {file_type}")
            
            # Build storage path
            storage_path = build_storage_path(self.base_dir, project_id, version, execution_id)
            
            # Create file path
            file_name = file_type
            if not file_name.endswith(get_file_extension(file_type)):
                file_name += get_file_extension(file_type)
            
            file_path = storage_path / file_name
            
            # Check if file exists
            if not file_path.exists():
                raise HTTPException(status_code=404, detail="Artifact not found")
            
            # Ensure the path is safe
            if not is_safe_path(file_path, self.base_dir):
                raise HTTPException(status_code=400, detail="Invalid file path")
            
            # Read file content
            async with aiofiles.open(file_path, 'r', encoding='utf-8') as f:
                content = await f.read()
            
            # Load metadata
            metadata = await self._load_metadata(storage_path, file_type)
            if not metadata:
                # Create minimal metadata if not found
                file_size = file_path.stat().st_size
                try:
                    relative_path = str(file_path.relative_to(Path.cwd()))
                except ValueError:
                    relative_path = str(file_path)
                    
                metadata = StorageMetadata(
                    project_id=project_id,
                    version=version,
                    execution_id=execution_id,
                    timestamp=datetime.fromtimestamp(file_path.stat().st_mtime),
                    file_type=file_type,
                    file_size=file_size,
                    file_path=relative_path
                )
            
            logger.info(f"Artifact retrieved successfully: {file_path}")
            
            return ArtifactContent(content=content, metadata=metadata)
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error retrieving artifact: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to retrieve artifact: {str(e)}")
    
    async def list_projects(self) -> List[ProjectInfo]:
        """
        List all projects in storage
        
        Returns:
            List of project information
        """
        try:
            logger.info("Listing all projects")
            projects = []
            
            if not self.base_dir.exists():
                return projects
            
            for project_dir in self.base_dir.iterdir():
                if project_dir.is_dir():
                    project_info = await self._get_project_info(project_dir.name)
                    if project_info:
                        projects.append(project_info)
            
            logger.info(f"Found {len(projects)} projects")
            return projects
            
        except Exception as e:
            logger.error(f"Error listing projects: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to list projects: {str(e)}")
    
    async def get_project_versions(self, project_id: str) -> List[VersionInfo]:
        """
        Get all versions for a project
        
        Args:
            project_id: Project identifier
            
        Returns:
            List of version information
        """
        try:
            logger.info(f"Getting versions for project: {project_id}")
            versions = []
            
            project_path = self.base_dir / project_id
            if not project_path.exists():
                raise HTTPException(status_code=404, detail="Project not found")
            
            for version_dir in project_path.iterdir():
                if version_dir.is_dir():
                    version_info = await self._get_version_info(project_id, version_dir.name)
                    if version_info:
                        versions.append(version_info)
            
            # Sort versions by creation time
            versions.sort(key=lambda v: v.created_at, reverse=True)
            
            logger.info(f"Found {len(versions)} versions for project {project_id}")
            return versions
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting project versions: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to get project versions: {str(e)}")
    
    async def get_execution_info(self, project_id: str, version: str, execution_id: str) -> ExecutionInfo:
        """
        Get information about a specific execution
        
        Args:
            project_id: Project identifier
            version: Project version
            execution_id: Execution identifier
            
        Returns:
            Execution information
        """
        try:
            logger.info(f"Getting execution info: {project_id}/{version}/{execution_id}")
            
            execution_path = build_storage_path(self.base_dir, project_id, version, execution_id)
            if not execution_path.exists():
                raise HTTPException(status_code=404, detail="Execution not found")
            
            # Load all artifacts for this execution
            artifacts = []
            total_size = 0
            
            metadata_files = list(execution_path.glob("*.metadata.json"))
            for metadata_file in metadata_files:
                metadata = await self._load_metadata_from_file(metadata_file)
                if metadata:
                    artifacts.append(metadata)
                    total_size += metadata.file_size
            
            # Get creation time from directory
            created_at = datetime.fromtimestamp(execution_path.stat().st_ctime)
            
            execution_info = ExecutionInfo(
                project_id=project_id,
                version=version,
                execution_id=execution_id,
                artifacts=artifacts,
                created_at=created_at,
                total_size=total_size
            )
            
            logger.info(f"Found {len(artifacts)} artifacts for execution {execution_id}")
            return execution_info
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting execution info: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to get execution info: {str(e)}")
    
    async def get_storage_stats(self) -> StorageStats:
        """
        Get storage system statistics
        
        Returns:
            Storage statistics
        """
        try:
            logger.info("Calculating storage statistics")
            
            total_projects = 0
            total_versions = 0
            total_executions = 0
            total_artifacts = 0
            total_size = 0
            oldest_artifact = None
            newest_artifact = None
            
            if not self.base_dir.exists():
                return StorageStats(
                    total_projects=0,
                    total_versions=0, 
                    total_executions=0,
                    total_artifacts=0,
                    total_size=0
                )
            
            for project_dir in self.base_dir.iterdir():
                if project_dir.is_dir():
                    total_projects += 1
                    
                    for version_dir in project_dir.iterdir():
                        if version_dir.is_dir():
                            total_versions += 1
                            
                            for execution_dir in version_dir.iterdir():
                                if execution_dir.is_dir():
                                    total_executions += 1
                                    
                                    # Count artifacts and calculate total size
                                    for file_path in execution_dir.iterdir():
                                        if file_path.is_file() and not file_path.name.endswith('.metadata.json'):
                                            total_artifacts += 1
                                            file_size = file_path.stat().st_size
                                            total_size += file_size
                                            
                                            # Track oldest and newest artifacts
                                            file_mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                                            if oldest_artifact is None or file_mtime < oldest_artifact:
                                                oldest_artifact = file_mtime
                                            if newest_artifact is None or file_mtime > newest_artifact:
                                                newest_artifact = file_mtime
            
            stats = StorageStats(
                total_projects=total_projects,
                total_versions=total_versions,
                total_executions=total_executions,
                total_artifacts=total_artifacts,
                total_size=total_size,
                oldest_artifact=oldest_artifact,
                newest_artifact=newest_artifact
            )
            
            logger.info(f"Storage stats: {total_projects} projects, {total_artifacts} artifacts, {total_size} bytes")
            return stats
            
        except Exception as e:
            logger.error(f"Error calculating storage stats: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to calculate storage stats: {str(e)}")
    
    async def delete_artifact(self, project_id: str, version: str, execution_id: str, file_type: str) -> bool:
        """
        Delete a specific artifact
        
        Args:
            project_id: Project identifier
            version: Project version
            execution_id: Execution identifier
            file_type: Type of file to delete
            
        Returns:
            True if deleted successfully
        """
        try:
            logger.info(f"Deleting artifact: {project_id}/{version}/{execution_id}/{file_type}")
            
            # Build storage path
            storage_path = build_storage_path(self.base_dir, project_id, version, execution_id)
            
            # Create file path
            file_name = file_type
            if not file_name.endswith(get_file_extension(file_type)):
                file_name += get_file_extension(file_type)
            
            file_path = storage_path / file_name
            metadata_path = storage_path / f"{file_type}.metadata.json"
            
            # Check if file exists
            if not file_path.exists():
                raise HTTPException(status_code=404, detail="Artifact not found")
            
            # Delete files
            file_path.unlink()
            if metadata_path.exists():
                metadata_path.unlink()
            
            logger.info(f"Artifact deleted successfully: {file_path}")
            return True
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error deleting artifact: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to delete artifact: {str(e)}")
    
    async def _save_metadata(self, storage_path: Path, metadata: StorageMetadata) -> None:
        """Save metadata to a JSON file"""
        metadata_path = storage_path / f"{metadata.file_type}.metadata.json"
        async with aiofiles.open(metadata_path, 'w', encoding='utf-8') as f:
            await f.write(metadata.model_dump_json(indent=2))
    
    async def _load_metadata(self, storage_path: Path, file_type: str) -> Optional[StorageMetadata]:
        """Load metadata from a JSON file"""
        metadata_path = storage_path / f"{file_type}.metadata.json"
        if not metadata_path.exists():
            return None
        
        try:
            async with aiofiles.open(metadata_path, 'r', encoding='utf-8') as f:
                content = await f.read()
                data = json.loads(content)
                return StorageMetadata(**data)
        except Exception as e:
            logger.warning(f"Failed to load metadata from {metadata_path}: {e}")
            return None
    
    async def _load_metadata_from_file(self, metadata_path: Path) -> Optional[StorageMetadata]:
        """Load metadata from a specific metadata file"""
        if not metadata_path.exists():
            return None
        
        try:
            async with aiofiles.open(metadata_path, 'r', encoding='utf-8') as f:
                content = await f.read()
                data = json.loads(content)
                return StorageMetadata(**data)
        except Exception as e:
            logger.warning(f"Failed to load metadata from {metadata_path}: {e}")
            return None
    
    async def _get_project_info(self, project_id: str) -> Optional[ProjectInfo]:
        """Get information about a project"""
        try:
            project_path = self.base_dir / project_id
            if not project_path.exists():
                return None
            
            versions = []
            total_size = 0
            execution_count = 0
            created_at = datetime.fromtimestamp(project_path.stat().st_ctime)
            updated_at = created_at
            
            for version_dir in project_path.iterdir():
                if version_dir.is_dir():
                    versions.append(version_dir.name)
                    
                    # Update timestamps
                    version_mtime = datetime.fromtimestamp(version_dir.stat().st_mtime)
                    if version_mtime > updated_at:
                        updated_at = version_mtime
                    
                    # Calculate size and execution count
                    for execution_dir in version_dir.iterdir():
                        if execution_dir.is_dir():
                            execution_count += 1
                            for file_path in execution_dir.iterdir():
                                if file_path.is_file():
                                    total_size += file_path.stat().st_size
            
            # Sort versions
            versions.sort()
            latest_version = versions[-1] if versions else "unknown"
            
            return ProjectInfo(
                project_id=project_id,
                versions=versions,
                latest_version=latest_version,
                created_at=created_at,
                updated_at=updated_at,
                total_size=total_size,
                execution_count=execution_count
            )
        except Exception as e:
            logger.warning(f"Failed to get project info for {project_id}: {e}")
            return None
    
    async def _get_version_info(self, project_id: str, version: str) -> Optional[VersionInfo]:
        """Get information about a project version"""
        try:
            version_path = self.base_dir / project_id / version
            if not version_path.exists():
                return None
            
            executions = []
            artifact_count = 0
            total_size = 0
            created_at = datetime.fromtimestamp(version_path.stat().st_ctime)
            updated_at = created_at
            
            for execution_dir in version_path.iterdir():
                if execution_dir.is_dir():
                    executions.append(execution_dir.name)
                    
                    # Update timestamps
                    execution_mtime = datetime.fromtimestamp(execution_dir.stat().st_mtime)
                    if execution_mtime > updated_at:
                        updated_at = execution_mtime
                    
                    # Count artifacts and calculate size
                    for file_path in execution_dir.iterdir():
                        if file_path.is_file() and not file_path.name.endswith('.metadata.json'):
                            artifact_count += 1
                            total_size += file_path.stat().st_size
            
            return VersionInfo(
                project_id=project_id,
                version=version,
                executions=executions,
                created_at=created_at,
                updated_at=updated_at,
                artifact_count=artifact_count,
                total_size=total_size
            )
        except Exception as e:
            logger.warning(f"Failed to get version info for {project_id}/{version}: {e}")
            return None