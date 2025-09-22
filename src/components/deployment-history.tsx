import { useState, useEffect, useMemo } from 'react';
import { Clock, CheckCircle, XCircle, Search, Filter, Rocket, Eye, Trash2, Server, Cloud } from 'lucide-react';
import {
  apiClient,
  type DeploymentHistoryItem,
  formatTimeAgo
} from '../lib/api-client';

interface DeploymentHistoryProps {
  projectId?: string;
  version?: string;
  onDeploymentSelect?: (deployment: DeploymentHistoryItem) => void;
  className?: string;
}

interface FilterOptions {
  projectId: string;
  version: string;
  status: 'all' | 'success' | 'failed';
  target: 'all' | 'agentcore' | 'lambda';
  timeRange: 'all' | '1d' | '7d' | '30d';
}

export function DeploymentHistory({
  projectId,
  version,
  onDeploymentSelect,
  className = ''
}: DeploymentHistoryProps) {
  const [deployments, setDeployments] = useState<DeploymentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterOptions>({
    projectId: projectId || 'all',
    version: version || 'all',
    status: 'all',
    target: 'all',
    timeRange: 'all'
  });

  // Load deployment history
  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getDeploymentHistory(
        filters.projectId !== 'all' ? filters.projectId : undefined,
        filters.version !== 'all' ? filters.version : undefined,
        50 // limit
      );
      setDeployments(response.deployments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployment history');
      console.error('Error loading deployment history:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load initial data
  useEffect(() => {
    loadData();
  }, [projectId, version]);

  // Reload when filters change
  useEffect(() => {
    loadData();
  }, [filters.projectId, filters.version]);

  // Filter deployments based on search term and filters
  const filteredDeployments = useMemo(() => {
    let filtered = [...deployments];

    // Search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(deployment =>
        deployment.agent_name.toLowerCase().includes(searchLower) ||
        deployment.deployment_target.toLowerCase().includes(searchLower) ||
        deployment.region.toLowerCase().includes(searchLower) ||
        deployment.deployment_id.toLowerCase().includes(searchLower)
      );
    }

    // Status filter
    if (filters.status !== 'all') {
      filtered = filtered.filter(deployment =>
        filters.status === 'success' ? deployment.success : !deployment.success
      );
    }

    // Target filter
    if (filters.target !== 'all') {
      filtered = filtered.filter(deployment => deployment.deployment_target === filters.target);
    }

    // Time range filter
    if (filters.timeRange !== 'all') {
      const now = new Date();
      const timeMap = {
        '1d': 1,
        '7d': 7,
        '30d': 30
      };
      const daysAgo = timeMap[filters.timeRange as keyof typeof timeMap];
      const cutoff = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));

      filtered = filtered.filter(deployment =>
        new Date(deployment.created_at) >= cutoff
      );
    }

    return filtered.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [deployments, searchTerm, filters]);

  const handleDelete = async (deploymentId: string) => {
    if (!confirm('Are you sure you want to delete this deployment record?')) {
      return;
    }

    try {
      await apiClient.deleteDeploymentHistoryItem(deploymentId);
      setDeployments(prev => prev.filter(d => d.deployment_id !== deploymentId));
    } catch (err) {
      console.error('Error deleting deployment:', err);
      alert('Failed to delete deployment record');
    }
  };

  const getStatusIcon = (success: boolean) => {
    return success
      ? <CheckCircle className="w-4 h-4 text-green-500" />
      : <XCircle className="w-4 h-4 text-red-500" />;
  };

  const getTargetIcon = (target: string) => {
    return target === 'agentcore'
      ? <Server className="w-4 h-4 text-purple-500" />
      : <Cloud className="w-4 h-4 text-orange-500" />;
  };

  if (loading) {
    return (
      <div className={`p-8 text-center ${className}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading deployment history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-8 text-center ${className}`}>
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Error Loading Deployments</h3>
        <p className="text-gray-600 mb-4">{error}</p>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-white ${className}`}>
      {/* Header */}
      <div className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Rocket className="w-5 h-5 text-purple-600 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">Deployment History</h2>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            <Filter className="w-4 h-4 mr-1" />
            Filters
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search deployments..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="all">All</option>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target</label>
                <select
                  value={filters.target}
                  onChange={(e) => setFilters(prev => ({ ...prev, target: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="all">All Targets</option>
                  <option value="agentcore">AgentCore</option>
                  <option value="lambda">Lambda</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Time Range</label>
                <select
                  value={filters.timeRange}
                  onChange={(e) => setFilters(prev => ({ ...prev, timeRange: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="all">All Time</option>
                  <option value="1d">Last 24 Hours</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="p-4">
        {filteredDeployments.length === 0 ? (
          <div className="text-center py-12">
            <Rocket className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Deployments Found</h3>
            <p className="text-gray-600">
              {deployments.length === 0
                ? "No deployment history available yet. Deploy an agent to see it here."
                : "No deployments match your current filters."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDeployments.map((deployment) => (
              <div
                key={deployment.deployment_id}
                className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      {getStatusIcon(deployment.success)}
                      {getTargetIcon(deployment.deployment_target)}
                      <h3 className="text-sm font-semibold text-gray-900 truncate">
                        {deployment.agent_name}
                      </h3>
                      <span className="text-xs text-gray-500">
                        {deployment.deployment_target.toUpperCase()}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-gray-600 mb-2">
                      <span className="flex items-center">
                        <Clock className="w-3 h-3 mr-1" />
                        {formatTimeAgo(deployment.created_at)}
                      </span>
                      <span>Region: {deployment.region}</span>
                      {deployment.execute_role && (
                        <span>Role: {deployment.execute_role}</span>
                      )}
                    </div>

                    {deployment.error_message && (
                      <p className="text-xs text-red-600 truncate">
                        Error: {deployment.error_message}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => onDeploymentSelect?.(deployment)}
                      className="p-1 text-gray-400 hover:text-purple-600 transition-colors"
                      title="View deployment details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(deployment.deployment_id)}
                      className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                      title="Delete deployment record"
                    >
                      <Trash2 className="w-4 h-4" />
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