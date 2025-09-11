import React, { useState, useEffect } from 'react';
import { Save, FolderOpen, Download, Upload, Plus, Trash2, X, Cloud, CloudOff } from 'lucide-react';
import { ProjectManager, type StrandsProject } from '../lib/project-manager';
import { apiClient, type ProjectData } from '../lib/api-client';
import { type Node, type Edge } from '@xyflow/react';

interface ProjectManagerComponentProps {
  nodes: Node[];
  edges: Edge[];
  onLoadProject: (project: StrandsProject) => void;
  onClose: () => void;
  className?: string;
}

export function ProjectManagerComponent({
  nodes,
  edges,
  onLoadProject,
  onClose,
  className = ''
}: ProjectManagerComponentProps) {
  const [projects, setProjects] = useState<StrandsProject[]>([]);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [currentProject, setCurrentProject] = useState<StrandsProject | null>(null);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [syncMode, setSyncMode] = useState<'local' | 'backend'>('local');

  useEffect(() => {
    loadProjects();
    const current = ProjectManager.getCurrentProject();
    setCurrentProject(current);
  }, []);

  const loadProjects = () => {
    const allProjects = ProjectManager.getAllProjects();
    setProjects(allProjects);
  };

  const handleSaveCurrentProject = () => {
    if (currentProject) {
      // Update existing project
      const updated = ProjectManager.updateProject(currentProject.id, {
        nodes,
        edges,
      });
      if (updated) {
        setCurrentProject(updated);
        loadProjects();
      }
    } else {
      // Save as new project
      setShowNewProjectDialog(true);
    }
  };

  const handleCreateNewProject = () => {
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
    loadProjects();
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

  const handleImportProject = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const imported = ProjectManager.importProject(content);
      if (imported) {
        loadProjects();
        alert('Project imported successfully!');
      } else {
        alert('Failed to import project. Please check the file format.');
      }
    };
    reader.readAsText(file);
    
    // Reset input
    event.target.value = '';
  };

  return (
    <div className={`bg-white border border-gray-300 rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Project Manager</h3>
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

      {/* Actions */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSaveCurrentProject}
            className="flex items-center px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            <Save className="w-3 h-3 mr-1" />
            Save Project
          </button>
          
          <button
            onClick={() => setShowNewProjectDialog(true)}
            className="flex items-center px-3 py-2 text-sm bg-green-500 text-white rounded hover:bg-green-600"
          >
            <Plus className="w-3 h-3 mr-1" />
            New Project
          </button>

          <label className="flex items-center px-3 py-2 text-sm bg-purple-500 text-white rounded hover:bg-purple-600 cursor-pointer">
            <Upload className="w-3 h-3 mr-1" />
            Import
            <input
              type="file"
              accept=".json"
              onChange={handleImportProject}
              className="hidden"
            />
          </label>
        </div>
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

      {/* New Project Dialog */}
      {showNewProjectDialog && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
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