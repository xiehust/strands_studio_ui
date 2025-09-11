/**
 * API Client for Strands UI Backend
 * Handles communication between frontend and FastAPI backend
 */

const API_BASE_URL = 'http://localhost:8000';

export interface ExecutionRequest {
  code: string;
  input_data?: string;
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
    onComplete: () => void,
    onError: (error: string) => void
  ): Promise<void> {
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

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const chunk = line.substring(6); // Remove 'data: ' prefix
            
            if (chunk === '[STREAM_COMPLETE]') {
              onComplete();
              return;
            } else if (chunk.startsWith('Error: ')) {
              onError(chunk.substring(7)); // Remove 'Error: ' prefix
              return;
            } else {
              onChunk(chunk);
            }
          }
        }
      }

      onComplete();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unknown streaming error');
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