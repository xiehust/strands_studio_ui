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

  return (
    <div className={`lp-node min-w-[200px] max-w-[300px] ${selected ? 'sel' : ''}`}>
      {/* Node Header */}
      <div className="lp-node-head" style={{ boxShadow: 'inset 2px 0 0 var(--ink-2)' }}>
        <ArrowRight className="w-4 h-4 text-ink-2 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-ink flex-1 truncate">{label}</span>
        <span className="lp-node-type text-ink-3">INPUT</span>
        <div className="flex items-center gap-1">
          <MessageCircle className="w-3 h-3 text-ink-3" />
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
        <div className="text-center">
          <div className="font-mono text-[10px] text-ink-3">
            Connects user input to agents
          </div>
        </div>
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!bg-s2 !w-3 !h-3 !absolute"
        style={{ right: -6 }}
      />
    </div>
  );
}