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
  SkillNode,
} from './nodes';
import { MCPToolNode } from './nodes/mcp-tool-node';
import { isValidConnection } from '../lib/connection-validator';
import { DEFAULT_MODEL_ID } from '../lib/models';

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
  skill: SkillNode,
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
          modelId: DEFAULT_MODEL_ID,
          modelName: 'Claude Sonnet 4.6',
          systemPrompt: 'You are a helpful AI assistant.',
          temperature: 0.7,
          maxTokens: 4000,
        });
      }
      
      // Set default values for skill nodes
      if (type === 'skill') {
        Object.assign(defaultData, {
          label: 'Skill',
          skillName: '',
          description: '',
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
      <div className="absolute top-4 right-4 z-10 lp-panel px-3.5 py-2 flex items-center gap-3">
        <Network className={`w-4 h-4 ${graphMode ? 'text-s5' : 'text-ink-3'}`} />
        <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${graphMode ? 'text-s5' : 'text-ink-2'}`}>Graph Mode</span>
        <button
          onClick={() => onGraphModeChange?.(!graphMode)}
          className={`
            relative inline-flex items-center border transition-colors
            ${graphMode ? 'bg-s5/25 border-s5' : 'bg-panel2 border-line2'}
          `}
          style={{ height: 18, width: 36 }}
          title="Toggle Graph Mode: Enable DAG-based multi-agent orchestration"
        >
          <span
            className={`
              inline-block h-3 w-3 transform transition-transform
              ${graphMode ? 'translate-x-[19px] bg-s5' : 'translate-x-[3px] bg-ink-3'}
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
        <MiniMap
          pannable
          zoomable
          bgColor="var(--panel)"
          maskColor="rgba(11, 14, 13, 0.75)"
          nodeColor="var(--line-2)"
          nodeStrokeColor="transparent"
        />
        <Background
          variant={BackgroundVariant.Lines}
          gap={28}
          size={1}
          color="var(--grid)"
        />
      </ReactFlow>
    </div>
  );
}