// Input validation utilities for security

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates project ID format to prevent path traversal attacks
 */
export const validateProjectId = (projectId: string): boolean => {
  // Allow alphanumeric characters, hyphens, underscores, and dots
  // Prevent directory traversal patterns
  const validPattern = /^[a-zA-Z0-9\-_.]{1,50}$/;
  const invalidPatterns = [
    /\.\./,  // Directory traversal
    /\/\//,  // Double slashes
    /^\./,   // Starting with dot
    /\.$/,   // Ending with dot
  ];

  if (!validPattern.test(projectId)) {
    return false;
  }

  return !invalidPatterns.some(pattern => pattern.test(projectId));
};

/**
 * Validates version format
 */
export const validateVersion = (version: string): boolean => {
  // Allow semantic versioning and simple version strings
  const validPattern = /^[a-zA-Z0-9\-_.]{1,20}$/;
  const invalidPatterns = [
    /\.\./,  // Directory traversal
    /\/\//,  // Double slashes
  ];

  if (!validPattern.test(version)) {
    return false;
  }

  return !invalidPatterns.some(pattern => pattern.test(version));
};

/**
 * Validates execution ID format
 */
export const validateExecutionId = (executionId: string): boolean => {
  // Allow alphanumeric, hyphens, underscores
  const validPattern = /^[a-zA-Z0-9\-_]{1,100}$/;
  const invalidPatterns = [
    /\.\./,  // Directory traversal
    /\/\//,  // Double slashes
  ];

  if (!validPattern.test(executionId)) {
    return false;
  }

  return !invalidPatterns.some(pattern => pattern.test(executionId));
};

/**
 * Validates file type
 */
export const validateFileType = (fileType: string): boolean => {
  const allowedTypes = ['generate.py', 'flow.json', 'result.json', 'metadata.json'];
  return allowedTypes.includes(fileType);
};

/**
 * Sanitizes and validates all path components
 */
export const validatePathComponents = (
  projectId: string, 
  version: string, 
  executionId: string, 
  fileType: string
): void => {
  if (!validateProjectId(projectId)) {
    throw new ValidationError(`Invalid project ID format: ${projectId}`);
  }
  
  if (!validateVersion(version)) {
    throw new ValidationError(`Invalid version format: ${version}`);
  }
  
  if (!validateExecutionId(executionId)) {
    throw new ValidationError(`Invalid execution ID format: ${executionId}`);
  }
  
  if (!validateFileType(fileType)) {
    throw new ValidationError(`Invalid file type: ${fileType}`);
  }
};

/**
 * Validates project ID only
 */
export const validateProjectOnly = (projectId: string): void => {
  if (!validateProjectId(projectId)) {
    throw new ValidationError(`Invalid project ID format: ${projectId}`);
  }
};

/**
 * Validates project ID and version
 */
export const validateProjectAndVersion = (projectId: string, version: string): void => {
  if (!validateProjectId(projectId)) {
    throw new ValidationError(`Invalid project ID format: ${projectId}`);
  }
  
  if (!validateVersion(version)) {
    throw new ValidationError(`Invalid version format: ${version}`);
  }
};

/**
 * Type guard for execution result
 */
export const isExecutionResult = (obj: unknown): obj is { 
  success: boolean; 
  output: string; 
  execution_time: number; 
  timestamp: string; 
} => {
  return typeof obj === 'object' && 
         obj !== null &&
         typeof (obj as Record<string, unknown>).success === 'boolean' &&
         typeof (obj as Record<string, unknown>).output === 'string' &&
         typeof (obj as Record<string, unknown>).execution_time === 'number' &&
         typeof (obj as Record<string, unknown>).timestamp === 'string';
};

/**
 * Type guard for artifact content
 */
export const isArtifactContent = (obj: unknown): obj is {
  content: string;
  metadata: Record<string, unknown>;
} => {
  return typeof obj === 'object' &&
         obj !== null &&
         typeof (obj as Record<string, unknown>).content === 'string' &&
         (obj as Record<string, unknown>).metadata !== undefined;
};