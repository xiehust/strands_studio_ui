import { type Node, type Edge } from '@xyflow/react';

export interface StrandsProject {
  id: string;
  name: string;
  description?: string;
  nodes: Node[];
  edges: Edge[];
  createdAt: string;
  updatedAt: string;
  version: string;
}

const STORAGE_KEY = 'strands_projects';
const CURRENT_PROJECT_KEY = 'current_strands_project';

export class ProjectManager {
  static saveProject(project: Omit<StrandsProject, 'id' | 'createdAt' | 'updatedAt' | 'version'>): StrandsProject {
    const now = new Date().toISOString();
    const savedProject: StrandsProject = {
      id: `project_${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      version: '1.0.0',
      ...project,
    };

    const projects = this.getAllProjects();
    projects.push(savedProject);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    
    return savedProject;
  }

  static updateProject(projectId: string, updates: Partial<StrandsProject>): StrandsProject | null {
    const projects = this.getAllProjects();
    const projectIndex = projects.findIndex(p => p.id === projectId);
    
    if (projectIndex === -1) {
      return null;
    }

    projects[projectIndex] = {
      ...projects[projectIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    return projects[projectIndex];
  }

  static loadProject(projectId: string): StrandsProject | null {
    const projects = this.getAllProjects();
    return projects.find(p => p.id === projectId) || null;
  }

  static deleteProject(projectId: string): boolean {
    const projects = this.getAllProjects();
    const filteredProjects = projects.filter(p => p.id !== projectId);
    
    if (filteredProjects.length === projects.length) {
      return false; // Project not found
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredProjects));
    return true;
  }

  static getAllProjects(): StrandsProject[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load projects:', error);
      return [];
    }
  }

  static setCurrentProject(projectId: string): void {
    localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
  }

  static getCurrentProject(): StrandsProject | null {
    const currentId = localStorage.getItem(CURRENT_PROJECT_KEY);
    if (!currentId) return null;
    return this.loadProject(currentId);
  }

  static clearCurrentProject(): void {
    localStorage.removeItem(CURRENT_PROJECT_KEY);
  }

  static exportProject(project: StrandsProject): string {
    return JSON.stringify(project, null, 2);
  }

  static importProject(jsonData: string): StrandsProject | null {
    try {
      const project = JSON.parse(jsonData);
      
      // Validate project structure
      if (!project.nodes || !project.edges || !project.name) {
        throw new Error('Invalid project format');
      }

      // Generate new ID and timestamps
      return this.saveProject({
        name: project.name + ' (Imported)',
        description: project.description,
        nodes: project.nodes,
        edges: project.edges,
      });
    } catch (error) {
      console.error('Failed to import project:', error);
      return null;
    }
  }

  static createNewProject(name: string, description?: string): StrandsProject {
    return this.saveProject({
      name,
      description,
      nodes: [],
      edges: [],
    });
  }
}