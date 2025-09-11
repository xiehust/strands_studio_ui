import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { Code, FileCode, Settings, X } from 'lucide-react';
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
    <div className={`
      bg-white rounded-lg border-2 shadow-sm min-w-[220px]
      ${selected ? 'border-blue-500 shadow-lg' : 'border-gray-200 hover:border-purple-200'}
    `}>
      {/* Node Header */}
      <div className="bg-purple-50 px-4 py-2 border-b border-purple-200 rounded-t-lg flex items-center">
        <Code className="w-4 h-4 text-purple-600 mr-2" />
        <span className="text-sm font-semibold text-purple-800">{label}</span>
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
        <div className="space-y-2">
          <div className="text-xs text-gray-600">
            <span className="font-medium">Function:</span> {functionName}
          </div>
          
          {parameters && parameters.length > 0 && (
            <div className="text-xs">
              <span className="font-medium text-gray-600">Parameters:</span>
              <div className="text-gray-700 mt-1">
                {parameters.map((param, index) => (
                  <span key={param} className="inline-block bg-gray-100 px-2 py-1 rounded text-xs mr-1 mb-1">
                    {param}
                  </span>
                ))}
              </div>
            </div>
          )}

          {description && (
            <div className="text-xs text-gray-500">
              {description}
            </div>
          )}

          {pythonCode && (
            <div className="text-xs">
              <div className="rounded border max-h-24 overflow-y-auto">
                <SyntaxHighlighter
                  language="python"
                  style={vscDarkPlus}
                  customStyle={{
                    fontSize: '10px',
                    lineHeight: '1.2',
                    margin: 0,
                    padding: '8px',
                    background: '#1e1e1e'
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
        className="!bg-gray-500"
        style={{ left: -6 }}
      />

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="tool-output"
        className="!bg-purple-500"
        style={{ right: -6 }}
      />
    </div>
  );
}