import { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Download, 
  FileText, 
  CheckCircle, 
  XCircle, 
  Copy,
  Code,
  Database,
  Settings
} from 'lucide-react';
import { 
  apiClient, 
  type ExecutionInfo, 
  type ArtifactContent,
  formatDateTime, 
  formatFileSize, 
  getFileTypeIcon 
} from '../lib/api-client';

interface ExecutionDetailProps {
  execution: ExecutionInfo;
  onBack?: () => void;
  className?: string;
}

interface ArtifactData extends ArtifactContent {
  loading: boolean;
  error?: string;
}

export function ExecutionDetail({ execution, onBack, className = '' }: ExecutionDetailProps) {
  const [artifacts, setArtifacts] = useState<Map<string, ArtifactData>>(new Map());
  const [activeArtifact, setActiveArtifact] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState<string>('');

  // Initialize with the first artifact as active
  useEffect(() => {
    if (execution.artifacts.length > 0 && !activeArtifact) {
      setActiveArtifact(execution.artifacts[0].file_type);
    }
  }, [execution.artifacts, activeArtifact]);

  const loadArtifact = async (fileType: string) => {
    if (artifacts.has(fileType) && !artifacts.get(fileType)?.error) {
      return; // Already loaded
    }

    // Set loading state
    setArtifacts(prev => new Map(prev.set(fileType, {
      loading: true,
      content: '',
      metadata: execution.artifacts.find(a => a.file_type === fileType)!
    })));

    try {
      const artifactContent = await apiClient.getArtifact(
        execution.project_id,
        execution.version,
        execution.execution_id,
        fileType
      );

      setArtifacts(prev => new Map(prev.set(fileType, {
        ...artifactContent,
        loading: false
      })));
    } catch (error) {
      console.error('Failed to load artifact:', error);
      setArtifacts(prev => new Map(prev.set(fileType, {
        loading: false,
        error: `Failed to load ${fileType}`,
        content: '',
        metadata: execution.artifacts.find(a => a.file_type === fileType)!
      })));
    }
  };

  const handleArtifactClick = async (fileType: string) => {
    setActiveArtifact(fileType);
    await loadArtifact(fileType);
  };

  const handleDownload = async (fileType: string) => {
    try {
      const blob = await apiClient.downloadArtifact(
        execution.project_id,
        execution.version,
        execution.execution_id,
        fileType
      );
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileType;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to download artifact:', error);
    }
  };

  const handleCopy = async (content: string, fileType: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopySuccess(fileType);
      setTimeout(() => setCopySuccess(''), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const getArtifactIcon = (fileType: string) => {
    switch (fileType) {
      case 'generate.py': return <Code className="w-4 h-4" />;
      case 'flow.json': return <Database className="w-4 h-4" />;
      case 'result.json': return <FileText className="w-4 h-4" />;
      case 'metadata.json': return <Settings className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  const getArtifactDescription = (fileType: string) => {
    switch (fileType) {
      case 'generate.py': return 'Generated Python code for the agent';
      case 'flow.json': return 'Flow diagram configuration and node data';
      case 'result.json': return 'Execution result and output data';
      case 'metadata.json': return 'Execution metadata and configuration';
      default: return 'Artifact file';
    }
  };

  const formatContent = (content: string, fileType: string) => {
    if (fileType.endsWith('.json')) {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return content;
      }
    }
    return content;
  };

  const getLanguage = (fileType: string) => {
    if (fileType.endsWith('.py')) return 'python';
    if (fileType.endsWith('.json')) return 'json';
    return 'text';
  };

  const currentArtifact = artifacts.get(activeArtifact);

  return (
    <div className={`flex flex-col h-full bg-white ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center space-x-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1 text-gray-600 hover:bg-gray-200 rounded"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Execution Details</h3>
            <p className="text-sm text-gray-600">{execution.execution_id}</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <CheckCircle className="w-5 h-5 text-green-500" />
          <span className="text-sm text-green-700">Completed</span>
        </div>
      </div>

      {/* Execution Info */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <label className="font-medium text-gray-700">Project</label>
            <p className="text-gray-900">{execution.project_id}</p>
          </div>
          <div>
            <label className="font-medium text-gray-700">Version</label>
            <p className="text-gray-900">{execution.version}</p>
          </div>
          <div>
            <label className="font-medium text-gray-700">Created</label>
            <p className="text-gray-900">{formatDateTime(execution.created_at)}</p>
          </div>
          <div>
            <label className="font-medium text-gray-700">Total Size</label>
            <p className="text-gray-900">{formatFileSize(execution.total_size)}</p>
          </div>
        </div>
      </div>

      {/* Artifacts Tabs */}
      <div className="flex border-b border-gray-200 bg-gray-50">
        {execution.artifacts.map((artifact) => (
          <button
            key={artifact.file_type}
            onClick={() => handleArtifactClick(artifact.file_type)}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeArtifact === artifact.file_type
                ? 'border-blue-500 text-blue-600 bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-100'
            }`}
          >
            {getArtifactIcon(artifact.file_type)}
            <span>{artifact.file_type.replace(/\.(py|json)$/, '')}</span>
            <span className="text-xs text-gray-500">
              ({formatFileSize(artifact.file_size)})
            </span>
          </button>
        ))}
      </div>

      {/* Artifact Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {activeArtifact && (
          <>
            {/* Artifact Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{getFileTypeIcon(activeArtifact)}</span>
                <div>
                  <h4 className="font-medium text-gray-900">{activeArtifact}</h4>
                  <p className="text-sm text-gray-600">
                    {getArtifactDescription(activeArtifact)}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {currentArtifact && !currentArtifact.loading && !currentArtifact.error && (
                  <button
                    onClick={() => handleCopy(currentArtifact.content, activeArtifact)}
                    className="flex items-center space-x-1 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
                    title="Copy to clipboard"
                  >
                    <Copy className="w-4 h-4" />
                    <span>{copySuccess === activeArtifact ? 'Copied!' : 'Copy'}</span>
                  </button>
                )}
                <button
                  onClick={() => handleDownload(activeArtifact)}
                  className="flex items-center space-x-1 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
                  title="Download file"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </button>
              </div>
            </div>

            {/* Artifact Content Display */}
            <div className="flex-1 overflow-auto">
              {currentArtifact?.loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                    <p className="text-sm text-gray-600">Loading {activeArtifact}...</p>
                  </div>
                </div>
              ) : currentArtifact?.error ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                    <p className="text-sm text-red-600">{currentArtifact.error}</p>
                    <button
                      onClick={() => loadArtifact(activeArtifact)}
                      className="mt-2 px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : currentArtifact ? (
                <div className="p-4">
                  <pre className={`bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-auto font-mono ${
                    getLanguage(activeArtifact) === 'json' ? 'text-green-400' : 
                    getLanguage(activeArtifact) === 'python' ? 'text-blue-300' : 'text-gray-100'
                  }`}>
                    <code>{formatContent(currentArtifact.content, activeArtifact)}</code>
                  </pre>
                </div>
              ) : (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">Click on an artifact tab to view its content</p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
        <div className="flex justify-between">
          <span>
            {execution.artifacts.length} artifact{execution.artifacts.length !== 1 ? 's' : ''}
          </span>
          <span>
            Execution ID: {execution.execution_id}
          </span>
        </div>
      </div>
    </div>
  );
}