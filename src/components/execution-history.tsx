import { useState, useEffect, useMemo } from 'react';
import { Clock, CheckCircle, XCircle, Search, Filter, FileText, Eye } from 'lucide-react';
import { 
  apiClient, 
  type ExecutionInfo, 
  type ProjectInfo, 
  type VersionInfo,
  formatTimeAgo, 
  formatFileSize, 
  getFileTypeIcon 
} from '../lib/api-client';

interface ExecutionHistoryProps {
  projectId?: string;
  version?: string;
  onExecutionSelect?: (execution: ExecutionInfo) => void;
  className?: string;
}

interface FilterOptions {
  projectId: string;
  version: string;
  status: 'all' | 'success' | 'failed';
  timeRange: 'all' | '1d' | '7d' | '30d';
}

export function ExecutionHistory({ 
  projectId, 
  version, 
  onExecutionSelect,
  className = '' 
}: ExecutionHistoryProps) {
  const [executions, setExecutions] = useState<ExecutionInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterOptions>({
    projectId: projectId || 'all',
    version: version || 'all',
    status: 'all',
    timeRange: 'all'
  });

  // Load initial data
  useEffect(() => {
    loadData();
  }, [projectId, version]);

  // Load projects when filter changes
  useEffect(() => {
    if (filters.projectId !== 'all' && filters.projectId !== projectId) {
      loadVersions(filters.projectId);
    }
  }, [filters.projectId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [executionHistory, projectsList] = await Promise.all([
        apiClient.getExecutionHistory(projectId, version),
        apiClient.getStorageProjects()
      ]);
      
      setExecutions(executionHistory);
      setProjects(projectsList);
      
      if (projectId) {
        const versionsList = await apiClient.getProjectVersions(projectId);
        setVersions(versionsList);
      }
    } catch (err) {
      console.error('Failed to load execution history:', err);
      setError('Failed to load execution history');
    } finally {
      setLoading(false);
    }
  };

  const loadVersions = async (selectedProjectId: string) => {
    try {
      const versionsList = await apiClient.getProjectVersions(selectedProjectId);
      setVersions(versionsList);
    } catch (err) {
      console.error('Failed to load versions:', err);
    }
  };

  // Filter and search executions
  const filteredExecutions = useMemo(() => {
    let filtered = executions;

    // Apply filters
    if (filters.projectId !== 'all') {
      filtered = filtered.filter(exec => exec.project_id === filters.projectId);
    }
    
    if (filters.version !== 'all') {
      filtered = filtered.filter(exec => exec.version === filters.version);
    }

    if (filters.timeRange !== 'all') {
      const now = new Date();
      const timeRanges = {
        '1d': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
      };
      const rangeMs = timeRanges[filters.timeRange as keyof typeof timeRanges];
      filtered = filtered.filter(exec => {
        const execDate = new Date(exec.created_at);
        return now.getTime() - execDate.getTime() <= rangeMs;
      });
    }

    // Apply search
    if (searchTerm) {
      filtered = filtered.filter(exec => 
        exec.execution_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        exec.project_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        exec.version.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  }, [executions, filters, searchTerm]);

  const handleExecutionClick = (execution: ExecutionInfo) => {
    if (onExecutionSelect) {
      onExecutionSelect(execution);
    }
  };

  const getStatusIcon = (execution: ExecutionInfo) => {
    // Check if there's a result artifact to determine success/failure
    const resultArtifact = execution.artifacts.find(a => a.file_type === 'result.json');
    if (!resultArtifact) {
      return <Clock className="w-4 h-4 text-gray-400" />;
    }
    
    // For now, assume success if artifacts exist - this could be enhanced
    // by checking the actual result content
    return <CheckCircle className="w-4 h-4 text-green-500" />;
  };

  const getStatusText = (execution: ExecutionInfo) => {
    const resultArtifact = execution.artifacts.find(a => a.file_type === 'result.json');
    if (!resultArtifact) return 'No result';
    return 'Completed';
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Loading execution history...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="text-center">
          <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-red-600">{error}</p>
          <button 
            onClick={loadData}
            className="mt-2 px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header with Search and Filters */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900">Execution History</h3>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded ${showFilters ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-200'}`}
            >
              <Filter className="w-4 h-4" />
            </button>
            <button
              onClick={loadData}
              className="p-2 text-gray-600 hover:bg-gray-200 rounded"
              title="Refresh"
            >
              <Clock className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search executions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mt-3 p-3 bg-white border border-gray-200 rounded-md">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Project</label>
                <select
                  value={filters.projectId}
                  onChange={(e) => setFilters(prev => ({ ...prev, projectId: e.target.value, version: 'all' }))}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                >
                  <option value="all">All Projects</option>
                  {projects.map(project => (
                    <option key={project.project_id} value={project.project_id}>
                      {project.project_id}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Version</label>
                <select
                  value={filters.version}
                  onChange={(e) => setFilters(prev => ({ ...prev, version: e.target.value }))}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                  disabled={filters.projectId === 'all'}
                >
                  <option value="all">All Versions</option>
                  {versions.map(version => (
                    <option key={version.version} value={version.version}>
                      {version.version}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value as any }))}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                >
                  <option value="all">All Status</option>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Time Range</label>
                <select
                  value={filters.timeRange}
                  onChange={(e) => setFilters(prev => ({ ...prev, timeRange: e.target.value as any }))}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                >
                  <option value="all">All Time</option>
                  <option value="1d">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Execution List */}
      <div className="flex-1 overflow-auto">
        {filteredExecutions.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500">
            <div className="text-center">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No executions found</p>
              {searchTerm && (
                <p className="text-xs mt-1">Try adjusting your search or filters</p>
              )}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredExecutions.map((execution) => (
              <div 
                key={`${execution.project_id}-${execution.version}-${execution.execution_id}`}
                className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => handleExecutionClick(execution)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      {getStatusIcon(execution)}
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {execution.execution_id}
                      </span>
                      <span className="text-xs text-gray-500">
                        {getStatusText(execution)}
                      </span>
                    </div>
                    
                    <div className="flex items-center space-x-4 text-xs text-gray-600 mb-2">
                      <span>Project: {execution.project_id}</span>
                      <span>Version: {execution.version}</span>
                      <span>{formatTimeAgo(execution.created_at)}</span>
                    </div>
                    
                    {execution.artifacts.length > 0 && (
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-gray-500">Artifacts:</span>
                        <div className="flex space-x-1">
                          {execution.artifacts.map((artifact, index) => (
                            <span 
                              key={index}
                              className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800"
                              title={`${artifact.file_type} (${formatFileSize(artifact.file_size)})`}
                            >
                              <span className="mr-1">{getFileTypeIcon(artifact.file_type)}</span>
                              {artifact.file_type.replace(/\.(py|json)$/, '')}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center space-x-2 ml-4">
                    <span className="text-xs text-gray-500">
                      {formatFileSize(execution.total_size)}
                    </span>
                    <Eye className="w-4 h-4 text-gray-400" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
        <div className="flex justify-between">
          <span>
            {filteredExecutions.length} execution{filteredExecutions.length !== 1 ? 's' : ''}
            {filteredExecutions.length !== executions.length && ` (filtered from ${executions.length})`}
          </span>
          <span>
            Total size: {formatFileSize(
              filteredExecutions.reduce((sum, exec) => sum + exec.total_size, 0)
            )}
          </span>
        </div>
      </div>
    </div>
  );
}