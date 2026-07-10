import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { Sparkles, X } from 'lucide-react';

interface SkillNodeData {
  label?: string;
  skillName?: string;
  description?: string;
}

export function SkillNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = (data as SkillNodeData) || {};
  const {
    label = 'Skill',
    skillName = '',
    description = '',
  } = nodeData;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  return (
    <div className={`lp-node min-w-[180px] ${selected ? 'sel' : ''}`}>
      {/* Node Header */}
      <div className="lp-node-head" style={{ boxShadow: 'inset 2px 0 0 var(--s3)' }}>
        <Sparkles className="w-4 h-4 text-s3 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-ink flex-1 truncate">{label}</span>
        <span className="lp-node-type text-s3">SKILL</span>
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

      {/* Node Content */}
      <div className="px-3 py-2.5">
        <div className="lp-node-kv">
          <span className="k">SKILL</span>
          <span className="v">{skillName || 'not selected'}</span>
        </div>
        {description && (
          <div className="font-mono text-[10px] text-ink-3 mt-1.5 truncate">
            {description}
          </div>
        )}
        {!skillName && (
          <div className="font-mono text-[10px] text-warn mt-1.5">
            Select a skill in the property panel
          </div>
        )}
      </div>

      {/* Output Handle */}
      <div className="absolute right-0 top-1/2 translate-x-full -translate-y-1/2 flex items-center">
        <Handle
          type="source"
          position={Position.Right}
          id="skill-output"
          className="!bg-s3 !w-3 !h-3 !relative !transform-none"
          style={{ position: 'relative', right: 0, top: 0 }}
        />
        <span className="lp-handle-tag text-s3 ml-0.5">Skill</span>
      </div>
    </div>
  );
}
