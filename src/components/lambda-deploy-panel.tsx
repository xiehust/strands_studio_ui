import { useEffect, useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { type Node, type Edge } from '@xyflow/react';
import { Download, Copy, CheckCircle, Cloud, AlertCircle, Edit3, Save, RotateCcw, History, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { generateStrandsAgentCode } from '../lib/code-generator';
import { apiClient, type DeploymentHistoryItem } from '../lib/api-client';

interface LambdaDeployPanelProps {
  nodes: Node[];
  edges: Edge[];
  graphMode?: boolean;
  className?: string;
}


interface LambdaDeploymentState {
  config: {
    functionName: string;
    memorySize: number;
    timeout: number;
    runtime: string;
    architecture: string;
    region: string;
    stackName?: string;
    projectId?: string;
    version?: string;
    enableApiGateway: boolean;
    enableFunctionUrl: boolean;
  };
  isDeploying: boolean;
  deploymentResult?: any;
  error?: string;
}

export function LambdaDeployPanel({ nodes, edges, graphMode = false, className = '' }: LambdaDeployPanelProps) {
  const [activeTab, setActiveTab] = useState<'configuration' | 'code-preview'>('configuration');
  const [generatedCode, setGeneratedCode] = useState('');
  const [editableCode, setEditableCode] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [showDeploymentLogs, setShowDeploymentLogs] = useState(false);
  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [deploymentSteps, setDeploymentSteps] = useState<Array<{
    step: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    message?: string;
  }>>([]);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [currentDeploymentId, setCurrentDeploymentId] = useState<string | null>(null);

  // Use websocket to avoid unused variable warning
  console.log('WebSocket state:', websocket ? 'connected' : 'disconnected');

  const [deploymentState, setDeploymentState] = useState<LambdaDeploymentState>({
    config: {
      functionName: '',
      memorySize: 512,
      timeout: 300,
      runtime: 'python3.12',
      architecture: 'x86_64',
      region: 'us-east-1',
      projectId: '',
      version: 'v1.0.0',
      enableApiGateway: false,  // Fixed: No API Gateway
      enableFunctionUrl: true,  // Fixed: Always use Function URL
    },
    isDeploying: false,
  });

  useEffect(() => {
    const result = generateStrandsAgentCode(nodes, edges, graphMode);
    const fullCode = result.imports.join('\n') + '\n\n' + result.code;
    setGeneratedCode(fullCode);
    setEditableCode(fullCode);
    setErrors(result.errors);
    setIsEditing(false);
  }, [nodes, edges, graphMode]);

  // Load deployment history on component mount
  useEffect(() => {
    loadDeploymentHistory();
  }, []);

  // Store current deployment ID globally to avoid closure issues
  useEffect(() => {
    (window as any).__currentDeploymentId = currentDeploymentId;
    console.log('🔄 Updated global deployment ID:', currentDeploymentId);
  }, [currentDeploymentId]);

  // Define updateDeploymentStep before it's used in useEffect
  const updateDeploymentStep = useCallback((stepName: string, status: 'pending' | 'running' | 'completed' | 'error', message?: string) => {
    console.log(`🔄 updateDeploymentStep called: ${stepName} -> ${status}`, message);
    setDeploymentSteps(prev => {
      const existingIndex = prev.findIndex(s => s.step === stepName);
      console.log(`📊 Current steps before update:`, prev);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { step: stepName, status, message };
        console.log(`📊 Updated existing step at index ${existingIndex}:`, updated);
        return updated;
      } else {
        const newSteps = [...prev, { step: stepName, status, message }];
        console.log(`📊 Added new step:`, newSteps);
        return newSteps;
      }
    });
  }, []);

  // WebSocket connection management with global singleton approach
  useEffect(() => {
    const connectWebSocket = () => {
      // Check if there's already a global WebSocket connection
      if ((window as any).__globalWebSocket && (window as any).__globalWebSocket.readyState === WebSocket.OPEN) {
        console.log('🔗 Reusing existing WebSocket connection');
        setWebsocket((window as any).__globalWebSocket);
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      console.log('🔌 Creating new WebSocket connection:', wsUrl);

      const ws = new WebSocket(wsUrl);
      (window as any).__globalWebSocket = ws;

      ws.onopen = () => {
        console.log('✅ WebSocket connected');
        setWebsocket(ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 Raw WebSocket message:', event.data);
          console.log('📨 Parsed WebSocket data:', data);

          if (data.type === 'deployment_progress') {
            console.log(`🔄 Deployment progress: ${data.step} - ${data.status}`);
            console.log('🆔 Message deployment_id:', data.deployment_id);
            console.log('🆔 Current global deployment_id:', (window as any).__currentDeploymentId);
            // Broadcast to all listeners
            window.dispatchEvent(new CustomEvent('deployment-progress', { detail: data }));
            console.log('✅ Custom event dispatched');
          }
        } catch (error) {
          console.error('❌ WebSocket message parse error:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('❌ WebSocket closed:', event.code, event.reason);
        setWebsocket(null);
        (window as any).__globalWebSocket = null;

        // Auto-reconnect after a delay unless it's a normal close
        if (event.code !== 1000) {
          console.log('🔄 WebSocket will reconnect in 5 seconds...');
          setTimeout(() => {
            connectWebSocket();
          }, 5000);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };
    };

    // Event listener for deployment progress
    const handleDeploymentProgress = (event: CustomEvent) => {
      const data = event.detail;
      console.log('📨 handleDeploymentProgress called with data:', data);

      // Only process messages for the current deployment
      const currentId = (window as any).__currentDeploymentId;
      const idMatch = data.deployment_id === currentId;

      console.log('🔍 ID Comparison:');
      console.log('  - Received ID:', data.deployment_id);
      console.log('  - Current ID:', currentId);
      console.log('  - Match:', idMatch);

      if (data.deployment_id && currentId && !idMatch) {
        console.log(`🚫 IGNORING: Different deployment ID`);
        return;
      }

      console.log(`✅ PROCESSING: ${data.step} -> ${data.status}`);
      updateDeploymentStep(data.step, data.status, data.message);
    };

    // Add event listener
    window.addEventListener('deployment-progress', handleDeploymentProgress as EventListener);

    // Connect WebSocket
    connectWebSocket();

    // Cleanup function
    return () => {
      window.removeEventListener('deployment-progress', handleDeploymentProgress as EventListener);
      // Don't close the global WebSocket - let it persist for other components
    };
  }, [updateDeploymentStep]); // Include updateDeploymentStep in dependencies

  const handleDownload = () => {
    const codeToUse = isEditing ? editableCode : generatedCode;
    const blob = new Blob([codeToUse], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strands_agent.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyToClipboard = async () => {
    try {
      const codeToUse = isEditing ? editableCode : generatedCode;
      await navigator.clipboard.writeText(codeToUse);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const copyToClipboard = async (text: string, itemKey: string, successMessage: string = 'Copied!') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(itemKey);
      setTimeout(() => setCopiedItem(null), 2000);
      console.log(successMessage, text);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const handleEditCode = () => {
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    setGeneratedCode(editableCode);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditableCode(generatedCode);
    setIsEditing(false);
  };

  const handleCodeChange = (value: string | undefined) => {
    if (value !== undefined) {
      setEditableCode(value);
    }
  };

  // Load deployment history from persistent storage
  const loadDeploymentHistory = async () => {
    try {
      console.log('🔄 Loading Lambda deployment history...');
      const response = await apiClient.getDeploymentHistory(
        undefined, // project_id - load all projects
        undefined, // version - load all versions
        20 // limit to recent 20 deployments
      );
      console.log('📊 Raw deployment history response:', response);

      // Filter for Lambda deployments only
      const lambdaDeployments = response.deployments?.filter(
        deployment => {
          console.log(`🔍 Checking deployment: ${deployment.deployment_id}, target: ${deployment.deployment_target}`);
          return deployment.deployment_target === 'lambda';
        }
      ) || [];

      console.log('✅ Filtered Lambda deployments:', lambdaDeployments);
      setDeploymentHistory(lambdaDeployments);
    } catch (error) {
      console.error('Failed to load deployment history:', error);
    }
  };

  // Delete deployment from history
  const deleteFromHistory = async (deploymentId: string) => {
    try {
      await apiClient.deleteDeploymentHistoryItem(deploymentId);
      setDeploymentHistory(prev => prev.filter(entry => entry.deployment_id !== deploymentId));
      if (expandedHistoryId === deploymentId) {
        setExpandedHistoryId(null);
      }
    } catch (error) {
      console.error('Failed to delete from deployment history:', error);
    }
  };

  // Toggle history entry expansion
  const toggleHistoryExpansion = (id: string) => {
    setExpandedHistoryId(expandedHistoryId === id ? null : id);
  };

  const validateFunctionName = (name: string): string | null => {
    if (!name.trim()) return 'Function name is required';
    if (name.length < 1 || name.length > 64) return 'Function name must be 1-64 characters';
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return 'Function name can only contain letters, numbers, hyphens, and underscores';
    return null;
  };

  const handleConfigChange = (field: keyof LambdaDeploymentState['config'], value: string | number | boolean) => {
    const newConfig = { ...deploymentState.config, [field]: value };
    setDeploymentState(prev => ({ ...prev, config: newConfig }));

    // Validate fields
    if (field === 'functionName' && typeof value === 'string') {
      const error = validateFunctionName(value);
      setFormErrors(prev => ({ ...prev, functionName: error || '' }));
    }
  };


  // Extract API key requirements from generated code
  const extractApiKeyRequirements = (code: string): Record<string, string> => {
    const apiKeys: Record<string, string> = {};

    // Extract API keys from agent nodes in the flow
    const agentNodes = nodes.filter(node => node.type === 'agent' || node.type === 'orchestrator-agent');

    for (const node of agentNodes) {
      // Check for OpenAI API key in node properties
      if (node.data?.modelProvider === 'OpenAI' && node.data?.apiKey && typeof node.data.apiKey === 'string') {
        apiKeys.openai_api_key = node.data.apiKey.trim();
      }

      // Check for Anthropic API key in node properties (if implemented)
      if (node.data?.modelProvider === 'Anthropic' && node.data?.apiKey && typeof node.data.apiKey === 'string') {
        apiKeys.anthropic_api_key = node.data.apiKey.trim();
      }
    }

    // Fallback: Look for API key usage in code and try environment variables
    if (code.includes('OPENAI_API_KEY') && !apiKeys.openai_api_key) {
      const envKey = import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.OPENAI_API_KEY;
      if (envKey && envKey.trim()) {
        apiKeys.openai_api_key = envKey.trim();
      }
    }

    if (code.includes('ANTHROPIC_API_KEY') && !apiKeys.anthropic_api_key) {
      const envKey = import.meta.env.VITE_ANTHROPIC_API_KEY || import.meta.env.ANTHROPIC_API_KEY;
      if (envKey && envKey.trim()) {
        apiKeys.anthropic_api_key = envKey.trim();
      }
    }

    return apiKeys;
  };

  const canDeploy = () => {
    return (
      generatedCode.trim() !== '' &&
      deploymentState.config.functionName.trim() !== '' &&
      !formErrors.functionName &&
      !deploymentState.isDeploying
    );
  };

  const handleDeploy = async () => {
    setDeploymentState(prev => ({ ...prev, isDeploying: true, error: undefined, deploymentResult: undefined }));
    setDeploymentSteps([]);

    // Generate deployment ID and set it for WebSocket filtering
    const deploymentId = crypto.randomUUID();
    setCurrentDeploymentId(deploymentId);
    // CRITICAL: Set global variable immediately to catch early WebSocket messages
    (window as any).__currentDeploymentId = deploymentId;
    console.log('🚀 Starting deployment with ID:', deploymentId);

    // Start with initial deployment steps
    updateDeploymentStep('Initializing deployment', 'running');

    // Prepare deployment request - use edited code if available
    const codeToUse = isEditing ? editableCode : generatedCode;

    // Extract API key requirements from the code
    const apiKeyRequirements = extractApiKeyRequirements(codeToUse);
    console.log('Detected API key requirements:', Object.keys(apiKeyRequirements));

    try {
      const deploymentRequest = {
        deployment_type: 'lambda',
        deployment_id: deploymentId,
        code: codeToUse,
        function_name: deploymentState.config.functionName,
        memory_size: deploymentState.config.memorySize,
        timeout: deploymentState.config.timeout,
        runtime: deploymentState.config.runtime,
        architecture: deploymentState.config.architecture,
        region: deploymentState.config.region,
        stack_name: deploymentState.config.stackName || undefined,
        project_id: deploymentState.config.projectId || undefined,
        version: deploymentState.config.version || undefined,
        enable_api_gateway: deploymentState.config.enableApiGateway,
        enable_function_url: deploymentState.config.enableFunctionUrl,
        api_keys: apiKeyRequirements, // Add API key requirements
      };

      console.log('Deploying Lambda with config:', deploymentRequest);

      updateDeploymentStep('Initializing deployment', 'completed');
      updateDeploymentStep('Sending deployment request', 'running');

      // Call backend API
      const response = await fetch('/api/deploy/lambda', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(deploymentRequest),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Deployment failed' }));
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      updateDeploymentStep('Sending deployment request', 'completed');
      updateDeploymentStep('Processing deployment', 'running');

      const result = await response.json();

      // Verify the deployment ID matches (should be the same)
      if (result.deployment_id && result.deployment_id !== deploymentId) {
        console.warn('⚠️ Deployment ID mismatch:', result.deployment_id, 'vs', deploymentId);
      }

      // Check if deployment actually succeeded
      if (!result.success) {
        throw new Error(result.message || 'Deployment failed');
      }

      updateDeploymentStep('Processing deployment', 'completed');
      updateDeploymentStep('Deployment completed successfully', 'completed');

      setDeploymentState(prev => ({
        ...prev,
        isDeploying: false,
        deploymentResult: result
      }));

      // Refresh deployment history
      await loadDeploymentHistory();

      // Keep deployment ID for a bit longer to allow late WebSocket messages
      setTimeout(() => {
        setCurrentDeploymentId(null);
      }, 5000); // Clear after 5 seconds

    } catch (error) {
      // Mark any pending steps as error
      setDeploymentSteps(prev => prev.map(step =>
        step.status === 'pending' || step.status === 'running'
          ? { ...step, status: 'error' as const, message: error instanceof Error ? error.message : 'Failed' }
          : step
      ));

      setDeploymentState(prev => ({
        ...prev,
        isDeploying: false,
        error: error instanceof Error ? error.message : 'Deployment failed'
      }));

      // Clear deployment ID after failed deployment
      setCurrentDeploymentId(null);
    }
  };

  return (
    <div className={`bg-white border-l border-gray-200 flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center">
          <Cloud className="w-4 h-4 text-orange-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Deploy to Lambda</h3>
        </div>
        <div className="flex space-x-2">
          {/* Tab Buttons */}
          <button
            onClick={() => setActiveTab('configuration')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              activeTab === 'configuration'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Config
          </button>
          <button
            onClick={() => setActiveTab('code-preview')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              activeTab === 'code-preview'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Code
          </button>
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="p-4 bg-red-50 border-b border-red-200">
          <div className="flex items-center mb-2">
            <AlertCircle className="w-4 h-4 text-red-500 mr-2" />
            <span className="text-sm font-medium text-red-800">Code Generation Errors</span>
          </div>
          <ul className="text-sm text-red-700">
            {errors.map((error, index) => (
              <li key={index} className="mb-1">• {error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'configuration' ? (
          <div className="p-4 h-full overflow-y-auto">
            {/* Configuration Content */}
            <div className="space-y-6">
              {/* Basic Configuration */}
              <div className="space-y-4">
                <label className="text-sm font-medium text-gray-900">Lambda Configuration</label>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="functionName" className="text-sm text-gray-700">Function Name *</label>
                    <input
                      id="functionName"
                      type="text"
                      value={deploymentState.config.functionName}
                      onChange={(e) => handleConfigChange('functionName', e.target.value)}
                      placeholder="my-strands-agent"
                      className={`w-full px-3 py-2 border rounded-md text-sm ${
                        formErrors.functionName ? 'border-red-500' : 'border-gray-300'
                      } focus:outline-none focus:ring-2 focus:ring-orange-500`}
                    />
                    {formErrors.functionName && (
                      <p className="text-xs text-red-600 mt-1">{formErrors.functionName}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="memorySize" className="text-sm text-gray-700">Memory (MB)</label>
                      <select
                        id="memorySize"
                        value={deploymentState.config.memorySize}
                        onChange={(e) => handleConfigChange('memorySize', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value={128}>128 MB</option>
                        <option value={256}>256 MB</option>
                        <option value={512}>512 MB</option>
                        <option value={1024}>1024 MB</option>
                        <option value={2048}>2048 MB</option>
                        <option value={3008}>3008 MB</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="timeout" className="text-sm text-gray-700">Timeout (sec)</label>
                      <input
                        id="timeout"
                        type="number"
                        min="3"
                        max="900"
                        value={deploymentState.config.timeout}
                        onChange={(e) => handleConfigChange('timeout', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="runtime" className="text-sm text-gray-700">Runtime</label>
                      <select
                        id="runtime"
                        value={deploymentState.config.runtime}
                        onChange={(e) => handleConfigChange('runtime', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="python3.12">python3.12</option>
                        <option value="python3.13">python3.13</option>
                      </select>
                      {/* <p className="text-xs text-gray-500 mt-1">Only Python 3.12 is currently available (more versions coming soon)</p> */}
                    </div>

                    <div>
                      <label htmlFor="architecture" className="text-sm text-gray-700">Architecture</label>
                      <select
                        id="architecture"
                        value={deploymentState.config.architecture}
                        onChange={(e) => handleConfigChange('architecture', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="x86_64">x86_64</option>
                        <option value="arm64">arm64</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <span className="text-orange-400">💡</span>
                        <span className="text-orange-400">Choose the same architecture as your deployment host for consistancy</span>
                      </p>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="region" className="text-sm text-gray-700">Region</label>
                    <select
                      id="region"
                      value={deploymentState.config.region}
                      onChange={(e) => handleConfigChange('region', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="us-east-1">us-east-1 (N. Virginia)</option>
                      <option value="us-west-2">us-west-2 (Oregon)</option>
                      <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
                      <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
                      <option value="ap-southeast-2">ap-southeast-2 (Sydney)</option>
                      <option value="cn-north-1">cn-north-1 (Beijing)</option>
                      <option value="cn-northwest-1">ap-northwest-1 (Ningxia)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Optional Configuration */}
              <div className="space-y-4">
                <label className="text-sm font-medium text-gray-900">Optional Settings</label>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="stackName" className="text-sm text-gray-700">Stack Name (Optional)</label>
                    <input
                      id="stackName"
                      type="text"
                      value={deploymentState.config.stackName || ''}
                      onChange={(e) => handleConfigChange('stackName', e.target.value)}
                      placeholder="strands-agent-stack"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="projectId" className="text-sm text-gray-700">Project ID (Optional)</label>
                      <input
                        id="projectId"
                        type="text"
                        value={deploymentState.config.projectId || ''}
                        onChange={(e) => handleConfigChange('projectId', e.target.value)}
                        placeholder="my-project-id"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>

                    <div>
                      <label htmlFor="version" className="text-sm text-gray-700">Version</label>
                      <input
                        id="version"
                        type="text"
                        value={deploymentState.config.version || ''}
                        onChange={(e) => handleConfigChange('version', e.target.value)}
                        placeholder="v1.0.0"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>

                </div>
              </div>


              {/* Deploy Actions */}
              <div className="space-y-3 pt-4 border-t border-gray-200">
                {/* Deploy Button */}
                <button
                  onClick={handleDeploy}
                  disabled={!canDeploy()}
                  className="w-full px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {deploymentState.isDeploying ? 'Deploying...' : 'Deploy to Lambda'}
                </button>

                {/* Deployment Steps Display */}
                {deploymentSteps.length > 0 && (
                  <div className="mt-4 p-3 bg-black text-green-400 rounded text-xs font-mono">
                    <div className="space-y-1">
                      {deploymentSteps.map((step, index) => (
                        <div key={index} className="flex items-center space-x-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${
                            step.status === 'completed' ? 'bg-green-400' :
                            step.status === 'running' ? 'bg-yellow-400 animate-pulse' :
                            step.status === 'error' ? 'bg-red-400' :
                            'bg-gray-600'
                          }`}></span>
                          <span className={`${
                            step.status === 'error' ? 'text-red-400' :
                            step.status === 'completed' ? 'text-green-400' :
                            step.status === 'running' ? 'text-yellow-400' :
                            'text-gray-400'
                          }`}>
                            {step.step}
                            {step.status === 'running' && ' ...'}
                            {step.status === 'completed' && ' ✓'}
                            {step.status === 'error' && ' ✗'}
                          </span>
                        </div>
                      ))}
                      {deploymentSteps.some(step => step.status === 'error' && step.message) && (
                        <div className="mt-2 text-red-400 text-xs">
                          Error: {deploymentSteps.find(step => step.status === 'error' && step.message)?.message}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Deployment History */}
              <div className="pt-4 border-t border-gray-200">
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center justify-between w-full text-left text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                  <div className="flex items-center">
                    <History className="w-4 h-4 mr-2" />
                    Deploy History ({deploymentHistory.length})
                  </div>
                  {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showHistory && (
                  <div className="border-t border-gray-200">
                    <div className="p-3 bg-gray-50 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Cloud className="w-4 h-4 text-gray-600" />
                        <h4 className="text-sm font-medium text-gray-700">Lambda Deployments</h4>
                      </div>
                      <button
                        onClick={loadDeploymentHistory}
                        className="text-xs text-orange-600 hover:text-orange-800"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="max-h-40 overflow-auto">
                      {deploymentHistory.length === 0 ? (
                        <div className="p-4 text-center text-xs text-gray-500">
                          No Lambda deployments available
                        </div>
                      ) : (
                        deploymentHistory.slice(0, 10).map((entry) => (
                          <div
                            key={entry.deployment_id}
                            className={`p-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                              expandedHistoryId === entry.deployment_id ? 'bg-orange-50' : ''
                            }`}
                            onClick={() => toggleHistoryExpansion(entry.deployment_id)}
                            title={`Deployment ID: ${entry.deployment_id}`}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center space-x-2">
                                <Cloud className="w-3 h-3 text-gray-500" />
                                <span className="text-gray-700">
                                  {entry.deployment_id.substring(0, 12)}...
                                </span>
                                <span className={`text-xs px-1 rounded ${
                                  entry.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                }`}>
                                  {entry.success ? '✓' : '✗'}
                                </span>
                                <span className="text-xs bg-orange-100 px-1 rounded text-orange-600">
                                  LAMBDA
                                </span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <span className="text-gray-500">
                                  {new Date(entry.created_at).toLocaleTimeString()}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteFromHistory(entry.deployment_id);
                                  }}
                                  className="text-gray-400 hover:text-red-600 transition-colors"
                                  title="Delete deployment"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-gray-600">
                              Function: {entry.agent_name} • Region: {entry.region}
                              {!entry.success && entry.error_message && (
                                <span className="text-red-600 ml-2">• Error: {entry.error_message.substring(0, 50)}...</span>
                              )}
                            </div>

                            {/* Expanded details */}
                            {expandedHistoryId === entry.deployment_id && (
                              <div className="mt-2 pt-2 border-t border-gray-200 space-y-2">
                                {/* Deployment Results */}
                                {entry.deployment_result?.function_arn && (
                                  <div className="text-xs space-y-2">
                                    <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
                                      <div className="flex-1 mr-2">
                                        <p className="font-medium text-gray-700">Function ARN:</p>
                                        <p className="font-mono text-gray-600 break-all text-xs">
                                          {entry.deployment_result.function_arn}
                                        </p>
                                      </div>
                                      <button
                                        onClick={() => copyToClipboard(
                                          entry.deployment_result.function_arn || '',
                                          `history_arn_${entry.deployment_id}`,
                                          'Function ARN copied!'
                                        )}
                                        className="flex items-center px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-xs transition-colors"
                                        title="Copy Function ARN"
                                      >
                                        {copiedItem === `history_arn_${entry.deployment_id}` ? (
                                          <>
                                            <CheckCircle className="w-3 h-3 mr-1" />
                                            Copied!
                                          </>
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                    {entry.deployment_result.invoke_endpoint && (
                                      <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
                                        <div className="flex-1 mr-2">
                                          <p className="font-medium text-gray-700">Function URL (Non-streaming):</p>
                                          <a
                                            href={entry.deployment_result.invoke_endpoint}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-mono text-blue-600 underline break-all text-xs hover:text-blue-800"
                                          >
                                            {entry.deployment_result.invoke_endpoint}
                                          </a>
                                        </div>
                                        <button
                                          onClick={() => copyToClipboard(
                                            entry.deployment_result.invoke_endpoint || '',
                                            `history_nonstream_${entry.deployment_id}`,
                                            'Non-streaming URL copied!'
                                          )}
                                          className="flex items-center px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-xs transition-colors"
                                          title="Copy Non-streaming Function URL"
                                        >
                                          {copiedItem === `history_nonstream_${entry.deployment_id}` ? (
                                            <>
                                              <CheckCircle className="w-3 h-3 mr-1" />
                                              Copied!
                                            </>
                                          ) : (
                                            <Copy className="w-3 h-3" />
                                          )}
                                        </button>
                                      </div>
                                    )}
                                    {entry.deployment_result.streaming_invoke_endpoint && (
                                      <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
                                        <div className="flex-1 mr-2">
                                          <p className="font-medium text-gray-700">Function URL (Streaming):</p>
                                          <a
                                            href={entry.deployment_result.streaming_invoke_endpoint}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-mono text-purple-600 underline break-all text-xs hover:text-purple-800"
                                          >
                                            {entry.deployment_result.streaming_invoke_endpoint}
                                          </a>
                                        </div>
                                        <button
                                          onClick={() => copyToClipboard(
                                            entry.deployment_result.streaming_invoke_endpoint || '',
                                            `history_stream_${entry.deployment_id}`,
                                            'Streaming URL copied!'
                                          )}
                                          className="flex items-center px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-xs transition-colors"
                                          title="Copy Streaming Function URL"
                                        >
                                          {copiedItem === `history_stream_${entry.deployment_id}` ? (
                                            <>
                                              <CheckCircle className="w-3 h-3 mr-1" />
                                              Copied!
                                            </>
                                          ) : (
                                            <Copy className="w-3 h-3" />
                                          )}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {/* Deployment Logs Preview */}
                                {entry.deployment_logs && (
                                  <div className="text-xs">
                                    <p className="font-medium text-gray-700 mb-1">Logs:</p>
                                    <div className="bg-gray-100 p-2 rounded font-mono max-h-32 overflow-y-auto">
                                      <pre className="whitespace-pre-wrap text-xs">{entry.deployment_logs}</pre>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Deployment Result */}
              {deploymentState.deploymentResult && (
                <div className="space-y-3">
                  {deploymentState.deploymentResult.success ? (
                    <>
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="text-sm text-green-800">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium">✅ Lambda deployment successful! <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded font-bold text-sm">({
                              deploymentState.deploymentResult.status?.deployment_outputs?.streaming_capable
                                ? 'Sync + Stream'
                                : 'Sync Only'
                            })</span></p>
                            <button
                              onClick={() => setShowDeploymentLogs(!showDeploymentLogs)}
                              className="text-xs px-2 py-1 bg-green-100 hover:bg-green-200 rounded border border-green-300 transition-colors"
                            >
                              {showDeploymentLogs ? 'Hide Logs' : 'View Logs'}
                            </button>
                          </div>

                          {/* Smart Deployment Results */}
                          {deploymentState.deploymentResult.status?.deployment_outputs && (
                            <div className="space-y-3 text-xs">
                              {/* Python BUFFERED Function Section */}
                              {(deploymentState.deploymentResult.status.deployment_outputs.python_function_arn ||
                               deploymentState.deploymentResult.status.deployment_outputs.sync_function_url) && (
                                <div className="space-y-2">
                                  <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    <h4 className="font-medium text-green-800">Sync Function</h4>
                                  </div>

                                  {deploymentState.deploymentResult.status.deployment_outputs.python_function_arn && (
                                    <div className="flex items-center justify-between bg-green-50 p-3 rounded border border-green-200">
                                      <div className="flex-1 mr-2">
                                        <p className="font-medium text-green-800">Function ARN:</p>
                                        <p className="font-mono text-green-700 break-all text-xs">
                                          {deploymentState.deploymentResult.status.deployment_outputs.python_function_arn}
                                        </p>
                                      </div>
                                      <button
                                        onClick={() => copyToClipboard(
                                          deploymentState.deploymentResult.status.deployment_outputs.python_function_arn,
                                          'python_function_arn',
                                          'Sync Function ARN copied!'
                                        )}
                                        className="flex items-center px-2 py-1 bg-green-100 hover:bg-green-200 text-green-800 rounded text-xs transition-colors"
                                        title="Copy Sync Function ARN"
                                      >
                                        {copiedItem === 'python_function_arn' ? (
                                          <>
                                            <CheckCircle className="w-3 h-3 mr-1" />
                                            Copied!
                                          </>
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                  )}

                                  {deploymentState.deploymentResult.status.deployment_outputs.sync_function_url && (
                                    <div className="flex items-center justify-between bg-green-50 p-3 rounded border border-green-200">
                                      <div className="flex-1 mr-2">
                                        <p className="font-medium text-green-800">Function URL:</p>
                                        <a
                                          href={deploymentState.deploymentResult.status.deployment_outputs.sync_function_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="font-mono text-green-700 underline break-all text-xs hover:text-green-900"
                                        >
                                          {deploymentState.deploymentResult.status.deployment_outputs.sync_function_url}
                                        </a>
                                        <p className="text-xs text-green-600 mt-1">6MB limit, JSON responses</p>
                                      </div>
                                      <button
                                        onClick={() => copyToClipboard(
                                          deploymentState.deploymentResult.status.deployment_outputs.sync_function_url,
                                          'sync_function_url',
                                          'Sync Function URL copied!'
                                        )}
                                        className="flex items-center px-2 py-1 bg-green-100 hover:bg-green-200 text-green-800 rounded text-xs transition-colors"
                                        title="Copy Sync Function URL"
                                      >
                                        {copiedItem === 'sync_function_url' ? (
                                          <>
                                            <CheckCircle className="w-3 h-3 mr-1" />
                                            Copied!
                                          </>
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Python RESPONSE_STREAM Function Section - Only show if streaming capable */}
                              {deploymentState.deploymentResult.status.deployment_outputs.streaming_capable &&
                               (deploymentState.deploymentResult.status.deployment_outputs.python_stream_function_arn ||
                                deploymentState.deploymentResult.status.deployment_outputs.stream_function_url) && (
                                <div className="space-y-2">
                                  <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                                    <h4 className="font-medium text-purple-800">Stream Function</h4>
                                  </div>

                                  {deploymentState.deploymentResult.status.deployment_outputs.python_stream_function_arn && (
                                    <div className="flex items-center justify-between bg-purple-50 p-3 rounded border border-purple-200">
                                      <div className="flex-1 mr-2">
                                        <p className="font-medium text-purple-800">Function ARN:</p>
                                        <p className="font-mono text-purple-700 break-all text-xs">
                                          {deploymentState.deploymentResult.status.deployment_outputs.python_stream_function_arn}
                                        </p>
                                      </div>
                                      <button
                                        onClick={() => copyToClipboard(
                                          deploymentState.deploymentResult.status.deployment_outputs.python_stream_function_arn,
                                          'python_stream_function_arn',
                                          'Stream Function ARN copied!'
                                        )}
                                        className="flex items-center px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded text-xs transition-colors"
                                        title="Copy Stream Function ARN"
                                      >
                                        {copiedItem === 'python_stream_function_arn' ? (
                                          <>
                                            <CheckCircle className="w-3 h-3 mr-1" />
                                            Copied!
                                          </>
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                  )}

                                  {deploymentState.deploymentResult.status.deployment_outputs.stream_function_url && (
                                    <div className="flex items-center justify-between bg-purple-50 p-3 rounded border border-purple-200">
                                      <div className="flex-1 mr-2">
                                        <p className="font-medium text-purple-800">Function URL:</p>
                                        <a
                                          href={deploymentState.deploymentResult.status.deployment_outputs.stream_function_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="font-mono text-purple-700 underline break-all text-xs hover:text-purple-900"
                                        >
                                          {deploymentState.deploymentResult.status.deployment_outputs.stream_function_url}
                                        </a>
                                        <p className="text-xs text-purple-600 mt-1">200MB limit, SSE streaming responses</p>
                                      </div>
                                      <button
                                        onClick={() => copyToClipboard(
                                          deploymentState.deploymentResult.status.deployment_outputs.stream_function_url,
                                          'stream_function_url',
                                          'Stream Function URL copied!'
                                        )}
                                        className="flex items-center px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded text-xs transition-colors"
                                        title="Copy Stream Function URL"
                                      >
                                        {copiedItem === 'stream_function_url' ? (
                                          <>
                                            <CheckCircle className="w-3 h-3 mr-1" />
                                            Copied!
                                          </>
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}

                            </div>
                          )}
                        </div>
                      </div>

                      {/* Deployment Logs */}
                      {showDeploymentLogs && (
                        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-medium text-gray-900">Deployment Logs</h4>
                            <button
                              onClick={() => {
                                const logsText = JSON.stringify(deploymentState.deploymentResult, null, 2);
                                navigator.clipboard.writeText(logsText).then(() => {
                                  // Could add a toast notification here
                                });
                              }}
                              className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors"
                            >
                              Copy Logs
                            </button>
                          </div>
                          <div className="bg-black text-green-400 p-3 rounded text-xs font-mono overflow-auto max-h-64">
                            <pre>{JSON.stringify(deploymentState.deploymentResult, null, 2)}</pre>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="text-sm text-red-800">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium">❌ Lambda deployment failed!</p>
                          <button
                            onClick={() => setShowDeploymentLogs(!showDeploymentLogs)}
                            className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 rounded border border-red-300 transition-colors"
                          >
                            {showDeploymentLogs ? 'Hide Details' : 'View Details'}
                          </button>
                        </div>

                        {deploymentState.deploymentResult.message && (
                          <p className="text-xs mb-2">{deploymentState.deploymentResult.message}</p>
                        )}

                        {/* Failure Details */}
                        {showDeploymentLogs && (
                          <div className="mt-3 p-3 bg-red-900 text-red-100 rounded text-xs font-mono overflow-auto max-h-64">
                            <pre>{JSON.stringify(deploymentState.deploymentResult, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {deploymentState.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">❌ {deploymentState.error}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Code Preview */
          <div className="flex flex-col h-full">
            {/* Code Preview Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">Generated Code</span>
                {isEditing && (
                  <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                    Editing
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <button
                      onClick={handleSaveEdit}
                      className="flex items-center px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="flex items-center px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleEditCode}
                      className="flex items-center px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600"
                    >
                      <Edit3 className="h-4 w-4 mr-2" />
                      Edit
                    </button>
                    <button
                      onClick={handleDownload}
                      className="flex items-center px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </button>
                    <button
                      onClick={handleCopyToClipboard}
                      className="flex items-center px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                      {copied ? (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2 text-green-400" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-2" />
                          Copy
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Code Editor */}
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                language="python"
                theme="vs-light"
                value={isEditing ? editableCode : generatedCode}
                onChange={isEditing ? handleCodeChange : undefined}
                options={{
                  readOnly: !isEditing,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  lineNumbers: 'on',
                  roundedSelection: false,
                  automaticLayout: true,
                  wordWrap: 'on',
                  tabSize: 2,
                  insertSpaces: true,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
        <div className="flex justify-between">
          <span>Deploy • AWS Lambda</span>
          <span>{generatedCode.split('\n').length} lines</span>
        </div>
      </div>
    </div>
  );
}
