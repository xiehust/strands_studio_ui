import { useEffect, useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { type Node, type Edge } from '@xyflow/react';
import { Rocket, Download, Copy, CheckCircle, AlertCircle, Edit3, Save, RotateCcw, History, ChevronDown, ChevronUp, Trash2, Plus, X, Eye, EyeOff } from 'lucide-react';
import { generateStrandsAgentCode } from '../lib/code-generator';
import { apiClient, type DeploymentHistoryItem } from '../lib/api-client';

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

interface AgentCoreDeployPanelProps {
  nodes: Node[];
  edges: Edge[];
  graphMode?: boolean;
  className?: string;
}

interface ApiKeyEntry {
  key: string;
  value: string;
  visible: boolean;
}

interface AgentCoreDeploymentState {
  config: {
    agentName: string;
    region: string;
    executeRole?: string;
    projectId?: string;
    version?: string;
  };
  apiKeys: Record<string, string>;
  isDeploying: boolean;
  deploymentResult?: any;
  error?: string;
}

interface DeploymentHistoryEntry {
  id: string;
  timestamp: string;
  deploymentTarget: 'agentcore';
  config: {
    agentName: string;
    region: string;
    executeRole?: string;
    projectId?: string;
    version?: string;
  };
  apiKeys: Record<string, string>;
  generatedCode: string;
  result?: any;
  logs?: string;
  error?: string;
  status: 'success' | 'error' | 'pending';
}

export function AgentCoreDeployPanel({ nodes, edges, graphMode = false, className = '' }: AgentCoreDeployPanelProps) {
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
  const [showHistory, setShowHistory] = useState(false);
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

  // Define updateDeploymentStep before it's used in useEffect
  const updateDeploymentStep = useCallback((stepName: string, status: 'pending' | 'running' | 'completed' | 'error', message?: string) => {
    console.log(`🔄 AgentCore updateDeploymentStep called: ${stepName} -> ${status}`, message);
    setDeploymentSteps(prev => {
      const existingIndex = prev.findIndex(s => s.step === stepName);
      console.log(`📊 Current AgentCore steps before update:`, prev);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { step: stepName, status, message };
        console.log(`📊 Updated existing AgentCore step at index ${existingIndex}:`, updated);
        return updated;
      } else {
        const newSteps = [...prev, { step: stepName, status, message }];
        console.log(`📊 Added new AgentCore step:`, newSteps);
        return newSteps;
      }
    });
  }, []);

  // Save deployment output to localStorage
  const saveDeploymentOutput = (deploymentOutput: any, streamingCapable?: boolean) => {
    try {
      console.log('saveDeploymentOutput called with:', deploymentOutput, 'streamingCapable:', streamingCapable);

      if (!deploymentOutput) {
        console.warn('No deployment output provided to save');
        return;
      }

      const existingDeployments = JSON.parse(localStorage.getItem('agentcore_deployments') || '[]');
      console.log('Existing deployments:', existingDeployments);

      const newDeployment = {
        ...deploymentOutput,
        streaming_capable: streamingCapable ?? deploymentOutput.streaming_capable ?? false,
        saved_at: new Date().toISOString()
      };
      console.log('New deployment to save:', newDeployment);

      // Remove existing deployment with same ARN to avoid duplicates
      const filteredDeployments = existingDeployments.filter(
        (dep: any) => dep.agent_runtime_arn !== deploymentOutput.agent_runtime_arn
      );
      console.log('Filtered deployments:', filteredDeployments);

      filteredDeployments.push(newDeployment);
      localStorage.setItem('agentcore_deployments', JSON.stringify(filteredDeployments));

      console.log('Successfully saved deployment output to localStorage:', newDeployment);
    } catch (error) {
      console.error('Failed to save deployment output:', error);
      throw error; // Re-throw so we can catch it in the caller
    }
  };

  const [deploymentState, setDeploymentState] = useState<AgentCoreDeploymentState>({
    config: {
      agentName: '',
      region: 'us-east-1',
      executeRole: 'AmazonBedrockAgentCoreRuntimeDefaultServiceRole',
      projectId: '',
      version: 'v1.0.0',
    },
    apiKeys: {},
    isDeploying: false,
  });

  useEffect(() => {
    const result = generateStrandsAgentCode(nodes, edges, graphMode);
    const fullCode = result.imports.join('\n') + '\n\n' + result.code;
    setGeneratedCode(fullCode);
    setEditableCode(fullCode);
    setErrors(result.errors);
    // Reset editing state when code regenerates
    setIsEditing(false);
    // Reset state when flow changes
  }, [nodes, edges, graphMode]);

  // Load deployment history on component mount
  useEffect(() => {
    loadDeploymentHistory();
  }, []);

  // Store current deployment ID globally to avoid closure issues
  useEffect(() => {
    (window as any).__currentAgentCoreDeploymentId = currentDeploymentId;
    console.log('🔄 Updated global AgentCore deployment ID:', currentDeploymentId);
  }, [currentDeploymentId]);

  // WebSocket connection management with global singleton approach
  useEffect(() => {
    const connectWebSocket = () => {
      // Check if there's already a global WebSocket connection
      if ((window as any).__globalWebSocket && (window as any).__globalWebSocket.readyState === WebSocket.OPEN) {
        console.log('🔗 AgentCore reusing existing WebSocket connection');
        setWebsocket((window as any).__globalWebSocket);
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      console.log('🔌 AgentCore creating new WebSocket connection:', wsUrl);

      const ws = new WebSocket(wsUrl);
      (window as any).__globalWebSocket = ws;

      ws.onopen = () => {
        console.log('✅ AgentCore WebSocket connected');
        setWebsocket(ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 Raw AgentCore WebSocket message:', event.data);
          console.log('📨 Parsed AgentCore WebSocket data:', data);

          if (data.type === 'deployment_progress') {
            console.log(`🔄 AgentCore deployment progress: ${data.step} - ${data.status}`);
            console.log('🆔 AgentCore message deployment_id:', data.deployment_id);
            console.log('🆔 Current global AgentCore deployment_id:', (window as any).__currentAgentCoreDeploymentId);
            // Broadcast to all listeners
            window.dispatchEvent(new CustomEvent('agentcore-deployment-progress', { detail: data }));
            console.log('✅ AgentCore custom event dispatched');
          }
        } catch (error) {
          console.error('❌ AgentCore WebSocket message parse error:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('❌ AgentCore WebSocket closed:', event.code, event.reason);
        setWebsocket(null);
        (window as any).__globalWebSocket = null;

        // Auto-reconnect after a delay unless it's a normal close
        if (event.code !== 1000) {
          console.log('🔄 AgentCore WebSocket will reconnect in 5 seconds...');
          setTimeout(() => {
            connectWebSocket();
          }, 5000);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ AgentCore WebSocket error:', error);
      };
    };

    // Event listener for AgentCore deployment progress
    const handleDeploymentProgress = (event: CustomEvent) => {
      const data = event.detail;
      console.log('📨 AgentCore handleDeploymentProgress called with data:', data);

      // Only process messages for the current deployment
      const currentId = (window as any).__currentAgentCoreDeploymentId;
      const idMatch = data.deployment_id === currentId;

      console.log('🔍 AgentCore ID Comparison:');
      console.log('  - Received ID:', data.deployment_id);
      console.log('  - Current ID:', currentId);
      console.log('  - Match:', idMatch);

      if (data.deployment_id && currentId && !idMatch) {
        console.log(`🚫 IGNORING AgentCore: Different deployment ID`);
        return;
      }

      console.log(`✅ PROCESSING AgentCore: ${data.step} -> ${data.status}`);
      updateDeploymentStep(data.step, data.status, data.message);
    };

    // Add event listener
    window.addEventListener('agentcore-deployment-progress', handleDeploymentProgress as EventListener);

    // Connect WebSocket
    connectWebSocket();

    // Cleanup function
    return () => {
      window.removeEventListener('agentcore-deployment-progress', handleDeploymentProgress as EventListener);
      // Don't close the global WebSocket - let it persist for other components
    };
  }, [updateDeploymentStep]); // Include updateDeploymentStep in dependencies

  // Auto-populate API keys when generated code or nodes change
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
      console.log('🔄 Loading AgentCore deployment history...');
      const response = await apiClient.getDeploymentHistory(
        undefined, // project_id - load all projects
        undefined, // version - load all versions
        20 // limit to recent 20 deployments
      );
      console.log('📊 Raw deployment history response:', response);

      // Filter for AgentCore deployments only
      const agentCoreDeployments = response.deployments?.filter(
        deployment => {
          console.log(`🔍 Checking deployment: ${deployment.deployment_id}, target: ${deployment.deployment_target}`);
          return deployment.deployment_target === 'agentcore';
        }
      ) || [];

      console.log('✅ Filtered AgentCore deployments:', agentCoreDeployments);
      setDeploymentHistory(agentCoreDeployments);
    } catch (error) {
      console.error('Failed to load deployment history:', error);
      // Fallback to localStorage for backward compatibility
      try {
        const saved = localStorage.getItem('deployment_history');
        if (saved) {
          const localHistory = JSON.parse(saved);
          // Convert old format to new format if needed
          const convertedHistory = localHistory.map((entry: any) => ({
            deployment_id: entry.id || `legacy-${entry.timestamp}`,
            project_id: entry.config?.projectId || 'default-project',
            version: entry.config?.version || '1.0.0',
            deployment_target: entry.deploymentTarget || 'agentcore',
            agent_name: entry.config?.agentName || 'Unknown Agent',
            region: entry.config?.region || 'us-east-1',
            execute_role: entry.config?.executeRole,
            api_keys: entry.apiKeys,
            code: entry.generatedCode || '',
            deployment_result: entry.result || {},
            deployment_logs: entry.logs,
            success: entry.status === 'success',
            error_message: entry.status !== 'success' ? 'Legacy deployment' : undefined,
            created_at: entry.timestamp || new Date().toISOString()
          }));
          setDeploymentHistory(convertedHistory);
        }
      } catch (localError) {
        console.error('Failed to load deployment history from localStorage:', localError);
      }
    }
  };

  // Save deployment to history
  const saveToHistory = (entry: Omit<DeploymentHistoryEntry, 'id' | 'timestamp'>) => {
    const historyEntry: DeploymentHistoryEntry = {
      ...entry,
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
    };

    try {
      const existing = JSON.parse(localStorage.getItem('deployment_history') || '[]');
      const updated = [historyEntry, ...existing].slice(0, 50); // Keep last 50 deployments
      localStorage.setItem('deployment_history', JSON.stringify(updated));
      setDeploymentHistory(updated);
    } catch (error) {
      console.error('Failed to save deployment history:', error);
    }
  };

  // Delete deployment from history
  const deleteFromHistory = async (deploymentId: string) => {
    try {
      await apiClient.deleteDeploymentHistoryItem(deploymentId);
      // Remove from local state
      setDeploymentHistory(prev => prev.filter(entry => entry.deployment_id !== deploymentId));
      // Close expanded view if deleting the expanded item
      if (expandedHistoryId === deploymentId) {
        setExpandedHistoryId(null);
      }
    } catch (error) {
      console.error('Failed to delete from deployment history:', error);
      // Fallback to localStorage for backward compatibility
      try {
        const existing = JSON.parse(localStorage.getItem('deployment_history') || '[]');
        const updated = existing.filter((entry: any) => entry.id !== deploymentId);
        localStorage.setItem('deployment_history', JSON.stringify(updated));
        setDeploymentHistory(prev => prev.filter(entry => entry.deployment_id !== deploymentId));
      } catch (localError) {
        console.error('Failed to delete from localStorage:', localError);
      }
    }
  };

  // Toggle history entry expansion
  const toggleHistoryExpansion = (id: string) => {
    setExpandedHistoryId(expandedHistoryId === id ? null : id);
  };

  const validateAgentName = (name: string): string | null => {
    if (!name.trim()) return 'Agent name is required';
    if (name.length < 1 || name.length > 63) return 'Agent name must be 1-63 characters';
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return 'Agent name can only contain letters, numbers, hyphens, and underscores';
    return null;
  };

  const validateExecuteRole = (role: string): string | null => {
    if (!role.trim()) return 'Execute role is required for AgentCore deployment';
    // Allow both role names and full ARNs
    if (role.includes('arn:aws:iam::') && !role.startsWith('arn:aws:iam::')) {
      return 'Execute role must be a valid IAM role ARN or role name';
    }
    return null;
  };

  const handleConfigChange = (field: keyof AgentCoreDeploymentState['config'], value: string) => {
    const newConfig = { ...deploymentState.config, [field]: value };
    setDeploymentState(prev => ({ ...prev, config: newConfig }));

    // Validate fields
    if (field === 'agentName') {
      const error = validateAgentName(value);
      setFormErrors(prev => ({ ...prev, agentName: error || '' }));
    } else if (field === 'executeRole') {
      const error = validateExecuteRole(value);
      setFormErrors(prev => ({ ...prev, executeRole: error || '' }));
    }
  };

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

  const canDeploy = () => {
    return (
      generatedCode.trim() !== '' &&
      deploymentState.config.agentName.trim() !== '' &&
      !formErrors.agentName &&
      deploymentState.config.executeRole?.trim() !== '' &&
      !formErrors.executeRole &&
      !deploymentState.isDeploying
    );
  };

  const convertCode = () => {
    const codeToConvert = isEditing ? editableCode : generatedCode;

    // Check if already converted
    if (codeToConvert.includes('@app.entrypoint')) {
      return codeToConvert;
    }

    // Check if it's streaming code
    const isStreamingCode = codeToConvert.includes('stream_async');

    let convertedCode = codeToConvert;

    // Add BedrockAgentCoreApp imports at the top if not already present
    const bedrockImports = `from bedrock_agentcore.runtime import BedrockAgentCoreApp
app = BedrockAgentCoreApp()

`;

    if (!convertedCode.includes('BedrockAgentCoreApp')) {
      convertedCode = bedrockImports + convertedCode;
    }

    // Find the if __name__ == "__main__": section
    const mainPattern = /if __name__ == "__main__":\s*\n([\s\S]*?)(?=\n\S|\n*$)/;
    const mainMatch = convertedCode.match(mainPattern);

    if (mainMatch) {
      const mainIndex = convertedCode.indexOf(mainMatch[0]);

      // Prepare the entrypoint function
      let entrypointFunction = '';
      if (isStreamingCode) {
        entrypointFunction = `@app.entrypoint
async def entry(payload):
    user_input_param = payload.get('user_input')
    messages_param = payload.get('messages')
    async for event in main(user_input_param, messages_param):
        yield event

`;
      } else {
        entrypointFunction = `@app.entrypoint
async def entry(payload):
    user_input_param = payload.get('user_input')
    messages_param = payload.get('messages')
    return await main(user_input_param, messages_param)

`;
      }

      // Replace the main section
      const newMainSection = `if __name__ == "__main__":
    app.run()`;

      // Insert entrypoint before main and replace main section
      convertedCode = convertedCode.substring(0, mainIndex) +
                     entrypointFunction +
                     newMainSection;

      // For streaming code, also modify the stream_async yield pattern
      if (isStreamingCode) {
        const streamPattern = /(\s+async for event in \w+\.stream_async\([^)]+\):\s*\n)(\s+)(if "data" in event:\s*\n\s+print\(event\['data'\][^)]*\))/g;
        convertedCode = convertedCode.replace(streamPattern, (_, asyncForPart, ifIndent, restPart) => {
          return asyncForPart + ifIndent + 'yield event\n' + ifIndent + restPart;
        });
      }
    }

    // Update the appropriate code state
    if (isEditing) {
      setEditableCode(convertedCode);
    } else {
      setGeneratedCode(convertedCode);
      setEditableCode(convertedCode);
    }

    return convertedCode;
  };

  const handleDeploy = async () => {
    console.log('Starting AgentCore deployment process...');
    setDeploymentSteps([]);

    // Generate deployment ID and set it for WebSocket filtering
    const deploymentId = crypto.randomUUID();
    setCurrentDeploymentId(deploymentId);
    // CRITICAL: Set global variable immediately to catch early WebSocket messages
    (window as any).__currentAgentCoreDeploymentId = deploymentId;
    console.log('🚀 Starting AgentCore deployment with ID:', deploymentId);

    // Start with initial deployment steps
    updateDeploymentStep('Initializing AgentCore deployment', 'running');

    try {
      // Automatically convert code if not already converted and get the converted code
      console.log('Converting code for AgentCore deployment...');
      updateDeploymentStep('Initializing AgentCore deployment', 'completed');
      updateDeploymentStep('Converting code for AgentCore', 'running');
      const codeToUse = convertCode();

      // Extract API keys from multiple sources
      const extractedApiKeys = extractApiKeysFromCode(codeToUse);
      const nodeApiKeys = extractApiKeysFromNodes(nodes);

      // Update API keys in deployment state - merge all sources
      const manualApiKeys = apiKeys.reduce((acc, item) => {
        if (item.key && item.value) {
          acc[item.key] = item.value;
        }
        return acc;
      }, {} as Record<string, string>);

      // Merge priority: manual keys > node keys > extracted keys
      // This allows manual override of node values, and node values override empty extracted keys
      const apiKeysObject = { ...extractedApiKeys, ...nodeApiKeys, ...manualApiKeys };

      console.log('Extracted API keys from code:', extractedApiKeys);
      console.log('Node API keys:', nodeApiKeys);
      console.log('Manual API keys:', manualApiKeys);
      console.log('Final API keys object:', apiKeysObject);

      updateDeploymentStep('Converting code for AgentCore', 'completed');
      updateDeploymentStep('Preparing deployment request', 'running');

      console.log('Setting deployment state to deploying...');
      setDeploymentState(prev => ({ ...prev, apiKeys: apiKeysObject, isDeploying: true, error: undefined }));
      let logsText = 'No deployment logs available';
      console.log('Using code length:', codeToUse.length, 'characters');

      // Detect streaming capability from code
      const isStreamingCapable = codeToUse.includes('stream_async') || codeToUse.includes('yield');
      console.log('Code streaming capability detected:', isStreamingCapable);

      const deploymentRequest: any = {
        deployment_id: deploymentId,
        code: codeToUse,
        agent_name: deploymentState.config.agentName,
        region: deploymentState.config.region,
        project_id: deploymentState.config.projectId || undefined,
        version: deploymentState.config.version || undefined,
        api_keys: apiKeysObject,
        deployment_type: 'agentcore',
        streaming_capable: isStreamingCapable,
        execute_role: deploymentState.config.executeRole,
      };

      console.log('Deploying with config:', deploymentRequest);

      updateDeploymentStep('Preparing deployment request', 'completed');
      updateDeploymentStep('Sending deployment request', 'running');

      console.log('📤 Sending deployment request to /api/deploy/agentcore');
      console.log('📤 Request payload:', deploymentRequest);

      // Call backend API
      let response;
      try {
        response = await fetch('/api/deploy/agentcore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(deploymentRequest),
        });
        console.log('📥 Received response:', response.status, response.statusText);
      } catch (fetchError) {
        console.error('❌ Fetch error:', fetchError);
        throw new Error(`Network error: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
      }

      if (!response.ok) {
        console.error('❌ Response not OK:', response.status, response.statusText);
        const errorData = await response.json().catch(() => ({ detail: 'Deployment failed' }));
        console.error('❌ Error data:', errorData);
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      console.log('✅ Response OK, marking step as completed');
      updateDeploymentStep('Sending deployment request', 'completed');
      updateDeploymentStep('Processing AgentCore deployment', 'running');

      const result = await response.json();
      console.log('Deployment result received:', result);
      console.log('result.success:', result.success, 'type:', typeof result.success);
      console.log('result.status:', result.status);
      console.log('result.message:', result.message);

      // Verify the deployment ID matches (should be the same)
      if (result.deployment_id && result.deployment_id !== deploymentId) {
        console.warn('⚠️ AgentCore deployment ID mismatch:', result.deployment_id, 'vs', deploymentId);
      }

      // Check if deployment actually succeeded
      if (!result.success) {
        console.error('❌ Deployment failed - result.success is falsy:', result.success);
        console.error('Full result object:', JSON.stringify(result, null, 2));
        throw new Error(result.message || 'AgentCore deployment failed');
      }

      console.log('✅ Deployment succeeded - result.success is truthy');

      updateDeploymentStep('Processing AgentCore deployment', 'completed');
      updateDeploymentStep('AgentCore deployment completed successfully', 'completed');

      setDeploymentState(prev => ({
        ...prev,
        isDeploying: false,
        deploymentResult: result
      }));

      // Keep deployment ID for a bit longer to allow late WebSocket messages
      setTimeout(() => {
        setCurrentDeploymentId(null);
      }, 5000); // Clear after 5 seconds

      // IMPORTANT: Save operations below are non-blocking and should not fail the deployment
      // Wrap everything in a separate promise to prevent errors from propagating
      Promise.resolve().then(async () => {
        // Save deployment outputs to localStorage if deployment was successful
        try {
          if (result.success && result.status?.deployment_outputs) {
            console.log('Saving deployment outputs:', result.status.deployment_outputs);
            saveDeploymentOutput(result.status.deployment_outputs, isStreamingCapable);
          } else {
            console.log('No deployment outputs to save or deployment not successful');
          }
        } catch (saveError) {
          console.error('Error saving deployment outputs:', saveError);
          // Don't let this break the deployment flow
        }

        // Save to persistent deployment history (both success and failure)
        try {
          console.log('Starting deployment history save...');

          // Handle logs - they might be an array or string
          if (result.status?.logs) {
            if (Array.isArray(result.status.logs)) {
              logsText = result.status.logs.join('\n');
            } else {
              logsText = result.status.logs;
            }
          } else if (result.logs) {
            if (Array.isArray(result.logs)) {
              logsText = result.logs.join('\n');
            } else {
              logsText = result.logs;
            }
          }

          const deploymentHistoryItem: DeploymentHistoryItem = {
            deployment_id: `deployment-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            project_id: deploymentState.config.projectId || 'default-project',
            version: deploymentState.config.version || '1.0.0',
            deployment_target: 'agentcore',
            agent_name: deploymentState.config.agentName,
            region: deploymentState.config.region,
            execute_role: deploymentState.config.executeRole,
            api_keys: apiKeysObject,
            code: codeToUse,
            deployment_result: result,
            deployment_logs: logsText,
            success: result.success,
            error_message: result.success ? undefined : (result.message || 'Deployment failed'),
            created_at: new Date().toISOString()
          };

          console.log('Saving deployment history item:', deploymentHistoryItem);
          await apiClient.saveDeploymentHistory(deploymentHistoryItem);
          console.log('Deployment saved to persistent storage:', deploymentHistoryItem.deployment_id);

          // Also save to localStorage history for backward compatibility
          try {
            if (result.success) {
              console.log('Saving to localStorage history...');
              saveToHistory({
                deploymentTarget: 'agentcore',
                config: deploymentState.config,
                apiKeys: apiKeysObject,
                generatedCode: codeToUse,
                result: result,
                logs: logsText,
                status: 'success'
              });
              console.log('Successfully saved to localStorage history');
            }
          } catch (localStorageError) {
            console.error('Error saving to localStorage history:', localStorageError);
            // Don't let this break the deployment flow
          }
        } catch (storageError) {
          console.error('Failed to save deployment to persistent storage:', storageError);
          // Fall back to localStorage only
          try {
            if (result.success) {
              console.log('Falling back to localStorage only...');
              saveToHistory({
                deploymentTarget: 'agentcore',
                config: deploymentState.config,
                apiKeys: apiKeysObject,
                generatedCode: codeToUse,
                result: result,
                logs: logsText,
                status: 'success'
              });
            }
          } catch (fallbackError) {
            console.error('Even localStorage fallback failed:', fallbackError);
            // Continue anyway - don't break the deployment flow
          }
        }
      }).catch(err => {
        // Catch any errors from the save operations and log them without failing
        console.error('Non-critical error in post-deployment save operations:', err);
      });
    } catch (error) {
      console.error('AgentCore deployment error caught:', error);

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

      // Also save failed deployments to persistent storage
      try {
        const codeToUse = convertCode();

        // Extract API keys from all sources for failed deployments too
        const extractedApiKeys = extractApiKeysFromCode(codeToUse);
        const nodeApiKeys = extractApiKeysFromNodes(nodes);
        const manualApiKeys = apiKeys.reduce((acc, item) => {
          if (item.key && item.value) {
            acc[item.key] = item.value;
          }
          return acc;
        }, {} as Record<string, string>);
        const apiKeysObject = { ...extractedApiKeys, ...nodeApiKeys, ...manualApiKeys };

        const deploymentHistoryItem: DeploymentHistoryItem = {
          deployment_id: `deployment-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          project_id: deploymentState.config.projectId || 'default-project',
          version: deploymentState.config.version || '1.0.0',
          deployment_target: 'agentcore',
          agent_name: deploymentState.config.agentName,
          region: deploymentState.config.region,
          execute_role: deploymentState.config.executeRole,
          api_keys: apiKeysObject,
          code: codeToUse,
          deployment_result: {},
          deployment_logs: `Deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          success: false,
          error_message: error instanceof Error ? error.message : 'Deployment failed',
          created_at: new Date().toISOString()
        };

        console.log('Saving failed deployment to history:', deploymentHistoryItem);
        await apiClient.saveDeploymentHistory(deploymentHistoryItem);
        console.log('Failed deployment saved to persistent storage:', deploymentHistoryItem.deployment_id);
      } catch (storageError) {
        console.error('Failed to save failed deployment to persistent storage:', storageError);
      }
    }
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* AgentCore Panel Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center">
          <Rocket className="w-4 h-4 text-purple-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Deploy to AgentCore</h3>
        </div>
        <div className="flex space-x-2">
          {/* Tab Buttons */}
          <button
            onClick={() => setActiveTab('configuration')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              activeTab === 'configuration'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Config
          </button>
          <button
            onClick={() => setActiveTab('code-preview')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              activeTab === 'code-preview'
                ? 'bg-purple-100 text-purple-700'
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
              {/* Configuration Fields */}
              <div className="space-y-4">
                <label className="text-sm font-medium text-gray-900">Configuration</label>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="agentName" className="text-sm text-gray-700">Agent Name *</label>
                    <input
                      id="agentName"
                      type="text"
                      value={deploymentState.config.agentName}
                      onChange={(e) => handleConfigChange('agentName', e.target.value)}
                      placeholder="my-agent-name"
                      className={`w-full px-3 py-2 border rounded-md text-sm ${
                        formErrors.agentName ? 'border-red-500' : 'border-gray-300'
                      } focus:outline-none focus:ring-2 focus:ring-purple-500`}
                    />
                    {formErrors.agentName && (
                      <p className="text-xs text-red-600 mt-1">{formErrors.agentName}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="region" className="text-sm text-gray-700">Region</label>
                    <select
                      id="region"
                      value={deploymentState.config.region}
                      onChange={(e) => handleConfigChange('region', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="us-east-1">us-east-1 (N. Virginia)</option>
                      <option value="us-west-2">us-west-2 (Oregon)</option>
                      <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
                      <option value="ap-southeast-2">ap-southeast-2 (Sydney)</option>
                    </select>
                  </div>

                  {/* Execute Role - Always required for AgentCore */}
                  <div>
                    <label htmlFor="executeRole" className="text-sm text-gray-700">Execute Role *</label>
                    <input
                      id="executeRole"
                      type="text"
                      value={deploymentState.config.executeRole || ''}
                      onChange={(e) => handleConfigChange('executeRole', e.target.value)}
                      placeholder="AmazonBedrockAgentCoreRuntimeDefaultServiceRole"
                      className={`w-full px-3 py-2 border rounded-md text-sm ${
                        formErrors.executeRole ? 'border-red-500' : 'border-gray-300'
                      } focus:outline-none focus:ring-2 focus:ring-purple-500`}
                    />
                    {formErrors.executeRole && (
                      <p className="text-xs text-red-600 mt-1">{formErrors.executeRole}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      IAM role name that AgentCore will use to execute your agent
                    </p>
                  </div>

                  <div>
                    <label htmlFor="projectId" className="text-sm text-gray-700">Project ID (Optional)</label>
                    <input
                      id="projectId"
                      type="text"
                      value={deploymentState.config.projectId || ''}
                      onChange={(e) => handleConfigChange('projectId', e.target.value)}
                      placeholder="my-project-id"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
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
                      placeholder="Key name (e.g., ANTHROPIC_API_KEY)"
                      value={apiKey.key}
                      onChange={(e) => updateApiKey(index, 'key', e.target.value)}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                    <div className="relative flex-1">
                      <input
                        type={apiKey.visible ? 'text' : 'password'}
                        placeholder="API key value"
                        value={apiKey.value}
                        onChange={(e) => updateApiKey(index, 'value', e.target.value)}
                        className="w-full px-2 py-1 pr-8 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
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

              {/* Deploy Actions */}
              <div className="space-y-3 pt-4 border-t border-gray-200">
                {/* Deploy Button */}
                <button
                  onClick={handleDeploy}
                  disabled={!canDeploy()}
                  className="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {deploymentState.isDeploying ? 'Deploying...' : 'Deploy'}
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
                          <Rocket className="w-4 h-4 text-gray-600" />
                          <h4 className="text-sm font-medium text-gray-700">Stored Deployments</h4>
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
                            No stored deployments available
                          </div>
                        ) : (
                          deploymentHistory.slice(0, 10).map((entry) => (
                            <div
                              key={entry.deployment_id}
                              className={`p-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                                expandedHistoryId === entry.deployment_id ? 'bg-blue-50' : ''
                              }`}
                              onClick={() => toggleHistoryExpansion(entry.deployment_id)}
                              title={`Deployment ID: ${entry.deployment_id || 'Unknown'}`}
                            >
                              <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center space-x-2">
                                  <Rocket className="w-3 h-3 text-gray-500" />
                                  <span className="text-gray-700">
                                    {entry.deployment_id ? entry.deployment_id.substring(0, 12) + '...' : 'Unknown ID'}
                                  </span>
                                  <span className={`text-xs px-1 rounded ${
                                    entry.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                  }`}>
                                    {entry.success ? '✓' : '✗'}
                                  </span>
                                  <span className="text-xs bg-gray-100 px-1 rounded text-gray-600">
                                    {entry.deployment_target ? entry.deployment_target.toUpperCase() : 'AGENTCORE'}
                                  </span>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <span className="text-gray-500">
                                    {entry.created_at ? new Date(entry.created_at).toLocaleTimeString() : 'Unknown time'}
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
                                Agent: {entry.agent_name || 'Unknown'} • Region: {entry.region || 'Unknown'}
                                {!entry.success && entry.error_message && (
                                  <span className="text-red-600 ml-2">• Error: {entry.error_message.substring(0, 50)}...</span>
                                )}
                              </div>

                              {/* Expanded details */}
                              {expandedHistoryId === entry.deployment_id && (
                                <div className="mt-2 pt-2 border-t border-gray-200 space-y-2">
                                  {/* Deployment Results */}
                                  {entry.deployment_result?.agent_arn && (
                                    <div className="text-xs text-gray-600">
                                      <p><strong>Agent ARN:</strong> <span className="font-mono">{entry.deployment_result.agent_arn}</span></p>
                                      {entry.deployment_result.agent_endpoint && (
                                        <p><strong>Endpoint:</strong> <span className="font-mono">{entry.deployment_result.agent_endpoint}</span></p>
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
              {deploymentState.deploymentResult && (() => {
                try {
                  return (
                    <div className="space-y-3">
                      {deploymentState.deploymentResult.success ? (
                    <>
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="text-sm text-green-800">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium">✅ Deployment successful!</p>
                            <button
                              onClick={() => setShowDeploymentLogs(!showDeploymentLogs)}
                              className="text-xs px-2 py-1 bg-green-100 hover:bg-green-200 rounded border border-green-300 transition-colors"
                            >
                              {showDeploymentLogs ? 'Hide Logs' : 'View Logs'}
                            </button>
                          </div>

                          {/* AgentCore specific results */}
                          {deploymentState.deploymentResult.agent_arn && (
                            <div className="space-y-1 text-xs">
                              <p><strong>Agent ARN:</strong> {deploymentState.deploymentResult.agent_arn}</p>
                              {deploymentState.deploymentResult.agent_endpoint && (
                                <p><strong>Endpoint:</strong> {deploymentState.deploymentResult.agent_endpoint}</p>
                              )}
                              {deploymentState.deploymentResult.ecr_uri && (
                                <p><strong>ECR URI:</strong> {deploymentState.deploymentResult.ecr_uri}</p>
                              )}
                            </div>
                          )}

                          {/* Generic URL fallback */}
                          {deploymentState.deploymentResult.url && !deploymentState.deploymentResult.agent_arn && (
                            <p className="text-xs">
                              <a href={deploymentState.deploymentResult.url} target="_blank" rel="noopener noreferrer" className="underline">
                                View deployment
                              </a>
                            </p>
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
                          <p className="font-medium">❌ Deployment failed!</p>
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
                    );
                } catch (renderError) {
                  console.error('Error rendering deployment result:', renderError);
                  return (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-800">Error displaying deployment result. Check console for details.</p>
                    </div>
                  );
                }
              })()}

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
                <span className="font-medium text-gray-900">Deploy Code</span>
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
          <span>Deploy • AWS AgentCore</span>
          <span>{generatedCode.split('\n').length} lines</span>
        </div>
      </div>
    </div>
  );
}