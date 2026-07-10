import { useState, useCallback, useEffect } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { Code, Eye, EyeOff, FolderOpen, Terminal, Save, Plus, Download, Upload, Rocket, Play, GithubIcon, Star } from 'lucide-react';
import { FlowEditor } from './flow-editor';
import { NodePalette } from './node-palette';
import { PropertyPanel } from './property-panel';
import { CodePanel } from './code-panel';
import { ExecutionPanel } from './execution-panel';
import { DeployPanel } from './deploy-panel';
import { InvokePanel } from './invoke-panel';
import { ProjectManagerComponent } from './project-manager';
import { ResizablePanel } from './resizable-panel';
import { type StrandsProject, ProjectManager } from '../lib/project-manager';
import { generateStrandsAgentCode } from '../lib/code-generator';

// Auto-save key for localStorage
const AUTOSAVE_FLOW_KEY = 'strands_autosave_flow';

// Helper functions for auto-save
const saveFlowToAutoSave = (nodes: Node[], edges: Edge[], graphMode: boolean) => {
  try {
    const flowData = { nodes, edges, graphMode, timestamp: Date.now() };
    localStorage.setItem(AUTOSAVE_FLOW_KEY, JSON.stringify(flowData));
  } catch (error) {
    console.error('Failed to auto-save flow:', error);
  }
};

