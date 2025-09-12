import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { ArrowLeft, Settings, X } from 'lucide-react';

interface OutputNodeData {
  label?: string;
  outputType?: 'response' | 'file' | 'data';
  format?: 'text' | 'json' | 'markdown' | 'csv';
  destination?: string;
}

export function OutputNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = data as OutputNodeData || {};
  const {
    label = 'Output',
    outputType = 'response',
    format = 'text',
    destination = 'Display',
  } = nodeData;

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'response':
        return { bg: 'bg-indigo-50', border: 'border-indigo-200', icon: 'text-indigo-600', text: 'text-indigo-800' };
      case 'file':
        return { bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-600', text: 'text-red-800' };
      case 'data':
        return { bg: 'bg-teal-50', border: 'border-teal-200', icon: 'text-teal-600', text: 'text-teal-800' };
      default:
        return { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-gray-600', text: 'text-gray-800' };
    }
  };

  const colors = getTypeColor(outputType);

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  return (
    <div className={`
      bg-white rounded-lg border-2 shadow-sm min-w-[180px]
      ${selected ? 'border-blue-500 shadow-lg' : `border-gray-200 hover:${colors.border}`}
    `}>
      {/* Node Header */}
      <div className={`${colors.bg} px-4 py-2 border-b ${colors.border} rounded-t-lg flex items-center`}>
        <ArrowLeft className={`w-4 h-4 ${colors.icon} mr-2`} />
        <span className={`text-sm font-semibold ${colors.text}`}>{label}</span>
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
      <div className="p-3">
        <div className="space-y-1 text-xs text-gray-600">
          <div>
            <span className="font-medium">Type:</span> {outputType}
          </div>
          <div>
            <span className="font-medium">Format:</span> {format}
          </div>
          <div>
            <span className="font-medium">To:</span> {destination}
          </div>
        </div>
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!bg-indigo-500"
        style={{ left: -6 }}
      />
    </div>
  );
}