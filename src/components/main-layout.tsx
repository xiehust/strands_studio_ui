import { useState, useCallback, useEffect } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { Code, Eye, EyeOff, FolderOpen, Terminal, Save, Plus, Download, Upload } from 'lucide-react';
import { FlowEditor } from './flow-editor';
import { NodePalette } from './node-palette';
import { PropertyPanel } from './property-panel';
import { CodePanel } from './code-panel';
import { ExecutionPanel } from './execution-panel';
import { ProjectManagerComponent } from './project-manager';
import { ResizablePanel } from './resizable-panel';
import { type StrandsProject, ProjectManager } from '../lib/project-manager';
import { generateStrandsAgentCode } from '../lib/code-generator';

// Auto-save key for localStorage
const AUTOSAVE_FLOW_KEY = 'strands_autosave_flow';

// Helper functions for auto-save
const saveFlowToAutoSave = (nodes: Node[], edges: Edge[]) => {
  try {
    const flowData = { nodes, edges, timestamp: Date.now() };
    localStorage.setItem(AUTOSAVE_FLOW_KEY, JSON.stringify(flowData));
  } catch (error) {
    console.error('Failed to auto-save flow:', error);
  }
};

const loadFlowFromAutoSave = (): { nodes: Node[], edges: Edge[] } | null => {
  try {
    const stored = localStorage.getItem(AUTOSAVE_FLOW_KEY);
    if (!stored) return null;
    const flowData = JSON.parse(stored);
    return { nodes: flowData.nodes || [], edges: flowData.edges || [] };
  } catch (error) {
    console.error('Failed to load auto-saved flow:', error);
    return null;
  }
};

const clearAutoSavedFlow = () => {
  localStorage.removeItem(AUTOSAVE_FLOW_KEY);
};

