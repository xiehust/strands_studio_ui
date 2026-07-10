import { useState, useCallback, useEffect, useRef } from 'react';
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
import { type StrandsProject, type ProjectCodeState, type CodeState, ProjectManager } from '../lib/project-manager';
import { generateStrandsAgentCode } from '../lib/code-generator';

// Auto-save key for localStorage
const AUTOSAVE_FLOW_KEY = 'strands_autosave_flow';

// Helper functions for auto-save
const saveFlowToAutoSave = (nodes: Node[], edges: Edge[], graphMode: boolean, codeState: ProjectCodeState) => {
  try {
    const flowData = { nodes, edges, graphMode, codeState, timestamp: Date.now() };
    localStorage.setItem(AUTOSAVE_FLOW_KEY, JSON.stringify(flowData));
  } catch (error) {
    console.error('Failed to auto-save flow:', error);
  }
};

const loadFlowFromAutoSave = (): { nodes: Node[], edges: Edge[], graphMode?: boolean, codeState?: ProjectCodeState } | null => {
  try {
    const stored = localStorage.getItem(AUTOSAVE_FLOW_KEY);
    if (!stored) return null;
    const flowData = JSON.parse(stored);
    return {
      nodes: flowData.nodes || [],
      edges: flowData.edges || [],
      graphMode: flowData.graphMode || false,
      codeState: flowData.codeState
    };
  } catch (error) {
    console.error('Failed to load auto-saved flow:', error);
    return null;
  }
};

const clearAutoSavedFlow = () => {
  localStorage.removeItem(AUTOSAVE_FLOW_KEY);
};

// Run the template generator and join imports + code (fast path)
const buildTemplateCode = (nodes: Node[], edges: Edge[], graphMode: boolean): { code: string; errors: string[] } => {
  const result = generateStrandsAgentCode(nodes, edges, graphMode);
  return {
    code: result.imports.join('\n') + '\n\n' + result.code,
    errors: result.errors,
  };
};

// Restore a persisted code state; legacy projects without codeState (or with
// template source) fall back to live template generation - identical to old behavior.
const restoreCodeState = (
  saved: ProjectCodeState | undefined,
  nodes: Node[],
  edges: Edge[],
  graphMode: boolean
): { codeState: CodeState; codeErrors: string[] } => {
  if (saved && saved.source !== 'template' && typeof saved.code === 'string' &&
      (saved.source === 'ai' || saved.source === 'manual')) {
    return {
      codeState: { code: saved.code, source: saved.source, flowStale: false },
      codeErrors: [],
    };
  }
  const { code, errors } = buildTemplateCode(nodes, edges, graphMode);
  return {
    codeState: { code, source: 'template', flowStale: false },
    codeErrors: errors,
  };
};

interface InitialAppState {
  nodes: Node[];
  edges: Edge[];
  graphMode: boolean;
  project: StrandsProject | null;
  codeState: CodeState;
  codeErrors: string[];
}

// Compute initial state synchronously so the flow-change effect never observes
// a half-restored project (nodes loaded but code state still default).
const computeInitialState = (): InitialAppState => {
  const current = ProjectManager.getCurrentProject();
  if (current) {
    const graphMode = current.graphMode || false;
    const restored = restoreCodeState(current.codeState, current.nodes, current.edges, graphMode);
    return { nodes: current.nodes, edges: current.edges, graphMode, project: current, ...restored };
  }
  const autoSaved = loadFlowFromAutoSave();
  if (autoSaved) {
    const graphMode = autoSaved.graphMode || false;
    const restored = restoreCodeState(autoSaved.codeState, autoSaved.nodes, autoSaved.edges, graphMode);
    return { nodes: autoSaved.nodes, edges: autoSaved.edges, graphMode, project: null, ...restored };
  }
  const { code, errors } = buildTemplateCode([], [], false);
  return {
    nodes: [],
    edges: [],
    graphMode: false,
    project: null,
    codeState: { code, source: 'template', flowStale: false },
    codeErrors: errors,
  };
};

