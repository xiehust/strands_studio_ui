import React, { useCallback, useRef } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type Connection,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type ReactFlowInstance,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';
import { Network } from 'lucide-react';

import {
  AgentNode,
  OrchestratorAgentNode,
  SwarmNode,
  ToolNode,
  InputNode,
  OutputNode,
  CustomToolNode,
} from './nodes';
import { MCPToolNode } from './nodes/mcp-tool-node';
import { isValidConnection } from '../lib/connection-validator';

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

const nodeTypes = {
  agent: AgentNode,
  'orchestrator-agent': OrchestratorAgentNode,
  swarm: SwarmNode,
  tool: ToolNode,
  'mcp-tool': MCPToolNode,
  input: InputNode,
  output: OutputNode,
  'custom-tool': CustomToolNode,
};

interface FlowEditorProps {
  className?: string;
  onNodeSelect?: (node: Node | null) => void;
  nodes?: Node[];
  onNodesChange?: (nodes: Node[]) => void;
  edges?: Edge[];
  onEdgesChange?: (edges: Edge[]) => void;
  graphMode?: boolean;
  onGraphModeChange?: (enabled: boolean) => void;
}

export function FlowEditor({
  className = '',
  onNodeSelect,
  nodes: externalNodes,
  onNodesChange: externalOnNodesChange,
  edges: externalEdges,
  onEdgesChange: externalOnEdgesChange,
  graphMode = false,
  onGraphModeChange
}: FlowEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [internalNodes, setInternalNodes, onInternalNodesChange]: [Node[], (nodes: Node[]) => void, OnNodesChange] = useNodesState(initialNodes);

  // Use external nodes if provided, otherwise use internal state
  const nodes = externalNodes || internalNodes;
  const setNodes = externalOnNodesChange || setInternalNodes;
  const onNodesChange = externalOnNodesChange ? 
    (changes: any) => {
      // Get removed node IDs first
      const removedNodeIds = changes
        .filter((change: any) => change.type === 'remove')
        .map((change: any) => change.id);
      
      // Apply changes to external nodes
      const updatedNodes = nodes.map((node) => {
        const change = changes.find((c: any) => c.id === node.id);
        if (!change) return node;
        
        switch (change.type) {
          case 'position':
            return { ...node, position: change.position };
          case 'select':
            return { ...node, selected: change.selected };
          case 'remove':
            return null;
          default:
            return node;
        }
      }).filter(Boolean);
      
      externalOnNodesChange(updatedNodes as Node[]);
      
      // Also remove connected edges when nodes are deleted
      if (removedNodeIds.length > 0 && externalOnEdgesChange) {
        const updatedEdges = edges.filter(edge => 
          !removedNodeIds.includes(edge.source) && !removedNodeIds.includes(edge.target)
        );
        externalOnEdgesChange(updatedEdges);
      }
    } : 
    onInternalNodesChange;
  
  const [internalEdges, setInternalEdges, onInternalEdgesChange]: [Edge[], (edges: Edge[]) => void, OnEdgesChange] = useEdgesState(initialEdges);
  
  // Use external edges if provided, otherwise use internal state
  const edges = externalEdges || internalEdges;
  const setEdges = externalOnEdgesChange || setInternalEdges;
  const onEdgesChange = externalOnEdgesChange ? 
    (changes: any) => {
      // Apply changes to external edges properly
      const updatedEdges = edges.map((edge) => {
        const change = changes.find((c: any) => c.id === edge.id);
        if (!change) return edge;
        
        switch (change.type) {
          case 'remove':
            return null;
          case 'select':
            return { ...edge, selected: change.selected };
          default:
            return edge;
        }
      }).filter(Boolean);
      
      externalOnEdgesChange(updatedEdges as Edge[]);
    } : 
    onInternalEdgesChange;
  const [reactFlowInstance, setReactFlowInstance] = React.useState<ReactFlowInstance | null>(null);

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      const validation = isValidConnection(params, nodes, edges, graphMode);
      if (validation.valid) {
        setEdges(addEdge(params, edges));
      } else {
        // Show user-friendly error message
        console.warn('Invalid connection:', validation.message);
        alert(`Connection not allowed: ${validation.message}`);
      }
    },
    [setEdges, nodes, edges, graphMode]
  );

  const isValidConnectionCallback = useCallback(
    (connection: Connection) => {
      const validation = isValidConnection(connection, nodes, edges, graphMode);
      return validation.valid;
    },
    [nodes, edges, graphMode]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeSelect?.(node);
    },
    [onNodeSelect]
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!reactFlowWrapper.current || !reactFlowInstance) {
        return;
      }

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const type = event.dataTransfer.getData('application/reactflow');

      if (!type) {
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      const defaultData = { label: `${type} node` };
      
      // Set default values for agent nodes
      if (type === 'agent') {
        Object.assign(defaultData, {
          label: 'Agent',
          modelProvider: 'AWS Bedrock',
          modelId: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
          modelName: 'Claude 3.7 Sonnet',
          systemPrompt: 'You are a helpful AI assistant.',
          temperature: 0.7,
          maxTokens: 4000,
        });
      }
      
      // Set default values for MCP tool nodes
      if (type === 'mcp-tool') {
        Object.assign(defaultData, {
          label: 'MCP Server',
          serverName: 'mcp_server',
          transportType: 'stdio',
          command: 'uvx',
          args: ['server-name@latest'],
          argsText: 'server-name@latest',
          url: 'http://localhost:8000/mcp',
          timeout: 30,
          description: 'MCP server for external tools',
          env: {},
          envText: '',
        });
      }

      const newNode: Node = {
        id: `${type}_${Date.now()}`,
        type,
        position,
        data: defaultData,
      };

      setNodes([...nodes, newNode]);
    },
    [reactFlowInstance, setNodes, nodes]
  );

  return (
    <div className={`h-full w-full ${className} relative`} ref={reactFlowWrapper}>
      {/* Graph Mode Toggle */}
      <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg px-4 py-2 flex items-center space-x-3 border-2 border-gray-200">
        <Network className={`w-4 h-4 ${graphMode ? 'text-purple-600' : 'text-gray-400'}`} />
        <span className="text-sm font-medium text-gray-700">Graph Mode</span>
        <button
          onClick={() => onGraphModeChange?.(!graphMode)}
          className={`
            relative inline-flex h-6 w-11 items-center rounded-full transition-colors
            ${graphMode ? 'bg-purple-600' : 'bg-gray-300'}
          `}
          title="Toggle Graph Mode: Enable DAG-based multi-agent orchestration"
        >
          <span
            className={`
              inline-block h-4 w-4 transform rounded-full bg-white transition-transform
              ${graphMode ? 'translate-x-6' : 'translate-x-1'}
            `}
          />
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={(edge) => isValidConnectionCallback(edge as Connection)}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        deleteKeyCode={["Delete", "Backspace"]}
        multiSelectionKeyCode={["Meta", "Ctrl"]}
        fitView
        attributionPosition="bottom-left"
      >
        <Controls />
        <MiniMap />
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
      </ReactFlow>
    </div>
  );
}