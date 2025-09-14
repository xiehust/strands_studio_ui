/**
 * API Client for Strands UI Backend
 * Handles communication between frontend and FastAPI backend
 */

import { validatePathComponents, validateProjectOnly, validateProjectAndVersion, ValidationError } from './validation';

// Dynamic API base URL configuration
const getApiBaseUrl = (): string => {
  // First check for environment variable (set at build time)
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  // For development, use localhost
  if (import.meta.env.DEV) {
    return 'http://localhost:8000';
  }

  // For production, dynamically construct based on current host
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;

  // If accessing via localhost in production, use localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8000';
  }

  // Handle ALB (Application Load Balancer) scenarios
  if (hostname.includes('.elb.amazonaws.com') || hostname.includes('.amazonaws.com')) {
    // For ALB, assume it's configured to proxy both frontend and backend
    // Use the same protocol and host, but backend port 8000
    return `${protocol}//${hostname}:8000`;
  }

  // For direct EC2 access or other cloud providers, use same host with backend port
  return `${protocol}//${hostname}:8000`;
};

const API_BASE_URL = getApiBaseUrl();

export interface ExecutionRequest {
  code: string;
  input_data?: string;
  project_id?: string;
  version?: string;
  flow_data?: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  // API Keys for secure environment variable handling
  openai_api_key?: string;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  execution_time: number;
  timestamp: string;
}

export interface ExecutionResponse {
  execution_id: string;
  result: ExecutionResult;
}

export interface ExecutionHistoryItem {
  execution_id: string;
  project_id?: string;
  version?: string;
  result: ExecutionResult;
  code?: string;
  input_data?: string;
  created_at: string;
}

export interface ExecutionHistoryResponse {
  executions: ExecutionHistoryItem[];
}

export interface ProjectData {
  id: string;
  name: string;
  description?: string;
  nodes: any[];
  edges: any[];
  createdAt: string;
  updatedAt: string;
  version: string;
}

// Storage API Types
export interface StorageMetadata {
  project_id: string;
  version: string;
  execution_id: string;
  timestamp: string;
  file_type: string;
  file_size: number;
  file_path: string;
  checksum?: string;
}

export interface ArtifactRequest {
  project_id: string;
  version: string;
  execution_id: string;
  content: string;
  file_type: 'generate.py' | 'flow.json' | 'result.json' | 'metadata.json';
}

export interface ArtifactResponse {
  success: boolean;
  message: string;
  metadata?: StorageMetadata;
  file_path?: string;
}

export interface ArtifactContent {
  content: string;
  metadata: StorageMetadata;
}

export interface ProjectInfo {
  project_id: string;
  versions: string[];
  latest_version: string;
  created_at: string;
  updated_at: string;
  total_size: number;
  execution_count: number;
}

export interface VersionInfo {
  project_id: string;
  version: string;
  executions: string[];
  created_at: string;
  updated_at: string;
  artifact_count: number;
  total_size: number;
}

export interface ExecutionInfo {
  project_id: string;
  version: string;
  execution_id: string;
  artifacts: StorageMetadata[];
  created_at: string;
  total_size: number;
}

export interface StorageStats {
  total_projects: number;
  total_versions: number;
  total_executions: number;
  total_artifacts: number;
  total_size: number;
  oldest_artifact?: string;
  newest_artifact?: string;
}