export function MainLayout() {
  const [initialState] = useState<InitialAppState>(computeInitialState);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodes, setNodes] = useState<Node[]>(initialState.nodes);
  const [edges, setEdges] = useState<Edge[]>(initialState.edges);
  const [graphMode, setGraphMode] = useState(initialState.graphMode);
  const [showCodePanel, setShowCodePanel] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<'code' | 'execution' | 'deploy' | 'invoke'>('code');
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [currentProject, setCurrentProject] = useState<StrandsProject | null>(initialState.project);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [lastSaveTime, setLastSaveTime] = useState<Date | null>(
    initialState.project ? new Date(initialState.project.updatedAt) : null
  );

  // Single source of truth for the code shown/executed/deployed (design 3.1)
  const [codeState, setCodeState] = useState<CodeState>(initialState.codeState);
  const [codeErrors, setCodeErrors] = useState<string[]>(initialState.codeErrors);
  // Read the current source inside the flow-change effect without re-triggering
  // it when the source changes (e.g. a manual edit must not mark the flow stale).
  const codeSourceRef = useRef(codeState.source);
  codeSourceRef.current = codeState.source;
  // The flow (by reference) that the current non-template code corresponds to.
  // Canvas edits always produce new arrays, so reference comparison detects real
  // changes while surviving mount re-runs (StrictMode) and programmatic loads.
  const codeFlowBaselineRef = useRef<{ nodes: Node[]; edges: Edge[]; graphMode: boolean }>({
    nodes: initialState.nodes,
    edges: initialState.edges,
    graphMode: initialState.graphMode,
  });

  // Clear auto-save on mount if a project was restored
  useEffect(() => {
    if (initialState.project) {
      clearAutoSavedFlow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to canvas changes according to the code source:
  // - template: regenerate immediately (existing fast-path behavior)
  // - ai/manual: never overwrite the code, only flag it as stale
  useEffect(() => {
    if (codeSourceRef.current === 'template') {
      const { code, errors } = buildTemplateCode(nodes, edges, graphMode);
      setCodeState({ code, source: 'template', flowStale: false });
      setCodeErrors(errors);
      codeFlowBaselineRef.current = { nodes, edges, graphMode };
    } else {
      const baseline = codeFlowBaselineRef.current;
      if (baseline.nodes !== nodes || baseline.edges !== edges || baseline.graphMode !== graphMode) {
        setCodeState(prev =>
          prev.source === 'template' || prev.flowStale ? prev : { ...prev, flowStale: true }
        );
      }
    }
  }, [nodes, edges, graphMode]);

  // Code state transitions
  const handleManualCodeEdit = useCallback((code: string) => {
    setCodeState(prev => {
      if (prev.source === 'template' && !prev.flowStale) {
        // Entering manual mode from a template that matches the current canvas
        codeFlowBaselineRef.current = { nodes, edges, graphMode };
      }
      return { ...prev, code, source: 'manual' };
    });
  }, [nodes, edges, graphMode]);

  const handleAiCodeGenerated = useCallback((code: string) => {
    codeFlowBaselineRef.current = { nodes, edges, graphMode };
    setCodeState({ code, source: 'ai', flowStale: false });
    setCodeErrors([]);
  }, [nodes, edges, graphMode]);

  // Apply AI-fixed code from the execution panel. Unlike a fresh AI generation,
  // this preserves flowStale (the fix corresponds to the same flow the failing
  // code did) and does NOT reset the flow baseline. Returns whether it applied.
  const handleApplyFixedCode = useCallback((code: string): boolean => {
    if (codeSourceRef.current === 'manual') {
      if (!confirm('This will replace your manual edits with AI-fixed code. Continue?')) {
        return false;
      }
    }
    setCodeState(prev => ({ code, source: 'ai', flowStale: prev.flowStale }));
    setCodeErrors([]);
    return true;
  }, []);

  const handleRegenerateTemplate = useCallback(() => {
    const { code, errors } = buildTemplateCode(nodes, edges, graphMode);
    codeFlowBaselineRef.current = { nodes, edges, graphMode };
    setCodeState({ code, source: 'template', flowStale: false });
    setCodeErrors(errors);
  }, [nodes, edges, graphMode]);

  // Template code for the current canvas (used as AI fallback reference)
  const getTemplateCode = useCallback(() => {
    return buildTemplateCode(nodes, edges, graphMode).code;
  }, [nodes, edges, graphMode]);

  // Keep selectedNode synchronized with nodes array
  useEffect(() => {
    if (selectedNode) {
      const updatedNode = nodes.find(n => n.id === selectedNode.id);
      if (updatedNode && updatedNode !== selectedNode) {
        setSelectedNode(updatedNode);
      }
    }
  }, [nodes, selectedNode]);

  // Auto-save flow when nodes, edges, graphMode, or code state change (only if no current project)
  useEffect(() => {
    if (!currentProject && (nodes.length > 0 || edges.length > 0)) {
      // Debounce the auto-save to avoid too frequent localStorage writes
      const timer = setTimeout(() => {
        saveFlowToAutoSave(nodes, edges, graphMode, { code: codeState.code, source: codeState.source });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [nodes, edges, graphMode, currentProject, codeState.code, codeState.source]);

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
    const restored = restoreCodeState(project.codeState, project.nodes, project.edges, project.graphMode || false);
    codeFlowBaselineRef.current = { nodes: project.nodes, edges: project.edges, graphMode: project.graphMode || false };
    setCodeState(restored.codeState);
    setCodeErrors(restored.codeErrors);
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
        codeState: { code: codeState.code, source: codeState.source },
      });
      if (updated) {
        setCurrentProject(updated);
        setLastSaveTime(new Date()); // Set save timestamp
      }
    } else {
      // Save as new project
      setShowNewProjectDialog(true);
    }
  }, [currentProject, nodes, edges, graphMode, codeState.code, codeState.source]);

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
      codeState: { code: codeState.code, source: codeState.source },
    });

    ProjectManager.setCurrentProject(newProject.id);
    setCurrentProject(newProject);
    setLastSaveTime(new Date()); // Set save timestamp for new project
    setNewProjectName('');
    setNewProjectDescription('');
    setShowNewProjectDialog(false);
    // Clear auto-save since we now have a saved project
    clearAutoSavedFlow();
  }, [newProjectName, newProjectDescription, nodes, edges, graphMode, codeState.code, codeState.source]);

  const handleNewProject = useCallback(() => {
    if (nodes.length > 0 || edges.length > 0) {
      if (confirm('Creating a new project will clear the current flow. Continue?')) {
        const emptyNodes: Node[] = [];
        const emptyEdges: Edge[] = [];
        setNodes(emptyNodes);
        setEdges(emptyEdges);
        const { code, errors } = buildTemplateCode(emptyNodes, emptyEdges, graphMode);
        codeFlowBaselineRef.current = { nodes: emptyNodes, edges: emptyEdges, graphMode };
        setCodeState({ code, source: 'template', flowStale: false });
        setCodeErrors(errors);
        setCurrentProject(null);
        ProjectManager.clearCurrentProject();
      }
    }
  }, [nodes, edges, graphMode]);

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
        const restored = restoreCodeState(imported.codeState, imported.nodes, imported.edges, imported.graphMode || false);
        codeFlowBaselineRef.current = { nodes: imported.nodes, edges: imported.edges, graphMode: imported.graphMode || false };
        setCodeState(restored.codeState);
        setCodeErrors(restored.codeErrors);
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
                  codeState={codeState}
                  codeErrors={codeErrors}
                  onManualEdit={handleManualCodeEdit}
                  onAiGenerated={handleAiCodeGenerated}
                  onRegenerateTemplate={handleRegenerateTemplate}
                  getTemplateCode={getTemplateCode}
                />
              ) : rightPanelMode === 'execution' ? (
                <ExecutionPanel
                  code={codeState.code}
                  projectId={currentProject?.id || 'default-project'}
                  projectName={currentProject?.name || 'Untitled Project'}
                  projectVersion={currentProject?.version || '1.0.0'}
                  flowData={{ nodes, edges }}
                  graphMode={graphMode}
                  onApplyFixedCode={handleApplyFixedCode}
                />
              ) : rightPanelMode === 'deploy' ? (
                <DeployPanel
                  nodes={nodes}
                  code={codeState.code}
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