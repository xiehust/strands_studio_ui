import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { Server, Globe, Radio, Terminal, Settings, X } from 'lucide-react';

export interface MCPToolNodeData {
  id: string;
  label?: string;
  serverName: string;
  transportType: 'stdio' | 'streamable_http' | 'sse';
  command?: string;  // For stdio transport
  args?: string[];   // For stdio transport  
  url?: string;      // For HTTP/SSE transports
  description?: string;
  timeout?: number;
  headers?: Record<string, string>; // For HTTP/SSE transports
  env?: Record<string, string>; // Environment variables for stdio
}

const getTransportIcon = (transportType: string) => {
  switch (transportType) {
    case 'stdio':
      return <Terminal className="w-4 h-4" />;
    case 'streamable_http':
      return <Globe className="w-4 h-4" />;
    case 'sse':
      return <Radio className="w-4 h-4" />;
    default:
      return <Server className="w-4 h-4" />;
  }
};

const getTransportLabel = (transportType: string) => {
  switch (transportType) {
    case 'stdio':
      return 'Standard I/O';
    case 'streamable_http':
      return 'HTTP';
    case 'sse':
      return 'Server-Sent Events';
    default:
      return 'Unknown';
  }
};

export function MCPToolNode({ data, selected, id }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const nodeData = (data as unknown as MCPToolNodeData) || {};
  const { 
    label = 'MCP Server',
    serverName = 'mcp_server',
    transportType = 'stdio',
    command,
    url,
    description
  } = nodeData;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  const transportIcon = getTransportIcon(transportType);
  const transportLabel = getTransportLabel(transportType);

  return (
    <div className={`
      bg-white rounded-lg border-2 shadow-sm min-w-[200px]
      ${selected ? 'border-purple-500 shadow-lg' : 'border-gray-200 hover:border-gray-300'}
    `}>
      {/* Node Header */}
      <div className="bg-purple-50 px-4 py-2 border-b border-gray-200 rounded-t-lg flex items-center">
        <Server className="w-4 h-4 text-purple-600 mr-2" />
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
      <div className="p-4">
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            {transportIcon}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-700 truncate">
                {serverName}
              </div>
              <div className="text-xs text-gray-500 truncate">
                Transport: {transportLabel}
              </div>
            </div>
          </div>
          
          <div className="space-y-1 text-xs text-gray-600">
            {transportType === 'stdio' && command && (
              <div>
                <span className="font-medium">Command:</span> {command}
              </div>
            )}
            {(transportType === 'streamable_http' || transportType === 'sse') && url && (
              <div>
                <span className="font-medium">URL:</span> {url}
              </div>
            )}
          </div>
          
          {description && (
            <div className="text-xs text-gray-600 p-2 bg-gray-50 rounded mt-2">
              {description}
            </div>
          )}
        </div>
      </div>

      {/* Output Handle - connects to agent tools input */}
      <Handle
        type="source"
        position={Position.Right}
        id="mcp-tools"
        className="!bg-purple-500"
        style={{ right: -6 }}
      />
    </div>
  );
}