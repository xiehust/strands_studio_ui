import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { ArrowRight, MessageCircle, X } from 'lucide-react';

interface InputNodeData {
  label?: string;
  inputType?: 'user-prompt' | 'data' | 'variable';
  content?: string;
  placeholder?: string;
}

export function InputNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = data as InputNodeData || {};
  const {
    label = 'Input',
    inputType = 'user-prompt',
    content = '',
    placeholder = 'Enter your prompt...',
  } = nodeData;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'user-prompt':
        return { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', text: 'text-blue-800' };
      case 'data':
        return { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600', text: 'text-purple-800' };
      case 'variable':
        return { bg: 'bg-yellow-50', border: 'border-yellow-200', icon: 'text-yellow-600', text: 'text-yellow-800' };
      default:
        return { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-gray-600', text: 'text-gray-800' };
    }
  };

  const colors = getTypeColor(inputType);

  return (
    <div className={`
      bg-white rounded-lg border-2 shadow-sm min-w-[200px] max-w-[300px]
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
        <div className="space-y-2">
          <div className="text-xs text-gray-600">
            <span className="font-medium">Type:</span> {inputType}
          </div>
          
          {content ? (
            <div className="text-xs text-gray-700 bg-gray-50 p-2 rounded border max-h-20 overflow-y-auto">
              {content}
            </div>
          ) : (
            <div className="text-xs text-gray-400 italic">
              {placeholder}
            </div>
          )}
        </div>
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!bg-green-500"
        style={{ right: -6 }}
      />
    </div>
  );
}