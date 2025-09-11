import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { Bot, Settings, X } from 'lucide-react';

interface AgentNodeData {
  label?: string;
  modelProvider?: string;
  modelId?: string;
  modelName?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}

export function AgentNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = data as AgentNodeData || {};
  const {
    label = 'Agent',
    modelProvider = 'AWS Bedrock',
    modelName = 'Claude 3.7 Sonnet',
    temperature = 0.7,
  } = nodeData;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  return (
    <div className={`
      bg-white rounded-lg border-2 shadow-sm min-w-[200px]
      ${selected ? 'border-blue-500 shadow-lg' : 'border-gray-200 hover:border-gray-300'}
    `}>
      {/* Node Header */}
      <div className="bg-blue-50 px-4 py-2 border-b border-gray-200 rounded-t-lg flex items-center">
        <Bot className="w-4 h-4 text-blue-600 mr-2" />
        <span className="text-sm font-semibold text-blue-800">{label}</span>
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
            <span className="font-medium">Provider:</span> {modelProvider}
          </div>
          <div>
            <span className="font-medium">Model:</span> {modelName}
          </div>
          <div>
            <span className="font-medium">Temperature:</span> {temperature}
          </div>
        </div>
      </div>

      {/* Input Handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="user-input"
        className="!bg-blue-500"
        style={{ top: -6, left: '50%', transform: 'translateX(-50%)' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="tools"
        className="!bg-orange-500"
        style={{ left: -6 }}
      />

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        className="!bg-blue-500"
        style={{ bottom: -6 }}
      />
    </div>
  );
}