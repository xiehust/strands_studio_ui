"""
Path utilities for safe filesystem operations
"""
import os
import re
import hashlib
from pathlib import Path
from typing import Optional


def sanitize_path_component(component: str) -> str:
    """
    Sanitize a path component to make it safe for filesystem use
    
    Args:
        component: The path component to sanitize
        
    Returns:
        Sanitized path component
    """
    if not component:
        raise ValueError("Path component cannot be empty")
    
    # Remove any directory traversal attempts
    component = component.replace("..", "").replace("/", "").replace("\\", "")
    
    # Keep only safe characters: alphanumeric, hyphens, underscores, and dots
    safe_component = re.sub(r'[^a-zA-Z0-9\-_.]', '_', component)
    
    # Ensure it's not empty after sanitization
    if not safe_component:
        raise ValueError("Path component became empty after sanitization")
    
    # Ensure it doesn't start with a dot (hidden files)
    if safe_component.startswith('.'):
        safe_component = 'file_' + safe_component[1:]
    
    return safe_component


def build_storage_path(base_dir: Path, project_id: str, version: str, execution_id: str) -> Path:
    """
    Build a safe storage path for artifacts
    
    Args:
        base_dir: Base storage directory
        project_id: Project identifier
        version: Project version
        execution_id: Execution identifier
        
    Returns:
        Safe storage path
    """
    safe_project = sanitize_path_component(project_id)
    safe_version = sanitize_path_component(version)
    safe_execution = sanitize_path_component(execution_id)
    
    return base_dir / safe_project / safe_version / safe_execution


def ensure_directory_exists(path: Path) -> None:
    """
    Ensure that a directory exists, creating it if necessary
    
    Args:
        path: Path to the directory
    """
    path.mkdir(parents=True, exist_ok=True)


def is_safe_path(path: Path, base_dir: Path) -> bool:
    """
    Check if a path is safe (within the base directory)
    
    Args:
        path: Path to check
        base_dir: Base directory that should contain the path
        
    Returns:
        True if path is safe, False otherwise
    """
    try:
        # Resolve both paths to handle any symbolic links or relative components
        resolved_path = path.resolve()
        resolved_base = base_dir.resolve()
        
        # Check if the path is within the base directory
        return resolved_path.is_relative_to(resolved_base)
    except (OSError, ValueError):
        return False


def calculate_file_checksum(file_path: Path) -> str:
    """
    Calculate SHA256 checksum of a file
    
    Args:
        file_path: Path to the file
        
    Returns:
        SHA256 checksum as hex string
    """
    sha256_hash = hashlib.sha256()
    try:
        with open(file_path, "rb") as f:
            # Read in chunks to handle large files efficiently
            for chunk in iter(lambda: f.read(4096), b""):
                sha256_hash.update(chunk)
        return f"sha256:{sha256_hash.hexdigest()}"
    except OSError as e:
        raise ValueError(f"Cannot calculate checksum for {file_path}: {e}")


def calculate_content_checksum(content: str) -> str:
    """
    Calculate SHA256 checksum of content string
    
    Args:
        content: Content to checksum
        
    Returns:
        SHA256 checksum as hex string
    """
    sha256_hash = hashlib.sha256()
    sha256_hash.update(content.encode('utf-8'))
    return f"sha256:{sha256_hash.hexdigest()}"


def get_file_extension(file_type: str) -> str:
    """
    Get the appropriate file extension for a given file type
    
    Args:
        file_type: The file type identifier
        
    Returns:
        File extension (including the dot)
    """
    extension_map = {
        'generate.py': '.py',
        'flow.json': '.json',
        'result.json': '.json',
        'metadata.json': '.json'
    }
    return extension_map.get(file_type, '.txt')


def validate_file_type(file_type: str) -> bool:
    """
    Validate if a file type is allowed
    
    Args:
        file_type: File type to validate
        
    Returns:
        True if file type is allowed, False otherwise
    """
    allowed_types = {'generate.py', 'flow.json', 'result.json', 'metadata.json'}
    return file_type in allowed_types