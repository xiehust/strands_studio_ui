import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitBranch, Zap } from 'lucide-react';

interface ControlNodeData {
  label?: string;
  controlType?: 'conditional' | 'loop' | 'switch' | 'parallel';
  condition?: string;
  description?: string;
}

export function ControlNode({ data, selected }: NodeProps) {
  const nodeData = data as ControlNodeData || {};
  const {
    label = 'Control Flow',
    controlType = 'conditional',
    condition = 'if result.success',
    description = 'Conditional execution based on previous results',
  } = nodeData;

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'conditional':
        return { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600', text: 'text-amber-800' };
      case 'loop':
        return { bg: 'bg-cyan-50', border: 'border-cyan-200', icon: 'text-cyan-600', text: 'text-cyan-800' };
      case 'switch':
        return { bg: 'bg-rose-50', border: 'border-rose-200', icon: 'text-rose-600', text: 'text-rose-800' };
      case 'parallel':
        return { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-600', text: 'text-emerald-800' };
      default:
        return { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-gray-600', text: 'text-gray-800' };
    }
  };

  const colors = getTypeColor(controlType);

  return (
    <div className={`
      bg-white rounded-lg border-2 shadow-sm min-w-[200px]
      ${selected ? 'border-blue-500 shadow-lg' : `border-gray-200 hover:${colors.border}`}
    `}>
      {/* Node Header */}
      <div className={`${colors.bg} px-4 py-2 border-b ${colors.border} rounded-t-lg flex items-center`}>
        <GitBranch className={`w-4 h-4 ${colors.icon} mr-2`} />
        <span className={`text-sm font-semibold ${colors.text}`}>{label}</span>
        <Zap className="w-3 h-3 text-gray-400 ml-auto" />
      </div>

      {/* Node Content */}
      <div className="p-3">
        <div className="space-y-2">
          <div className="text-xs text-gray-600">
            <span className="font-medium">Type:</span> {controlType}
          </div>
          
          {condition && (
            <div className="text-xs">
              <span className="font-medium text-gray-600">Condition:</span>
              <div className="text-gray-700 bg-gray-50 p-2 rounded border mt-1 font-mono text-xs">
                {condition}
              </div>
            </div>
          )}

          {description && (
            <div className="text-xs text-gray-500">
              {description}
            </div>
          )}
        </div>
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="input"
        className="!bg-gray-500"
        style={{ top: -6 }}
      />

      {/* Output Handles for branches */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="!bg-green-500"
        style={{ bottom: -6, left: '30%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="!bg-red-500"
        style={{ bottom: -6, right: '30%' }}
      />
    </div>
  );
}