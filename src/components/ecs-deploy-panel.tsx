import { useEffect, useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { type Node, type Edge } from '@xyflow/react';
import { Download, Copy, CheckCircle, Container, AlertCircle, Edit3, RotateCcw, History, ChevronDown, ChevronUp, Trash2, Plus, X, Eye, EyeOff } from 'lucide-react';
import { generateStrandsAgentCode } from '../lib/code-generator';
import { type DeploymentHistoryItem } from '../lib/api-client';

// Utility function to extract API key references from generated code
function extractApiKeysFromCode(generatedCode: string): Record<string, string> {
  const apiKeyMatches: Record<string, string> = {};

  // Pattern to match os.environ.get("API_KEY_NAME") calls
  const envGetPattern = /os\.environ\.get\(["']([A-Z_]*API_KEY[A-Z_]*)['"]\)/g;

  let match;
  while ((match = envGetPattern.exec(generatedCode)) !== null) {
    const keyName = match[1];
    // Use the actual environment variable name as the key
    apiKeyMatches[keyName] = '';
  }

  return apiKeyMatches;
}

// Utility function to extract API keys from agent nodes
function extractApiKeysFromNodes(nodes: Node[]): Record<string, string> {
  const nodeApiKeys: Record<string, string> = {};

  nodes.forEach(node => {
    if (node.type === 'agent' || node.type === 'orchestratorAgent') {
      const apiKey = node.data?.apiKey;
      if (apiKey && typeof apiKey === 'string' && apiKey.trim()) {
        // Determine the provider type and map to appropriate environment variable name
        const modelProvider = node.data?.modelProvider;
        if (modelProvider === 'OpenAI') {
          nodeApiKeys['OPENAI_API_KEY'] = apiKey.trim();
        } else if (modelProvider === 'Anthropic') {
          nodeApiKeys['ANTHROPIC_API_KEY'] = apiKey.trim();
        } else {
          // Generic fallback - construct proper env var name
          const keyName = (typeof modelProvider === 'string' && modelProvider)
            ? `${modelProvider.toUpperCase()}_API_KEY`
            : 'OPENAI_API_KEY';
          nodeApiKeys[keyName] = apiKey.trim();
        }
      }
    }
  });

  return nodeApiKeys;
}

interface ApiKeyEntry {
  key: string;
  value: string;
  visible: boolean;
}

interface ECSDeployPanelProps {
  nodes: Node[];
  edges: Edge[];
  graphMode: boolean;
  className?: string;
}

interface ECSDeploymentState {
  config: {
    serviceName: string;
    cpu: number;
    memory: number;
    region: string;
    containerName: string;
    containerPort: number;
    desiredCount: number;
    enableLoadBalancer: boolean;
    enableLogging: boolean;
    healthCheckPath: string;
    version?: string;
    architecture: string;
    // Advanced options
    vpcId?: string;
    subnetIds?: string[];
    securityGroupIds?: string[];
    assignPublicIp: boolean;
    executionRoleArn?: string;
    taskRoleArn?: string;
    // Auto-scaling (disabled for now)
    enableAutoscaling: boolean;
    minCapacity: number;
    maxCapacity: number;
    targetCpuUtilization: number;
  };
  isDeploying: boolean;
  deploymentResult?: any;
  error?: string;
}

const AWS_REGIONS = [
  { value: 'us-east-1', label: 'us-east-1 (N. Virginia)' },
  { value: 'us-west-2', label: 'us-west-2 (Oregon)' },
  { value: 'eu-central-1', label: 'eu-central-1 (Frankfurt)' },
  { value: 'ap-southeast-1', label: 'ap-southeast-1 (Singapore)' },
  { value: 'ap-northeast-1', label: 'ap-northeast-1 (Tokyo)' },
  { value: 'cn-north-1', label: 'cn-north-1 (Beijing)' },
  { value: 'cn-northwest-1', label: 'cn-northwest-1 (Ningxia)' },
];

export function ECSDeployPanel({ nodes, edges, graphMode: _graphMode, className = '' }: ECSDeployPanelProps) {
  const [activeTab, setActiveTab] = useState<'configuration' | 'code-preview'>('configuration');
  const [generatedCode, setGeneratedCode] = useState('');
  const [editableCode, setEditableCode] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [showDeploymentLogs, setShowDeploymentLogs] = useState(false);
  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [deploymentSteps, setDeploymentSteps] = useState<Array<{
    step: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    message?: string;
  }>>([]);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [currentDeploymentId, setCurrentDeploymentId] = useState<string | null>(null);
  const [serviceNameOptions, setServiceNameOptions] = useState<string[]>([]);
  const [showServiceNameDropdown, setShowServiceNameDropdown] = useState(false);

  const [deploymentState, setDeploymentState] = useState<ECSDeploymentState>({
    config: {
      serviceName: '',
      cpu: 1024, // 1 vCPU
      memory: 2048, // 2GB (minimum for 1024 CPU)
      region: 'us-east-1',
      containerName: 'strands-agent',
      containerPort: 8000,
      desiredCount: 1,
      enableLoadBalancer: true, // Always enabled
      enableLogging: true, // Always enabled
      healthCheckPath: '/health',
      version: 'v1.0.0',
      assignPublicIp: true,
      enableAutoscaling: false,
      minCapacity: 1,
      maxCapacity: 10,
      targetCpuUtilization: 70,
      architecture: 'x86_64', // Add architecture
    },
    isDeploying: false,
  });

  useEffect(() => {
    const result = generateStrandsAgentCode(nodes, edges);
    const fullCode = result.imports.join('\n') + '\n\n' + result.code;
    setGeneratedCode(fullCode);
    setEditableCode(fullCode);
    setErrors(result.errors);
    setIsEditing(false);
  }, [nodes, edges]);

  // Load deployment history on component mount
  useEffect(() => {
    loadDeploymentHistory();
    loadServiceNameOptions();
  }, []);

  // Extract API keys from generated code and nodes
  useEffect(() => {
    if (generatedCode) {
      const extractedApiKeys = extractApiKeysFromCode(generatedCode);
      const nodeApiKeys = extractApiKeysFromNodes(nodes);

      // Merge extracted and node API keys
      const allDetectedKeys = { ...extractedApiKeys, ...nodeApiKeys };

      // Only add new API keys that aren't already in the form
      const existingKeys = new Set(apiKeys.map(k => k.key));
      const newApiKeys: ApiKeyEntry[] = [];

      Object.entries(allDetectedKeys).forEach(([key, value]) => {
        if (!existingKeys.has(key)) {
          newApiKeys.push({
            key,
            value: value || '', // Use node value if available, otherwise empty
            visible: false
          });
        }
      });

      if (newApiKeys.length > 0) {
        setApiKeys(prev => [...prev, ...newApiKeys]);
        console.log('Auto-added API keys - from code:', Object.keys(extractedApiKeys), 'from nodes:', Object.keys(nodeApiKeys));
      }
    }
  }, [generatedCode, nodes, apiKeys]);

  const loadServiceNameOptions = async () => {
    try {
      const response = await fetch('/api/deployment-history?deployment_type=ecs-fargate&limit=50');
      if (response.ok) {
        const data = await response.json();
        const ecsDeployments = data.deployments?.filter((d: DeploymentHistoryItem) =>
          d.deployment_target === 'ecs-fargate'
        ) || [];

        // Extract unique service names
        const uniqueServiceNames = Array.from(
          new Set(ecsDeployments.map((d: DeploymentHistoryItem) => d.agent_name).filter(Boolean))
        ).sort() as string[];

        setServiceNameOptions(uniqueServiceNames);
      }
    } catch (error) {
      console.error('Failed to load service name options:', error);
    }
  };

  // WebSocket connection management
  useEffect(() => {
    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('✅ ECS WebSocket connected');
        setWebsocket(ws);

        // Send periodic ping to keep connection alive during long builds
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            console.log('📡 ECS WebSocket ping sent');
          } else {
            clearInterval(pingInterval);
          }
        }, 30000); // Every 30 seconds

        // Store interval ID to clean up later
        (ws as any).pingInterval = pingInterval;
      };

      ws.onmessage = (event) => {
        console.log('📨 ECS WebSocket RAW message received:', event.data);
        try {
          const data = JSON.parse(event.data);
          console.log('📨 ECS WebSocket parsed message:', data);
          if (data.type === 'deployment_progress') {
            console.log('🚀 ECS deployment progress data:', data);
            console.log('🚀 Dispatching deployment-progress event for:', data.deployment_id);
            window.dispatchEvent(new CustomEvent('deployment-progress', { detail: data }));
          } else {
            console.log('📨 ECS WebSocket ignoring message type:', data.type);
          }
        } catch (error) {
          console.error('❌ ECS WebSocket message parse error:', error);
        }
      };

      ws.onclose = () => {
        console.log('❌ ECS WebSocket disconnected, reconnecting in 3s...');

        // Clear ping interval
        if ((ws as any).pingInterval) {
          clearInterval((ws as any).pingInterval);
        }

        setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = (error) => {
        console.error('❌ ECS WebSocket error:', error);
      };
    };

    connectWebSocket();

    return () => {
      // Don't close WebSocket
    };
  }, []);

  const updateDeploymentStep = useCallback((stepName: string, status: 'pending' | 'running' | 'completed' | 'error', message?: string) => {
    console.log('Updating deployment step:', { stepName, status, message });
    setDeploymentSteps(prev => {
      const existingIndex = prev.findIndex(s => s.step === stepName);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { step: stepName, status, message };
        return updated;
      } else {
        return [...prev, { step: stepName, status, message }];
      }
    });
  }, []);

  // Listen for deployment progress
  useEffect(() => {
    const handleDeploymentProgress = (event: CustomEvent) => {
      const data = event.detail;
      console.log('Received deployment progress:', data);
      console.log('Current deployment ID:', currentDeploymentId);
      if (data.deployment_id === currentDeploymentId) {
        updateDeploymentStep(data.step, data.status, data.message);
      } else {
        console.log('Deployment ID mismatch, ignoring progress update');
      }
    };

    window.addEventListener('deployment-progress', handleDeploymentProgress as EventListener);
    return () => {
      window.removeEventListener('deployment-progress', handleDeploymentProgress as EventListener);
    };
  }, [currentDeploymentId, updateDeploymentStep]);

  const loadDeploymentHistory = async () => {
    try {
      const response = await fetch('/api/deployment-history?deployment_type=ecs-fargate&limit=20');
      if (response.ok) {
        const data = await response.json();
        const ecsDeployments = data.deployments?.filter((d: DeploymentHistoryItem) =>
          d.deployment_target === 'ecs-fargate'
        ) || [];
        setDeploymentHistory(ecsDeployments);
      }
    } catch (error) {
      console.error('Failed to load ECS deployment history:', error);
      // Fallback to localStorage
      const saved = localStorage.getItem('ecs_deployments');
      if (saved) {
        try {
          setDeploymentHistory(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to parse saved ECS deployments:', e);
        }
      }
    }
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!deploymentState.config.serviceName.trim()) {
      errors.serviceName = 'Service name is required';
    } else if (!/^[a-zA-Z0-9\-_]+$/.test(deploymentState.config.serviceName)) {
      errors.serviceName = 'Service name can only contain alphanumeric characters, hyphens, and underscores';
    }

    if (deploymentState.config.desiredCount < 1 || deploymentState.config.desiredCount > 10) {
      errors.desiredCount = 'Desired count must be between 1 and 10';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  const downloadCode = () => {
    const blob = new Blob([editableCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `strands_agent_${deploymentState.config.serviceName || 'ecs'}.py`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const resetCode = () => {
    setEditableCode(generatedCode);
    setIsEditing(false);
  };

  const handleServiceNameChange = (serviceName: string) => {
    // Update state
    setDeploymentState(prev => ({
      ...prev,
      config: { ...prev.config, serviceName }
    }));

    // Cache to localStorage
    if (serviceName.trim()) {
      localStorage.setItem('ecs_service_name', serviceName);
    }
  };

  const deployToECS = async () => {
    if (!validateForm()) {
      return;
    }

    if (errors.length > 0) {
      alert('Please fix the code generation errors before deploying.');
      return;
    }

    setDeploymentState(prev => ({ ...prev, isDeploying: true, error: undefined, deploymentResult: undefined }));
    setDeploymentSteps([]);

    const deploymentId = `ecs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log('🆔 Generated deployment ID:', deploymentId);
    console.log('🔌 Current WebSocket state:', websocket?.readyState);
    console.log('🔌 Global WebSocket state:', (window as any).__globalWebSocket?.readyState);
    setCurrentDeploymentId(deploymentId);

    try {
      const response = await fetch('/api/deploy/ecs-fargate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deployment_id: deploymentId,
          code: editableCode,
          service_name: deploymentState.config.serviceName,
          cpu: deploymentState.config.cpu,
          memory: deploymentState.config.memory,
          architecture: deploymentState.config.architecture,
          region: deploymentState.config.region,
          container_name: deploymentState.config.containerName,
          container_port: deploymentState.config.containerPort,
          desired_count: deploymentState.config.desiredCount,
          // ALB and logging are always enabled
          health_check_path: deploymentState.config.healthCheckPath,
          project_id: deploymentState.config.serviceName,
          version: deploymentState.config.version,
          vpc_id: deploymentState.config.vpcId,
          subnet_ids: deploymentState.config.subnetIds,
          security_group_ids: deploymentState.config.securityGroupIds,
          assign_public_ip: deploymentState.config.assignPublicIp,
          execution_role_arn: deploymentState.config.executionRoleArn,
          task_role_arn: deploymentState.config.taskRoleArn,
          // Convert API keys array to object format
          api_keys: apiKeys.reduce((acc, { key, value }) => {
            if (key && value) {
              acc[key] = value;
            }
            return acc;
          }, {} as Record<string, string>)
        }),
      });

      const result = await response.json();

      if (result.success) {
        setDeploymentState(prev => ({
          ...prev,
          deploymentResult: result,
          error: undefined
        }));

        // Save to deployment history (non-blocking)
        Promise.resolve().then(async () => {
          try {
            await fetch('/api/deployment-history', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                deployment_id: deploymentId,
                project_id: deploymentState.config.serviceName,
                version: deploymentState.config.version,
                deployment_target: 'ecs-fargate',
                agent_name: deploymentState.config.serviceName,
                region: deploymentState.config.region,
                code: editableCode,
                deployment_result: {
                  ...(result.status?.deployment_outputs || result),
                  // Add configuration info that's not in deployment_outputs
                  cpu: deploymentState.config.cpu,
                  memory: deploymentState.config.memory,
                  architecture: deploymentState.config.architecture,
                  desired_count: deploymentState.config.desiredCount
                },
                success: true,
                created_at: new Date().toISOString()
              })
            });
            await loadDeploymentHistory();
          } catch (saveError) {
            console.warn('Failed to save deployment to history:', saveError);
          }
        });

      } else {
        throw new Error(result.message || 'Deployment failed');
      }
    } catch (error) {
      console.error('ECS deployment error:', error);
      setDeploymentState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Deployment failed'
      }));
    } finally {
      setDeploymentState(prev => ({ ...prev, isDeploying: false }));
      setCurrentDeploymentId(null);
    }
  };

  // API Key management functions
  const addApiKey = () => {
    setApiKeys(prev => [...prev, { key: '', value: '', visible: false }]);
  };

  const removeApiKey = (index: number) => {
    setApiKeys(prev => prev.filter((_, i) => i !== index));
  };

  const updateApiKey = (index: number, field: 'key' | 'value', value: string) => {
    setApiKeys(prev => prev.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const toggleApiKeyVisibility = (index: number) => {
    setApiKeys(prev => prev.map((item, i) =>
      i === index ? { ...item, visible: !item.visible } : item
    ));
  };

  const deleteDeployment = async (deploymentId: string) => {
    if (!confirm('Are you sure you want to delete this deployment? This action cannot be undone.')) {
      return;
    }

    try {
      // This would typically call an API to actually delete the ECS service
      // For now, just remove from local history
      setDeploymentHistory(prev => prev.filter(d => d.deployment_id !== deploymentId));

      // Update localStorage
      const updated = deploymentHistory.filter(d => d.deployment_id !== deploymentId);
      localStorage.setItem('ecs_deployments', JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to delete deployment:', error);
      alert('Failed to delete deployment. Please try again.');
    }
  };

  return (
    <div className={`bg-white border-l border-gray-200 flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center">
          <Container className="w-4 h-4 text-blue-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Deploy to ECS Fargate</h3>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('configuration')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'configuration'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Configuration
        </button>
        <button
          onClick={() => setActiveTab('code-preview')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'code-preview'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Code Preview
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'configuration' && (
          <div className="h-full overflow-y-auto">
            <div className="p-4 space-y-6">
              {/* Basic Configuration */}
              <div className="space-y-4">
                <h4 className="text-md font-semibold text-gray-900">Basic Configuration</h4>

                {/* Service Name with Dropdown */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Service Name *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={deploymentState.config.serviceName}
                      onChange={(e) => handleServiceNameChange(e.target.value)}
                      onFocus={() => setShowServiceNameDropdown(true)}
                      onBlur={() => {
                        // Delay hiding dropdown to allow for clicks
                        setTimeout(() => setShowServiceNameDropdown(false), 150);
                      }}
                      className={`w-full px-3 py-2 border rounded-md text-sm ${
                        formErrors.serviceName ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="my-strands-agent"
                    />

                    {/* Dropdown */}
                    {showServiceNameDropdown && serviceNameOptions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {serviceNameOptions
                          .filter(name =>
                            name.toLowerCase().includes(deploymentState.config.serviceName.toLowerCase())
                          )
                          .map((serviceName, index) => (
                          <div
                            key={index}
                            onClick={() => {
                              handleServiceNameChange(serviceName);
                              setShowServiceNameDropdown(false);
                            }}
                            className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                          >
                            {serviceName}
                          </div>
                        ))}
                        {serviceNameOptions.filter(name =>
                          name.toLowerCase().includes(deploymentState.config.serviceName.toLowerCase())
                        ).length === 0 && deploymentState.config.serviceName && (
                          <div className="px-3 py-2 text-sm text-gray-500 italic">
                            No matching service names found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {formErrors.serviceName && (
                    <p className="text-red-500 text-xs mt-1">{formErrors.serviceName}</p>
                  )}
                </div>

                {/* Version */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Version
                  </label>
                  <input
                    type="text"
                    value={deploymentState.config.version || ''}
                    onChange={(e) => setDeploymentState(prev => ({
                      ...prev,
                      config: { ...prev.config, version: e.target.value }
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="v1.0.0"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {/* Architecture */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Architecture
                    </label>
                    <select
                      value={deploymentState.config.architecture}
                      onChange={(e) => setDeploymentState(prev => ({
                        ...prev,
                        config: { ...prev.config, architecture: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="x86_64">x86_64</option>
                      <option value="arm64">ARM64</option>
                    </select>
                       <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <span className="text-orange-400">💡</span>
                        <span className="text-orange-400">Choose the same architecture as your deployment host for consistancy</span>
                      </p>
                  </div>


                  {/* CPU */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      CPU (vCPU)
                    </label>
                    <select
                      value={deploymentState.config.cpu}
                      onChange={(e) => setDeploymentState(prev => ({
                        ...prev,
                        config: { ...prev.config, cpu: parseInt(e.target.value) }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="256">0.25 vCPU</option>
                      <option value="512">0.5 vCPU</option>
                      <option value="1024">1 vCPU</option>
                      <option value="2048">2 vCPU</option>
                      <option value="4096">4 vCPU</option>
                    </select>
                  </div>

                  {/* Memory */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Memory (MB)
                    </label>
                    <select
                      value={deploymentState.config.memory}
                      onChange={(e) => setDeploymentState(prev => ({
                        ...prev,
                        config: { ...prev.config, memory: parseInt(e.target.value) }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="512">512 MB</option>
                      <option value="1024">1 GB</option>
                      <option value="2048">2 GB</option>
                      <option value="3072">3 GB</option>
                      <option value="4096">4 GB</option>
                      <option value="8192">8 GB</option>
                    </select>
                  </div>
                </div>

                {/* Region */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    AWS Region
                  </label>
                  <select
                    value={deploymentState.config.region}
                    onChange={(e) => setDeploymentState(prev => ({
                      ...prev,
                      config: { ...prev.config, region: e.target.value }
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    {AWS_REGIONS.map((region) => (
                      <option key={region.value} value={region.value}>
                        {region.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Desired Count */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Desired Count
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={deploymentState.config.desiredCount}
                    onChange={(e) => setDeploymentState(prev => ({
                      ...prev,
                      config: { ...prev.config, desiredCount: parseInt(e.target.value) || 1 }
                    }))}
                    className={`w-full px-3 py-2 border rounded-md text-sm ${
                      formErrors.desiredCount ? 'border-red-500' : 'border-gray-300'
                    }`}
                  />
                  {formErrors.desiredCount && (
                    <p className="text-red-500 text-xs mt-1">{formErrors.desiredCount}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">Number of running tasks (1-10)</p>
                </div>

                {/* Container Settings */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Container Name
                    </label>
                    <input
                      type="text"
                      value={deploymentState.config.containerName}
                      onChange={(e) => setDeploymentState(prev => ({
                        ...prev,
                        config: { ...prev.config, containerName: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Container Port
                    </label>
                    <input
                      type="number"
                      value={deploymentState.config.containerPort}
                      onChange={(e) => setDeploymentState(prev => ({
                        ...prev,
                        config: { ...prev.config, containerPort: parseInt(e.target.value) || 8000 }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                </div>

                {/* Health Check Path */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Health Check Path
                  </label>
                  <input
                    type="text"
                    value={deploymentState.config.healthCheckPath}
                    onChange={(e) => setDeploymentState(prev => ({
                      ...prev,
                      config: { ...prev.config, healthCheckPath: e.target.value }
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="/health"
                  />
                </div>
              </div>

              {/* Advanced Options */}
              <div className="border-t pt-4">
                <button
                  onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                  className="flex items-center text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  {showAdvancedOptions ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
                  Advanced Options
                </button>

                {showAdvancedOptions && (
                  <div className="mt-4 space-y-4">
                    {/* VPC Configuration */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        VPC ID (optional)
                      </label>
                      <input
                        type="text"
                        value={deploymentState.config.vpcId || ''}
                        onChange={(e) => setDeploymentState(prev => ({
                          ...prev,
                          config: { ...prev.config, vpcId: e.target.value || undefined }
                        }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        placeholder="vpc-xxxxxx (uses default VPC if empty)"
                      />
                    </div>

                    {/* Subnet IDs */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Subnet IDs (optional)
                      </label>
                      <input
                        type="text"
                        value={deploymentState.config.subnetIds?.join(', ') || ''}
                        onChange={(e) => {
                          const subnets = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setDeploymentState(prev => ({
                            ...prev,
                            config: { ...prev.config, subnetIds: subnets.length > 0 ? subnets : undefined }
                          }));
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        placeholder="subnet-xxxxx, subnet-yyyyy (uses default subnets if empty)"
                      />
                    </div>

                    {/* Public IP */}
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="assignPublicIp"
                        checked={deploymentState.config.assignPublicIp}
                        onChange={(e) => setDeploymentState(prev => ({
                          ...prev,
                          config: { ...prev.config, assignPublicIp: e.target.checked }
                        }))}
                        className="mr-2"
                      />
                      <label htmlFor="assignPublicIp" className="text-sm text-gray-700">
                        Assign Public IP to tasks
                      </label>
                    </div>

                    {/* Auto Scaling (Disabled) */}
                    <div className="space-y-3 opacity-50">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="enableAutoscaling"
                          checked={false}
                          disabled
                          className="mr-2"
                        />
                        <label htmlFor="enableAutoscaling" className="text-sm text-gray-700">
                          Enable Auto Scaling (Coming Soon)
                        </label>
                      </div>
                      <p className="text-xs text-gray-500">
                        Auto scaling configuration will be available in a future update.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* API Keys */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-900">API Keys (Optional)</label>
                  <button
                    onClick={addApiKey}
                    className="flex items-center px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Key
                  </button>
                </div>

                {apiKeys.map((apiKey, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <input
                      placeholder="Key name (e.g., OPENAI_API_KEY)"
                      value={apiKey.key}
                      onChange={(e) => updateApiKey(index, 'key', e.target.value)}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="relative flex-1">
                      <input
                        type={apiKey.visible ? 'text' : 'password'}
                        placeholder="API key value"
                        value={apiKey.value}
                        onChange={(e) => updateApiKey(index, 'value', e.target.value)}
                        className="w-full px-2 py-1 pr-8 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => toggleApiKeyVisibility(index)}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {apiKey.visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                    <button
                      onClick={() => removeApiKey(index)}
                      className="p-1 text-gray-400 hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Deploy Button */}
              <div className="border-t pt-4">
                <button
                  onClick={deployToECS}
                  disabled={deploymentState.isDeploying || errors.length > 0}
                  className={`w-full flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium ${
                    deploymentState.isDeploying || errors.length > 0
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {deploymentState.isDeploying ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Deploying to ECS Fargate...
                    </>
                  ) : (
                    <>
                      <Container className="w-4 h-4 mr-2" />
                      Deploy to ECS Fargate
                    </>
                  )}
                </button>

                {errors.length > 0 && (
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                    <div className="flex items-center">
                      <AlertCircle className="w-4 h-4 text-red-600 mr-2" />
                      <span className="text-sm font-medium text-red-800">Code Generation Errors</span>
                    </div>
                    <ul className="mt-1 text-sm text-red-700 list-disc list-inside">
                      {errors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {deploymentState.error && (
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                    <div className="flex items-center">
                      <AlertCircle className="w-4 h-4 text-red-600 mr-2" />
                      <span className="text-sm font-medium text-red-800">Deployment Error</span>
                    </div>
                    <p className="mt-1 text-sm text-red-700">{deploymentState.error}</p>
                  </div>
                )}

                {deploymentState.deploymentResult && (
                  <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
                    <div className="flex items-center">
                      <CheckCircle className="w-4 h-4 text-green-600 mr-2" />
                      <span className="text-sm font-medium text-green-800">Deployment Successful</span>
                    </div>

                    {/* Cluster Information - Prominent Display */}
                    {deploymentState.deploymentResult.deployment_outputs?.ClusterName && (
                      <div className="mt-3 p-2 bg-green-100 border border-green-300 rounded">
                        <p className="text-lg font-bold text-green-800 text-center">
                          🚀 ECS Cluster: <span className="text-green-900">{deploymentState.deploymentResult.deployment_outputs.ClusterName}</span>
                        </p>
                      </div>
                    )}

                    {/* Service Endpoint - Display only sync or stream based on capability */}
                    {deploymentState.deploymentResult.deployment_outputs?.ServiceEndpoint && (
                      <div className="mt-3 space-y-2">
                        <div className="p-2 bg-blue-50 border border-blue-200 rounded">
                          {deploymentState.deploymentResult.streaming_capable ? (
                            <>
                              <p className="text-sm font-medium text-blue-800 mb-1">📡 Stream Endpoint:</p>
                              <code className="bg-blue-100 px-2 py-1 rounded text-xs font-mono border block">
                                {deploymentState.deploymentResult.deployment_outputs.ServiceEndpoint}/invoke-stream
                              </code>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-medium text-blue-800 mb-1">📡 Sync Endpoint:</p>
                              <code className="bg-blue-100 px-2 py-1 rounded text-xs font-mono border block">
                                {deploymentState.deploymentResult.deployment_outputs.ServiceEndpoint}/invoke
                              </code>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Legacy endpoint support */}
                    {deploymentState.deploymentResult.status?.endpoint_url && (
                      <p className="mt-1 text-sm text-green-700">
                        Service Endpoint: {deploymentState.deploymentResult.status.endpoint_url}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Deployment Progress - Terminal Style */}
              {deploymentSteps.length > 0 && (
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-gray-900">Deployment Progress</h4>
                    <button
                      onClick={() => setShowDeploymentLogs(!showDeploymentLogs)}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      {showDeploymentLogs ? 'Hide Details' : 'Show Details'}
                    </button>
                  </div>

                  {/* Always show terminal-style progress */}
                  <div className="p-3 bg-black text-green-400 rounded text-xs font-mono">
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
                            {step.status === 'running' && '...'}
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

                  {/* Detailed logs (optional toggle) */}
                  {showDeploymentLogs && (
                    <div className="mt-3 space-y-2 text-xs text-gray-600">
                      {deploymentSteps.map((step, index) => (
                        <div key={index} className="flex items-start">
                          <div className={`w-1.5 h-1.5 rounded-full mr-2 mt-1.5 flex-shrink-0 ${
                            step.status === 'completed' ? 'bg-green-500' :
                            step.status === 'running' ? 'bg-blue-500 animate-pulse' :
                            step.status === 'error' ? 'bg-red-500' :
                            'bg-gray-300'
                          }`} />
                          <div className="flex-1">
                            <div className={`font-medium ${
                              step.status === 'error' ? 'text-red-700' :
                              step.status === 'completed' ? 'text-green-700' :
                              step.status === 'running' ? 'text-blue-700' :
                              'text-gray-700'
                            }`}>
                              {step.step}
                            </div>
                            {step.message && (
                              <div className="text-gray-600 mt-1">
                                {step.message}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Deploy History - Unified with Lambda style */}
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
                        <Container className="w-4 h-4 text-gray-600" />
                        <h4 className="text-sm font-medium text-gray-700">ECS Fargate Deployments</h4>
                      </div>
                      <button
                        onClick={loadDeploymentHistory}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="max-h-40 overflow-auto">
                      {deploymentHistory.length === 0 ? (
                        <div className="p-4 text-center text-xs text-gray-500">
                          No ECS deployments available
                        </div>
                      ) : (
                        deploymentHistory.slice(0, 10).map((entry) => (
                          <div
                            key={entry.deployment_id}
                            className={`p-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                              expandedHistoryId === entry.deployment_id ? 'bg-blue-50' : ''
                            }`}
                            onClick={() => setExpandedHistoryId(
                              expandedHistoryId === entry.deployment_id ? null : entry.deployment_id
                            )}
                            title={`Deployment ID: ${entry.deployment_id}`}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center space-x-2">
                                <Container className="w-3 h-3 text-gray-500" />
                                <span className="text-gray-700">
                                  {entry.deployment_id.substring(0, 12)}...
                                </span>
                                <span className={`text-xs px-1 rounded ${
                                  entry.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                }`}>
                                  {entry.success ? '✓' : '✗'}
                                </span>
                                <span className="text-xs bg-blue-100 px-1 rounded text-blue-600">
                                  ECS
                                </span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <span className="text-gray-500">
                                  {new Date(entry.created_at).toLocaleTimeString()}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteDeployment(entry.deployment_id);
                                  }}
                                  className="text-gray-400 hover:text-red-600 transition-colors"
                                  title="Delete deployment"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-gray-600">
                              Service: {entry.agent_name} • Region: {entry.region}
                              {!entry.success && entry.error_message && (
                                <span className="text-red-600 ml-2">• Error: {entry.error_message.substring(0, 50)}...</span>
                              )}
                            </div>

                            {/* Expanded details - ECS specific */}
                            {expandedHistoryId === entry.deployment_id && (
                              <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                                <div className="text-xs text-gray-600">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <strong>Stack:</strong> {entry.deployment_result?.ClusterName || entry.deployment_result?.stack_name || 'Not Available'}
                                    </div>
                                    <div>
                                      <strong>CPU/Memory:</strong> {entry.deployment_result?.cpu || 'N/A'}vCPU / {entry.deployment_result?.memory || 'N/A'}MB
                                    </div>
                                    <div>
                                      <strong>Architecture:</strong> {entry.deployment_result?.architecture || 'N/A'}
                                    </div>
                                    <div>
                                      <strong>Tasks:</strong> {entry.deployment_result?.desired_count || 'N/A'}
                                    </div>
                                  </div>
                                  {entry.deployment_result?.ServiceEndpoint && (
                                    <div className="mt-2 space-y-1">
                                      <div>
                                        <strong>{entry.deployment_result?.streaming_capable ? 'Stream Endpoint:' : 'Sync Endpoint:'}</strong>
                                        <div className="mt-1 font-mono text-xs bg-blue-50 p-1 rounded break-all">
                                          {entry.deployment_result.ServiceEndpoint}{entry.deployment_result?.streaming_capable ? '/invoke-stream' : '/invoke'}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  {entry.deployment_result?.TaskDefinitionArn && (
                                    <div className="mt-2">
                                      <strong>Task Definition ARN:</strong>
                                      <div className="mt-1 font-mono text-xs bg-gray-50 p-1 rounded break-all">
                                        {entry.deployment_result.TaskDefinitionArn}
                                      </div>
                                    </div>
                                  )}
                                  {entry.deployment_result?.LoadBalancerDNS && (
                                    <div className="mt-2">
                                      <strong>Load Balancer DNS:</strong>
                                      <div className="mt-1 font-mono text-xs bg-gray-50 p-1 rounded break-all">
                                        {entry.deployment_result.LoadBalancerDNS}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'code-preview' && (
          <div className="h-full flex flex-col">
            {/* Code Preview Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <h4 className="text-sm font-medium text-gray-900">Generated Agent Code</h4>
                {isEditing && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                    <Edit3 className="w-3 h-3 mr-1" />
                    Modified
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => copyToClipboard(editableCode)}
                  className="flex items-center px-2 py-1 text-xs text-gray-600 hover:text-gray-900"
                  title="Copy to clipboard"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={downloadCode}
                  className="flex items-center px-2 py-1 text-xs text-gray-600 hover:text-gray-900"
                  title="Download code"
                >
                  <Download className="w-3 h-3 mr-1" />
                  Download
                </button>
                {isEditing && (
                  <button
                    onClick={resetCode}
                    className="flex items-center px-2 py-1 text-xs text-gray-600 hover:text-gray-900"
                    title="Reset to generated code"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Code Editor */}
            <div className="flex-1">
              <Editor
                height="100%"
                defaultLanguage="python"
                value={editableCode}
                onChange={(value) => {
                  setEditableCode(value || '');
                  setIsEditing(value !== generatedCode);
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: 'on',
                  renderWhitespace: 'none',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: 'on',
                }}
                theme="light"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}