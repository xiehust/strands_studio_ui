import { useState, useEffect } from 'react';
import { Play, RefreshCw, X, Trash2, AlertTriangle, Cloud, Zap, Waves } from 'lucide-react';

interface AgentCoreDeployment {
  agent_runtime_arn: string;
  agent_runtime_name: string;
  invoke_endpoint: string;
  deployment_method: string;
  region: string;
  network_mode: string;
  saved_at: string;
  deployment_type: 'agentcore';
  streaming_capable?: boolean;
}

interface LambdaDeployment {
  deployment_id: string;
  agent_name: string;
  region: string;
  deployment_result: {
    function_arn?: string;
    api_endpoint?: string;
    invoke_endpoint?: string;
    streaming_invoke_endpoint?: string;
    streaming_capable?: boolean;
    deployment_type?: string;
    python_function_arn?: string;
    python_stream_function_arn?: string;
    nodejs_function_arn?: string;
    sync_function_url?: string;
    stream_function_url?: string;
  };
  created_at: string;
  deployment_type: 'lambda';
}

type DeploymentHistory = AgentCoreDeployment | LambdaDeployment;

interface InvokePanelProps {
  className?: string;
}

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  agentName: string;
  deploymentType: 'agentcore' | 'lambda';
  identifier: string; // ARN for AgentCore, function name for Lambda
  region?: string; // For Lambda deployments
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmationModal({ isOpen, agentName, deploymentType, identifier, region, onConfirm, onCancel }: DeleteConfirmationModalProps) {
  if (!isOpen) return null;

  const isAgentCore = deploymentType === 'agentcore';
  const title = isAgentCore ? 'Delete AgentCore Runtime' : 'Delete Lambda Deployment';
  const typeLabel = isAgentCore ? 'AgentCore runtime' : 'Lambda deployment';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="mb-4">
            <p className="text-gray-700 mb-3">
              Are you sure you want to delete the {typeLabel} <strong>"{agentName}"</strong>?
            </p>
            <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-800">
                  <p className="font-medium mb-1">This action cannot be undone!</p>
                  <p>This will permanently delete the AWS resources and all associated data.</p>
                  {!isAgentCore && (
                    <p className="mt-1">This includes the CloudFormation stack, Lambda functions, and ECR repositories.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded-md p-3">
              <p className="text-xs text-gray-600 mb-1">{isAgentCore ? 'ARN:' : 'Function Name:'}</p>
              <p className="text-xs font-mono text-gray-800 break-all">{identifier}</p>
              {region && !isAgentCore && (
                <>
                  <p className="text-xs text-gray-600 mb-1 mt-2">Region:</p>
                  <p className="text-xs font-mono text-gray-800">{region}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t bg-gray-50 rounded-b-lg">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Delete Runtime
          </button>
        </div>
      </div>
    </div>
  );
}

export function InvokePanel({ className = '' }: InvokePanelProps) {
  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentHistory[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<DeploymentHistory | null>(null);
  const [payload, setPayload] = useState('{"user_input": "Hello, Agent!"}');
  const [sessionId, setSessionId] = useState('');
  const [invokeResult, setInvokeResult] = useState<any>(null);
  const [isInvoking, setIsInvoking] = useState(false);
  // Auto-detect streaming capability based on deployment metadata
  const getStreamingCapability = (agent: DeploymentHistory | null): boolean => {
    if (!agent) return false;

    if (agent.deployment_type === 'lambda') {
      // For Lambda: check if deployment has streaming capability
      return !!(agent as LambdaDeployment).deployment_result.streaming_capable;
    } else if (agent.deployment_type === 'agentcore') {
      // For AgentCore: check if deployment has streaming capability from stored metadata
      const agentCoreAgent = agent as AgentCoreDeployment;

      // Check streaming_capable from deployment outputs if available
      if (agentCoreAgent.streaming_capable !== undefined) {
        console.log('AgentCore streaming capability from stored metadata:', agentCoreAgent.streaming_capable);
        return agentCoreAgent.streaming_capable;
      }

      // Legacy fallback: infer from agent name patterns
      const agentName = agentCoreAgent.agent_runtime_name?.toLowerCase() || '';
      console.log('AgentCore agent name for streaming inference:', agentName);

      // If agent name suggests non-streaming, assume false
      if (agentName.includes('no_stream') || agentName.includes('non_stream') ||
          agentName.includes('sync') || agentName.includes('regular')) {
        console.log('AgentCore inferred as non-streaming from name pattern');
        return false;
      }

      // If agent name suggests streaming, assume true
      if (agentName.includes('stream') || agentName.includes('async')) {
        console.log('AgentCore inferred as streaming from name pattern');
        return true;
      }

      // Final fallback: assume streaming for AgentCore (most AgentCore agents support streaming)
      console.log('AgentCore defaulting to streaming capability (most AgentCore agents support streaming)');
      return true;
    }

    return false;
  };

  const isStreamingCapable = getStreamingCapability(selectedAgent);
  const [streamContent, setStreamContent] = useState<string[]>([]);
  const [streamingResult, setStreamingResult] = useState<string>('');
  const [showStreamingWarning, setShowStreamingWarning] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    agentName: string;
    deploymentType: 'agentcore' | 'lambda';
    identifier: string; // ARN for AgentCore, function name for Lambda
    region?: string; // For Lambda deployments
    deploymentId?: string; // For Lambda deployment history cleanup
  }>({
    isOpen: false,
    agentName: '',
    deploymentType: 'agentcore',
    identifier: ''
  });

  // Generate a 33-character random session ID
  const generateSessionId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 33; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  // Load deployment history from both localStorage (AgentCore) and API (Lambda)
  const loadDeploymentHistory = async () => {
    try {
      const allDeployments: DeploymentHistory[] = [];

      // Load all deployments (both AgentCore and Lambda) from backend API
      try {
        const response = await fetch('/api/deployment-history?limit=50');
        if (response.ok) {
          const historyData = await response.json();
          const successfulDeployments = historyData.deployments?.filter(
            (dep: any) => dep.success
          ) || [];

          // Process each deployment by type
          for (const dep of successfulDeployments) {
            if (dep.deployment_target === 'lambda') {
              // Lambda deployment
              const lambdaDeployment: LambdaDeployment = {
                deployment_id: dep.deployment_id,
                agent_name: dep.agent_name,
                region: dep.region,
                deployment_result: dep.deployment_result || {},
                created_at: dep.created_at,
                deployment_type: 'lambda' as const
              };
              allDeployments.push(lambdaDeployment);
            } else if (dep.deployment_target === 'agentcore') {
              // AgentCore deployment - extract deployment outputs from deployment_result
              const deploymentOutputs = dep.deployment_result?.status?.deployment_outputs || dep.deployment_result?.deployment_outputs || {};

              const agentCoreDeployment: AgentCoreDeployment = {
                agent_runtime_arn: deploymentOutputs.agent_runtime_arn || dep.deployment_result?.agent_runtime_arn || '',
                agent_runtime_name: deploymentOutputs.agent_runtime_name || dep.agent_name || '',
                invoke_endpoint: deploymentOutputs.invoke_endpoint || dep.deployment_result?.invoke_endpoint || '',
                deployment_method: deploymentOutputs.deployment_method || 'sdk',
                region: dep.region || 'us-east-1',
                network_mode: deploymentOutputs.network_mode || 'PUBLIC',
                saved_at: dep.created_at,
                deployment_type: 'agentcore' as const,
                streaming_capable: deploymentOutputs.streaming_capable
              };

              // Only add if we have a valid ARN
              if (agentCoreDeployment.agent_runtime_arn) {
                allDeployments.push(agentCoreDeployment);
              } else {
                console.warn('Skipping AgentCore deployment without ARN:', dep);
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to load deployments from backend:', error);
      }

      // Fallback: Load AgentCore deployments from localStorage if backend returns no AgentCore deployments
      const hasAgentCoreFromBackend = allDeployments.some(dep => dep.deployment_type === 'agentcore');
      if (!hasAgentCoreFromBackend) {
        console.log('No AgentCore deployments found in backend, checking localStorage as fallback');
        try {
          const saved = localStorage.getItem('agentcore_deployments');
          if (saved) {
            const agentCoreDeployments = JSON.parse(saved);
            const typedAgentCore = agentCoreDeployments.map((dep: any) => ({
              ...dep,
              deployment_type: 'agentcore' as const
            }));
            allDeployments.push(...typedAgentCore);
            console.log('Loaded', typedAgentCore.length, 'AgentCore deployments from localStorage fallback');
          }
        } catch (error) {
          console.error('Failed to load AgentCore deployments from localStorage:', error);
        }
      }

      // Sort by creation date (newest first)
      allDeployments.sort((a, b) => {
        const dateA = 'saved_at' in a ? a.saved_at : a.created_at;
        const dateB = 'saved_at' in b ? b.saved_at : b.created_at;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });

      // Deduplicate by agent name, keeping only the latest deployment for each agent
      const uniqueDeployments = allDeployments.reduce((acc, deployment) => {
        const agentName = deployment.deployment_type === 'agentcore'
          ? (deployment as AgentCoreDeployment).agent_runtime_name
          : (deployment as LambdaDeployment).agent_name;

        // Only keep if we haven't seen this agent name before (since sorted by newest first)
        if (!acc.find(existing => {
          const existingAgentName = existing.deployment_type === 'agentcore'
            ? (existing as AgentCoreDeployment).agent_runtime_name
            : (existing as LambdaDeployment).agent_name;
          return existingAgentName === agentName;
        })) {
          acc.push(deployment);
        }

        return acc;
      }, [] as DeploymentHistory[]);

      setDeploymentHistory(uniqueDeployments);
    } catch (error) {
      console.error('Failed to load deployment history:', error);
    }
  };

  // Show delete confirmation modal
  const showDeleteConfirmation = (
    agentName: string,
    deploymentType: 'agentcore' | 'lambda',
    identifier: string,
    region?: string,
    deploymentId?: string
  ) => {
    setDeleteModal({
      isOpen: true,
      agentName,
      deploymentType,
      identifier,
      region,
      deploymentId
    });
  };

  // Handle delete confirmation
  const handleDeleteConfirm = async () => {
    const { deploymentType, identifier, region, deploymentId } = deleteModal;

    // Close modal first
    setDeleteModal({
      isOpen: false,
      agentName: '',
      deploymentType: 'agentcore',
      identifier: ''
    });

    try {
      let response: Response;

      if (deploymentType === 'agentcore') {
        // Delete AgentCore deployment
        response = await fetch(`/api/deploy/agentcore/${encodeURIComponent(identifier)}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      } else {
        // Delete Lambda deployment using the new API client method
        const apiClient = (await import('../lib/api-client')).apiClient;
        const result = await apiClient.deleteLambdaDeployment(identifier, region);

        console.log('Lambda deletion result:', result);

        if (!result.success) {
          throw new Error(result.message);
        }

        // Also delete from deployment history if we have a deployment ID
        if (deploymentId) {
          try {
            await apiClient.deleteDeploymentHistoryItem(deploymentId);
            console.log('Lambda deployment history record deleted:', deploymentId);
          } catch (historyError) {
            console.warn('Failed to delete deployment history record:', historyError);
            // Don't fail the entire operation if history deletion fails
          }
        }

        // Reload deployment history after successful deletion
        await loadDeploymentHistory();

        // Clear selection if the deleted deployment was selected
        if (selectedAgent && selectedAgent.deployment_type === 'lambda' &&
            (selectedAgent as LambdaDeployment).agent_name === identifier) {
          setSelectedAgent(null);
        }

        return; // Exit early for Lambda since apiClient handles everything
      }

      // Handle AgentCore response
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('AgentCore deletion result:', result);

      // Remove from localStorage after successful deletion
      try {
        const saved = localStorage.getItem('agentcore_deployments');
        if (saved) {
          const agentCoreDeployments = JSON.parse(saved);
          const filteredDeployments = agentCoreDeployments.filter(
            (dep: any) => dep.agent_runtime_arn !== identifier
          );
          localStorage.setItem('agentcore_deployments', JSON.stringify(filteredDeployments));
          console.log('Removed AgentCore deployment from localStorage:', identifier);
        }
      } catch (error) {
        console.error('Failed to remove AgentCore deployment from localStorage:', error);
      }

      // Reload deployment history after successful deletion
      await loadDeploymentHistory();

      // Clear selection if the deleted agent was selected
      if (selectedAgent && selectedAgent.deployment_type === 'agentcore' &&
          (selectedAgent as AgentCoreDeployment).agent_runtime_arn === identifier) {
        setSelectedAgent(null);
      }

    } catch (error) {
      console.error('Failed to delete agent:', error);
      // Show error to user
      alert(`Failed to delete ${deploymentType === 'agentcore' ? 'AgentCore runtime' : 'Lambda deployment'}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Delete single agent from deployment history
  const deleteAgent = async (deployment: DeploymentHistory) => {
    try {
      if (deployment.deployment_type === 'agentcore') {
        // For AgentCore, show confirmation modal
        const agentCore = deployment as AgentCoreDeployment;
        showDeleteConfirmation(
          agentCore.agent_runtime_name,
          'agentcore',
          agentCore.agent_runtime_arn
        );
        return;
      } else if (deployment.deployment_type === 'lambda') {
        // For Lambda, show confirmation modal with deployment_id for history cleanup
        const lambdaDeployment = deployment as LambdaDeployment;
        showDeleteConfirmation(
          lambdaDeployment.agent_name,
          'lambda',
          lambdaDeployment.agent_name, // Use agent_name as function name
          lambdaDeployment.region,
          lambdaDeployment.deployment_id // Pass deployment_id for history cleanup
        );
        return;
      }
    } catch (error) {
      console.error('Failed to delete agent:', error);
      alert(`Failed to delete agent: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Handle delete cancellation
  const handleDeleteCancel = () => {
    setDeleteModal({
      isOpen: false,
      agentName: '',
      deploymentType: 'agentcore',
      identifier: ''
    });
  };

  // Handle streaming response
  const handleStreamingResponse = async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // Streaming will be automatically determined by isStreamingCapable
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
      // Streaming automatically determined by deployment capability
      reader.releaseLock();
    }
  };

  // Invoke agent
  const handleInvokeAgent = async () => {
    if (!selectedAgent || !payload) {
      return;
    }

    // For Lambda, sessionId is not required
    if (selectedAgent.deployment_type === 'agentcore' && !sessionId) {
      return;
    }

    setIsInvoking(true);
    setInvokeResult(null);
    setStreamContent([]);
    setStreamingResult('');

    try {
      // Parse payload as JSON
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(payload);
      } catch (error) {
        throw new Error('Invalid JSON payload');
      }

      if (selectedAgent.deployment_type === 'agentcore') {
        // AgentCore invocation
        const response = await fetch('/api/deploy/agentcore/invoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            agent_runtime_arn: (selectedAgent as AgentCoreDeployment).agent_runtime_arn,
            runtime_session_id: sessionId,
            payload: parsedPayload,
            qualifier: 'DEFAULT',
            region: selectedAgent.region,
            enable_stream: true  // Always enable streaming, let backend auto-detect
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Check response type and handle accordingly
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('text/event-stream')) {
          // Handle streaming response
          await handleStreamingResponse(response);
        } else {
          // Handle JSON response
          const result = await response.json();
          setInvokeResult(result);
        }
      } else if (selectedAgent.deployment_type === 'lambda') {
        // Lambda invocation using Function URLs
        const lambdaDeployment = selectedAgent as LambdaDeployment;

        if (isStreamingCapable) {
          // Use streaming function URL if available
          const streamFunctionUrl = lambdaDeployment.deployment_result.stream_function_url;

          if (streamFunctionUrl) {
            // Use streaming function URL endpoint
            const lambdaPayload = {
              prompt: parsedPayload.user_input || parsedPayload.prompt || JSON.stringify(parsedPayload),
              input_data: parsedPayload.input_data,
              api_keys: parsedPayload.api_keys || {}
            };

            // Use backend invoke-url stream endpoint for Function URL with AWS IAM auth
            const response = await fetch('/api/deploy/lambda/invoke-url/stream', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                function_url: streamFunctionUrl,
                payload: lambdaPayload,
                region: lambdaDeployment.region
              }),
            });

            if (!response.ok) {
              throw new Error(`HTTP API error! status: ${response.status}`);
            }

            // Check if this is a streaming response
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/event-stream')) {
              // Handle SSE streaming response from Function URL
              const reader = response.body?.getReader();
              if (!reader) {
                throw new Error('No response body reader available');
              }

              const decoder = new TextDecoder();
              let buffer = '';
              let hasReceivedData = false;

              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || '';

                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      const data = line.slice(6);

                      try {
                        // Parse JSON data from SSE
                        const sseData = JSON.parse(data);

                        if (sseData.type === 'delta' && sseData.text) {
                          hasReceivedData = true;
                          setStreamingResult(prev => prev + sseData.text);
                        } else if (sseData.type === 'done') {
                          // Streaming complete
                          setInvokeResult({
                            success: true,
                            response_data: streamingResult,
                            execution_time: null,
                            streaming_via: 'Function URL SSE'
                          });
                          return;
                        } else if (sseData.type === 'error') {
                          throw new Error(sseData.message || 'Streaming error');
                        }
                      } catch (parseError) {
                        // Handle non-JSON SSE data
                        if (data === '[DONE]') {
                          setInvokeResult({
                            success: true,
                            response_data: streamingResult,
                            execution_time: null,
                            streaming_via: 'Function URL SSE'
                          });
                          return;
                        } else if (data.startsWith('Error: ')) {
                          throw new Error(data.slice(7));
                        } else if (data.trim()) {
                          hasReceivedData = true;
                          setStreamingResult(prev => prev + data);
                        }
                      }
                    }
                  }
                }

                // If we reach here without a proper done signal, finalize
                if (hasReceivedData) {
                  setInvokeResult({
                    success: true,
                    response_data: streamingResult,
                    execution_time: null,
                    streaming_via: 'Function URL SSE'
                  });
                }
              } finally {
                reader.releaseLock();
              }
            } else {
              // Handle regular JSON response (fallback streaming)
              const result = await response.json();
              setInvokeResult({
                ...result,
                streaming_via: 'HTTP API Gateway JSON'
              });

              // Check if streaming was requested but not available
              if (result.success && result.streaming_available === false) {
                setShowStreamingWarning(true);
              }
            }
          } else {
            throw new Error('No streaming function URL available for this deployment');
          }
        } else {
          // Non-streaming Lambda invocation using sync function URL
          const syncFunctionUrl = lambdaDeployment.deployment_result.sync_function_url;

          if (syncFunctionUrl) {
            const lambdaPayload = {
              prompt: parsedPayload.user_input || parsedPayload.prompt || JSON.stringify(parsedPayload),
              input_data: parsedPayload.input_data,
              api_keys: parsedPayload.api_keys || {}
            };

            // Use backend invoke-url endpoint for Function URL with AWS IAM auth
            const response = await fetch('/api/deploy/lambda/invoke-url', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                function_url: syncFunctionUrl,
                payload: lambdaPayload,
                region: lambdaDeployment.region
              }),
            });

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            setInvokeResult({
              ...result,
              invocation_via: 'Function URL'
            });
          } else {
            throw new Error('No sync function URL available for this deployment');
          }
        }
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
              {deploymentHistory.map((deployment) => {
                const isSelected = selectedAgent && (
                  (selectedAgent.deployment_type === 'agentcore' && deployment.deployment_type === 'agentcore' &&
                   (selectedAgent as AgentCoreDeployment).agent_runtime_arn === (deployment as AgentCoreDeployment).agent_runtime_arn) ||
                  (selectedAgent.deployment_type === 'lambda' && deployment.deployment_type === 'lambda' &&
                   (selectedAgent as LambdaDeployment).deployment_id === (deployment as LambdaDeployment).deployment_id)
                );

                const agentName = deployment.deployment_type === 'agentcore'
                  ? (deployment as AgentCoreDeployment).agent_runtime_name
                  : (deployment as LambdaDeployment).agent_name;

                const uniqueKey = deployment.deployment_type === 'agentcore'
                  ? (deployment as AgentCoreDeployment).agent_runtime_arn
                  : (deployment as LambdaDeployment).deployment_id;

                // For Lambda deployments, we need to show both sync and stream details
                const lambdaDeployment = deployment.deployment_type === 'lambda' ? (deployment as LambdaDeployment) : null;

                return (
                  <div
                    key={uniqueKey}
                    className={`p-3 border rounded-md cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                    onClick={() => setSelectedAgent(deployment)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {deployment.deployment_type === 'agentcore' ? (
                            <Zap className="h-4 w-4 text-purple-600 flex-shrink-0" />
                          ) : (
                            <Cloud className="h-4 w-4 text-orange-600 flex-shrink-0" />
                          )}
                          <h3 className="text-sm font-medium text-gray-900 truncate">
                            {agentName}
                          </h3>
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded flex-shrink-0">
                            {deployment.region}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded flex-shrink-0 ${
                            deployment.deployment_type === 'agentcore'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}>
                            {deployment.deployment_type === 'agentcore' ? 'AgentCore' : 'Lambda'}
                          </span>
                        </div>
                        {/* Show deployment details */}
                        {deployment.deployment_type === 'agentcore' ? (
                          <div className="text-xs text-gray-500 mt-1 space-y-1 min-w-0">
                            {(deployment as AgentCoreDeployment).streaming_capable ? (
                              <div className="min-w-0">
                                <span className="font-medium text-green-600">Stream:</span>
                                <div className="ml-2 min-w-0">
                                  <div className="truncate">ARN: {(deployment as AgentCoreDeployment).agent_runtime_arn}</div>
                                </div>
                              </div>
                            ) : (
                              <div className="min-w-0">
                                <span className="font-medium text-blue-600">Sync:</span>
                                <div className="ml-2 min-w-0">
                                  <div className="truncate">ARN: {(deployment as AgentCoreDeployment).agent_runtime_arn}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : lambdaDeployment ? (
                          <div className="text-xs text-gray-500 mt-1 space-y-1 min-w-0">
                            {/* Sync function details */}
                            {lambdaDeployment.deployment_result.python_function_arn && (
                              <div className="min-w-0">
                                <span className="font-medium text-blue-600">Sync:</span>
                                <div className="ml-2 min-w-0">
                                  <div className="truncate">ARN: {lambdaDeployment.deployment_result.python_function_arn}</div>
                                  {lambdaDeployment.deployment_result.sync_function_url && (
                                    <div className="truncate">URL: {lambdaDeployment.deployment_result.sync_function_url}</div>
                                  )}
                                </div>
                              </div>
                            )}
                            {/* Stream function details */}
                            {lambdaDeployment.deployment_result.python_stream_function_arn && (
                              <div className="min-w-0">
                                <span className="font-medium text-green-600">Stream:</span>
                                <div className="ml-2 min-w-0">
                                  <div className="truncate">ARN: {lambdaDeployment.deployment_result.python_stream_function_arn}</div>
                                  {lambdaDeployment.deployment_result.stream_function_url && (
                                    <div className="truncate">URL: {lambdaDeployment.deployment_result.stream_function_url}</div>
                                  )}
                                </div>
                              </div>
                            )}
                            {/* Fallback for old deployment format */}
                            {!lambdaDeployment.deployment_result.python_function_arn && lambdaDeployment.deployment_result.function_arn && (
                              <div className="truncate">
                                ARN: {lambdaDeployment.deployment_result.function_arn}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAgent(deployment);
                        }}
                        className="p-1 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0 ml-2"
                        title="Delete this agent"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Agent Details */}
        {selectedAgent && (
          <div className={`p-3 border rounded-md ${
            selectedAgent.deployment_type === 'agentcore'
              ? 'bg-purple-50 border-purple-200'
              : 'bg-orange-50 border-orange-200'
          }`}>
            <h4 className={`text-sm font-medium mb-2 ${
              selectedAgent.deployment_type === 'agentcore'
                ? 'text-purple-900'
                : 'text-orange-900'
            }`}>
              {selectedAgent.deployment_type === 'agentcore' ? 'AgentCore' : 'Lambda'} Details
            </h4>
            <div className={`space-y-1 text-xs ${
              selectedAgent.deployment_type === 'agentcore'
                ? 'text-purple-800'
                : 'text-orange-800'
            }`}>
              {selectedAgent.deployment_type === 'agentcore' ? (
                <>
                  <p><strong>Name:</strong> {(selectedAgent as AgentCoreDeployment).agent_runtime_name}</p>
                  <p><strong>Region:</strong> {selectedAgent.region}</p>
                  <p><strong>Method:</strong> {(selectedAgent as AgentCoreDeployment).deployment_method}</p>
                  <p><strong>Network:</strong> {(selectedAgent as AgentCoreDeployment).network_mode}</p>
                  <p><strong>Deployed:</strong> {new Date((selectedAgent as AgentCoreDeployment).saved_at).toLocaleString()}</p>
                </>
              ) : (
                <>
                  <p><strong>Name:</strong> {(selectedAgent as LambdaDeployment).agent_name}</p>
                  <p><strong>Region:</strong> {selectedAgent.region}</p>
                  <p><strong>Type:</strong> Lambda Function</p>
                  {(selectedAgent as LambdaDeployment).deployment_result.api_endpoint && (
                    <p><strong>API Endpoint:</strong> Available</p>
                  )}
                  {(selectedAgent as LambdaDeployment).deployment_result.streaming_capable !== undefined && (
                    <p><strong>Streaming:</strong> {(selectedAgent as LambdaDeployment).deployment_result.streaming_capable ? 'Supported' : 'Not Supported'}</p>
                  )}
                  {(selectedAgent as LambdaDeployment).deployment_result.deployment_type && (
                    <p><strong>Deployment:</strong> {(selectedAgent as LambdaDeployment).deployment_result.deployment_type === 'streaming' ? 'HTTP API (Streaming)' : 'REST API (Regular)'}</p>
                  )}
                  <p><strong>Deployed:</strong> {new Date((selectedAgent as LambdaDeployment).created_at).toLocaleString()}</p>
                </>
              )}
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


        {/* Session ID - Only for AgentCore */}
        {selectedAgent && selectedAgent.deployment_type === 'agentcore' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Session ID (Required for AgentCore)</label>
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
        )}

        {/* Invoke Button */}
        <div>
          <button
            onClick={handleInvokeAgent}
            disabled={
              !selectedAgent ||
              !payload ||
              (selectedAgent?.deployment_type === 'agentcore' && !sessionId) ||
              isInvoking
            }
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isInvoking
              ? isStreamingCapable
                ? 'Streaming...'
                : 'Invoking...'
              : selectedAgent?.deployment_type === 'lambda'
                ? isStreamingCapable
                  ? 'Invoke Lambda Function'
                  : 'Invoke Lambda Function'
                : isStreamingCapable
                  ? 'Invoke AgentCore Agent'
                  : 'Invoke AgentCore Agent'
            }
          </button>
        </div>

        {/* Streaming Result (Lambda) - shown during and after streaming */}
        {streamingResult && selectedAgent?.deployment_type === 'lambda' && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-2">
              <Waves className="h-4 w-4 text-blue-600 animate-pulse" />
              Streaming Response
            </h4>
            <div className="bg-black text-green-400 p-3 rounded text-xs font-mono overflow-auto max-h-64">
              <div className="whitespace-pre-wrap">
                {streamingResult}
                {isInvoking && (
                  <span className="animate-pulse">▋</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Streaming Response (AgentCore) */}
        {((isInvoking && isStreamingCapable) || streamContent.length > 0) && selectedAgent?.deployment_type === 'agentcore' && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">
              Streaming Response
              {(isInvoking && isStreamingCapable) && (
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
                {(isInvoking && isStreamingCapable) && (
                  <span className="animate-pulse">▋</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Invoke Result */}
        {invokeResult && (
          (selectedAgent?.deployment_type === 'agentcore' && !((isInvoking && isStreamingCapable) || streamContent.length > 0)) ||
          (selectedAgent?.deployment_type === 'lambda' && !streamingResult)
        ) && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">
              {isStreamingCapable ? 'Final Result' : 'Invoke Result'}
            </h4>

            {/* Show streaming capability info if available */}
            {invokeResult.success && (invokeResult.streaming_available === false || invokeResult.streaming_requested) && (
              <div className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                {invokeResult.streaming_available === false ? (
                  <div className="flex items-center gap-1">
                    <span>ℹ️</span>
                    <span>Generated code does not support streaming. {invokeResult.message || 'Agent executed in regular mode.'}</span>
                  </div>
                ) : invokeResult.streaming_captured ? (
                  <div className="flex items-center gap-1">
                    <span>✅</span>
                    <span>Streaming output captured ({invokeResult.chunks_captured} chunks)</span>
                  </div>
                ) : invokeResult.streaming_simulated ? (
                  <div className="flex items-center gap-1">
                    <span>🔄</span>
                    <span>Streaming simulated ({invokeResult.chunks_collected} chunks collected)</span>
                  </div>
                ) : invokeResult.streaming_fallback ? (
                  <div className="flex items-center gap-1">
                    <span>⚠️</span>
                    <span>Streaming fallback used - executed in regular mode</span>
                  </div>
                ) : null}
              </div>
            )}

            <div className={`p-3 rounded overflow-auto max-h-64 ${
              invokeResult.success
                ? 'bg-black text-green-400 text-xs font-mono'
                : 'bg-red-50 border border-red-200 text-red-800 text-sm'
            }`}>
              {invokeResult.success ? (
                // Show only the agent's response for successful invocations
                <div className="whitespace-pre-wrap font-normal">
                  {(() => {
                    // For streaming, show the accumulated result
                    if (isStreamingCapable && streamingResult) {
                      return streamingResult;
                    }

                    // Handle Function URL response format
                    let responseText = 'Agent executed successfully (no response)';

                    // Check if invokeResult itself has the Function URL format
                    if (invokeResult.success && invokeResult.response) {
                      responseText = invokeResult.response;
                    } else if (invokeResult.response_data) {
                      // Handle nested response_data
                      const responseData = invokeResult.response_data;

                      if (typeof responseData === 'object' && responseData !== null) {
                        // Check for Function URL response format {success: true, response: "..."}
                        if (responseData.success && responseData.response) {
                          responseText = responseData.response;
                        }
                        // Check for Lambda response format {statusCode, body}
                        else if ('statusCode' in responseData && 'body' in responseData) {
                          try {
                            const bodyData = typeof responseData.body === 'string'
                              ? JSON.parse(responseData.body)
                              : responseData.body;

                            if (bodyData && typeof bodyData === 'object' && 'response' in bodyData) {
                              responseText = bodyData.response;
                            } else if (bodyData && typeof bodyData === 'object' && 'success' in bodyData) {
                              responseText = bodyData.success ? (bodyData.response || 'Success') : (bodyData.error || 'Failed');
                            } else {
                              responseText = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
                            }
                          } catch (e) {
                            responseText = JSON.stringify(responseData.body);
                          }
                        }
                        // Other object formats
                        else {
                          responseText = JSON.stringify(responseData);
                        }
                      } else if (typeof responseData === 'string') {
                        // Try to parse string response
                        if (responseData.startsWith('{')) {
                          try {
                            const parsed = JSON.parse(responseData);
                            if (parsed.success && parsed.response) {
                              responseText = parsed.response;
                            } else {
                              responseText = responseData;
                            }
                          } catch (e) {
                            responseText = responseData;
                          }
                        } else {
                          responseText = responseData;
                        }
                      }
                    }

                    // Ensure we always return a string for React rendering
                    return typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
                  })()}
                </div>
              ) : (
                // Show error message for failed invocations
                <div>
                  <div className="font-medium mb-2">Error:</div>
                  <div className="whitespace-pre-wrap font-normal">
                    {invokeResult.error || 'Unknown error occurred'}
                  </div>
                </div>
              )}
            </div>
            {/* Show execution details in a smaller, less prominent way */}
            {invokeResult.success && invokeResult.execution_context && (
              <div className="mt-2 text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>Function: {invokeResult.execution_context.function_name}</span>
                  {invokeResult.execution_context.remaining_time && (
                    <span>Remaining: {Math.round(invokeResult.execution_context.remaining_time / 1000)}s</span>
                  )}
                </div>
                {invokeResult.execution_time && (
                  <div className="mt-1">
                    <span>Execution time: {invokeResult.execution_time.toFixed(2)}s</span>
                  </div>
                )}
                {(invokeResult.streaming_via || invokeResult.invocation_via) && (
                  <div className="mt-1">
                    <span>Via: {invokeResult.streaming_via || invokeResult.invocation_via}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Streaming Warning Modal */}
      {showStreamingWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0">
                <svg className="h-8 w-8 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-lg font-medium text-gray-900">
                  Non-Streaming Code Detected
                </h3>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-sm text-gray-600 mb-3">
                The deployed Lambda function was generated with non-streaming code, but you requested streaming mode.
              </p>
              <p className="text-sm text-gray-600 mb-3">
                To enable streaming:
              </p>
              <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1 ml-2">
                <li>Go back to the flow editor</li>
                <li>Select your Agent node</li>
                <li>Check the "Enable Streaming" checkbox in the property panel</li>
                <li>Regenerate and redeploy the Lambda function</li>
                <li className="text-xs text-gray-500 italic">
                  (The new deployment will use HTTP API with Response Streaming support)
                </li>
              </ol>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowStreamingWarning(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Got it
              </button>
              <button
                onClick={() => {
                  setShowStreamingWarning(false);
                  // Streaming automatically determined by deployment capability
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Disable Streaming
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
        <div className="flex justify-between">
          <span>Invoke Agent Runtime</span>
          <span>{deploymentHistory.length} agent(s) available</span>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={deleteModal.isOpen}
        agentName={deleteModal.agentName}
        deploymentType={deleteModal.deploymentType}
        identifier={deleteModal.identifier}
        region={deleteModal.region}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  );
}
