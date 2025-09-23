import { useState, useEffect } from 'react';
import { Play, RefreshCw, Trash2, X, Cloud, Zap } from 'lucide-react';

interface AgentCoreDeployment {
  agent_runtime_arn: string;
  agent_runtime_name: string;
  invoke_endpoint: string;
  deployment_method: string;
  region: string;
  network_mode: string;
  saved_at: string;
  deployment_type: 'agentcore';
}

interface LambdaDeployment {
  deployment_id: string;
  agent_name: string;
  region: string;
  deployment_result: {
    function_arn: string;
    api_endpoint?: string;
  };
  created_at: string;
  deployment_type: 'lambda';
}

type DeploymentHistory = AgentCoreDeployment | LambdaDeployment;

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

      // Load AgentCore deployments from localStorage
      try {
        const saved = localStorage.getItem('agentcore_deployments');
        if (saved) {
          const agentCoreDeployments = JSON.parse(saved);
          const typedAgentCore = agentCoreDeployments.map((dep: any) => ({
            ...dep,
            deployment_type: 'agentcore' as const
          }));
          allDeployments.push(...typedAgentCore);
        }
      } catch (error) {
        console.error('Failed to load AgentCore deployments:', error);
      }

      // Load Lambda deployments from API
      try {
        const response = await fetch('/api/deployment-history');
        if (response.ok) {
          const historyData = await response.json();
          const lambdaDeployments = historyData.deployments?.filter(
            (dep: any) => dep.deployment_target === 'lambda' && dep.success
          ) || [];

          const typedLambda: LambdaDeployment[] = lambdaDeployments.map((dep: any) => ({
            deployment_id: dep.deployment_id,
            agent_name: dep.agent_name,
            region: dep.region,
            deployment_result: dep.deployment_result || {},
            created_at: dep.created_at,
            deployment_type: 'lambda' as const
          }));

          allDeployments.push(...typedLambda);
        }
      } catch (error) {
        console.error('Failed to load Lambda deployments:', error);
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

  // Clear deployment history
  const clearDeploymentHistory = () => {
    localStorage.removeItem('agentcore_deployments');
    setDeploymentHistory([]);
    setSelectedAgent(null);
  };

  // Delete single agent from deployment history
  const deleteAgent = async (deployment: DeploymentHistory) => {
    try {
      if (deployment.deployment_type === 'agentcore') {
        // Delete from localStorage for AgentCore
        const saved = localStorage.getItem('agentcore_deployments');
        if (saved) {
          const deployments = JSON.parse(saved);
          const filteredDeployments = deployments.filter(
            (dep: any) => dep.agent_runtime_arn !== deployment.agent_runtime_arn
          );
          localStorage.setItem('agentcore_deployments', JSON.stringify(filteredDeployments));
        }
      } else if (deployment.deployment_type === 'lambda') {
        // Delete from backend API for Lambda
        try {
          await fetch(`/api/deployment-history/${deployment.deployment_id}`, {
            method: 'DELETE',
          });
        } catch (error) {
          console.error('Failed to delete Lambda deployment:', error);
        }
      }

      // Reload the deployment history
      await loadDeploymentHistory();

      // Clear selection if the deleted deployment was selected
      if (selectedAgent &&
          ((selectedAgent.deployment_type === 'agentcore' && deployment.deployment_type === 'agentcore' &&
            (selectedAgent as AgentCoreDeployment).agent_runtime_arn === (deployment as AgentCoreDeployment).agent_runtime_arn) ||
           (selectedAgent.deployment_type === 'lambda' && deployment.deployment_type === 'lambda' &&
            (selectedAgent as LambdaDeployment).deployment_id === (deployment as LambdaDeployment).deployment_id))) {
        setSelectedAgent(null);
      }
    } catch (error) {
      console.error('Failed to delete agent:', error);
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
            region: selectedAgent.region
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        setInvokeResult(result);
      } else if (selectedAgent.deployment_type === 'lambda') {
        // Lambda invocation
        const lambdaDeployment = selectedAgent as LambdaDeployment;

        if (lambdaDeployment.deployment_result.api_endpoint) {
          // Use API Gateway endpoint if available
          // Convert user_input to prompt format expected by Lambda handler
          const lambdaPayload = {
            prompt: parsedPayload.user_input || parsedPayload.prompt || JSON.stringify(parsedPayload),
            input_data: parsedPayload.input_data,
            api_keys: parsedPayload.api_keys || {}
          };

          // Ensure the API endpoint has the correct path
          let apiUrl = lambdaDeployment.deployment_result.api_endpoint;
          if (!apiUrl.endsWith('/execute')) {
            apiUrl = apiUrl.endsWith('/') ? apiUrl + 'execute' : apiUrl + '/execute';
          }

          console.log('Invoking Lambda at URL:', apiUrl);
          console.log('Payload:', lambdaPayload);

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(lambdaPayload),
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const result = await response.json();

          // Lambda returns different format: {statusCode, body}
          if (result.statusCode && result.body) {
            const bodyData = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
            if (bodyData.success) {
              setInvokeResult({
                success: true,
                response_data: bodyData.response,
                execution_time: bodyData.execution_context?.remaining_time || null,
                execution_context: bodyData.execution_context
              });
            } else {
              throw new Error(bodyData.error || 'Lambda execution failed');
            }
          } else {
            // Direct API Gateway response format
            setInvokeResult({
              success: true,
              response_data: typeof result === 'string' ? result : JSON.stringify(result),
              execution_time: null
            });
          }
        } else {
          // Direct Lambda invocation via AWS SDK (requires backend endpoint)
          const response = await fetch('/api/deploy/lambda/invoke', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              function_arn: lambdaDeployment.deployment_result.function_arn,
              payload: parsedPayload,
              region: lambdaDeployment.region
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const result = await response.json();
          setInvokeResult(result);
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

                const identifier = deployment.deployment_type === 'agentcore'
                  ? (deployment as AgentCoreDeployment).agent_runtime_arn
                  : (deployment as LambdaDeployment).deployment_result.function_arn || 'No ARN';

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
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {deployment.deployment_type === 'agentcore' ? (
                            <Zap className="h-4 w-4 text-purple-600" />
                          ) : (
                            <Cloud className="h-4 w-4 text-orange-600" />
                          )}
                          <h3 className="text-sm font-medium text-gray-900">
                            {agentName}
                          </h3>
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                            {deployment.region}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            deployment.deployment_type === 'agentcore'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}>
                            {deployment.deployment_type === 'agentcore' ? 'AgentCore' : 'Lambda'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 truncate">
                          {identifier}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAgent(deployment);
                        }}
                        className="p-1 text-gray-400 hover:text-red-600 transition-colors"
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
              ? 'Invoking...'
              : selectedAgent?.deployment_type === 'lambda'
                ? 'Invoke Lambda Function'
                : 'Invoke AgentCore Agent'
            }
          </button>
        </div>

        {/* Invoke Result */}
        {invokeResult && (
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
