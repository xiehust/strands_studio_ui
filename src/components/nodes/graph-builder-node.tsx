import { type NodeProps, useReactFlow } from '@xyflow/react';
import { Network, Settings, X } from 'lucide-react';

interface GraphBuilderNodeData {
  label?: string;
  enableDebugLogs?: boolean;
  executionTimeout?: number;
}

export function GraphBuilderNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = data as GraphBuilderNodeData || {};
  const {
    label = 'Graph',
    enableDebugLogs = false,
    executionTimeout = undefined,
  } = nodeData;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  return (
    <div
      className={`
        rounded-xl border-4 border-dashed bg-gradient-to-br from-purple-50/30 to-violet-50/30
        min-w-[800px] min-h-[600px] p-6
        ${selected ? 'border-purple-500 shadow-2xl' : 'border-purple-300 hover:border-purple-400'}
      `}
      style={{
        backdropFilter: 'blur(1px)',
      }}
    >
      {/* Container Header */}
      <div className="absolute top-2 left-2 right-2 bg-gradient-to-r from-purple-500 to-violet-500 rounded-lg px-4 py-2 flex items-center shadow-lg z-10" style={{ pointerEvents: 'all' }}>
        <Network className="w-5 h-5 text-white mr-2" />
        <span className="text-sm font-bold text-white">{label}</span>
        <div className="ml-auto flex items-center space-x-2">
          <div className="text-xs text-white/80">
            {enableDebugLogs && '🐛 Debug'}
            {executionTimeout && ` ⏱️ ${executionTimeout}s`}
          </div>
          <Settings className="w-4 h-4 text-white/80" />
          {selected && (
            <button
              onClick={handleDelete}
              className="w-5 h-5 flex items-center justify-center text-white/80 hover:text-white hover:bg-white/20 rounded transition-colors"
              title="Delete graph"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Container Content Area - agents will be placed here */}
      {/* Use pointer-events: none on background elements so child nodes can receive events */}
      <div className="pt-12 pb-4 h-full" style={{ pointerEvents: 'none' }}>
        <div className="h-full rounded-lg border-2 border-dashed border-purple-200 bg-white/40 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
          <div className="text-center text-purple-400 text-sm" style={{ pointerEvents: 'none' }}>
            <Network className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="font-medium">Drop agent nodes here</p>
            <p className="text-xs mt-1">Connect agents to define dependencies</p>
          </div>
        </div>
      </div>
    </div>
  );
}
