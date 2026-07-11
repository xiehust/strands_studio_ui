import { useState, useEffect, useCallback } from 'react';
import { Play, Square, Loader, CheckCircle, XCircle, Clock, Terminal, Zap, FolderOpen, FileText, AlertTriangle, RefreshCw, MessageSquare, Wrench } from 'lucide-react';
import { ChatModal } from './chat-modal';
import { AiFixProgress } from './ai-fix-progress';
import { useAiFix } from '../hooks/use-ai-fix';
import { apiClient, type ExecutionRequest, type ExecutionResult, type ExecutionHistoryItem } from '../lib/api-client';
import { ValidationError, isExecutionResult } from '../lib/validation';

interface ExecutionPanelProps {
  code: string;
  className?: string;
  projectId?: string;
  projectName?: string;
  projectVersion?: string;
  flowData?: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  graphMode?: boolean;
  // Returns true when the fixed code was applied to the app code state
  // (false when the user declined to overwrite manual edits).
  onApplyFixedCode?: (code: string) => boolean;
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
  flowData,
  graphMode = false,
  onApplyFixedCode
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
  const [showChatModal, setShowChatModal] = useState(false);

  // AI Fix state (backend coding agent, POST /api/fix-code/stream)
  const [codegenAvailable, setCodegenAvailable] = useState(false);
  const {
    isFixing,
    fixEvents,
    fixError,
    fixDiagnosis,
    fixApplied,
    startFix,
    resetFixState,
    dismissDiagnosis,
  } = useAiFix({
    onApplied: (fixedCode) => (onApplyFixedCode ? onApplyFixedCode(fixedCode) : false),
  });

  // Extract OpenAI API key from agent nodes
  const getOpenAIApiKey = (): string | undefined => {
    const allNodes = flowData?.nodes || [];
    const agentNodes = allNodes.filter(node =>
      node.type === 'agent' || node.type === 'orchestrator-agent'
    );

    // Find first OpenAI API key from any agent node
    for (const node of agentNodes) {
      const nodeData = node.data as any;
      if (nodeData?.modelProvider === 'OpenAI' && nodeData?.apiKey) {
        return nodeData.apiKey;
      }
    }
    return undefined;
  };

  // Check backend availability on mount
  useEffect(() => {
    checkBackendHealth();
  }, []);

