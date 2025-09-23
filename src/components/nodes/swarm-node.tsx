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
    <div className={`
      bg-white rounded-lg border-2 shadow-sm min-w-[240px]
      ${selected ? 'border-emerald-500 shadow-lg' : 'border-gray-200 hover:border-emerald-300'}
    `}>
      {/* Node Header */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-2 border-b border-emerald-200 rounded-t-lg flex items-center">
        <Users className="w-4 h-4 text-emerald-600 mr-2" />
        <span className="text-sm font-semibold text-emerald-800">{label}</span>
        <div className="ml-auto flex items-center space-x-1">
          <Settings className="w-3 h-3 text-gray-400" />
          {selected && (
            <button
              onClick={handleDelete}
              className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
              title="Delete node"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Node Content */}
      <div className="p-4">
        <div className="space-y-2 text-xs text-gray-600">
          <div>
            <span className="font-medium">Max Handoffs:</span> {maxHandoffs}
          </div>
          <div>
            <span className="font-medium">Max Iterations:</span> {maxIterations}
          </div>
          <div>
            <span className="font-medium">Execution Timeout:</span> {executionTimeout}s
          </div>
          <div>
            <span className="font-medium">Node Timeout:</span> {nodeTimeout}s
          </div>
        </div>
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="user-input"
        className="!bg-green-500 !w-3 !h-3 !absolute"
        style={{ top: -6, left: '50%' }}
      />

      {/* Agents Handle (to connect to agent nodes that will be part of the swarm) */}
      <Handle
        type="source"
        position={Position.Right}
        id="sub-agents"
        className="!bg-purple-400 !w-3 !h-3 !absolute"
        style={{ right: -6, top: '50%' }}
      />

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        className="!bg-indigo-500 !w-3 !h-3 !absolute"
        style={{ bottom: -6 }}
      />
    </div>
  );
}