export function MainLayout() {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [showCodePanel, setShowCodePanel] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<'code' | 'execution'>('code');
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [currentProject, setCurrentProject] = useState<StrandsProject | null>(null);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');

  // Load current project on mount, or load auto-saved flow if no project
  useEffect(() => {
    const current = ProjectManager.getCurrentProject();
    if (current) {
      setCurrentProject(current);
      setNodes(current.nodes);
      setEdges(current.edges);
      // Clear auto-save since we have a project loaded
      clearAutoSavedFlow();
    } else {
      // No current project, try to load auto-saved flow
      const autoSaved = loadFlowFromAutoSave();
      if (autoSaved) {
        setNodes(autoSaved.nodes);
        setEdges(autoSaved.edges);
      }
    }
  }, []);

  // Keep selectedNode synchronized with nodes array
  useEffect(() => {
    if (selectedNode) {
      const updatedNode = nodes.find(n => n.id === selectedNode.id);
      if (updatedNode && updatedNode !== selectedNode) {
        setSelectedNode(updatedNode);
      }
    }
  }, [nodes, selectedNode]);

  // Auto-save flow when nodes or edges change (only if no current project)
  useEffect(() => {
    if (!currentProject && (nodes.length > 0 || edges.length > 0)) {
      // Debounce the auto-save to avoid too frequent localStorage writes
      const timer = setTimeout(() => {
        saveFlowToAutoSave(nodes, edges);
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [nodes, edges, currentProject]);

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
    setCurrentProject(project);
    // Clear auto-save since we now have a project loaded
    clearAutoSavedFlow();
  }, []);

  // Project management functions
  const handleSaveCurrentProject = useCallback(() => {
    if (currentProject) {
      // Update existing project
      const updated = ProjectManager.updateProject(currentProject.id, {
        nodes,
        edges,
      });
      if (updated) {
        setCurrentProject(updated);
      }
    } else {
      // Save as new project
      setShowNewProjectDialog(true);
    }
  }, [currentProject, nodes, edges]);

  const handleCreateNewProject = useCallback(() => {
    if (!newProjectName.trim()) {
      alert('Project name is required');
      return;
    }

    const newProject = ProjectManager.saveProject({
      name: newProjectName.trim(),
      description: newProjectDescription.trim() || undefined,
      nodes,
      edges,
    });

    ProjectManager.setCurrentProject(newProject.id);
    setCurrentProject(newProject);
    setNewProjectName('');
    setNewProjectDescription('');
    setShowNewProjectDialog(false);
    // Clear auto-save since we now have a saved project
    clearAutoSavedFlow();
  }, [newProjectName, newProjectDescription, nodes, edges]);

  const handleNewProject = useCallback(() => {
    if (nodes.length > 0 || edges.length > 0) {
      if (confirm('Creating a new project will clear the current flow. Continue?')) {
        setNodes([]);
        setEdges([]);
        setCurrentProject(null);
        ProjectManager.clearCurrentProject();
      }
    }
  }, [nodes, edges]);

  const handleExportCurrentProject = useCallback(() => {
    if (currentProject) {
      const jsonData = ProjectManager.exportProject(currentProject);
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentProject.name.replace(/\s+/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [currentProject]);

  const handleImportProject = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const imported = ProjectManager.importProject(content);
      if (imported) {
        ProjectManager.setCurrentProject(imported.id);
        setCurrentProject(imported);
        setNodes(imported.nodes);
        setEdges(imported.edges);
        // Clear auto-save since we now have an imported project
        clearAutoSavedFlow();
        alert('Project imported successfully!');
      } else {
        alert('Failed to import project. Please check the file format.');
      }
    };
    reader.readAsText(file);
    
    // Reset input
    event.target.value = '';
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
          <div className="flex items-center space-x-6">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Strands Agent Builder</h1>
              <p className="text-sm text-gray-500 mt-1">
                Visually create and configure AI agents using drag-and-drop interface
              </p>
            </div>
            <div className="flex items-center space-x-1 pl-6 border-l border-gray-200">
              <span className="text-sm text-gray-600">Project:</span>
              <span className="text-sm font-medium text-gray-900">
                {currentProject ? currentProject.name : 'Untitled Project'}
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {/* Project Controls */}
            <button
              onClick={handleSaveCurrentProject}
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
              title="Save current project"
            >
              <Save className="w-4 h-4 mr-2" />
              Save
            </button>
            
            <button
              onClick={handleNewProject}
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
              title="Create new project"
            >
              <Plus className="w-4 h-4 mr-2" />
              New
            </button>

            <label className="flex items-center px-3 py-2 rounded-md text-sm font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors cursor-pointer"
                   title="Import project">
              <Upload className="w-4 h-4 mr-2" />
              Import
              <input
                type="file"
                accept=".json"
                onChange={handleImportProject}
                className="hidden"
              />
            </label>

            <button
              onClick={handleExportCurrentProject}
              disabled={!currentProject}
              className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                currentProject
                  ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
              title="Export current project"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </button>

            <div className="w-px h-6 bg-gray-300 mx-2" />

            <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowProjectManager(true)}
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Open
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
            <ResizablePanel
              resizeFrom="left"
              defaultWidth={384}
              minWidth={300}
              maxWidth={800}
              storageKey="right-panel-width" // Shared storage key for both panels
            >
              {rightPanelMode === 'code' ? (
                <CodePanel
                  nodes={nodes}
                  edges={edges}
                />
              ) : (
                <ExecutionPanel
                  code={getCurrentCode()}
                  projectId={currentProject?.id || 'default-project'}
                  projectName={currentProject?.name || 'Untitled Project'}
                  projectVersion={currentProject?.version || '1.0.0'}
                  flowData={{ nodes, edges }}
                />
              )}
            </ResizablePanel>
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

      {/* New Project Dialog */}
      {showNewProjectDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-80 mx-4">
            <h4 className="text-lg font-semibold text-gray-900 mb-4">Create New Project</h4>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project Name *
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter project name"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Optional description"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 mt-6">
              <button
                onClick={() => setShowNewProjectDialog(false)}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNewProject}
                className="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}