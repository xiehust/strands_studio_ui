"""
Custom exceptions for the storage system
"""
from typing import Optional


class StorageError(Exception):
    """Base exception for storage-related errors"""
    
    def __init__(self, message: str, error_code: Optional[str] = None):
        self.message = message
        self.error_code = error_code
        super().__init__(self.message)


class ArtifactNotFoundError(StorageError):
    """Raised when an artifact is not found"""
    
    def __init__(self, project_id: str, version: str, execution_id: str, file_type: str):
        message = f"Artifact not found: {project_id}/{version}/{execution_id}/{file_type}"
        super().__init__(message, "ARTIFACT_NOT_FOUND")
        self.project_id = project_id
        self.version = version
        self.execution_id = execution_id
        self.file_type = file_type


class ProjectNotFoundError(StorageError):
    """Raised when a project is not found"""
    
    def __init__(self, project_id: str):
        message = f"Project not found: {project_id}"
        super().__init__(message, "PROJECT_NOT_FOUND")
        self.project_id = project_id


class VersionNotFoundError(StorageError):
    """Raised when a project version is not found"""
    
    def __init__(self, project_id: str, version: str):
        message = f"Version not found: {project_id}/{version}"
        super().__init__(message, "VERSION_NOT_FOUND")
        self.project_id = project_id
        self.version = version


class ExecutionNotFoundError(StorageError):
    """Raised when an execution is not found"""
    
    def __init__(self, project_id: str, version: str, execution_id: str):
        message = f"Execution not found: {project_id}/{version}/{execution_id}"
        super().__init__(message, "EXECUTION_NOT_FOUND")
        self.project_id = project_id
        self.version = version
        self.execution_id = execution_id


class InvalidPathError(StorageError):
    """Raised when a path is invalid or unsafe"""
    
    def __init__(self, path: str, reason: str = "Path is invalid or unsafe"):
        message = f"Invalid path '{path}': {reason}"
        super().__init__(message, "INVALID_PATH")
        self.path = path
        self.reason = reason


class InvalidFileTypeError(StorageError):
    """Raised when an invalid file type is specified"""
    
    def __init__(self, file_type: str, allowed_types: set):
        message = f"Invalid file type '{file_type}'. Allowed types: {', '.join(sorted(allowed_types))}"
        super().__init__(message, "INVALID_FILE_TYPE")
        self.file_type = file_type
        self.allowed_types = allowed_types


class StoragePermissionError(StorageError):
    """Raised when there are permission issues with storage operations"""
    
    def __init__(self, operation: str, path: str, reason: str = "Permission denied"):
        message = f"Permission error during {operation} on '{path}': {reason}"
        super().__init__(message, "STORAGE_PERMISSION_ERROR")
        self.operation = operation
        self.path = path
        self.reason = reason


class StorageCapacityError(StorageError):
    """Raised when storage capacity is exceeded"""
    
    def __init__(self, current_size: int, max_size: int):
        message = f"Storage capacity exceeded: {current_size} bytes (max: {max_size} bytes)"
        super().__init__(message, "STORAGE_CAPACITY_ERROR")
        self.current_size = current_size
        self.max_size = max_size


class MetadataCorruptionError(StorageError):
    """Raised when metadata is corrupted or invalid"""
    
    def __init__(self, metadata_path: str, reason: str = "Metadata is corrupted"):
        message = f"Metadata corruption in '{metadata_path}': {reason}"
        super().__init__(message, "METADATA_CORRUPTION")
        self.metadata_path = metadata_path
        self.reason = reason


class ChecksumMismatchError(StorageError):
    """Raised when file checksum doesn't match expected value"""
    
    def __init__(self, file_path: str, expected: str, actual: str):
        message = f"Checksum mismatch for '{file_path}': expected {expected}, got {actual}"
        super().__init__(message, "CHECKSUM_MISMATCH")
        self.file_path = file_path
        self.expected = expected
        self.actual = actual