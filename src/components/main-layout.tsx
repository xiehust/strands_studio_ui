import { useState, useCallback, useEffect } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { Code, Eye, EyeOff, FolderOpen, Play, Terminal } from 'lucide-react';
import { FlowEditor } from './flow-editor';
import { NodePalette } from './node-palette';
import { PropertyPanel } from './property-panel';
import { CodePanel } from './code-panel';
import { ExecutionPanel } from './execution-panel';
import { ProjectManagerComponent } from './project-manager';
import { ResizablePanel } from './resizable-panel';
import { type StrandsProject } from '../lib/project-manager';
import { generateStrandsAgentCode } from '../lib/code-generator';

export function MainLayout() {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [showCodePanel, setShowCodePanel] = useState(true);
  const [showExecutionPanel, setShowExecutionPanel] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<'code' | 'execution'>('code');
  const [showProjectManager, setShowProjectManager] = useState(false);

  // Keep selectedNode synchronized with nodes array
  useEffect(() => {
    if (selectedNode) {
      const updatedNode = nodes.find(n => n.id === selectedNode.id);
      if (updatedNode && updatedNode !== selectedNode) {
        setSelectedNode(updatedNode);
      }
    }
  }, [nodes, selectedNode]);

  // Listen for switch to execution panel event
  useEffect(() => {
    const handleSwitchToExecution = () => {
      setRightPanelMode('execution');
      setShowCodePanel(true);
    };

    window.addEventListener('switchToExecution', handleSwitchToExecution);
    return () => {
      window.removeEventListener('switchToExecution', handleSwitchToExecution);
    };
  }, []);

  const handleNodeSelect = useCallback((node: Node | null) => {
    if (node) {
      // Always find the most up-to-date version of the node from the nodes array
      const currentNode = nodes.find(n => n.id === node.id) || node;
      setSelectedNode(currentNode);
    } else {
      setSelectedNode(null);
    }
  }, [nodes]);

  const handleNodesChange = useCallback((newNodes: Node[]) => {
    setNodes(newNodes);
    // Clear selected node if it was deleted
    if (selectedNode && !newNodes.find(node => node.id === selectedNode.id)) {
      setSelectedNode(null);
    }
  }, [selectedNode]);

  const handleUpdateNode = useCallback((nodeId: string, data: any) => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        if (node.id === nodeId) {
          // Merge new data with existing data instead of replacing it
          const updatedNode = { ...node, data: { ...node.data, ...data } };
          // Update selectedNode if it's the same node being updated
          if (selectedNode?.id === nodeId) {
            setSelectedNode(updatedNode);
          }
          return updatedNode;
        }
        return node;
      })
    );
  }, [selectedNode]);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleEdgesChange = useCallback((newEdges: Edge[]) => {
    setEdges(newEdges);
  }, []);

  const handleLoadProject = useCallback((project: StrandsProject) => {
    setNodes(project.nodes);
    setEdges(project.edges);
  }, []);

  // Generate current code for execution
  const getCurrentCode = useCallback(() => {
    const result = generateStrandsAgentCode(nodes, edges);
    return result.imports.join('\n') + '\n\n' + result.code;
  }, [nodes, edges]);

  return (
    <div className="h-screen w-screen flex bg-gray-50">
      {/* Node Palette Sidebar */}
      <NodePalette className="w-80 flex-shrink-0" />
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Strands Agent Builder</h1>
            <p className="text-sm text-gray-500 mt-1">
              Visually create and configure AI agents using drag-and-drop interface
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowProjectManager(true)}
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Projects
            </button>
            
            <button
              onClick={() => {
                setRightPanelMode('code');
                setShowCodePanel(true);
              }}
              className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                showCodePanel && rightPanelMode === 'code'
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Code className="w-4 h-4 mr-2" />
              Code
            </button>

            <button
              onClick={() => {
                setRightPanelMode('execution');
                setShowCodePanel(true);
              }}
              className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                showCodePanel && rightPanelMode === 'execution'
                  ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Terminal className="w-4 h-4 mr-2" />
              Execute
            </button>

            <button
              onClick={() => setShowCodePanel(!showCodePanel)}
              className="flex items-center px-2 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              title={showCodePanel ? 'Hide Panel' : 'Show Panel'}
            >
              {showCodePanel ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </header>
        
        {/* Flow Editor, Property Panel, and Code Panel */}
        <div className="flex-1 flex">
          <FlowEditor 
            className="flex-1" 
            onNodeSelect={handleNodeSelect}
            nodes={nodes}
            onNodesChange={handleNodesChange}
            edges={edges}
            onEdgesChange={handleEdgesChange}
          />
          
          {selectedNode && (
            <PropertyPanel
              className="w-80 flex-shrink-0"
              selectedNode={selectedNode}
              onClose={handleClosePanel}
              onUpdateNode={handleUpdateNode}
            />
          )}
          
          {showCodePanel && (
            rightPanelMode === 'code' ? (
              <CodePanel
                className="w-96 flex-shrink-0"
                nodes={nodes}
                edges={edges}
              />
            ) : (
              <ResizablePanel
                resizeFrom="left"
                defaultWidth={384}
                minWidth={300}
                maxWidth={800}
              >
                <ExecutionPanel
                  code={getCurrentCode()}
                />
              </ResizablePanel>
            )
          )}
        </div>
      </div>

      {/* Project Manager Modal */}
      {showProjectManager && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <ProjectManagerComponent
            className="w-96 max-h-96 m-4"
            nodes={nodes}
            edges={edges}
            onLoadProject={handleLoadProject}
            onClose={() => setShowProjectManager(false)}
          />
        </div>
      )}
    </div>
  );
}