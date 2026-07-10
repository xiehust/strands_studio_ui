import { useState, useEffect } from 'react';
import { FolderOpen, Download, Trash2, X } from 'lucide-react';
import { ProjectManager, type StrandsProject } from '../lib/project-manager';

interface ProjectManagerComponentProps {
  onLoadProject: (project: StrandsProject) => void;
  onClose: () => void;
  className?: string;
}

export function ProjectManagerComponent({
  onLoadProject,
  onClose,
  className = ''
}: ProjectManagerComponentProps) {
  const [projects, setProjects] = useState<StrandsProject[]>([]);
  const [currentProject, setCurrentProject] = useState<StrandsProject | null>(null);

  useEffect(() => {
    loadProjects();
    const current = ProjectManager.getCurrentProject();
    setCurrentProject(current);
  }, []);

  const loadProjects = () => {
    const allProjects = ProjectManager.getAllProjects();
    setProjects(allProjects);
  };


  const handleLoadProject = (project: StrandsProject) => {
    ProjectManager.setCurrentProject(project.id);
    setCurrentProject(project);
    onLoadProject(project);
    onClose();
  };

  const handleDeleteProject = (projectId: string) => {
    if (confirm('Are you sure you want to delete this project?')) {
      ProjectManager.deleteProject(projectId);
      if (currentProject?.id === projectId) {
        setCurrentProject(null);
      }
      loadProjects();
    }
  };

  const handleExportProject = (project: StrandsProject) => {
    const jsonData = ProjectManager.exportProject(project);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };


  return (
    <div className={`lp-panel brk lp-rise ${className}`}>
      {/* Header */}
      <div className="lp-phead">
        <FolderOpen className="w-4 h-4 text-ink-3" />
        <h3 className="lp-ptitle">Open Project</h3>
        <span className="lp-sub">local registry</span>
        <button
          onClick={onClose}
          className="ml-auto p-1 text-ink-3 hover:text-ink transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Current Project Status */}
      <div className="p-4 bg-panel2 border-b border-line">
        <div className="lp-label">Current Project</div>
        <div className="text-sm font-semibold text-ink">
          {currentProject ? currentProject.name : 'Untitled Project'}
        </div>
        {currentProject && (
          <div className="font-mono text-[10px] text-ink-3 mt-1">
            UPDATED {new Date(currentProject.updatedAt).toLocaleDateString()}
          </div>
        )}
      </div>


      {/* Projects List */}
      <div className="max-h-64 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="p-4 text-center font-mono text-[11px] text-ink-3">
            No saved projects yet
          </div>
        ) : (
          <div className="divide-y divide-grid">
            {projects.map((project) => (
              <div key={project.id} className="p-3 hover:bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">
                      {project.name}
                    </div>
                    {project.description && (
                      <div className="text-xs text-ink-3 mt-1 truncate">
                        {project.description}
                      </div>
                    )}
                    <div className="font-mono text-[10px] text-ink-3 mt-1">
                      {project.nodes.length} nodes · {project.edges.length} connections
                    </div>
                  </div>
                  <div className="flex items-center space-x-1 ml-2">
                    <button
                      onClick={() => handleLoadProject(project)}
                      className="p-1 text-amber hover:text-orange-400"
                      title="Load project"
                    >
                      <FolderOpen className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleExportProject(project)}
                      className="p-1 text-s2 hover:text-green-400"
                      title="Export project"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDeleteProject(project.id)}
                      className="p-1 text-crit hover:text-red-400"
                      title="Delete project"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}