import { useState, useEffect, useCallback } from 'react';
import { Play, Square, Loader, CheckCircle, XCircle, Clock, Terminal, Zap } from 'lucide-react';
import { apiClient, type ExecutionRequest, type ExecutionResult } from '../lib/api-client';

interface ExecutionPanelProps {
  code: string;
  className?: string;
}

interface ExecutionLog {
  id: string;
  timestamp: string;
  result: ExecutionResult;
}

export function ExecutionPanel({ code, className = '' }: ExecutionPanelProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentExecution, setCurrentExecution] = useState<ExecutionResult | null>(null);
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([]);
  const [inputData, setInputData] = useState('');
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [streamStartTime, setStreamStartTime] = useState<Date | null>(null);

  // Check backend availability on mount
  useEffect(() => {
    checkBackendHealth();
  }, []);

  // Set up WebSocket connection for real-time updates
  useEffect(() => {
    apiClient.connectWebSocket();
    
    const handleWebSocketMessage = (data: any) => {
      if (data.type === 'execution_complete') {
        setIsExecuting(false);
        setCurrentExecution(data.result);
        
        // Add to execution logs
        const log: ExecutionLog = {
          id: data.execution_id,
          timestamp: data.result.timestamp,
          result: data.result,
        };
        setExecutionLogs(prev => [log, ...prev].slice(0, 10)); // Keep last 10 logs
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
    return code.includes('streaming = True') || code.includes('"streaming": true');
  }, [code]);

  const handleExecute = async () => {
    if (!code.trim()) {
      alert('No code to execute');
      return;
    }

    if (!backendAvailable) {
      alert('Backend server is not available. Please make sure the server is running on port 8000.');
      return;
    }

    setIsExecuting(true);
    setCurrentExecution(null);
    
    const request: ExecutionRequest = {
      code: code,
      input_data: inputData.trim() || undefined,
    };

    // Check if streaming is enabled in the generated code
    const streamingEnabled = hasStreamingEnabled();

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
            setStreamingOutput(prev => prev + chunk);
          },
          () => {
            // Handle completion
            setIsExecuting(false);
            setIsStreaming(false);
            
            const endTime = new Date();
            const executionTime = streamStartTime ? 
              (endTime.getTime() - streamStartTime.getTime()) / 1000 : 0;

            const result: ExecutionResult = {
              success: true,
              output: streamingOutput,
              execution_time: executionTime,
              timestamp: new Date().toISOString(),
            };
            
            setCurrentExecution(result);
            
            // Add to execution logs
            const log: ExecutionLog = {
              id: Date.now().toString(),
              timestamp: result.timestamp,
              result: result,
            };
            setExecutionLogs(prev => [log, ...prev].slice(0, 10));
          },
          (error: string) => {
            // Handle error
            setIsExecuting(false);
            setIsStreaming(false);
            
            const endTime = new Date();
            const executionTime = streamStartTime ? 
              (endTime.getTime() - streamStartTime.getTime()) / 1000 : 0;

            const errorResult: ExecutionResult = {
              success: false,
              output: streamingOutput,
              error: error,
              execution_time: executionTime,
              timestamp: new Date().toISOString(),
            };
            
            setCurrentExecution(errorResult);
          }
        );
      } catch (error) {
        setIsExecuting(false);
        setIsStreaming(false);
        console.error('Streaming execution failed:', error);
        
        const errorResult: ExecutionResult = {
          success: false,
          output: '',
          error: `Failed to execute streaming code: ${error instanceof Error ? error.message : 'Unknown error'}`,
          execution_time: 0,
          timestamp: new Date().toISOString(),
        };
        
        setCurrentExecution(errorResult);
      }
    } else {
      // Use regular execution
      try {
        const response = await apiClient.executeCode(request);
        
        // The result will be updated via WebSocket, but we can also set it immediately
        setCurrentExecution(response.result);
        
      } catch (error) {
        setIsExecuting(false);
        console.error('Execution failed:', error);
        
        const errorResult: ExecutionResult = {
          success: false,
          output: '',
          error: `Failed to execute code: ${error instanceof Error ? error.message : 'Unknown error'}`,
          execution_time: 0,
          timestamp: new Date().toISOString(),
        };
        
        setCurrentExecution(errorResult);
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
            <span className="text-xs text-red-500 mr-2">Backend Offline</span>
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

      {/* Input Data Section */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Input Data (Optional)
        </label>
        <textarea
          value={inputData}
          onChange={(e) => setInputData(e.target.value)}
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
        {isStreaming && streamingOutput && (
          <div className="flex-1 overflow-auto">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center space-x-2 mb-2">
                <h4 className="text-sm font-medium text-gray-700">Live Output</h4>
                <div className="flex items-center space-x-1 text-xs text-blue-600">
                  <Zap className="w-3 h-3" />
                  <span>Streaming</span>
                </div>
              </div>
              <pre className="bg-gray-900 text-green-400 p-3 rounded text-xs overflow-auto font-mono">
                {streamingOutput}
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
                <pre className="bg-gray-900 text-green-400 p-3 rounded text-xs overflow-auto font-mono">
                  {currentExecution.output}
                </pre>
              </div>
            )}

            {/* Error */}
            {currentExecution.error && (
              <div className="p-4 border-b border-gray-200">
                <h4 className="text-sm font-medium text-red-700 mb-2">Error</h4>
                <pre className="bg-red-50 text-red-800 p-3 rounded text-xs overflow-auto font-mono border border-red-200">
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

        {/* Execution History */}
        {executionLogs.length > 0 && (
          <div className="border-t border-gray-200">
            <div className="p-3 bg-gray-50">
              <h4 className="text-sm font-medium text-gray-700">Execution History</h4>
            </div>
            <div className="max-h-40 overflow-auto">
              {executionLogs.map((log) => (
                <div key={log.id} className="p-3 border-b border-gray-100 hover:bg-gray-50">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(log.result)}
                      <span className={log.result.success ? 'text-green-600' : 'text-red-600'}>
                        {log.result.success ? 'Success' : 'Failed'}
                      </span>
                    </div>
                    <div className="text-gray-500">
                      {new Date(log.timestamp).toLocaleTimeString()} 
                      ({formatExecutionTime(log.result.execution_time)})
                    </div>
                  </div>
                  {log.result.output && (
                    <div className="mt-1 text-xs text-gray-600 truncate">
                      Output: {log.result.output.substring(0, 100)}...
                    </div>
                  )}
                </div>
              ))}
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
          <span>Port: 8000</span>
        </div>
      </div>
    </div>
  );
}