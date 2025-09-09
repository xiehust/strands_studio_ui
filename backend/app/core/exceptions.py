"""
Custom exceptions for the Agent Builder API.
"""

from typing import Any, Dict, Optional


class AgentBuilderException(Exception):
    """Base exception for Agent Builder API."""
    
    def __init__(
        self,
        message: str,
        error_code: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        self.message = message
        self.error_code = error_code
        self.details = details or {}
        super().__init__(self.message)


class WorkflowException(AgentBuilderException):
    """Exception related to workflow operations."""
    pass


class WorkflowNotFoundError(WorkflowException):
    """Raised when a workflow is not found."""
    
    def __init__(self, workflow_id: str):
        super().__init__(
            message=f"Workflow with ID '{workflow_id}' not found",
            error_code="WORKFLOW_NOT_FOUND",
            details={"workflow_id": workflow_id}
        )


class WorkflowValidationError(WorkflowException):
    """Raised when workflow validation fails."""
    
    def __init__(self, validation_errors: list):
        super().__init__(
            message="Workflow validation failed",
            error_code="WORKFLOW_VALIDATION_ERROR",
            details={"validation_errors": validation_errors}
        )


class CodeGenerationException(AgentBuilderException):
    """Exception related to code generation."""
    pass


class CodeGenerationError(CodeGenerationException):
    """Raised when code generation fails."""
    
    def __init__(self, reason: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=f"Code generation failed: {reason}",
            error_code="CODE_GENERATION_ERROR",
            details=details or {}
        )


class ComponentException(AgentBuilderException):
    """Exception related to component operations."""
    pass


class ComponentNotFoundError(ComponentException):
    """Raised when a component is not found."""
    
    def __init__(self, component_id: str):
        super().__init__(
            message=f"Component with ID '{component_id}' not found",
            error_code="COMPONENT_NOT_FOUND",
            details={"component_id": component_id}
        )


class ComponentRegistryError(ComponentException):
    """Raised when component registry operations fail."""
    
    def __init__(self, reason: str):
        super().__init__(
            message=f"Component registry error: {reason}",
            error_code="COMPONENT_REGISTRY_ERROR"
        )


class ExecutionException(AgentBuilderException):
    """Exception related to agent execution."""
    pass


class AgentExecutionError(ExecutionException):
    """Raised when agent execution fails."""
    
    def __init__(self, reason: str, process_id: Optional[str] = None):
        super().__init__(
            message=f"Agent execution failed: {reason}",
            error_code="AGENT_EXECUTION_ERROR",
            details={"process_id": process_id} if process_id else {}
        )


class DependencyError(AgentBuilderException):
    """Raised when required dependencies are missing."""
    
    def __init__(self, missing_dependencies: list):
        super().__init__(
            message=f"Missing required dependencies: {', '.join(missing_dependencies)}",
            error_code="MISSING_DEPENDENCIES",
            details={"missing_dependencies": missing_dependencies}
        )


class StorageException(AgentBuilderException):
    """Exception related to storage operations."""
    pass


class StorageError(StorageException):
    """Raised when storage operations fail."""
    
    def __init__(self, operation: str, reason: str):
        super().__init__(
            message=f"Storage operation '{operation}' failed: {reason}",
            error_code="STORAGE_ERROR",
            details={"operation": operation, "reason": reason}
        )