class ApiClient {
  private baseUrl: string;
  private wsConnection: WebSocket | null = null;
  private wsListeners: Set<(data: any) => void> = new Set();

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Health check
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request('/health');
  }

  // Project Management
  async getProjects(): Promise<{ projects: ProjectData[] }> {
    return this.request('/api/projects');
  }

  async getProject(projectId: string): Promise<ProjectData> {
    return this.request(`/api/projects/${projectId}`);
  }

  async createProject(project: ProjectData): Promise<ProjectData> {
    return this.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(project),
    });
  }

  async updateProject(projectId: string, project: ProjectData): Promise<ProjectData> {
    return this.request(`/api/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(project),
    });
  }

  async deleteProject(projectId: string): Promise<{ message: string }> {
    return this.request(`/api/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  // Code Execution
  async executeCode(request: ExecutionRequest): Promise<ExecutionResponse> {
    console.log('API Client: Using regular execution endpoint /api/execute');
    return this.request('/api/execute', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getExecutionResult(executionId: string): Promise<ExecutionResult> {
    return this.request(`/api/execution/${executionId}`);
  }

  // Streaming Code Execution
  async executeCodeStream(
    request: ExecutionRequest,
    onChunk: (chunk: string) => void,
    onComplete: (finalOutput: string, executionTime?: number) => void,
    onError: (error: string, partialOutput: string, executionTime?: number) => void
  ): Promise<void> {
    console.log('API Client: Using streaming execution endpoint /api/execute/stream');
    try {
      const response = await fetch(`${this.baseUrl}/api/execute/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Streaming request failed: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedOutput = '';
      let errorMessage: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (separated by \n\n)
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep incomplete event in buffer

        for (const event of events) {
          if (!event.trim()) continue; // Skip empty events

          // Collect all data fields in this event
          let eventData = '';
          const lines = event.split('\n');

          // Simply concatenate all data field values, treating empty fields as newlines
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const chunk = line.substring(6); // Remove 'data: ' prefix
              eventData += (chunk === '' ? '\n' : chunk);
            } else if (line === 'data:') {
              // Handle "data:" with no space - represents empty data field (newline)
              eventData += '\n';
            }
          }

          // Process the accumulated event data
          if (eventData !== '' || lines.some(line => line === 'data:' || line.startsWith('data: '))) {
            if (eventData === '[STREAM_COMPLETE]') {
              if (errorMessage) {
                onError(errorMessage, accumulatedOutput);
              } else {
                onComplete(accumulatedOutput);
              }
              return;
            } else if (eventData.startsWith('[STREAM_COMPLETE:')) {
              // Parse execution time from format: [STREAM_COMPLETE:10.234]
              const match = eventData.match(/^\[STREAM_COMPLETE:([\d.]+)\]$/);
              const executionTime = match ? parseFloat(match[1]) : undefined;
              if (errorMessage) {
                onError(errorMessage, accumulatedOutput, executionTime);
              } else {
                onComplete(accumulatedOutput, executionTime);
              }
              return;
            } else if (eventData.startsWith('Error: ')) {
              // Store error message but don't return immediately - wait for completion signal with timing
              errorMessage = eventData.substring(7); // Remove 'Error: ' prefix
            } else {
              // Process the event data
              accumulatedOutput += eventData;
              onChunk(eventData);
            }
          }
        }
      }

      onComplete(accumulatedOutput);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unknown streaming error', '');
    }
  }

  // WebSocket connection for real-time updates
  connectWebSocket(): void {
    if (this.wsConnection) {
      this.wsConnection.close();
    }

    const wsUrl = this.baseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    this.wsConnection = new WebSocket(`${wsUrl}/ws`);

    this.wsConnection.onopen = () => {
      console.log('WebSocket connected');
    };

    this.wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.wsListeners.forEach(listener => listener(data));
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.wsConnection.onclose = () => {
      console.log('WebSocket disconnected');
    };

    this.wsConnection.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  disconnectWebSocket(): void {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
  }

  addWebSocketListener(listener: (data: any) => void): void {
    this.wsListeners.add(listener);
  }

  removeWebSocketListener(listener: (data: any) => void): void {
    this.wsListeners.delete(listener);
  }

  // Storage API Methods
  async saveArtifact(request: ArtifactRequest): Promise<ArtifactResponse> {
    return this.request('/api/storage/artifacts', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getArtifact(projectId: string, version: string, executionId: string, fileType: string): Promise<ArtifactContent> {
    validatePathComponents(projectId, version, executionId, fileType);
    return this.request(`/api/storage/artifacts/${projectId}/${version}/${executionId}/${fileType}`);
  }

  async downloadArtifact(projectId: string, version: string, executionId: string, fileType: string): Promise<Blob> {
    validatePathComponents(projectId, version, executionId, fileType);
    const url = `${this.baseUrl}/api/storage/artifacts/${projectId}/${version}/${executionId}/${fileType}/download`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    
    return response.blob();
  }

  async deleteArtifact(projectId: string, version: string, executionId: string, fileType: string): Promise<{ message: string }> {
    validatePathComponents(projectId, version, executionId, fileType);
    return this.request(`/api/storage/artifacts/${projectId}/${version}/${executionId}/${fileType}`, {
      method: 'DELETE',
    });
  }

  async getStorageProjects(): Promise<ProjectInfo[]> {
    return this.request('/api/storage/projects');
  }

  async getProjectVersions(projectId: string): Promise<VersionInfo[]> {
    validateProjectOnly(projectId);
    return this.request(`/api/storage/projects/${projectId}/versions`);
  }

  async getExecutionInfo(projectId: string, version: string, executionId: string): Promise<ExecutionInfo> {
    validateProjectAndVersion(projectId, version);
    if (!executionId || !/^[a-zA-Z0-9\-_]{1,100}$/.test(executionId)) {
      throw new ValidationError(`Invalid execution ID format: ${executionId}`);
    }
    return this.request(`/api/storage/projects/${projectId}/versions/${version}/executions/${executionId}`);
  }

  async getStorageStats(): Promise<StorageStats> {
    return this.request('/api/storage/stats');
  }

  // Enhanced execution history methods - for getting ExecutionInfo (storage metadata)
  async getExecutionHistory(projectId?: string, version?: string): Promise<ExecutionInfo[]> {
    try {
      // Get storage projects first
      const projects = await this.getStorageProjects();
      const allExecutions: ExecutionInfo[] = [];
      
      for (const project of projects) {
        // If projectId specified, filter to that project
        if (projectId && project.project_id !== projectId) continue;
        
        // Get project versions
        const versions = await this.getProjectVersions(project.project_id);
        for (const versionInfo of versions) {
          // If version specified, filter to that version
          if (version && versionInfo.version !== version) continue;
          
          // Get executions for this version
          for (const executionId of versionInfo.executions) {
            try {
              const executionInfo = await this.getExecutionInfo(project.project_id, versionInfo.version, executionId);
              allExecutions.push(executionInfo);
            } catch (error) {
              console.warn(`Failed to get execution ${executionId}:`, error);
            }
          }
        }
      }
      
      // Sort by created_at desc
      allExecutions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      return allExecutions.slice(0, 50); // Limit to 50
    } catch (error) {
      console.error('Failed to get execution history:', error);
      return [];
    }
  }

  // New method for getting ExecutionHistoryItem (with actual results)  
  async getExecutionHistoryItems(projectId?: string, version?: string): Promise<ExecutionHistoryItem[]> {
    try {
      // Use the backend execution history endpoint which returns ExecutionHistoryItem[]
      const params = new URLSearchParams();
      if (projectId) params.append('project_id', projectId);
      if (version) params.append('version', version);
      params.append('limit', '50');
      
      const url = `/api/execution-history${params.toString() ? '?' + params.toString() : ''}`;
      const response = await this.request<ExecutionHistoryResponse>(url);

      // The backend returns { executions: ExecutionHistoryItem[] }
      if (response && Array.isArray(response.executions)) {
        return response.executions;
      }
      
      return [];
    } catch (error) {
      console.error('Failed to get execution history items:', error);
      return [];
    }
  }

  // Execution History Methods
  async saveExecutionHistory(item: ExecutionHistoryItem): Promise<{ message: string; execution_id: string }> {
    return this.request('/api/execution-history', {
      method: 'POST',
      body: JSON.stringify(item),
    });
  }

  async getSimpleExecutionHistory(
    projectId?: string,
    version?: string,
    limit?: number
  ): Promise<{ executions: ExecutionHistoryItem[] }> {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', projectId);
    if (version) params.append('version', version);
    if (limit) params.append('limit', limit.toString());
    
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/api/execution-history${query}`);
  }

  async getExecutionHistoryItem(executionId: string): Promise<ExecutionHistoryItem> {
    return this.request(`/api/execution-history/${executionId}`);
  }

  async deleteExecutionHistoryItem(executionId: string): Promise<{ message: string }> {
    return this.request(`/api/execution-history/${executionId}`, {
      method: 'DELETE',
    });
  }

  // Utility method to check if backend is available
  async isBackendAvailable(): Promise<boolean> {
    try {
      await this.healthCheck();
      return true;
    } catch (error) {
      console.warn('Backend not available:', error);
      return false;
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default ApiClient;

// Utility functions for working with storage data
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString();
};

export const formatTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

export const getFileTypeIcon = (fileType: string): string => {
  switch (fileType) {
    case 'generate.py': return '🐍';
    case 'flow.json': return '🔄';
    case 'result.json': return '📊';
    case 'metadata.json': return '📋';
    default: return '📄';
  }
};