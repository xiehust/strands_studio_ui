import { useState, useEffect } from 'react';
import { Play, RefreshCw, Trash2, X } from 'lucide-react';

interface DeploymentHistory {
  agent_runtime_arn: string;
  agent_runtime_name: string;
  invoke_endpoint: string;
  deployment_method: string;
  region: string;
  network_mode: string;
  saved_at: string;
}

interface InvokePanelProps {
  className?: string;
}

export function InvokePanel({ className = '' }: InvokePanelProps) {
  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentHistory[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<DeploymentHistory | null>(null);
  const [payload, setPayload] = useState('{"user_input": "Hello, Agent!"}');
  const [sessionId, setSessionId] = useState('');
  const [invokeResult, setInvokeResult] = useState<any>(null);
  const [isInvoking, setIsInvoking] = useState(false);
  const [enableStream, setEnableStream] = useState(false);
  const [streamContent, setStreamContent] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Generate a 33-character random session ID
  const generateSessionId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 33; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  // Load deployment history from localStorage
  const loadDeploymentHistory = () => {
    try {
      const saved = localStorage.getItem('agentcore_deployments');
      if (saved) {
        const deployments = JSON.parse(saved);
        setDeploymentHistory(deployments);
      }
    } catch (error) {
      console.error('Failed to load deployment history:', error);
    }
  };

  // Clear deployment history
  const clearDeploymentHistory = () => {
    localStorage.removeItem('agentcore_deployments');
    setDeploymentHistory([]);
    setSelectedAgent(null);
  };

  // Delete single agent from deployment history
  const deleteAgent = (agentArn: string) => {
    try {
      const saved = localStorage.getItem('agentcore_deployments');
      if (saved) {
        const deployments = JSON.parse(saved);
        const filteredDeployments = deployments.filter(
          (deployment: DeploymentHistory) => deployment.agent_runtime_arn !== agentArn
        );
        localStorage.setItem('agentcore_deployments', JSON.stringify(filteredDeployments));
        setDeploymentHistory(filteredDeployments);

        // If the deleted agent was selected, clear selection
        if (selectedAgent?.agent_runtime_arn === agentArn) {
          setSelectedAgent(null);
        }
      }
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  };

  // Handle streaming response
  const handleStreamingResponse = async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    setIsStreaming(true);
    setStreamContent([]);

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process SSE data
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6); // Remove "data: " prefix
            if (data.trim()) {
              setStreamContent(prev => [...prev, data]);
            }
          } else if (line.startsWith('event: error')) {
            throw new Error('Streaming error occurred');
          } else if (line.startsWith('event: end')) {
            return; // End of stream
          }
        }
      }
    } finally {
      setIsStreaming(false);
      reader.releaseLock();
    }
  };

  // Invoke agent
  const handleInvokeAgent = async () => {
    if (!selectedAgent || !payload || !sessionId) {
      return;
    }

    setIsInvoking(true);
    setInvokeResult(null);
    setStreamContent([]);

    try {
      // Parse payload as JSON
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(payload);
      } catch (error) {
        throw new Error('Invalid JSON payload');
      }

      const response = await fetch('/api/deploy/agentcore/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_runtime_arn: selectedAgent.agent_runtime_arn,
          runtime_session_id: sessionId,
          payload: parsedPayload,
          qualifier: 'DEFAULT',
          region: selectedAgent.region,
          enable_stream: enableStream
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Check response type
      const contentType = response.headers.get('content-type') || '';

      if (enableStream && contentType.includes('text/event-stream')) {
        // Handle streaming response
        await handleStreamingResponse(response);
      } else {
        // Handle JSON response
        const result = await response.json();
        setInvokeResult(result);
      }
    } catch (error) {
      console.error('Agent invocation failed:', error);
      setInvokeResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    } finally {
      setIsInvoking(false);
    }
  };

  // Load deployment history on component mount
  useEffect(() => {
    loadDeploymentHistory();
    // Generate initial session ID
    setSessionId(generateSessionId());
  }, []);

  return (
    <div className={`flex flex-col h-full bg-white border border-gray-200 rounded-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-blue-600" />
          <span className="font-medium text-gray-900">Invoke Agent</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadDeploymentHistory}
            className="p-1 text-gray-400 hover:text-gray-600"
            title="Refresh deployment history"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={clearDeploymentHistory}
            className="p-1 text-gray-400 hover:text-red-600"
            title="Clear deployment history"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {/* Agent Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Agent</label>
          {deploymentHistory.length === 0 ? (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-md text-center">
              <p className="text-sm text-gray-500">No deployed agents found</p>
              <p className="text-xs text-gray-400 mt-1">Deploy an agent first to see it here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {deploymentHistory.map((deployment) => (
                <div
                  key={deployment.agent_runtime_arn}
                  className={`p-3 border rounded-md cursor-pointer transition-colors ${
                    selectedAgent?.agent_runtime_arn === deployment.agent_runtime_arn
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedAgent(deployment)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-gray-900">
                          {deployment.agent_runtime_name}
                        </h3>
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                          {deployment.region}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {deployment.agent_runtime_arn}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAgent(deployment.agent_runtime_arn);
                      }}
                      className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                      title="Delete this agent"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent Details */}
        {selectedAgent && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="text-sm font-medium text-blue-900 mb-2">Agent Details</h4>
            <div className="space-y-1 text-xs text-blue-800">
              <p><strong>Name:</strong> {selectedAgent.agent_runtime_name}</p>
              <p><strong>Region:</strong> {selectedAgent.region}</p>
              <p><strong>Method:</strong> {selectedAgent.deployment_method}</p>
              <p><strong>Network:</strong> {selectedAgent.network_mode}</p>
              <p><strong>Deployed:</strong> {new Date(selectedAgent.saved_at).toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* Payload Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Payload (JSON)</label>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
            placeholder='{"user_input": "Hello, Agent!"}'
          />
        </div>

        {/* Session ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Session ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              placeholder="33+ character session ID"
            />
            <button
              onClick={() => setSessionId(generateSessionId())}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-md text-sm"
            >
              Generate
            </button>
          </div>
        </div>

        {/* Stream Options */}
        <div>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={enableStream}
              onChange={(e) => setEnableStream(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">Enable Streaming</span>
          </label>
          <p className="text-xs text-gray-500 mt-1">
            Enable real-time streaming response from the agent
          </p>
        </div>

        {/* Invoke Button */}
        <div>
          <button
            onClick={handleInvokeAgent}
            disabled={!selectedAgent || !payload || !sessionId || isInvoking}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isInvoking ? 'Invoking...' : 'Invoke Agent'}
          </button>
        </div>

        {/* Streaming Response */}
        {enableStream && (isStreaming || streamContent.length > 0) && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">
              Streaming Response
              {isStreaming && (
                <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse mr-1"></div>
                  Streaming...
                </span>
              )}
            </h4>
            <div className="bg-black text-green-400 p-3 rounded text-xs font-mono overflow-auto max-h-64">
              <div className="whitespace-pre-wrap">
                {streamContent.map((chunk, index) => (
                  <span key={index}>{chunk}</span>
                ))}
                {isStreaming && (
                  <span className="animate-pulse">▋</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Invoke Result */}
        {invokeResult && !enableStream && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">Invoke Result</h4>
            <div className="bg-black text-green-400 p-3 rounded text-xs font-mono overflow-auto max-h-64">
              <pre>{JSON.stringify(invokeResult, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
        <div className="flex justify-between">
          <span>Invoke • AgentCore Runtime</span>
          <span>{deploymentHistory.length} agent(s) available</span>
        </div>
      </div>
    </div>
  );
}
