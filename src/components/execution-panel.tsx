import { useState, useEffect, useCallback } from 'react';
import { Play, Square, Loader, CheckCircle, XCircle, Clock, Terminal, Zap, FolderOpen, FileText, AlertTriangle, RefreshCw } from 'lucide-react';
import { apiClient, type ExecutionRequest, type ExecutionResult, type ExecutionHistoryItem } from '../lib/api-client';
import { ValidationError, isExecutionResult } from '../lib/validation';

interface ExecutionPanelProps {
  code: string;
  className?: string;
  projectId?: string;
  projectName?: string;
  projectVersion?: string;
  flowData?: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
}


// Utility functions for localStorage
const getStoredInputData = (): string => {
  try {
    return localStorage.getItem('execution-panel-input-data') || '';
  } catch (error) {
    console.warn('Failed to read input data from localStorage:', error);
    return '';
  }
};

const setStoredInputData = (data: string): void => {
  try {
    localStorage.setItem('execution-panel-input-data', data);
  } catch (error) {
    console.warn('Failed to save input data to localStorage:', error);
  }
};

export function ExecutionPanel({ 
  code, 
  className = '', 
  projectName = 'Untitled Project',
  projectVersion = '1.0.0',
  flowData
}: ExecutionPanelProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentExecution, setCurrentExecution] = useState<ExecutionResult | null>(null);
  const [inputData, setInputData] = useState(() => getStoredInputData()); // Initialize from localStorage
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [streamStartTime, setStreamStartTime] = useState<Date | null>(null);
  const [storedExecutions, setStoredExecutions] = useState<ExecutionHistoryItem[]>([]);
  const [loadingStoredExecutions, setLoadingStoredExecutions] = useState(false);
  const [selectedStoredExecution, setSelectedStoredExecution] = useState<ExecutionHistoryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Check backend availability on mount
  useEffect(() => {
    checkBackendHealth();
  }, []);

  // Load stored executions when backend becomes available
  useEffect(() => {
    if (backendAvailable) {
      loadStoredExecutions();
    }
  }, [backendAvailable, projectName, projectVersion]);

  const saveExecutionToHistory = async (executionId: string, result: ExecutionResult, code: string, inputData?: string) => {
    try {
      const historyItem: ExecutionHistoryItem = {
        execution_id: executionId,
        project_id: projectName,
        version: projectVersion,
        result: result,
        code: code,
        input_data: inputData,
        created_at: new Date().toISOString()
      };
      
      await apiClient.saveExecutionHistory(historyItem);
    } catch (error) {
      console.error('Failed to save execution to history:', error);
    }
  };

  const saveExecutionArtifacts = async (executionId: string, result: ExecutionResult, code: string, inputData?: string) => {
    if (!projectName) return;
    
    try {
      // Save generated code artifact
      await apiClient.saveArtifact({
        project_id: projectName,
        version: projectVersion,
        execution_id: executionId,
        content: code,
        file_type: 'generate.py'
      });

      // Save execution result artifact
      await apiClient.saveArtifact({
        project_id: projectName,
        version: projectVersion,
        execution_id: executionId,
        content: JSON.stringify(result, null, 2),
        file_type: 'result.json'
      });

      // Save flow data if available
      if (flowData) {
        await apiClient.saveArtifact({
          project_id: projectName,
          version: projectVersion,
          execution_id: executionId,
          content: JSON.stringify(flowData, null, 2),
          file_type: 'flow.json'
        });
      }

      // Save metadata
      const metadata = {
        project_id: projectName,
        version: projectVersion,
        execution_id: executionId,
        timestamp: result.timestamp,
        success: result.success,
        execution_time: result.execution_time,
        input_data: inputData,
        has_flow_data: !!flowData
      };
      
      await apiClient.saveArtifact({
        project_id: projectName,
        version: projectVersion,
        execution_id: executionId,
        content: JSON.stringify(metadata, null, 2),
        file_type: 'metadata.json'
      });

      console.log(`Artifacts saved for execution ${executionId}`);
      setStorageError(null); // Clear any previous storage errors
    } catch (error) {
      console.error('Failed to save execution artifacts:', error);
      const message = error instanceof ValidationError ? error.message : 
                      error instanceof Error ? error.message : 'Failed to save execution artifacts';
      setStorageError(`Storage failed: ${message}`);
    }
  };

  const loadStoredExecutions = async () => {
    if (!projectName) return;
    
    setLoadingStoredExecutions(true);
    try {
      // Use the optimized endpoint that returns execution results in a single call
      const executions = await apiClient.getExecutionHistoryItems(projectName, projectVersion);
      setStoredExecutions(executions);
      setStorageError(null); // Clear any previous storage errors
    } catch (error) {
      console.error('Failed to load stored executions:', error);
      const message = error instanceof ValidationError ? error.message : 
                      error instanceof Error ? error.message : 'Failed to load execution history';
      setStorageError(`Load failed: ${message}`);
    } finally {
      setLoadingStoredExecutions(false);
    }
  };


  const loadStoredExecutionResult = (execution: ExecutionHistoryItem) => {
    try {
      // ExecutionHistoryItem already includes the result and input_data, no need for additional API calls
      if (!isExecutionResult(execution.result)) {
        throw new Error('Invalid execution result format');
      }
      
      setCurrentExecution(execution.result);
      setSelectedStoredExecution(execution);
      setError(null); // Clear any previous errors

      // Set input data from the execution history item
      if (execution.input_data !== undefined && execution.input_data !== null) {
        setInputData(execution.input_data || ''); // Handle empty string case
        // Don't update localStorage when loading stored execution data
        // Let user manually save if they want to persist it
      } else {
        // Clear input data if stored execution had no input
        setInputData('');
      }
    } catch (error) {
      console.error('Failed to load stored execution result:', error);
      const message = error instanceof Error ? error.message : 'Failed to load execution result';
      setError(`Load failed: ${message}`);
    }
  };

  // Set up WebSocket connection for real-time updates
  useEffect(() => {
    apiClient.connectWebSocket();
    
    const handleWebSocketMessage = (data: any) => {
      if (data.type === 'execution_complete') {
        console.log(`WebSocket: Setting execution complete for ${data.execution_id}`);
        setIsExecuting(false);
        setCurrentExecution(data.result);
        
        // Log execution completion
        console.log(`Execution completed via WebSocket: ${data.execution_id}`);
      }
    };

    apiClient.addWebSocketListener(handleWebSocketMessage);

    return () => {
      apiClient.removeWebSocketListener(handleWebSocketMessage);
      apiClient.disconnectWebSocket();
    };
  }, []);

  const checkBackendHealth = async () => {
    const available = await apiClient.isBackendAvailable();
    setBackendAvailable(available);
  };

  // Check if the code has streaming enabled
  const hasStreamingEnabled = useCallback(() => {
    const hasYield = code.includes('yield event["data"]') || code.includes('yield') || code.includes('stream_async');
    const hasStreamingComment = code.includes('# Execute agent with streaming');
    
    // Also check if any agent nodes have streaming enabled in flowData
    const hasStreamingAgent = flowData?.nodes?.some(node => 
      (node.type === 'agent' || node.type === 'orchestrator-agent') && 
      (node.data as any)?.streaming === true
    ) || false;
    
    // console.log('Streaming detection:', { 
    //   hasYield, 
    //   hasStreamingComment, 
    //   hasStreamingAgent, 
    //   flowDataNodesCount: flowData?.nodes?.length || 0 
    // });
    
    return hasYield || hasStreamingComment || hasStreamingAgent;
  }, [code, flowData]);

  const handleExecute = async () => {
    if (!code.trim()) {
      setError('No code to execute');
      return;
    }

    if (!backendAvailable) {
      setError('Backend server is not available. Please make sure the server is running on port 8000.');
      return;
    }

    // Clear any previous errors
    setError(null);
    setStorageError(null);

    setIsExecuting(true);
    setCurrentExecution(null);
    
    // Extract API keys from agent nodes for secure backend handling
    const extractApiKeys = () => {
      const allNodes = flowData?.nodes || [];
      const agentNodes = allNodes.filter(node => 
        node.type === 'agent' || node.type === 'orchestrator-agent'
      );
      
      // Find first OpenAI API key from any agent node
      for (const node of agentNodes) {
        const nodeData = node.data as any;
        if (nodeData?.modelProvider === 'OpenAI' && nodeData?.apiKey) {
          return { openai_api_key: nodeData.apiKey };
        }
      }
      return {};
    };
    
    const apiKeys = extractApiKeys();
    
    const request: ExecutionRequest = {
      code: code,
      input_data: inputData.trim() || undefined,
      project_id: projectName,
      version: projectVersion,
      flow_data: flowData,
      ...apiKeys,
    };

    // Check if streaming is enabled in the generated code
    const streamingEnabled = hasStreamingEnabled();
    console.log('Execution decision:', { 
      streamingEnabled, 
      codeLength: code.length, 
      codeSnippet: code.substring(0, 200) + '...' 
    });

    if (streamingEnabled) {
      // Use streaming execution
      setIsStreaming(true);
      setStreamingOutput('');
      setStreamStartTime(new Date());

      try {
        await apiClient.executeCodeStream(
          request,
          (chunk: string) => {
            // Handle streaming chunk
            console.log('Chunk:', JSON.stringify(chunk), 'Has \\n:', chunk.includes('\n'));
            setStreamingOutput(prev => prev + chunk);
          },
          (finalOutput: string, backendExecutionTime?: number) => {
            // Handle completion
            setIsExecuting(false);
            setIsStreaming(false);
            
            // Use backend execution time if provided, otherwise fallback to frontend calculation
            const executionTime = backendExecutionTime ?? (streamStartTime ? 
              (new Date().getTime() - streamStartTime.getTime()) / 1000 : 0);
            
            console.log('Streaming completion:', {
              backendExecutionTime,
              frontendCalculatedTime: streamStartTime ? (new Date().getTime() - streamStartTime.getTime()) / 1000 : 0,
              usingExecutionTime: executionTime
            });

            const result: ExecutionResult = {
              success: true,
              output: finalOutput,
              execution_time: Math.max(executionTime, 0.001), // Ensure at least 1ms
              timestamp: streamStartTime?.toISOString() || new Date().toISOString(),
            };
            
            setCurrentExecution(result);
            
            // Log execution completion
            console.log(`Streaming execution completed: ${Date.now()}`);
            
            // Save to backend history and artifacts
            const executionId = Date.now().toString();
            saveExecutionToHistory(executionId, result, code, inputData);
            saveExecutionArtifacts(executionId, result, code, inputData);
          },
          (error: string, partialOutput: string, backendExecutionTime?: number) => {
            // Handle error
            setIsExecuting(false);
            setIsStreaming(false);
            
            // Use backend execution time if provided, otherwise fallback to frontend calculation
            const executionTime = backendExecutionTime ?? (streamStartTime ? 
              (new Date().getTime() - streamStartTime.getTime()) / 1000 : 0);

            const errorResult: ExecutionResult = {
              success: false,
              output: partialOutput,
              error: error,
              execution_time: Math.max(executionTime, 0.001), // Ensure at least 1ms
              timestamp: streamStartTime?.toISOString() || new Date().toISOString(),
            };
            
            setCurrentExecution(errorResult);
            
            // Save error to backend history and artifacts
            const errorLogId = Date.now().toString();
            saveExecutionToHistory(errorLogId, errorResult, code, inputData);
            saveExecutionArtifacts(errorLogId, errorResult, code, inputData);
          }
        );
      } catch (error) {
        setIsExecuting(false);
        setIsStreaming(false);
        console.error('Streaming execution failed:', error);
        
        const message = error instanceof Error ? error.message : 'Unknown streaming error';
        setError(`Streaming execution failed: ${message}`);
        
        const endTime = new Date();
        const executionTime = streamStartTime ? 
          (endTime.getTime() - streamStartTime.getTime()) / 1000 : 0;

        const errorResult: ExecutionResult = {
          success: false,
          output: '',
          error: `Failed to execute streaming code: ${error instanceof Error ? error.message : 'Unknown error'}`,
          execution_time: Math.max(executionTime, 0.001), // Ensure at least 1ms
          timestamp: streamStartTime?.toISOString() || new Date().toISOString(),
        };
        
        setCurrentExecution(errorResult);
        
        // Save catch error to backend history and artifacts
        const catchErrorLogId = Date.now().toString();
        saveExecutionToHistory(catchErrorLogId, errorResult, code, inputData);
        saveExecutionArtifacts(catchErrorLogId, errorResult, code, inputData);
      }
    } else {
      // Use regular execution
      try {
        const response = await apiClient.executeCode(request);
        
        // Set execution complete and update result
        console.log('Regular execution: Setting execution complete');
        setIsExecuting(false);
        setCurrentExecution(response.result);
        
      } catch (error) {
        setIsExecuting(false);
        console.error('Execution failed:', error);
        
        const message = error instanceof Error ? error.message : 'Unknown execution error';
        setError(`Execution failed: ${message}`);
        
        const errorResult: ExecutionResult = {
          success: false,
          output: '',
          error: `Failed to execute code: ${error instanceof Error ? error.message : 'Unknown error'}`,
          execution_time: 0,
          timestamp: new Date().toISOString(),
        };
        
        setCurrentExecution(errorResult);
        
        // Save regular execution error to backend history and artifacts
        const regularErrorLogId = Date.now().toString();
        saveExecutionToHistory(regularErrorLogId, errorResult, code, inputData);
        saveExecutionArtifacts(regularErrorLogId, errorResult, code, inputData);
      }
    }
  };

  const handleStop = () => {
    setIsExecuting(false);
    // TODO: Implement stop execution API call
  };

  const formatExecutionTime = (seconds: number) => {
    if (seconds < 1) {
      return `${Math.round(seconds * 1000)}ms`;
    }
    return `${seconds.toFixed(2)}s`;
  };

  const getStatusIcon = (result: ExecutionResult | null) => {
    if (!result) return <Clock className="w-4 h-4 text-gray-400" />;
    if (result.success) return <CheckCircle className="w-4 h-4 text-green-500" />;
    return <XCircle className="w-4 h-4 text-red-500" />;
  };

  return (
    <div className={`bg-white border-l border-gray-200 flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center">
          <Terminal className="w-4 h-4 text-gray-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Agent Execution</h3>
        </div>
        <div className="flex items-center space-x-2">
          {!backendAvailable && (
            <span className="text-xs text-red-500 mr-2">Backend Connecting</span>
          )}
          <button
            onClick={isExecuting ? handleStop : handleExecute}
            disabled={!backendAvailable}
            className={`flex items-center px-3 py-1 text-sm rounded ${
              isExecuting
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-green-500 text-white hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed'
            }`}
          >
            {isExecuting ? (
              <>
                <Square className="w-3 h-3 mr-1" />
                Stop
              </>
            ) : (
              <>
                <Play className="w-3 h-3 mr-1" />
                Execute
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 border-b border-gray-200">
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 text-red-500 mr-2" />
              <div className="flex-1">
                <p className="text-sm text-red-700">{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="text-xs text-red-500 hover:text-red-700 mt-1"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Storage Error Display */}
      {storageError && (
        <div className="p-4 border-b border-gray-200">
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 text-yellow-500 mr-2" />
              <div className="flex-1">
                <p className="text-sm text-yellow-700">{storageError}</p>
                <div className="flex items-center space-x-2 mt-2">
                  <button
                    onClick={() => setStorageError(null)}
                    className="text-xs text-yellow-600 hover:text-yellow-800"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => {
                      setStorageError(null);
                      loadStoredExecutions();
                    }}
                    className="text-xs text-yellow-600 hover:text-yellow-800 flex items-center"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Retry
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input Data Section */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Input Data (Optional)
        </label>
        <textarea
          value={inputData}
          onChange={(e) => {
            const newValue = e.target.value;
            setInputData(newValue);
            setStoredInputData(newValue); // Save to localStorage
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
          placeholder="Enter input data for your agent..."
          rows={2}
        />
      </div>

      {/* Current Execution Status */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Current Execution</span>
          <div className="flex items-center space-x-2">
            {hasStreamingEnabled() && (
              <div className="flex items-center space-x-1 text-xs text-blue-600">
                <Zap className="w-3 h-3" />
                <span>Streaming</span>
              </div>
            )}
            {isExecuting && <Loader className="w-4 h-4 text-blue-500 animate-spin" />}
          </div>
        </div>
        
        <div className="flex items-center space-x-2 text-sm">
          {getStatusIcon(currentExecution)}
          <span className={`${
            currentExecution?.success 
              ? 'text-green-700' 
              : currentExecution?.success === false 
                ? 'text-red-700' 
                : 'text-gray-500'
          }`}>
            {isExecuting 
              ? (isStreaming ? 'Streaming response...' : 'Executing...') 
              : currentExecution?.success 
                ? 'Completed successfully' 
                : currentExecution?.success === false 
                  ? 'Failed' 
                  : 'Ready to execute'
            }
          </span>
          {currentExecution && (
            <span className="text-gray-500">
              ({formatExecutionTime(currentExecution.execution_time)})
            </span>
          )}
        </div>
      </div>

      {/* Execution Results */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Show streaming output in real-time */}
        {isStreaming && (
          <div className="flex-1 overflow-auto">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center space-x-2 mb-2">
                <h4 className="text-sm font-medium text-gray-700">Live Output</h4>
                <div className="flex items-center space-x-1 text-xs text-blue-600">
                  <Zap className="w-3 h-3" />
                  <span>Streaming</span>
                </div>
              </div>
              <pre className="bg-gray-900 text-green-400 p-3 rounded text-xs font-mono whitespace-pre-wrap break-words overflow-y-auto">
                {streamingOutput || '...'}
                <span className="animate-pulse">█</span>
              </pre>
            </div>
          </div>
        )}
        
        {/* Show completed execution results */}
        {currentExecution && !isStreaming && (
          <div className="flex-1 overflow-auto">
            {/* Output */}
            {currentExecution.output && (
              <div className="p-4 border-b border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Output</h4>
                <pre className="bg-gray-900 text-green-400 p-3 rounded text-xs font-mono whitespace-pre-wrap break-words overflow-y-auto">
                  {currentExecution.output}
                </pre>
              </div>
            )}

            {/* Error */}
            {currentExecution.error && (
              <div className="p-4 border-b border-gray-200">
                <h4 className="text-sm font-medium text-red-700 mb-2">Error</h4>
                <pre className="bg-red-50 text-red-800 p-3 rounded text-xs font-mono border border-red-200 whitespace-pre-wrap break-words overflow-y-auto">
                  {currentExecution.error}
                </pre>
              </div>
            )}
          </div>
        )}
        
        {/* Show placeholder when no execution */}
        {!currentExecution && !isStreaming && (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Execute your agent to see results</p>
              {hasStreamingEnabled() && (
                <p className="text-xs mt-1 text-blue-600">Streaming mode enabled</p>
              )}
            </div>
          </div>
        )}

        {/* Stored Executions */}
        {(storedExecutions.length > 0 || loadingStoredExecutions) && (
          <div className="border-t border-gray-200">
            <div className="p-3 bg-gray-50 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FolderOpen className="w-4 h-4 text-gray-600" />
                <h4 className="text-sm font-medium text-gray-700">Stored Executions</h4>
                <span className="text-xs text-gray-500">({projectName})</span>
              </div>
              <button
                onClick={loadStoredExecutions}
                disabled={loadingStoredExecutions}
                className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                {loadingStoredExecutions ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            <div className="max-h-40 overflow-auto">
              {loadingStoredExecutions ? (
                <div className="p-4 text-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mx-auto mb-2"></div>
                  <p className="text-xs text-gray-600">Loading stored executions...</p>
                </div>
              ) : storedExecutions.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-500">
                  No stored executions available
                </div>
              ) : (
                storedExecutions.slice(0, 10).map((execution) => (
                  <div key={execution.execution_id} 
                    className={`p-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                      selectedStoredExecution?.execution_id === execution.execution_id ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => loadStoredExecutionResult(execution)}
                    title={`Execution ID: ${execution.execution_id}`}>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <FileText className="w-3 h-3 text-gray-500" />
                        <span className="text-gray-700">
                          {execution.execution_id.substring(0, 8)}...
                        </span>
                        <span className="text-gray-500 text-xs bg-gray-100 px-1 rounded">
                          {execution.result.success ? '✓' : '✗'}
                        </span>
                      </div>
                      <div className="text-gray-500">
                        {new Date(execution.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      Version: {execution.version} • Time: {execution.result.execution_time.toFixed(2)}s
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </div>

      {/* Backend Status Footer */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
        <div className="flex justify-between">
          <span>Backend Status: 
            <span className={backendAvailable ? 'text-green-600' : 'text-red-600'}>
              {backendAvailable ? ' Connected' : ' Disconnected'}
            </span>
          </span>
          <div className="flex items-center space-x-2">
            {selectedStoredExecution && (
              <span className="text-blue-600">
                Loaded: {selectedStoredExecution.execution_id.substring(0, 8)}...
              </span>
            )}
            <span>Port: 8000</span>
          </div>
        </div>
      </div>
    </div>
  );
}