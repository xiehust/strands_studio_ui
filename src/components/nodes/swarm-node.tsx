import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { Users, Settings, X } from 'lucide-react';

interface SwarmNodeData {
  label?: string;
  entryPointAgentId?: string; // ID of the agent node that should be the entry point
  maxHandoffs?: number;
  maxIterations?: number;
  executionTimeout?: number; // in seconds
  nodeTimeout?: number; // in seconds
  repetitiveHandoffDetectionWindow?: number;
  repetitiveHandoffMinUniqueAgents?: number;
  streaming?: boolean;
}

export function SwarmNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = data as SwarmNodeData || {};
  const {
    label = 'Swarm',
    maxHandoffs = 20,
    maxIterations = 20,
    executionTimeout = 900, // 15 minutes
    nodeTimeout = 300, // 5 minutes
  } = nodeData;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  return (
    <div className={`lp-node min-w-[240px] ${selected ? 'sel' : ''}`}>
      {/* Node Header */}
      <div className="lp-node-head" style={{ boxShadow: 'inset 2px 0 0 var(--s5)' }}>
        <Users className="w-4 h-4 text-s5 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-ink flex-1 truncate">{label}</span>
        <span className="lp-node-type text-s5">SWARM</span>
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
        <div className="lp-node-kv"><span className="k">MAX HANDOFFS</span><span className="v">{maxHandoffs}</span></div>
        <div className="lp-node-kv"><span className="k">MAX ITERATIONS</span><span className="v">{maxIterations}</span></div>
        <div className="lp-node-kv"><span className="k">EXEC TIMEOUT</span><span className="v">{executionTimeout}s</span></div>
        <div className="lp-node-kv"><span className="k">NODE TIMEOUT</span><span className="v">{nodeTimeout}s</span></div>
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="user-input"
        className="!bg-s2 !w-3 !h-3 !absolute"
        style={{ top: -6, left: '50%' }}
      />

      {/* Agents Handle (to connect to agent nodes that will be part of the swarm) */}
      <Handle
        type="source"
        position={Position.Right}
        id="sub-agents"
        className="!bg-s5 !w-3 !h-3 !absolute"
        style={{ right: -6, top: '50%' }}
      />

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        className="!bg-s1 !w-3 !h-3 !absolute"
        style={{ bottom: -6 }}
      />
    </div>
  );
}