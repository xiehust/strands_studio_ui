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

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  return (
    <div className={`lp-node min-w-[180px] ${selected ? 'sel' : ''}`}>
      {/* Node Header */}
      <div className="lp-node-head" style={{ boxShadow: 'inset 2px 0 0 var(--ink-2)' }}>
        <ArrowLeft className="w-4 h-4 text-ink-2 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-ink flex-1 truncate">{label}</span>
        <span className="lp-node-type text-ink-3">OUTPUT</span>
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
        <div className="lp-node-kv"><span className="k">TYPE</span><span className="v">{outputType}</span></div>
        <div className="lp-node-kv"><span className="k">FORMAT</span><span className="v">{format}</span></div>
        <div className="lp-node-kv"><span className="k">TO</span><span className="v">{destination}</span></div>
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!bg-s1 !w-3 !h-3 !absolute"
        style={{ left: -6 }}
      />
    </div>
  );
}