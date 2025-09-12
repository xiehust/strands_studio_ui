import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { Wrench, Package, Code, X } from 'lucide-react';

interface ToolNodeData {
  label?: string;
  toolType?: 'built-in' | 'custom';
  toolName?: string;
  description?: string;
  parameters?: Record<string, any>;
}


export function ToolNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = data as ToolNodeData || {};
  const {
    label = 'Tool',
    toolType = 'built-in',
    toolName = 'calculator',
    description = 'Calculator functionality',
  } = nodeData;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  const isBuiltIn = toolType === 'built-in';
  const IconComponent = isBuiltIn ? Package : Code;
  const bgColor = isBuiltIn ? 'bg-orange-50' : 'bg-purple-50';
  const borderColor = isBuiltIn ? 'border-orange-200' : 'border-purple-200';
  const iconColor = isBuiltIn ? 'text-orange-600' : 'text-purple-600';
  const textColor = isBuiltIn ? 'text-orange-800' : 'text-purple-800';

  return (
    <div className={`
      bg-white rounded-lg border-2 shadow-sm min-w-[180px]
      ${selected ? 'border-blue-500 shadow-lg' : `border-gray-200 hover:${borderColor}`}
    `}>
      {/* Node Header */}
      <div className={`${bgColor} px-4 py-2 border-b ${borderColor} rounded-t-lg flex items-center`}>
        <Wrench className={`w-4 h-4 ${iconColor} mr-2`} />
        <span className={`text-sm font-semibold ${textColor}`}>{label}</span>
        <div className="ml-auto flex items-center space-x-1">
          <IconComponent className="w-3 h-3 text-gray-400" />
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
            <span className="font-medium">Type:</span> {toolType}
          </div>
          <div>
            <span className="font-medium">Tool:</span> {toolName}
          </div>
          {description && (
            <div className="text-xs text-gray-500 mt-2 truncate">
              {description}
            </div>
          )}
        </div>
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="config"
        className="!bg-gray-500"
        style={{ left: -6 }}
      />

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="tool-output"
        className={isBuiltIn ? '!bg-orange-500' : '!bg-purple-500'}
        style={{ right: -6 }}
      />
    </div>
  );
}