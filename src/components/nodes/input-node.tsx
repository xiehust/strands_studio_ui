import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { ArrowRight, MessageCircle, X } from 'lucide-react';

interface InputNodeData {
  label?: string;
}

export function InputNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = data as InputNodeData || {};
  const {
    label = 'Input'
  } = nodeData;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  const colors = { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', text: 'text-blue-800' };

  return (
    <div className={`
      bg-white rounded-lg border-2 shadow-sm min-w-[200px] max-w-[300px] relative
      ${selected ? 'border-blue-500 shadow-lg' : `border-gray-200 hover:${colors.border}`}
    `}>
      {/* Node Header */}
      <div className={`${colors.bg} px-4 py-2 border-b ${colors.border} rounded-t-lg flex items-center`}>
        <ArrowRight className={`w-4 h-4 ${colors.icon} mr-2`} />
        <span className={`text-sm font-semibold ${colors.text}`}>{label}</span>
        <div className="ml-auto flex items-center space-x-1">
          <MessageCircle className="w-3 h-3 text-gray-400" />
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
      <div className="p-3">
        <div className="text-center">
          <div className="text-xs text-gray-500">
            Connects user input to agents
          </div>
        </div>
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!bg-green-500 !w-3 !h-3 !absolute"
        style={{ right: -6 }}
      />
    </div>
  );
}