const loadFlowFromAutoSave = (): { nodes: Node[], edges: Edge[], graphMode?: boolean } | null => {
  try {
    const stored = localStorage.getItem(AUTOSAVE_FLOW_KEY);
    if (!stored) return null;
    const flowData = JSON.parse(stored);
    return {
      nodes: flowData.nodes || [],
      edges: flowData.edges || [],
      graphMode: flowData.graphMode || false
    };
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
  const [graphMode, setGraphMode] = useState(false);
  const [showCodePanel, setShowCodePanel] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<'code' | 'execution' | 'deploy' | 'invoke'>('code');
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [currentProject, setCurrentProject] = useState<StrandsProject | null>(null);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [lastSaveTime, setLastSaveTime] = useState<Date | null>(null);

  // Load current project on mount, or load auto-saved flow if no project
  useEffect(() => {
    const current = ProjectManager.getCurrentProject();
    if (current) {
      setCurrentProject(current);
      setNodes(current.nodes);
      setEdges(current.edges);
      setGraphMode(current.graphMode || false);
      setLastSaveTime(new Date(current.updatedAt)); // Set timestamp to project's last updated time
      // Clear auto-save since we have a project loaded
      clearAutoSavedFlow();
    } else {
      // No current project, try to load auto-saved flow
      const autoSaved = loadFlowFromAutoSave();
      if (autoSaved) {
        setNodes(autoSaved.nodes);
        setEdges(autoSaved.edges);
        setGraphMode(autoSaved.graphMode || false);
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

  // Auto-save flow when nodes, edges, or graphMode change (only if no current project)
  useEffect(() => {
    if (!currentProject && (nodes.length > 0 || edges.length > 0)) {
      // Debounce the auto-save to avoid too frequent localStorage writes
      const timer = setTimeout(() => {
        saveFlowToAutoSave(nodes, edges, graphMode);
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [nodes, edges, graphMode, currentProject]);

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
    setGraphMode(project.graphMode || false);
    setCurrentProject(project);
    setLastSaveTime(new Date(project.updatedAt)); // Set timestamp to project's last updated time
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
        graphMode,
      });
      if (updated) {
        setCurrentProject(updated);
        setLastSaveTime(new Date()); // Set save timestamp
      }
    } else {
      // Save as new project
      setShowNewProjectDialog(true);
    }
  }, [currentProject, nodes, edges, graphMode]);

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
      graphMode,
    });

    ProjectManager.setCurrentProject(newProject.id);
    setCurrentProject(newProject);
    setLastSaveTime(new Date()); // Set save timestamp for new project
    setNewProjectName('');
    setNewProjectDescription('');
    setShowNewProjectDialog(false);
    // Clear auto-save since we now have a saved project
    clearAutoSavedFlow();
  }, [newProjectName, newProjectDescription, nodes, edges, graphMode]);

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
        setGraphMode(imported.graphMode || false);
        setLastSaveTime(new Date(imported.updatedAt)); // Set timestamp to imported project's time
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
    const result = generateStrandsAgentCode(nodes, edges, graphMode);
    return result.imports.join('\n') + '\n\n' + result.code;
  }, [nodes, edges, graphMode]);

  return (
    <div className="h-screen w-screen flex bg-bg text-ink">
      {/* Node Palette Sidebar */}
      <NodePalette className="w-64 flex-shrink-0" />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar — Launchpad chrome */}
        <header className="lp-topbar flex-shrink-0">
          <div className="lp-brand">
            <span className="glyph">▲</span>
            AGENTCORE<em>//</em>LAUNCHPAD
            <span className="text-ink-3 font-normal tracking-normal">·</span>
            <span className="text-ink-2">STRANDS STUDIO</span>
          </div>
          <div className="lp-crumb hidden md:block">
            CONSOLE / STUDIO / <b>{(currentProject ? currentProject.name : 'UNTITLED PROJECT').toUpperCase()}</b>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            {lastSaveTime && (
              <span className="lp-syschip hidden lg:flex" title="Last save time">
                SAVED {lastSaveTime.toLocaleTimeString()}
              </span>
            )}
            <span className="lp-syschip"><span className="lp-led" />STUDIO READY</span>
            <a
              href="https://github.com/xiehust/strands_studio_ui"
              target="_blank"
              rel="noopener noreferrer"
              className="lp-syschip hover:border-line2 hover:text-ink transition-colors"
              title="Star us on GitHub"
            >
              <GithubIcon className="w-3 h-3" />
              <Star className="w-3 h-3" />
              STAR
            </a>
          </div>
        </header>

        {/* Toolbar — project actions + panel controls */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-panel/60 flex-shrink-0 flex-wrap">
          <button
            onClick={handleSaveCurrentProject}
            className="lp-btn sm"
            title="Save current project"
          >
            <Save className="w-3 h-3" />
            Save
          </button>

          <button
            onClick={handleNewProject}
            className="lp-btn sm"
            title="Create new project"
          >
            <Plus className="w-3 h-3" />
            New
          </button>

          <label className="lp-btn sm" title="Import project">
            <Upload className="w-3 h-3" />
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
            className="lp-btn sm"
            title="Export current project"
          >
            <Download className="w-3 h-3" />
            Export
          </button>

          <button
            onClick={() => setShowProjectManager(true)}
            className="lp-btn sm"
          >
            <FolderOpen className="w-3 h-3" />
            Open
          </button>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setRightPanelMode('code');
                setShowCodePanel(true);
              }}
              className={`lp-btn sm ${showCodePanel && rightPanelMode === 'code' ? 'active' : ''}`}
            >
              <Code className="w-3 h-3" />
              Code
            </button>

            <button
              onClick={() => {
                setRightPanelMode('execution');
                setShowCodePanel(true);
              }}
              className={`lp-btn sm ${showCodePanel && rightPanelMode === 'execution' ? 'active' : ''}`}
            >
              <Terminal className="w-3 h-3" />
              Local Invoke
            </button>

            <button
              onClick={() => {
                setRightPanelMode('deploy');
                setShowCodePanel(true);
              }}
              className={`lp-btn sm ${showCodePanel && rightPanelMode === 'deploy' ? 'active' : ''}`}
            >
              <Rocket className="w-3 h-3" />
              Deploy
            </button>

            <button
              onClick={() => {
                setRightPanelMode('invoke');
                setShowCodePanel(true);
              }}
              className={`lp-btn sm ${showCodePanel && rightPanelMode === 'invoke' ? 'active' : ''}`}
            >
              <Play className="w-3 h-3" />
              Cloud Invoke
            </button>

            <div className="w-px h-5 bg-line mx-1" />

            <button
              onClick={() => setShowCodePanel(!showCodePanel)}
              className="lp-btn sm"
              title={showCodePanel ? 'Hide Panel' : 'Show Panel'}
            >
              {showCodePanel ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </div>
        </div>
        
        {/* Flow Editor, Property Panel, and Code Panel */}
        <div className="flex-1 flex">
          <FlowEditor
            className="flex-1"
            onNodeSelect={handleNodeSelect}
            nodes={nodes}
            onNodesChange={handleNodesChange}
            edges={edges}
            onEdgesChange={handleEdgesChange}
            graphMode={graphMode}
            onGraphModeChange={setGraphMode}
          />
          
          {selectedNode && (
            <PropertyPanel
              className="w-80 flex-shrink-0"
              selectedNode={selectedNode}
              onClose={handleClosePanel}
              onUpdateNode={handleUpdateNode}
              edges={edges}
              nodes={nodes}
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
                  graphMode={graphMode}
                />
              ) : rightPanelMode === 'execution' ? (
                <ExecutionPanel
                  code={getCurrentCode()}
                  projectId={currentProject?.id || 'default-project'}
                  projectName={currentProject?.name || 'Untitled Project'}
                  projectVersion={currentProject?.version || '1.0.0'}
                  flowData={{ nodes, edges }}
                />
              ) : rightPanelMode === 'deploy' ? (
                <DeployPanel
                  nodes={nodes}
                  edges={edges}
                  graphMode={graphMode}
                />
              ) : (
                <InvokePanel />
              )}
            </ResizablePanel>
          )}
        </div>
      </div>

      {/* Project Manager Modal */}
      {showProjectManager && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <ProjectManagerComponent
            className="w-96 max-h-96 m-4"
            onLoadProject={handleLoadProject}
            onClose={() => setShowProjectManager(false)}
          />
        </div>
      )}

      {/* New Project Dialog */}
      {showNewProjectDialog && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="lp-panel brk lp-rise p-6 w-80 mx-4">
            <div className="lp-kicker mb-1">// NEW PROJECT</div>
            <h4 className="lp-title text-lg text-ink mb-4">Create New Project</h4>

            <div className="space-y-4">
              <div>
                <label className="lp-label">
                  Project Name *
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="lp-input"
                  placeholder="Enter project name"
                />
              </div>

              <div>
                <label className="lp-label">
                  Description
                </label>
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  className="lp-input"
                  placeholder="Optional description"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowNewProjectDialog(false)}
                className="lp-btn"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNewProject}
                className="lp-btn primary"
              >
                ▲ Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}