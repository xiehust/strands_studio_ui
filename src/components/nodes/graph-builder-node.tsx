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
        border border-dashed bg-s5/5
        min-w-[800px] min-h-[600px] p-6
        ${selected ? 'border-s5 shadow-[0_0_0_1px_var(--s5)]' : 'border-s5/40 hover:border-s5/70'}
      `}
    >
      {/* Container Header */}
      <div className="absolute top-2 left-2 right-2 bg-panel2 border border-s5/40 px-4 py-2 flex items-center z-10" style={{ pointerEvents: 'all', boxShadow: 'inset 2px 0 0 var(--s5)' }}>
        <Network className="w-5 h-5 text-s5 mr-2" />
        <span className="text-sm font-bold text-ink">{label}</span>
        <span className="lp-node-type text-s5 ml-2">GRAPH</span>
        <div className="ml-auto flex items-center space-x-2">
          <div className="font-mono text-[10px] text-ink-3">
            {enableDebugLogs && 'DEBUG'}
            {executionTimeout && ` · ${executionTimeout}s`}
          </div>
          <Settings className="w-4 h-4 text-ink-3" />
          {selected && (
            <button
              onClick={handleDelete}
              className="w-5 h-5 flex items-center justify-center text-ink-3 hover:text-crit transition-colors"
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
        <div className="h-full border border-dashed border-s5/25 bg-bg/40 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
          <div className="text-center text-ink-3 text-sm" style={{ pointerEvents: 'none' }}>
            <Network className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="font-medium">Drop agent nodes here</p>
            <p className="font-mono text-[10px] mt-1">CONNECT AGENTS TO DEFINE DEPENDENCIES</p>
          </div>
        </div>
      </div>
    </div>
  );
}
