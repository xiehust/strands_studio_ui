import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { Code, Settings, X } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CustomToolNodeData {
  label?: string;
  functionName?: string;
  description?: string;
  parameters?: string[];
  pythonCode?: string;
}

export function CustomToolNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = data as CustomToolNodeData || {};
  const {
    label = 'Custom Tool',
    functionName = 'my_custom_tool',
    description = 'Custom Python function for specific tasks',
    parameters = ['input_text', 'options'],
    pythonCode = '',
  } = nodeData;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  return (
    <div className={`lp-node min-w-[220px] ${selected ? 'sel' : ''}`}>
      {/* Node Header */}
      <div className="lp-node-head" style={{ boxShadow: 'inset 2px 0 0 var(--s2)' }}>
        <Code className="w-4 h-4 text-s2 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-ink flex-1 truncate">{label}</span>
        <span className="lp-node-type text-s2">PY TOOL</span>
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
        <div className="space-y-2">
          <div className="lp-node-kv"><span className="k">FUNCTION</span><span className="v">{functionName}</span></div>

          {parameters && parameters.length > 0 && (
            <div className="text-xs">
              <span className="font-mono text-[10px] text-ink-3">PARAMETERS</span>
              <div className="mt-1">
                {parameters.map((param) => (
                  <span key={param} className="inline-block font-mono text-[10px] text-ink-2 border border-line-2 bg-panel2 px-1.5 py-0.5 mr-1 mb-1">
                    {param}
                  </span>
                ))}
              </div>
            </div>
          )}

          {description && (
            <div className="font-mono text-[10px] text-ink-3">
              {description}
            </div>
          )}

          {pythonCode && (
            <div className="text-xs">
              <div className="border border-grid max-h-24 overflow-y-auto">
                <SyntaxHighlighter
                  language="python"
                  style={vscDarkPlus}
                  customStyle={{
                    fontSize: '10px',
                    lineHeight: '1.2',
                    margin: 0,
                    padding: '8px',
                    background: '#0A0D0C'
                  }}
                  showLineNumbers={false}
                  wrapLines={true}
                  wrapLongLines={true}
                >
                  {pythonCode.length > 200 ? pythonCode.substring(0, 200) + '...' : pythonCode}
                </SyntaxHighlighter>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="config"
        className="!bg-line-2 !w-3 !h-3 !absolute"
        style={{ left: -6 }}
      />

      {/* Output Handle */}
      <div className="absolute right-0 top-1/2 translate-x-full -translate-y-1/2 flex items-center">
        <Handle
          type="source"
          position={Position.Right}
          id="tool-output"
          className="!bg-s3 !w-3 !h-3 !relative !transform-none"
          style={{ position: 'relative', right: 0, top: 0 }}
        />
        <span className="lp-handle-tag text-s3 ml-0.5">Tool</span>
      </div>
    </div>
  );
}