  // Check codegen backend availability on mount (drives AI Fix button visibility)
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getCodegenStatus()
      .then((status) => {
        if (!cancelled) setCodegenAvailable(status.available);
      })
      .catch(() => {
        if (!cancelled) setCodegenAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Full error text for the fix request (backend truncates to the traceback tail)
  const buildFixErrorText = (result: ExecutionResult): string => {
    const parts: string[] = [];
    if (result.output?.trim()) parts.push(result.output);
    if (result.error?.trim()) parts.push(result.error);
    return parts.join('\n\n');
  };

  const handleAiFix = () => {
    if (isFixing || !currentExecution || currentExecution.success !== false) return;

    startFix({
      code,
      error: buildFixErrorText(currentExecution),
      flow_data: flowData || { nodes: [], edges: [] },
      graph_mode: graphMode,
      input_data: inputData.trim() || undefined,
    });
  };

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
      resetFixState(); // Diagnosis from a previous fix no longer applies

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

  // Check if there's a valid agent configuration for chat
  const hasValidAgent = useCallback(() => {
    if (!flowData?.nodes) return false;

    // Check if there are agent or orchestrator-agent nodes
    const hasAgentNodes = flowData.nodes.some(node =>
      node.type === 'agent' || node.type === 'orchestrator-agent'
    );

    // Check if there are required input/output nodes
    const hasInputNode = flowData.nodes.some(node => node.type === 'input');
    const hasOutputNode = flowData.nodes.some(node => node.type === 'output');

    return hasAgentNodes && hasInputNode && hasOutputNode && code.trim().length > 0;
  }, [flowData, code]);

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
    resetFixState();

    // Extract API keys from agent nodes for secure backend handling
    const extractApiKeys = () => {
      const allNodes = flowData?.nodes || [];
      const agentNodes = allNodes.filter(node => 
        node.type === 'agent' || node.type === 'orchestrator-agent'
      );
      
      // Find first provider API key from any agent node
      const keys: Record<string, string> = {};
      for (const node of agentNodes) {
        const nodeData = node.data as any;
        if (nodeData?.modelProvider === 'OpenAI' && nodeData?.apiKey && !keys.openai_api_key) {
          keys.openai_api_key = nodeData.apiKey;
        }
        if (nodeData?.modelProvider === 'Amazon Bedrock (Mantle)' && nodeData?.apiKey && !keys.bedrock_api_key) {
          keys.bedrock_api_key = nodeData.apiKey;
        }
      }
      return keys;
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
            // console.log('Chunk:', JSON.stringify(chunk), 'Has \\n:', chunk.includes('\n'));
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

  const getStatusChip = (result: ExecutionResult | null) => {
    if (isExecuting) return <span className="lp-chip warn"><i>◐</i>{isStreaming ? 'STREAMING' : 'RUNNING'}</span>;
    if (!result) return <span className="lp-chip muted"><Clock className="w-3 h-3" />READY</span>;
    if (result.success) return <span className="lp-chip good"><CheckCircle className="w-3 h-3" />COMPLETE</span>;
    return <span className="lp-chip crit"><XCircle className="w-3 h-3" />FAILED</span>;
  };

  return (
    <div className={`bg-panel border-l border-line flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="lp-phead">
        <Terminal className="w-4 h-4 text-ink-3" />
        <h3 className="lp-ptitle">Agent Execution</h3>
        <span className="lp-sub">local invoke</span>
        <div className="ml-auto flex items-center gap-2">
          {!backendAvailable && (
            <span className="lp-chip crit"><i>✕</i>BACKEND</span>
          )}
          <button
            onClick={() => setShowChatModal(true)}
            disabled={!backendAvailable || !hasValidAgent()}
            className="lp-btn sm"
            title={!hasValidAgent() ? 'Create a valid agent flow with input/output nodes first' : 'Start a conversation with your agent'}
          >
            <MessageSquare className="w-3 h-3" />
            Chat
          </button>
          <button
            onClick={isExecuting ? handleStop : handleExecute}
            disabled={!backendAvailable}
            className={`lp-btn sm ${isExecuting ? 'danger' : 'primary'}`}
          >
            {isExecuting ? (
              <>
                <Square className="w-3 h-3" />
                Stop
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                Execute
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 border-b border-line">
          <div className="bg-crit/10 border border-crit/40 p-3">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 text-crit mr-2 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-red-700">{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="font-mono text-[10px] uppercase tracking-wider text-crit hover:text-red-700 mt-1"
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
        <div className="p-4 border-b border-line">
          <div className="bg-warn/10 border border-warn/40 p-3">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 text-warn mr-2 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-yellow-700">{storageError}</p>
                <div className="flex items-center space-x-2 mt-2">
                  <button
                    onClick={() => setStorageError(null)}
                    className="font-mono text-[10px] uppercase tracking-wider text-warn hover:text-yellow-700"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => {
                      setStorageError(null);
                      loadStoredExecutions();
                    }}
                    className="font-mono text-[10px] uppercase tracking-wider text-warn hover:text-yellow-700 flex items-center"
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
      <div className="p-4 border-b border-line">
        <label className="lp-label">
          User Input
        </label>
        <textarea
          value={inputData}
          onChange={(e) => {
            const newValue = e.target.value;
            setInputData(newValue);
            setStoredInputData(newValue); // Save to localStorage
          }}
          className="lp-input text-sm"
          placeholder="Enter input data for your agent..."
          rows={2}
        />
      </div>

      {/* Current Execution Status */}
      <div className="px-4 py-3 border-b border-line">
        <div className="flex items-center justify-between mb-2">
          <span className="lp-label !mb-0">Current Execution</span>
          <div className="flex items-center space-x-2">
            {hasStreamingEnabled() && (
              <span className="lp-chip blue"><Zap className="w-3 h-3" />STREAMING</span>
            )}
            {isExecuting && <Loader className="w-4 h-4 text-amber animate-spin" />}
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          {getStatusChip(currentExecution)}
          <span className="font-mono text-[10.5px] text-ink-2">
            {isExecuting
              ? (isStreaming ? 'streaming response…' : 'executing…')
              : currentExecution?.success
                ? 'completed successfully'
                : currentExecution?.success === false
                  ? 'failed'
                  : 'ready to execute'
            }
          </span>
          {currentExecution && (
            <span className="font-mono text-[10.5px] text-ink-3">
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
            <div className="p-4 border-b border-line">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="lp-label !mb-0">Live Output</h4>
                <span className="lp-chip blue"><Zap className="w-3 h-3" />STREAMING</span>
              </div>
              <pre className="lp-code whitespace-pre-wrap break-words overflow-y-auto">
                {streamingOutput || '...'}
                <span className="lp-caret" />
              </pre>
            </div>
          </div>
        )}

        {/* Show completed execution results */}
        {currentExecution && !isStreaming && (
          <div className="flex-1 overflow-auto">
            {/* Output */}
            {currentExecution.output && (
              <div className="p-4 border-b border-line">
                <h4 className="lp-label">Output</h4>
                <pre className="lp-code whitespace-pre-wrap break-words overflow-y-auto">
                  {currentExecution.output}
                </pre>
              </div>
            )}

            {/* Error */}
            {(currentExecution.error || currentExecution.success === false) && (
              <div className="p-4 border-b border-line">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="lp-label !text-crit !mb-0">Error</h4>
                  {codegenAvailable && currentExecution.success === false && (
                    <button
                      onClick={handleAiFix}
                      disabled={isFixing}
                      className="lp-btn sm"
                      title="Diagnose and fix this failure with the backend coding agent"
                    >
                      {isFixing ? (
                        <Loader className="w-3 h-3 animate-spin" />
                      ) : (
                        <Wrench className="w-3 h-3" />
                      )}
                      AI Fix
                    </button>
                  )}
                </div>
                {currentExecution.error && (
                  <pre className="lp-code !text-red-700 !border-crit/40 whitespace-pre-wrap break-words overflow-y-auto">
                    {currentExecution.error}
                  </pre>
                )}

                <AiFixProgress
                  isFixing={isFixing}
                  fixEvents={fixEvents}
                  fixError={fixError}
                  fixDiagnosis={fixDiagnosis}
                  fixApplied={fixApplied}
                  onDismissError={resetFixState}
                  onDismissDiagnosis={dismissDiagnosis}
                />
              </div>
            )}
          </div>
        )}

        {/* Show placeholder when no execution */}
        {!currentExecution && !isStreaming && (
          <div className="flex-1 flex items-center justify-center text-ink-3">
            <div className="text-center">
              <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Execute your agent to see results</p>
              {hasStreamingEnabled() && (
                <p className="font-mono text-[10px] uppercase tracking-wider mt-1 text-s1">Streaming mode enabled</p>
              )}
            </div>
          </div>
        )}

        {/* Stored Executions */}
        {(storedExecutions.length > 0 || loadingStoredExecutions) && (
          <div className="border-t border-line">
            <div className="px-4 py-2.5 bg-panel2 flex items-center justify-between border-b border-line">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-3.5 h-3.5 text-ink-3" />
                <h4 className="lp-label !mb-0">Stored Executions</h4>
                <span className="font-mono text-[9.5px] text-ink-3">({projectName})</span>
              </div>
              <button
                onClick={loadStoredExecutions}
                disabled={loadingStoredExecutions}
                className="font-mono text-[10px] uppercase tracking-wider text-amber hover:text-orange-400 disabled:opacity-50"
              >
                {loadingStoredExecutions ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            <div className="max-h-40 overflow-auto">
              {loadingStoredExecutions ? (
                <div className="p-4 text-center">
                  <Loader className="w-4 h-4 animate-spin text-amber mx-auto mb-2" />
                  <p className="font-mono text-[10px] text-ink-3">Loading stored executions…</p>
                </div>
              ) : storedExecutions.length === 0 ? (
                <div className="p-4 text-center font-mono text-[10px] text-ink-3">
                  No stored executions available
                </div>
              ) : (
                storedExecutions.slice(0, 10).map((execution) => (
                  <div key={execution.execution_id}
                    className={`px-4 py-2.5 border-b border-grid hover:bg-white/[0.02] cursor-pointer ${
                      selectedStoredExecution?.execution_id === execution.execution_id ? 'bg-amber-soft' : ''
                    }`}
                    onClick={() => loadStoredExecutionResult(execution)}
                    title={`Execution ID: ${execution.execution_id}`}>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3 h-3 text-ink-3" />
                        <span className="font-mono text-[11px] text-ink-2">
                          {execution.execution_id.substring(0, 8)}…
                        </span>
                        {execution.result.success ? (
                          <span className="lp-chip good"><i>●</i>OK</span>
                        ) : (
                          <span className="lp-chip crit"><i>✕</i>ERR</span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-ink-3">
                        {new Date(execution.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="mt-1 font-mono text-[9.5px] text-ink-3">
                      v{execution.version} · {execution.result.execution_time.toFixed(2)}s
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </div>

      {/* Backend Status Footer */}
      <div className="px-3 py-2 border-t border-line font-mono text-[9.5px] text-ink-3 tracking-wider uppercase">
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-1.5">
            <span className={`lp-led ${backendAvailable ? '' : 'crit'}`} />
            Backend {backendAvailable ? 'Connected' : 'Disconnected'}
          </span>
          <div className="flex items-center gap-2">
            {selectedStoredExecution && (
              <span className="text-amber">
                Loaded {selectedStoredExecution.execution_id.substring(0, 8)}…
              </span>
            )}
            <span>Port 8000</span>
          </div>
        </div>
      </div>

      {/* Chat Modal */}
      <ChatModal
        isOpen={showChatModal}
        onClose={() => setShowChatModal(false)}
        flowData={flowData || { nodes: [], edges: [] }}
        generatedCode={code}
        projectId={projectName}
        projectVersion={projectVersion}
        openaiApiKey={getOpenAIApiKey()}
        codegenAvailable={codegenAvailable}
        graphMode={graphMode}
        onApplyFixedCode={onApplyFixedCode}
      />
    </div>
  );
}