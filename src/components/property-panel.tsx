import { type Node, type Edge } from '@xyflow/react';
import { Settings, X } from 'lucide-react';

interface PropertyPanelProps {
  selectedNode: Node | null;
  onClose: () => void;
  onUpdateNode: (nodeId: string, data: any) => void;
  edges?: Edge[];
  nodes?: Node[];
  className?: string;
}

export function PropertyPanel({
  selectedNode,
  onClose,
  onUpdateNode,
  edges = [],
  nodes = [],
  className = ''
}: PropertyPanelProps) {
  if (!selectedNode) {
    return null;
  }

  // Check if the selected node has an output node connected
  const hasConnectedOutputNode = () => {
    if (!selectedNode || (selectedNode.type !== 'agent' && selectedNode.type !== 'orchestrator-agent')) {
      return true; // For non-agent nodes, always allow streaming
    }

    // Find all edges where this node is the source from its output handle
    const outgoingEdges = edges.filter(edge =>
      edge.source === selectedNode.id && edge.sourceHandle === 'output'
    );

    // For each outgoing edge, check if the target node is an output node
    return outgoingEdges.some(edge => {
      const targetNode = nodes.find(node => node.id === edge.target);
      return targetNode && targetNode.type === 'output';
    });
  };

  const handleInputChange = (field: string, value: any) => {
    try {
      onUpdateNode(selectedNode.id, {
        ...selectedNode.data,
        [field]: value,
      });
    } catch (error) {
      console.error('Failed to update node property:', error);
      // In a production app, you might want to show a toast notification here
    }
  };

  const bedrockModels = [
    {
      model_id: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      model_name: "Claude 4.5 Haiku (global)"
    },
    {
      model_id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      model_name: "Claude 4.5 Haiku (US)"
    },
    {
      model_id: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      model_name: "Claude 4.5 Haiku (EU)"
    },
    {
      model_id: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
      model_name: "Claude 4.5 Sonnet (global)"
    },
    {
      model_id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      model_name: "Claude 4.5 Sonnet (US)"
    },
    {
      model_id: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
      model_name: "Claude 4.5 Sonnet (EU)"
    },
    {
      model_id: "global.anthropic.claude-sonnet-4-20250514-v1:0",
      model_name: "Claude 4 Sonnet (global)"
    },
    {
      model_id: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      model_name: "Claude 4 Sonnet (US)"
    },
    {
      model_id: "eu.anthropic.claude-sonnet-4-20250514-v1:0",
      model_name: "Claude 4 Sonnet (EU)"
    },
    {
      model_id: "apac.anthropic.claude-sonnet-4-20250514-v1:0",
      model_name: "Claude 4 Sonnet (APAC)"
    },
    {
      model_id: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
      model_name: "Claude 3.7 Sonnet (US)"
    },
    {
      model_id: "eu.anthropic.claude-3-7-sonnet-20250219-v1:0",
      model_name: "Claude 3.7 Sonnet (EU)"
    },  
    {
      model_id: "apac.anthropic.claude-3-7-sonnet-20250219-v1:0",
      model_name: "Claude 3.7 Sonnet (APAC)"
    },  
    {
      model_id: "openai.gpt-oss-120b-1:0",
      model_name: "GPT-OSS-120B"
    },
    {
      model_id: "qwen.qwen3-235b-a22b-2507-v1:0",
      model_name: "Qwen3 235B A22B 2507"
    },
    {
      model_id: "qwen.qwen3-32b-v1:0",
      model_name: "Qwen3 32B (dense)"
    },
    {
      model_id: "qwen.qwen3-coder-480b-a35b-v1:0",
      model_name: "Qwen3 Coder 480B A35B Instruct"
    },
    {
      model_id: "deepseek.v3-v1:0",
      model_name: "DeepSeek-V3.1"
    },
    {
      model_id: "us.amazon.nova-premier-v1:0",
      model_name: "Amazon Nova Premier v1"
    },
    {
      model_id: "us.amazon.nova-pro-v1:0",
      model_name: "Amazon Nova Pro v1"
    }
  ];

  const renderAgentProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Agent Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          placeholder="Agent Name"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Model Provider
        </label>
        <select
          value={data.modelProvider || 'AWS Bedrock'}
          onChange={(e) => {
            // Update model provider and reset model selection
            if (e.target.value === 'AWS Bedrock') {
              onUpdateNode(selectedNode.id, {
                ...selectedNode.data,
                modelProvider: e.target.value,
                modelId: bedrockModels[0].model_id,
                modelName: bedrockModels[0].model_name,
              });
            } else {
              onUpdateNode(selectedNode.id, {
                ...selectedNode.data,
                modelProvider: e.target.value,
                modelId: '',
                modelName: '',
              });
            }
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="AWS Bedrock">AWS Bedrock</option>
          <option value="OpenAI">OpenAI</option>
          {/* <option value="Anthropic">Anthropic</option> */}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Model
        </label>
        {data.modelProvider === 'AWS Bedrock' || !data.modelProvider ? (
          <select
            value={data.modelId || bedrockModels[0].model_id}
            onChange={(e) => {
              const selectedModel = bedrockModels.find(m => m.model_id === e.target.value);
              if (selectedModel) {
                // Update both modelId and modelName in a single call to avoid timing issues
                onUpdateNode(selectedNode.id, {
                  ...selectedNode.data,
                  modelId: selectedModel.model_id,
                  modelName: selectedModel.model_name,
                });
              }
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            {bedrockModels.map((model) => (
              <option key={model.model_id} value={model.model_id}>
                {model.model_name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={data.modelName || ''}
            onChange={(e) => handleInputChange('modelName', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter model name (e.g., gpt-4o, gpt-3.5-turbo)"
          />
        )}
      </div>

      {/* OpenAI-specific fields */}
      {data.modelProvider === 'OpenAI' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Key
            </label>
            <input
              type="password"
              value={data.apiKey || ''}
              onChange={(e) => handleInputChange('apiKey', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter your OpenAI API key"
            />
            <p className="text-xs text-gray-500 mt-1">
              API key will be stored securely as OPENAI_API_KEY environment variable
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Base URL (Optional)
            </label>
            <input
              type="url"
              value={data.baseUrl || ''}
              onChange={(e) => handleInputChange('baseUrl', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://api.openai.com/v1 (default)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave empty to use the default OpenAI API endpoint
            </p>
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          System Prompt
        </label>
        <textarea
          value={data.systemPrompt || ''}
          onChange={(e) => handleInputChange('systemPrompt', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          placeholder="You are a helpful AI assistant..."
          rows={4}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Temperature: {data.temperature || 0.7}
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={data.temperature || 0.7}
          onChange={(e) => handleInputChange('temperature', parseFloat(e.target.value))}
          className="w-full"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Max Tokens
        </label>
        <input
          type="number"
          value={data.maxTokens || 8000}
          onChange={(e) => handleInputChange('maxTokens', parseInt(e.target.value))}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          min="1"
          max="100000"
        />
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={data.streaming || false}
            disabled={!hasConnectedOutputNode()}
            onChange={(e) => handleInputChange('streaming', e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-sm font-medium text-gray-700">Enable Streaming</span>
        </label>
        <p className="text-xs text-gray-500 mt-1">
          {hasConnectedOutputNode()
            ? "Stream responses in real-time for better user experience"
            : "Connect an Output node to enable streaming mode"
          }
        </p>
      </div>
    </div>
  );

  const renderToolProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tool Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          placeholder="Tool Name"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tool Type
        </label>
        <select
          value={data.toolType || 'built-in'}
          onChange={(e) => handleInputChange('toolType', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="built-in">Built-in</option>
          {/* <option value="custom">Custom</option> */}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tool Name/Function
        </label>
        {data.toolType === 'built-in' || !data.toolType ? (
          <select
            value={data.toolName || 'calculator'}
            onChange={(e) => handleInputChange('toolName', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="calculator">Calculator</option>
            <option value="file_read">File Reader</option>
            <option value="file_write">File Write</option>
            <option value="shell">Shell Command</option>
            <option value="current_time">Current Time</option>
            <option value="http_request">Http Request</option>
            <option value="editor">Editor</option>
            <option value="retrieve">Retrieve (KB)</option>
            <option value="mem0_memory">mem0_memory</option>
          </select>
        ) : (
          <input
            type="text"
            value={data.toolName || ''}
            onChange={(e) => handleInputChange('toolName', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="custom_function_name"
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Description
        </label>
        <textarea
          value={data.description || ''}
          onChange={(e) => handleInputChange('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          placeholder="Tool description..."
          rows={3}
        />
      </div>
    </div>
  );

  const renderInputProperties = () => (
    <div className="space-y-4">
      <div className="text-center py-8">
        <div className="text-gray-500">
          Input node - connects user input to agents
        </div>
        <div className="text-sm text-gray-400 mt-2">
          No configuration required
        </div>
      </div>
    </div>
  );

  const renderMCPToolProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Server Name
        </label>
        <input
          type="text"
          value={data.serverName || ''}
          onChange={(e) => handleInputChange('serverName', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          placeholder="MCP Server Name"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Transport Type
        </label>
        <select
          value={data.transportType || 'stdio'}
          onChange={(e) => handleInputChange('transportType', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="stdio">Standard I/O (stdio)</option>
          <option value="streamable_http">Streamable HTTP</option>
          <option value="sse">Server-Sent Events (SSE)</option>
        </select>
      </div>

      {data.transportType === 'stdio' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Command
            </label>
            <input
              type="text"
              value={data.command || ''}
              onChange={(e) => handleInputChange('command', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="uvx"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Arguments (one per line)
            </label>
            <textarea
              value={data.argsText !== undefined ? data.argsText : (data.args ? data.args.join('\n') : '')}
              onChange={(e) => {
                const argsText = e.target.value;
                const args = argsText.split('\n').filter(arg => arg.trim());
                onUpdateNode(selectedNode.id, {
                  ...selectedNode.data,
                  argsText: argsText,
                  args: args
                });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 resize-y"
              placeholder="server-name@latest"
              rows={3}
            />
            <p className="text-xs text-gray-500 mt-1">
              Enter each argument on a separate line
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Environment Variables (JSON format)
            </label>
            <textarea
              value={data.envText || (data.env && Object.keys(data.env).length > 0 ? JSON.stringify(data.env, null, 2) : '')}
              onChange={(e) => {
                const envText = e.target.value.trim();
                try {
                  const env = envText ? JSON.parse(envText) : {};
                  handleInputChange('envText', envText);
                  handleInputChange('env', env);
                } catch {
                  // Keep the text even if JSON is invalid for user to continue editing
                  handleInputChange('envText', envText);
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 resize-y font-mono text-sm"
              placeholder='{\n  "PATH": "/usr/local/bin",\n  "API_KEY": "your-key"\n}'
              rows={4}
            />
            <p className="text-xs text-gray-500 mt-1">
              Optional environment variables for the MCP server process (valid JSON required)
            </p>
          </div>
        </>
      )}

      {(data.transportType === 'streamable_http' || data.transportType === 'sse') && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Server URL
          </label>
          <input
            type="url"
            value={data.url || ''}
            onChange={(e) => handleInputChange('url', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="http://localhost:8000/mcp"
          />
        </div>
      )}

      {(data.transportType === 'streamable_http' || data.transportType === 'sse') && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Headers (JSON format)
          </label>
          <textarea
            value={data.headersText || ''}
            onChange={(e) => {
              const headersText = e.target.value;
              try {
                const headers = headersText ? JSON.parse(headersText) : {};
                handleInputChange('headersText', headersText);
                handleInputChange('headers', headers);
              } catch {
                handleInputChange('headersText', headersText);
              }
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder='{"Authorization": "Bearer token"}'
            rows={3}
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Timeout (seconds)
        </label>
        <input
          type="number"
          value={data.timeout || 30}
          onChange={(e) => handleInputChange('timeout', parseInt(e.target.value))}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          min="1"
          max="300"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Description
        </label>
        <textarea
          value={data.description || ''}
          onChange={(e) => handleInputChange('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          placeholder="Description of the MCP server..."
          rows={3}
        />
      </div>
    </div>
  );

  const renderCustomToolProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tool Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          placeholder="My Custom Tool"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Python Function
        </label>
        <textarea
          value={data.pythonCode || ''}
          onChange={(e) => handleInputChange('pythonCode', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
          placeholder="def word_counter(text: str) -> str:&#10;    &quot;&quot;&quot;Count words in the provided text&quot;&quot;&quot;&#10;    word_count = len(text.split())&#10;    return f&quot;Word count: {word_count}&quot;"
          rows={12}
        />
        <p className="text-xs text-gray-500 mt-1">
          Complete Python function with type hints and docstring. The function will be automatically decorated with @tool.
        </p>
      </div>
    </div>
  );

  const renderOrchestratorAgentProperties = (data: any) => (
    <div className="space-y-4">
      {/* Basic Agent Properties */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Orchestrator Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
          placeholder="Orchestrator Agent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Model Provider
        </label>
        <select
          value={data.modelProvider || 'AWS Bedrock'}
          onChange={(e) => {
            if (e.target.value === 'AWS Bedrock') {
              onUpdateNode(selectedNode.id, {
                ...selectedNode.data,
                modelProvider: e.target.value,
                modelId: bedrockModels[0].model_id,
                modelName: bedrockModels[0].model_name,
              });
            } else {
              onUpdateNode(selectedNode.id, {
                ...selectedNode.data,
                modelProvider: e.target.value,
                modelId: '',
                modelName: '',
              });
            }
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
        >
          <option value="AWS Bedrock">AWS Bedrock</option>
          <option value="OpenAI">OpenAI</option>
          <option value="Anthropic">Anthropic</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Model
        </label>
        {data.modelProvider === 'AWS Bedrock' || !data.modelProvider ? (
          <select
            value={data.modelId || bedrockModels[0].model_id}
            onChange={(e) => {
              const selectedModel = bedrockModels.find(m => m.model_id === e.target.value);
              if (selectedModel) {
                onUpdateNode(selectedNode.id, {
                  ...selectedNode.data,
                  modelId: selectedModel.model_id,
                  modelName: selectedModel.model_name,
                });
              }
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
          >
            {bedrockModels.map((model) => (
              <option key={model.model_id} value={model.model_id}>
                {model.model_name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={data.modelName || ''}
            onChange={(e) => handleInputChange('modelName', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
            placeholder="Enter model name (e.g., gpt-4o, gpt-3.5-turbo)"
          />
        )}
      </div>

      {/* OpenAI-specific fields */}
      {data.modelProvider === 'OpenAI' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Key
            </label>
            <input
              type="password"
              value={data.apiKey || ''}
              onChange={(e) => handleInputChange('apiKey', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
              placeholder="Enter your OpenAI API key"
            />
            <p className="text-xs text-gray-500 mt-1">
              API key will be stored securely as OPENAI_API_KEY environment variable
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Base URL (Optional)
            </label>
            <input
              type="url"
              value={data.baseUrl || ''}
              onChange={(e) => handleInputChange('baseUrl', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
              placeholder="https://api.openai.com/v1 (default)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave empty to use the default OpenAI API endpoint
            </p>
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          System Prompt
        </label>
        <textarea
          value={data.systemPrompt || ''}
          onChange={(e) => handleInputChange('systemPrompt', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
          placeholder="You are an orchestrator agent that coordinates multiple specialized agents..."
          rows={4}
        />
      </div>

      {/* Orchestrator-Specific Properties */}
      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold text-purple-800 mb-3">Orchestration Settings</h4>
        


        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Coordination Prompt
          </label>
          <textarea
            value={data.coordinationPrompt || ''}
            onChange={(e) => handleInputChange('coordinationPrompt', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
            placeholder="Instructions for how to coordinate and aggregate results from sub-agents..."
            rows={3}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Temperature: {data.temperature || 0.7}
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={data.temperature || 0.7}
          onChange={(e) => handleInputChange('temperature', parseFloat(e.target.value))}
          className="w-full"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Max Tokens
        </label>
        <input
          type="number"
          value={data.maxTokens || 4000}
          onChange={(e) => handleInputChange('maxTokens', parseInt(e.target.value))}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
          min="100"
          max="100000"
        />
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={data.streaming || false}
            disabled={!hasConnectedOutputNode()}
            onChange={(e) => handleInputChange('streaming', e.target.checked)}
            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-sm font-medium text-gray-700">Enable Streaming</span>
        </label>
        <p className="text-xs text-gray-500 mt-1">
          {hasConnectedOutputNode()
            ? "Stream responses in real-time for better user experience"
            : "Connect an Output node to enable streaming mode"
          }
        </p>
      </div>
    </div>
  );

  const renderGraphBuilderProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Graph Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
          placeholder="Graph"
        />
        <p className="text-xs text-gray-500 mt-1">
          Name for this graph workflow
        </p>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold text-purple-800 mb-2">Entry Points</h4>
        <p className="text-sm text-gray-600 mb-2">
          Connect the purple handle (right side) to agent nodes to define entry points.
          Entry point agents receive the original user input.
        </p>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold text-purple-800 mb-2">Agent Dependencies</h4>
        <p className="text-sm text-gray-600 mb-2">
          Connect agent output (bottom) to another agent's input (top) to define execution dependencies.
          Example: Agent A → Agent B means B depends on A's output.
        </p>
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={data.enableDebugLogs || false}
            onChange={(e) => handleInputChange('enableDebugLogs', e.target.checked)}
            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
          />
          <span className="text-sm font-medium text-gray-700">Enable Debug Logs</span>
        </label>
        <p className="text-xs text-gray-500 mt-1">
          Enable debug logging for graph execution
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Execution Timeout (seconds)
        </label>
        <input
          type="number"
          value={data.executionTimeout || ''}
          onChange={(e) => handleInputChange('executionTimeout', e.target.value ? parseInt(e.target.value) : undefined)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
          placeholder="Optional"
          min="1"
        />
        <p className="text-xs text-gray-500 mt-1">
          Leave empty for no timeout
        </p>
      </div>
    </div>
  );

  const renderSwarmProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Swarm Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
          placeholder="Swarm Name"
        />
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold text-emerald-800 mb-3">Execution Settings</h4>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Max Handoffs
          </label>
          <input
            type="number"
            value={data.maxHandoffs || 20}
            onChange={(e) => handleInputChange('maxHandoffs', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
            min="1"
            max="100"
          />
          <p className="text-xs text-gray-500 mt-1">
            Maximum number of agent handoffs allowed during execution
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Max Iterations
          </label>
          <input
            type="number"
            value={data.maxIterations || 20}
            onChange={(e) => handleInputChange('maxIterations', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
            min="1"
            max="100"
          />
          <p className="text-xs text-gray-500 mt-1">
            Maximum total iterations across all agents
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Execution Timeout (seconds)
          </label>
          <input
            type="number"
            value={data.executionTimeout || 900}
            onChange={(e) => handleInputChange('executionTimeout', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
            min="10"
            max="3600"
          />
          <p className="text-xs text-gray-500 mt-1">
            Total execution timeout in seconds (default: 900 = 15 minutes)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Node Timeout (seconds)
          </label>
          <input
            type="number"
            value={data.nodeTimeout || 300}
            onChange={(e) => handleInputChange('nodeTimeout', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
            min="5"
            max="1800"
          />
          <p className="text-xs text-gray-500 mt-1">
            Individual agent timeout in seconds (default: 300 = 5 minutes)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Repetitive Handoff Detection Window
          </label>
          <input
            type="number"
            value={data.repetitiveHandoffDetectionWindow || 0}
            onChange={(e) => handleInputChange('repetitiveHandoffDetectionWindow', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
            min="0"
            max="20"
          />
          <p className="text-xs text-gray-500 mt-1">
            Number of recent nodes to check for ping-pong behavior (0 = disabled)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Min Unique Agents for Detection
          </label>
          <input
            type="number"
            value={data.repetitiveHandoffMinUniqueAgents || 0}
            onChange={(e) => handleInputChange('repetitiveHandoffMinUniqueAgents', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
            min="0"
            max="10"
          />
          <p className="text-xs text-gray-500 mt-1">
            Minimum unique nodes required in recent sequence (0 = disabled)
          </p>
        </div>
      </div>

    </div>
  );

  const renderProperties = () => {
    switch (selectedNode.type) {
      case 'agent':
        return renderAgentProperties(selectedNode.data);
      case 'orchestrator-agent':
        return renderOrchestratorAgentProperties(selectedNode.data);
      case 'swarm':
        return renderSwarmProperties(selectedNode.data);
      case 'graph-builder':
        return renderGraphBuilderProperties(selectedNode.data);
      case 'tool':
        return renderToolProperties(selectedNode.data);
      case 'mcp-tool':
        return renderMCPToolProperties(selectedNode.data);
      case 'input':
        return renderInputProperties();
      case 'custom-tool':
        return renderCustomToolProperties(selectedNode.data);
      default:
        return (
          <div className="text-gray-500 text-center py-8">
            No properties available for this node type.
          </div>
        );
    }
  };

  return (
    <div className={`bg-white border-l border-gray-200 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center">
          <Settings className="w-4 h-4 text-gray-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Properties</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-600 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 overflow-y-auto">
        <div className="mb-4">
          <div className="text-sm text-gray-600 mb-2">Node Type</div>
          <div className="font-medium text-gray-900 capitalize">{selectedNode.type}</div>
        </div>

        {renderProperties()}
      </div>
    </div>
  );
}