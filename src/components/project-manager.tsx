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
    <div className={`bg-white border border-gray-300 rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Open Project</h3>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-600 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Current Project Status */}
      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <div className="text-sm text-gray-600 mb-2">Current Project</div>
        <div className="text-md font-medium text-gray-900">
          {currentProject ? currentProject.name : 'Untitled Project'}
        </div>
        {currentProject && (
          <div className="text-xs text-gray-500 mt-1">
            Last updated: {new Date(currentProject.updatedAt).toLocaleDateString()}
          </div>
        )}
      </div>


      {/* Projects List */}
      <div className="max-h-64 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            No saved projects yet
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {projects.map((project) => (
              <div key={project.id} className="p-3 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {project.name}
                    </div>
                    {project.description && (
                      <div className="text-xs text-gray-500 mt-1 truncate">
                        {project.description}
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                      {project.nodes.length} nodes • {project.edges.length} connections
                    </div>
                  </div>
                  <div className="flex items-center space-x-1 ml-2">
                    <button
                      onClick={() => handleLoadProject(project)}
                      className="p-1 text-blue-500 hover:text-blue-700"
                      title="Load project"
                    >
                      <FolderOpen className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleExportProject(project)}
                      className="p-1 text-green-500 hover:text-green-700"
                      title="Export project"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDeleteProject(project.id)}
                      className="p-1 text-red-500 hover:text-red-700"
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