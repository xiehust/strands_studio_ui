import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { Crown, Settings, X } from 'lucide-react';

interface OrchestratorAgentNodeData {
  label?: string;
  modelProvider?: string;
  modelId?: string;
  modelName?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  // Orchestrator-specific properties
  coordinationPrompt?: string;
  // OpenAI-specific fields
  apiKey?: string;
  baseUrl?: string;
  // Thinking settings
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  cacheMessages?: boolean;
  cacheTools?: boolean;
}

export function OrchestratorAgentNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = data as OrchestratorAgentNodeData || {};
  const {
    label = 'Orchestrator Agent',
    modelProvider = 'AWS Bedrock',
    modelName = 'Claude 3.7 Sonnet',
    temperature = 0.7,
  } = nodeData;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };


  return (
    <div className={`lp-node min-w-[220px] ${selected ? 'sel' : ''}`}>
      {/* Node Header */}
      <div className="lp-node-head" style={{ boxShadow: 'inset 2px 0 0 var(--s5)' }}>
        <Crown className="w-4 h-4 text-s5 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-ink flex-1 truncate">{label}</span>
        <span className="lp-node-type text-s5">ORCH</span>
        <div className="flex items-center gap-1">
          <Settings className="w-3 h-3 text-ink-3" />
          {selected && (
            <button
              onClick={handleDelete}
              className="w-4 h-4 flex items-center justify-center text-ink-3 hover:text-crit transition-colors"
              title="Delete node"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Node Content */}
      <div className="px-3 py-2.5">
        <div className="lp-node-kv"><span className="k">PROVIDER</span><span className="v">{modelProvider}</span></div>
        <div className="lp-node-kv"><span className="k">MODEL</span><span className="v">{modelName}</span></div>
        <div className="lp-node-kv"><span className="k">TEMP</span><span className="v">{temperature}</span></div>
      </div>

      {/* Input Handle with Label */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full flex flex-col items-center">
        <span className="lp-handle-tag text-s2 mb-0.5">In</span>
        <Handle
          type="target"
          position={Position.Top}
          id="user-input"
          className="!bg-s2 !w-3 !h-3 !relative !transform-none"
          style={{ position: 'relative', top: 0, left: 0 }}
        />
      </div>
      <div className="absolute left-0 top-[25%] -translate-x-full -translate-y-1/2 flex items-center">
        <span className="lp-handle-tag text-s3 mr-0.5">Tool</span>
        <Handle
          type="target"
          position={Position.Left}
          id="tools"
          className="!bg-s3 !w-3 !h-3 !relative !transform-none"
          style={{ position: 'relative', left: 0, top: 0 }}
        />
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="orchestrator-input"
        className="!bg-s5 !w-3 !h-3 !absolute"
        style={{ left: -6, top: '55%' }}
      />

      {/* Sub-Agents Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="sub-agents"
        className="!bg-s5 !w-3 !h-3 !absolute"
        style={{ right: -6, top: '50%' }}
      />

      {/* Output Handle with Label */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full flex flex-col items-center">
        <Handle
          type="source"
          position={Position.Bottom}
          id="output"
          className="!bg-s1 !w-3 !h-3 !relative !transform-none"
          style={{ position: 'relative', bottom: 0, left: 0 }}
        />
        <span className="lp-handle-tag text-s1 mt-0.5">Out</span>
      </div>
    </div>
  );
}