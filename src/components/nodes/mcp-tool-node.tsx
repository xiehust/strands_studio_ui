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
    <div className={`lp-node min-w-[200px] ${selected ? 'sel' : ''}`}>
      {/* Node Header */}
      <div className="lp-node-head" style={{ boxShadow: 'inset 2px 0 0 var(--s1)' }}>
        <Server className="w-4 h-4 text-s1 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-ink flex-1 truncate">{label}</span>
        <span className="lp-node-type text-s1">MCP</span>
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
          <div className="flex items-center gap-2 text-ink-2">
            {transportIcon}
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-ink truncate">
                {serverName}
              </div>
              <div className="font-mono text-[10px] text-ink-3 truncate">
                TRANSPORT · {transportLabel}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            {transportType === 'stdio' && command && (
              <div className="lp-node-kv"><span className="k">CMD</span><span className="v">{command}</span></div>
            )}
            {(transportType === 'streamable_http' || transportType === 'sse') && url && (
              <div className="lp-node-kv"><span className="k">URL</span><span className="v">{url}</span></div>
            )}
          </div>

          {description && (
            <div className="font-mono text-[10px] text-ink-3 p-2 bg-panel2 border border-grid mt-2">
              {description}
            </div>
          )}
        </div>
      </div>

      {/* Output Handle - connects to agent tools input */}
      <div className="absolute right-0 top-1/2 translate-x-full -translate-y-1/2 flex items-center">
        <Handle
          type="source"
          position={Position.Right}
          id="mcp-tools"
          className="!bg-s3 !w-3 !h-3 !relative !transform-none"
          style={{ position: 'relative', right: 0, top: 0 }}
        />
        <span className="lp-handle-tag text-s3 ml-0.5">Tool</span>
      </div>
    </div>
  );
}