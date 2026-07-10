import { type Node, type Edge } from '@xyflow/react';
import { Settings, X } from 'lucide-react';
import { BEDROCK_MODELS, CUSTOM_MODEL_OPTION, CUSTOM_MODEL_NAME, isCustomModel, MANTLE_PROVIDER, MANTLE_MODELS, DEFAULT_MANTLE_REGION, DEFAULT_MANTLE_MODEL_ID, mantleBaseUrl, isCustomMantleModel } from '@/lib/models';

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

  const bedrockModels = BEDROCK_MODELS;

  // When switching provider, seed sensible provider-specific defaults.
  const applyProviderChange = (provider: string) => {
    if (provider === 'AWS Bedrock') {
      onUpdateNode(selectedNode.id, {
        ...selectedNode.data,
        modelProvider: provider,
        modelId: bedrockModels[0].model_id,
        modelName: bedrockModels[0].model_name,
      });
    } else if (provider === MANTLE_PROVIDER) {
      const region = (selectedNode.data as { region?: string }).region || DEFAULT_MANTLE_REGION;
      onUpdateNode(selectedNode.id, {
        ...selectedNode.data,
        modelProvider: provider,
        region,
        baseUrl: mantleBaseUrl(region),
        // Mantle model ids flow through the non-Bedrock (modelName) codegen path.
        modelId: DEFAULT_MANTLE_MODEL_ID,
        modelName: DEFAULT_MANTLE_MODEL_ID,
      });
    } else {
      // OpenAI / other free-text providers
      onUpdateNode(selectedNode.id, {
        ...selectedNode.data,
        modelProvider: provider,
        modelId: '',
        modelName: '',
      });
    }
  };

  // Mantle: region + model dropdown (with custom id) + BEDROCK_API_KEY.
  const renderMantleFields = (data: { region?: string; modelId?: string; modelName?: string; apiKey?: string }) => {
    const region = data.region || DEFAULT_MANTLE_REGION;
    const custom = isCustomMantleModel(data.modelId, data.modelName);
    return (
      <>
        <div>
          <label className="lp-label">Region</label>
          <input
            type="text"
            value={region}
            onChange={(e) => {
              const r = e.target.value;
              onUpdateNode(selectedNode.id, {
                ...selectedNode.data,
                region: r,
                baseUrl: mantleBaseUrl(r),
              });
            }}
            className="lp-input"
            placeholder={DEFAULT_MANTLE_REGION}
          />
          <p className="text-[10px] text-[var(--ink-3)] font-mono mt-1">{mantleBaseUrl(region)}</p>
        </div>
        <div>
          <label className="lp-label">Model</label>
          <select
            value={custom ? CUSTOM_MODEL_OPTION : (data.modelId || DEFAULT_MANTLE_MODEL_ID)}
            onChange={(e) => {
              if (e.target.value === CUSTOM_MODEL_OPTION) {
                onUpdateNode(selectedNode.id, {
                  ...selectedNode.data,
                  modelId: '',
                  modelName: CUSTOM_MODEL_NAME,
                });
                return;
              }
              onUpdateNode(selectedNode.id, {
                ...selectedNode.data,
                modelId: e.target.value,
                modelName: e.target.value,
              });
            }}
            className="lp-input"
          >
            {MANTLE_MODELS.map((m) => (
              <option key={m.model_id} value={m.model_id}>{m.model_name}</option>
            ))}
            <option value={CUSTOM_MODEL_OPTION}>Custom model ID…</option>
          </select>
          {custom && (
            <input
              type="text"
              value={data.modelId || ''}
              onChange={(e) => {
                onUpdateNode(selectedNode.id, {
                  ...selectedNode.data,
                  modelId: e.target.value,
                  modelName: e.target.value ? e.target.value : CUSTOM_MODEL_NAME,
                });
              }}
              className="lp-input mt-2"
              placeholder="e.g. xai.grok-4.3"
            />
          )}
        </div>
        <div>
          <label className="lp-label">Bedrock API Key</label>
          <input
            type="password"
            value={data.apiKey || ''}
            onChange={(e) => handleInputChange('apiKey', e.target.value)}
            className="lp-input"
            placeholder="Enter your Bedrock API key"
          />
          <p className="text-[10px] text-[var(--ink-3)] font-mono mt-1">
            Stored securely as BEDROCK_API_KEY environment variable
          </p>
        </div>
      </>
    );
  };

  const renderAgentProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="lp-label">
          Agent Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="lp-input"
          placeholder="Agent Name"
        />
      </div>

      <div>
        <label className="lp-label">
          Model Provider
        </label>
        <select
          value={data.modelProvider || 'AWS Bedrock'}
          onChange={(e) => applyProviderChange(e.target.value)}
          className="lp-input"
        >
          <option value="AWS Bedrock">AWS Bedrock</option>
          <option value={MANTLE_PROVIDER}>{MANTLE_PROVIDER}</option>
          <option value="OpenAI">OpenAI</option>
          {/* <option value="Anthropic">Anthropic</option> */}
        </select>
      </div>

      {data.modelProvider === MANTLE_PROVIDER ? (
        renderMantleFields(data)
      ) : (
      <div>
        <label className="lp-label">
          Model
        </label>
        {data.modelProvider === 'AWS Bedrock' || !data.modelProvider ? (
          <>
            <select
              value={isCustomModel(data.modelId, data.modelName) ? CUSTOM_MODEL_OPTION : (data.modelId || bedrockModels[0].model_id)}
              onChange={(e) => {
                if (e.target.value === CUSTOM_MODEL_OPTION) {
                  onUpdateNode(selectedNode.id, {
                    ...selectedNode.data,
                    modelId: '',
                    modelName: CUSTOM_MODEL_NAME,
                  });
                  return;
                }
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
              className="lp-input"
            >
              {bedrockModels.map((model) => (
                <option key={model.model_id} value={model.model_id}>
                  {model.model_name}
                </option>
              ))}
              <option value={CUSTOM_MODEL_OPTION}>Custom model ID…</option>
            </select>
            {isCustomModel(data.modelId, data.modelName) && (
              <input
                type="text"
                value={data.modelId || ''}
                onChange={(e) => {
                  onUpdateNode(selectedNode.id, {
                    ...selectedNode.data,
                    modelId: e.target.value,
                    modelName: CUSTOM_MODEL_NAME,
                  });
                }}
                className="lp-input mt-2"
                placeholder="e.g. us.anthropic.claude-sonnet-5"
              />
            )}
          </>
        ) : (
          <input
            type="text"
            value={data.modelName || ''}
            onChange={(e) => handleInputChange('modelName', e.target.value)}
            className="lp-input"
            placeholder="Enter model name (e.g., gpt-4o, gpt-3.5-turbo)"
          />
        )}
      </div>
      )}

      {/* OpenAI-specific fields */}
      {data.modelProvider === 'OpenAI' && (
        <>
          <div>
            <label className="lp-label">
              API Key
            </label>
            <input
              type="password"
              value={data.apiKey || ''}
              onChange={(e) => handleInputChange('apiKey', e.target.value)}
              className="lp-input"
              placeholder="Enter your OpenAI API key"
            />
            <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
              API key will be stored securely as OPENAI_API_KEY environment variable
            </p>
          </div>

          <div>
            <label className="lp-label">
              Base URL (Optional)
            </label>
            <input
              type="url"
              value={data.baseUrl || ''}
              onChange={(e) => handleInputChange('baseUrl', e.target.value)}
              className="lp-input"
              placeholder="https://api.openai.com/v1 (default)"
            />
            <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
              Leave empty to use the default OpenAI API endpoint
            </p>
          </div>
        </>
      )}

      <div>
        <label className="lp-label">
          System Prompt
        </label>
        <textarea
          value={data.systemPrompt || ''}
          onChange={(e) => handleInputChange('systemPrompt', e.target.value)}
          className="lp-input"
          placeholder="You are a helpful AI assistant..."
          rows={4}
        />
      </div>

      <div>
        <label className="lp-label">
          Temperature: {(data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && data.thinkingEnabled ? 1 : (data.temperature || 0.7)}
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={(data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && data.thinkingEnabled ? 1 : (data.temperature || 0.7)}
          onChange={(e) => {
            const isBedrockThinking = (data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && data.thinkingEnabled;
            if (!isBedrockThinking) {
              handleInputChange('temperature', parseFloat(e.target.value));
            }
          }}
          disabled={(data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && data.thinkingEnabled}
          className="w-full accent-[#FFB000] disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {(data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && data.thinkingEnabled && (
          <p className="font-mono text-[10px] text-warn mt-1.5">
            Temperature is locked to 1.0 when thinking is enabled (Bedrock only)
          </p>
        )}
      </div>

      <div>
        <label className="lp-label">
          Max Tokens
        </label>
        <input
          type="number"
          value={data.maxTokens || 10000}
          onChange={(e) => handleInputChange('maxTokens', parseInt(e.target.value))}
          className="lp-input"
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
            className="accent-[#FFB000] disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-[12px] font-medium text-ink-2">Enable Streaming</span>
        </label>
        <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
          {hasConnectedOutputNode()
            ? "Stream responses in real-time for better user experience"
            : "Connect an Output node to enable streaming mode"
          }
        </p>
      </div>

      <div className="border-t pt-4">
        <h4 className="lp-label !text-amber mb-3">Advanced Settings</h4>

        <div>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={data.thinkingEnabled || false}
              onChange={(e) => handleInputChange('thinkingEnabled', e.target.checked)}
              className="accent-[#FFB000]"
            />
            <span className="text-[12px] font-medium text-ink-2">Enable Thinking</span>
          </label>
          <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
            Claude → adaptive thinking; GPT / Grok → reasoning effort
          </p>
        </div>

        {data.thinkingEnabled && (
          <>
            {data.modelProvider === 'AWS Bedrock' || !data.modelProvider ? (
              <div className="mt-3 lp-note">
                <span className="lp-note-icon">◇</span>
                <span>Adaptive thinking — Claude decides thinking depth per request. Temperature is pinned to 1 while thinking is on.</span>
              </div>
            ) : (
              <div className="mt-3">
                <label className="lp-label">
                  Reasoning Effort
                </label>
                <select
                  value={data.reasoningEffort === 'minimal' ? 'low' : (data.reasoningEffort || 'medium')}
                  onChange={(e) => handleInputChange('reasoningEffort', e.target.value)}
                  className="lp-input"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="xhigh">Extra High</option>
                  <option value="max">Max</option>
                </select>
              </div>
            )}
          </>
        )}

        {(data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && (
          <div className="mt-4">
            <label className="lp-label">Prompt Caching (Claude)</label>
            <label className="flex items-center space-x-2 mt-1.5">
              <input
                type="checkbox"
                checked={data.cacheMessages || false}
                onChange={(e) => handleInputChange('cacheMessages', e.target.checked)}
                className="accent-[#FFB000]"
              />
              <span className="text-[12px] font-medium text-ink-2">Cache conversation (auto)</span>
            </label>
            <label className="flex items-center space-x-2 mt-1.5">
              <input
                type="checkbox"
                checked={data.cacheTools || false}
                onChange={(e) => handleInputChange('cacheTools', e.target.checked)}
                className="accent-[#FFB000]"
              />
              <span className="text-[12px] font-medium text-ink-2">Cache tools</span>
            </label>
            <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
              Reuses cached prompt context across requests to cut cost and latency. Cache expires after ~5 min idle; content under the model's minimum token threshold is not cached.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderToolProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="lp-label">
          Tool Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="lp-input"
          placeholder="Tool Name"
        />
      </div>

      <div>
        <label className="lp-label">
          Tool Type
        </label>
        <select
          value={data.toolType || 'built-in'}
          onChange={(e) => handleInputChange('toolType', e.target.value)}
          className="lp-input"
        >
          <option value="built-in">Built-in</option>
          {/* <option value="custom">Custom</option> */}
        </select>
      </div>

      <div>
        <label className="lp-label">
          Tool Name/Function
        </label>
        {data.toolType === 'built-in' || !data.toolType ? (
          <select
            value={data.toolName || 'calculator'}
            onChange={(e) => handleInputChange('toolName', e.target.value)}
            className="lp-input"
          >
            <option value="calculator">Calculator</option>
            <option value="file_read">File Reader</option>
            <option value="file_write">File Write</option>
            <option value="shell">Shell Command</option>
            <option value="current_time">Current Time</option>
            <option value="http_request">Http Request</option>
            <option value="editor">Editor</option>
            <option value="retrieve">Retrieve (KB)</option>
          </select>
        ) : (
          <input
            type="text"
            value={data.toolName || ''}
            onChange={(e) => handleInputChange('toolName', e.target.value)}
            className="lp-input"
            placeholder="custom_function_name"
          />
        )}
      </div>

      <div>
        <label className="lp-label">
          Description
        </label>
        <textarea
          value={data.description || ''}
          onChange={(e) => handleInputChange('description', e.target.value)}
          className="lp-input"
          placeholder="Tool description..."
          rows={3}
        />
      </div>
    </div>
  );

  const renderInputProperties = () => (
    <div className="space-y-4">
      <div className="text-center py-8">
        <div className="text-ink-2 text-sm">
          Input node - connects user input to agents
        </div>
        <div className="font-mono text-[10px] text-ink-3 mt-2 uppercase tracking-wider">
          No configuration required
        </div>
      </div>
    </div>
  );

  const renderMCPToolProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="lp-label">
          Server Name
        </label>
        <input
          type="text"
          value={data.serverName || ''}
          onChange={(e) => handleInputChange('serverName', e.target.value)}
          className="lp-input"
          placeholder="MCP Server Name"
        />
      </div>

      <div>
        <label className="lp-label">
          Transport Type
        </label>
        <select
          value={data.transportType || 'stdio'}
          onChange={(e) => handleInputChange('transportType', e.target.value)}
          className="lp-input"
        >
          <option value="stdio">Standard I/O (stdio)</option>
          <option value="streamable_http">Streamable HTTP</option>
          <option value="sse">Server-Sent Events (SSE)</option>
        </select>
      </div>

      {data.transportType === 'stdio' && (
        <>
          <div>
            <label className="lp-label">
              Command
            </label>
            <input
              type="text"
              value={data.command || ''}
              onChange={(e) => handleInputChange('command', e.target.value)}
              className="lp-input"
              placeholder="uvx"
            />
          </div>

          <div>
            <label className="lp-label">
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
              className="lp-input resize-y"
              placeholder="server-name@latest"
              rows={3}
            />
            <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
              Enter each argument on a separate line
            </p>
          </div>

          <div>
            <label className="lp-label">
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
              className="lp-input mono resize-y"
              placeholder='{\n  "PATH": "/usr/local/bin",\n  "API_KEY": "your-key"\n}'
              rows={4}
            />
            <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
              Optional environment variables for the MCP server process (valid JSON required)
            </p>
          </div>
        </>
      )}

      {(data.transportType === 'streamable_http' || data.transportType === 'sse') && (
        <div>
          <label className="lp-label">
            Server URL
          </label>
          <input
            type="url"
            value={data.url || ''}
            onChange={(e) => handleInputChange('url', e.target.value)}
            className="lp-input"
            placeholder="http://localhost:8000/mcp"
          />
        </div>
      )}

      {(data.transportType === 'streamable_http' || data.transportType === 'sse') && (
        <div>
          <label className="lp-label">
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
            className="lp-input"
            placeholder='{"Authorization": "Bearer token"}'
            rows={3}
          />
        </div>
      )}

      <div>
        <label className="lp-label">
          Timeout (seconds)
        </label>
        <input
          type="number"
          value={data.timeout || 30}
          onChange={(e) => handleInputChange('timeout', parseInt(e.target.value))}
          className="lp-input"
          min="1"
          max="300"
        />
      </div>

      <div>
        <label className="lp-label">
          Description
        </label>
        <textarea
          value={data.description || ''}
          onChange={(e) => handleInputChange('description', e.target.value)}
          className="lp-input"
          placeholder="Description of the MCP server..."
          rows={3}
        />
      </div>
    </div>
  );

  const renderCustomToolProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="lp-label">
          Tool Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="lp-input"
          placeholder="My Custom Tool"
        />
      </div>

      <div>
        <label className="lp-label">
          Python Function
        </label>
        <textarea
          value={data.pythonCode || ''}
          onChange={(e) => handleInputChange('pythonCode', e.target.value)}
          className="lp-input mono"
          placeholder="def word_counter(text: str) -> str:&#10;    &quot;&quot;&quot;Count words in the provided text&quot;&quot;&quot;&#10;    word_count = len(text.split())&#10;    return f&quot;Word count: {word_count}&quot;"
          rows={12}
        />
        <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
          Complete Python function with type hints and docstring. The function will be automatically decorated with @tool.
        </p>
      </div>
    </div>
  );

  const renderOrchestratorAgentProperties = (data: any) => (
    <div className="space-y-4">
      {/* Basic Agent Properties */}
      <div>
        <label className="lp-label">
          Orchestrator Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="lp-input"
          placeholder="Orchestrator Agent"
        />
      </div>

      <div>
        <label className="lp-label">
          Model Provider
        </label>
        <select
          value={data.modelProvider || 'AWS Bedrock'}
          onChange={(e) => applyProviderChange(e.target.value)}
          className="lp-input"
        >
          <option value="AWS Bedrock">AWS Bedrock</option>
          <option value={MANTLE_PROVIDER}>{MANTLE_PROVIDER}</option>
          <option value="OpenAI">OpenAI</option>
          <option value="Anthropic">Anthropic</option>
        </select>
      </div>

      {data.modelProvider === MANTLE_PROVIDER ? (
        renderMantleFields(data)
      ) : (
      <div>
        <label className="lp-label">
          Model
        </label>
        {data.modelProvider === 'AWS Bedrock' || !data.modelProvider ? (
          <>
            <select
              value={isCustomModel(data.modelId, data.modelName) ? CUSTOM_MODEL_OPTION : (data.modelId || bedrockModels[0].model_id)}
              onChange={(e) => {
                if (e.target.value === CUSTOM_MODEL_OPTION) {
                  onUpdateNode(selectedNode.id, {
                    ...selectedNode.data,
                    modelId: '',
                    modelName: CUSTOM_MODEL_NAME,
                  });
                  return;
                }
                const selectedModel = bedrockModels.find(m => m.model_id === e.target.value);
                if (selectedModel) {
                  onUpdateNode(selectedNode.id, {
                    ...selectedNode.data,
                    modelId: selectedModel.model_id,
                    modelName: selectedModel.model_name,
                  });
                }
              }}
              className="lp-input"
            >
              {bedrockModels.map((model) => (
                <option key={model.model_id} value={model.model_id}>
                  {model.model_name}
                </option>
              ))}
              <option value={CUSTOM_MODEL_OPTION}>Custom model ID…</option>
            </select>
            {isCustomModel(data.modelId, data.modelName) && (
              <input
                type="text"
                value={data.modelId || ''}
                onChange={(e) => {
                  onUpdateNode(selectedNode.id, {
                    ...selectedNode.data,
                    modelId: e.target.value,
                    modelName: CUSTOM_MODEL_NAME,
                  });
                }}
                className="lp-input mt-2"
                placeholder="e.g. us.anthropic.claude-sonnet-5"
              />
            )}
          </>
        ) : (
          <input
            type="text"
            value={data.modelName || ''}
            onChange={(e) => handleInputChange('modelName', e.target.value)}
            className="lp-input"
            placeholder="Enter model name (e.g., gpt-4o, gpt-3.5-turbo)"
          />
        )}
      </div>
      )}

      {/* OpenAI-specific fields */}
      {data.modelProvider === 'OpenAI' && (
        <>
          <div>
            <label className="lp-label">
              API Key
            </label>
            <input
              type="password"
              value={data.apiKey || ''}
              onChange={(e) => handleInputChange('apiKey', e.target.value)}
              className="lp-input"
              placeholder="Enter your OpenAI API key"
            />
            <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
              API key will be stored securely as OPENAI_API_KEY environment variable
            </p>
          </div>
          
          <div>
            <label className="lp-label">
              Base URL (Optional)
            </label>
            <input
              type="url"
              value={data.baseUrl || ''}
              onChange={(e) => handleInputChange('baseUrl', e.target.value)}
              className="lp-input"
              placeholder="https://api.openai.com/v1 (default)"
            />
            <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
              Leave empty to use the default OpenAI API endpoint
            </p>
          </div>
        </>
      )}

      <div>
        <label className="lp-label">
          System Prompt
        </label>
        <textarea
          value={data.systemPrompt || ''}
          onChange={(e) => handleInputChange('systemPrompt', e.target.value)}
          className="lp-input"
          placeholder="You are an orchestrator agent that coordinates multiple specialized agents..."
          rows={4}
        />
      </div>

      {/* Orchestrator-Specific Properties */}
      <div className="border-t pt-4">
        <h4 className="lp-label !text-amber mb-3">Orchestration Settings</h4>
        


        <div>
          <label className="lp-label">
            Coordination Prompt
          </label>
          <textarea
            value={data.coordinationPrompt || ''}
            onChange={(e) => handleInputChange('coordinationPrompt', e.target.value)}
            className="lp-input"
            placeholder="Instructions for how to coordinate and aggregate results from sub-agents..."
            rows={3}
          />
        </div>
      </div>

      <div>
        <label className="lp-label">
          Temperature: {(data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && data.thinkingEnabled ? 1 : (data.temperature || 0.7)}
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={(data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && data.thinkingEnabled ? 1 : (data.temperature || 0.7)}
          onChange={(e) => {
            const isBedrockThinking = (data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && data.thinkingEnabled;
            if (!isBedrockThinking) {
              handleInputChange('temperature', parseFloat(e.target.value));
            }
          }}
          disabled={(data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && data.thinkingEnabled}
          className="w-full accent-[#FFB000] disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {(data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && data.thinkingEnabled && (
          <p className="font-mono text-[10px] text-warn mt-1.5">
            Temperature is locked to 1.0 when thinking is enabled (Bedrock only)
          </p>
        )}
      </div>

      <div>
        <label className="lp-label">
          Max Tokens
        </label>
        <input
          type="number"
          value={data.maxTokens || 10000}
          onChange={(e) => handleInputChange('maxTokens', parseInt(e.target.value))}
          className="lp-input"
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
            className="accent-[#FFB000] disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-[12px] font-medium text-ink-2">Enable Streaming</span>
        </label>
        <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
          {hasConnectedOutputNode()
            ? "Stream responses in real-time for better user experience"
            : "Connect an Output node to enable streaming mode"
          }
        </p>
      </div>

      <div className="border-t pt-4">
        <h4 className="lp-label !text-amber mb-3">Advanced Settings</h4>

        <div>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={data.thinkingEnabled || false}
              onChange={(e) => handleInputChange('thinkingEnabled', e.target.checked)}
              className="accent-[#FFB000]"
            />
            <span className="text-[12px] font-medium text-ink-2">Enable Thinking</span>
          </label>
          <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
            Claude → adaptive thinking; GPT / Grok → reasoning effort
          </p>
        </div>

        {data.thinkingEnabled && (
          <>
            {data.modelProvider === 'AWS Bedrock' || !data.modelProvider ? (
              <div className="mt-3 lp-note">
                <span className="lp-note-icon">◇</span>
                <span>Adaptive thinking — Claude decides thinking depth per request. Temperature is pinned to 1 while thinking is on.</span>
              </div>
            ) : (
              <div className="mt-3">
                <label className="lp-label">
                  Reasoning Effort
                </label>
                <select
                  value={data.reasoningEffort === 'minimal' ? 'low' : (data.reasoningEffort || 'medium')}
                  onChange={(e) => handleInputChange('reasoningEffort', e.target.value)}
                  className="lp-input"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="xhigh">Extra High</option>
                  <option value="max">Max</option>
                </select>
              </div>
            )}
          </>
        )}

        {(data.modelProvider === 'AWS Bedrock' || !data.modelProvider) && (
          <div className="mt-4">
            <label className="lp-label">Prompt Caching (Claude)</label>
            <label className="flex items-center space-x-2 mt-1.5">
              <input
                type="checkbox"
                checked={data.cacheMessages || false}
                onChange={(e) => handleInputChange('cacheMessages', e.target.checked)}
                className="accent-[#FFB000]"
              />
              <span className="text-[12px] font-medium text-ink-2">Cache conversation (auto)</span>
            </label>
            <label className="flex items-center space-x-2 mt-1.5">
              <input
                type="checkbox"
                checked={data.cacheTools || false}
                onChange={(e) => handleInputChange('cacheTools', e.target.checked)}
                className="accent-[#FFB000]"
              />
              <span className="text-[12px] font-medium text-ink-2">Cache tools</span>
            </label>
            <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
              Reuses cached prompt context across requests to cut cost and latency. Cache expires after ~5 min idle; content under the model's minimum token threshold is not cached.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderGraphBuilderProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="lp-label">
          Graph Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="lp-input"
          placeholder="Graph"
        />
        <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
          Name for this graph workflow
        </p>
      </div>

      <div className="border-t pt-4">
        <h4 className="lp-label !text-amber mb-2">Entry Points</h4>
        <p className="text-xs text-ink-2 mb-2 leading-relaxed">
          Connect the purple handle (right side) to agent nodes to define entry points.
          Entry point agents receive the original user input.
        </p>
      </div>

      <div className="border-t pt-4">
        <h4 className="lp-label !text-amber mb-2">Agent Dependencies</h4>
        <p className="text-xs text-ink-2 mb-2 leading-relaxed">
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
            className="accent-[#FFB000]"
          />
          <span className="text-[12px] font-medium text-ink-2">Enable Debug Logs</span>
        </label>
        <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
          Enable debug logging for graph execution
        </p>
      </div>

      <div>
        <label className="lp-label">
          Execution Timeout (seconds)
        </label>
        <input
          type="number"
          value={data.executionTimeout || ''}
          onChange={(e) => handleInputChange('executionTimeout', e.target.value ? parseInt(e.target.value) : undefined)}
          className="lp-input"
          placeholder="Optional"
          min="1"
        />
        <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
          Leave empty for no timeout
        </p>
      </div>
    </div>
  );

  const renderSwarmProperties = (data: any) => (
    <div className="space-y-4">
      <div>
        <label className="lp-label">
          Swarm Name
        </label>
        <input
          type="text"
          value={data.label || ''}
          onChange={(e) => handleInputChange('label', e.target.value)}
          className="lp-input"
          placeholder="Swarm Name"
        />
      </div>

      <div className="border-t pt-4">
        <h4 className="lp-label !text-amber mb-3">Execution Settings</h4>

        <div>
          <label className="lp-label">
            Max Handoffs
          </label>
          <input
            type="number"
            value={data.maxHandoffs || 20}
            onChange={(e) => handleInputChange('maxHandoffs', parseInt(e.target.value))}
            className="lp-input"
            min="1"
            max="100"
          />
          <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
            Maximum number of agent handoffs allowed during execution
          </p>
        </div>

        <div>
          <label className="lp-label">
            Max Iterations
          </label>
          <input
            type="number"
            value={data.maxIterations || 20}
            onChange={(e) => handleInputChange('maxIterations', parseInt(e.target.value))}
            className="lp-input"
            min="1"
            max="100"
          />
          <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
            Maximum total iterations across all agents
          </p>
        </div>

        <div>
          <label className="lp-label">
            Execution Timeout (seconds)
          </label>
          <input
            type="number"
            value={data.executionTimeout || 900}
            onChange={(e) => handleInputChange('executionTimeout', parseInt(e.target.value))}
            className="lp-input"
            min="10"
            max="3600"
          />
          <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
            Total execution timeout in seconds (default: 900 = 15 minutes)
          </p>
        </div>

        <div>
          <label className="lp-label">
            Node Timeout (seconds)
          </label>
          <input
            type="number"
            value={data.nodeTimeout || 300}
            onChange={(e) => handleInputChange('nodeTimeout', parseInt(e.target.value))}
            className="lp-input"
            min="5"
            max="1800"
          />
          <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
            Individual agent timeout in seconds (default: 300 = 5 minutes)
          </p>
        </div>

        <div>
          <label className="lp-label">
            Repetitive Handoff Detection Window
          </label>
          <input
            type="number"
            value={data.repetitiveHandoffDetectionWindow || 0}
            onChange={(e) => handleInputChange('repetitiveHandoffDetectionWindow', parseInt(e.target.value))}
            className="lp-input"
            min="0"
            max="20"
          />
          <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
            Number of recent nodes to check for ping-pong behavior (0 = disabled)
          </p>
        </div>

        <div>
          <label className="lp-label">
            Min Unique Agents for Detection
          </label>
          <input
            type="number"
            value={data.repetitiveHandoffMinUniqueAgents || 0}
            onChange={(e) => handleInputChange('repetitiveHandoffMinUniqueAgents', parseInt(e.target.value))}
            className="lp-input"
            min="0"
            max="10"
          />
          <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">
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
          <div className="text-ink-3 text-center py-8 text-sm">
            No properties available for this node type.
          </div>
        );
    }
  };

  return (
    <div className={`bg-panel border-l border-line flex flex-col ${className}`}>
      {/* Header */}
      <div className="lp-phead flex-shrink-0">
        <Settings className="w-4 h-4 text-ink-3" />
        <h3 className="lp-ptitle">Properties</h3>
        <span className="lp-sub">node config</span>
        <button
          onClick={onClose}
          className="ml-auto p-1 text-ink-3 hover:text-ink transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 overflow-y-auto">
        <div className="mb-4">
          <div className="lp-label">Node Type</div>
          <div className="font-mono text-[11px] text-ink uppercase tracking-wider">{selectedNode.type}</div>
        </div>

        {renderProperties()}
      </div>
    </div>
  );
}