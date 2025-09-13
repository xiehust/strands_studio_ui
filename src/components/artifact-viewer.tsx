import { useState, useEffect } from 'react';
import { 
  FileText, 
  Download, 
  Copy, 
  Code, 
  Database, 
  Settings,
  Loader,
  XCircle,
  CheckCircle
} from 'lucide-react';
import { 
  apiClient, 
  type ArtifactContent,
  type StorageMetadata,
  formatFileSize
} from '../lib/api-client';

interface ArtifactViewerProps {
  projectId: string;
  version: string;
  executionId: string;
  fileType: string;
  metadata?: StorageMetadata;
  onClose?: () => void;
  className?: string;
}

export function ArtifactViewer({ 
  projectId, 
  version, 
  executionId, 
  fileType, 
  metadata,
  onClose,
  className = '' 
}: ArtifactViewerProps) {
  const [artifact, setArtifact] = useState<ArtifactContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    loadArtifact();
  }, [projectId, version, executionId, fileType]);

  const loadArtifact = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const artifactContent = await apiClient.getArtifact(
        projectId,
        version,
        executionId,
        fileType
      );
      setArtifact(artifactContent);
    } catch (err) {
      console.error('Failed to load artifact:', err);
      setError(`Failed to load ${fileType}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      const blob = await apiClient.downloadArtifact(
        projectId,
        version,
        executionId,
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

  const handleCopy = async () => {
    if (!artifact) return;
    
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const getIcon = () => {
    switch (fileType) {
      case 'generate.py': return <Code className="w-5 h-5 text-blue-600" />;
      case 'flow.json': return <Database className="w-5 h-5 text-green-600" />;
      case 'result.json': return <FileText className="w-5 h-5 text-purple-600" />;
      case 'metadata.json': return <Settings className="w-5 h-5 text-orange-600" />;
      default: return <FileText className="w-5 h-5 text-gray-600" />;
    }
  };

  const getTitle = () => {
    switch (fileType) {
      case 'generate.py': return 'Generated Agent Code';
      case 'flow.json': return 'Flow Configuration';
      case 'result.json': return 'Execution Result';
      case 'metadata.json': return 'Execution Metadata';
      default: return fileType;
    }
  };

  const getDescription = () => {
    switch (fileType) {
      case 'generate.py': return 'Python code generated for the Strands agent based on the flow configuration';
      case 'flow.json': return 'Visual flow diagram configuration including nodes, edges, and properties';
      case 'result.json': return 'Output and result data from the agent execution';
      case 'metadata.json': return 'Execution metadata including timestamps and configuration details';
      default: return `Content of ${fileType} artifact`;
    }
  };

  const formatContent = (content: string) => {
    if (fileType.endsWith('.json')) {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return content;
      }
    }
    return content;
  };

  const getLanguageClass = () => {
    if (fileType.endsWith('.py')) return 'language-python';
    if (fileType.endsWith('.json')) return 'language-json';
    return 'language-text';
  };

  const getSyntaxHighlightClass = () => {
    if (fileType.endsWith('.py')) return 'text-blue-300';
    if (fileType.endsWith('.json')) return 'text-green-400';
    return 'text-gray-100';
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-center">
          <Loader className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">Loading Artifact</h3>
          <p className="text-sm text-gray-600">Fetching {fileType}...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-center">
          <XCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">Error Loading Artifact</h3>
          <p className="text-sm text-gray-600 mb-4">{error}</p>
          <div className="flex justify-center space-x-3">
            <button
              onClick={loadArtifact}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
            >
              Try Again
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 text-sm"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!artifact) {
    return null;
  }

  return (
    <div className={`flex flex-col h-full bg-white ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center space-x-3">
          {getIcon()}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              {getTitle()}
            </h2>
            <p className="text-sm text-gray-600 truncate">
              {getDescription()}
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={handleCopy}
            className="flex items-center space-x-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            title="Copy to clipboard"
          >
            <Copy className="w-4 h-4" />
            <span>{copySuccess ? 'Copied!' : 'Copy'}</span>
          </button>
          
          <button
            onClick={handleDownload}
            className="flex items-center space-x-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            title="Download file"
          >
            <Download className="w-4 h-4" />
            <span>Download</span>
          </button>
          
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600"
              title="Close"
            >
              <XCircle className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <label className="font-medium text-gray-700">Project</label>
            <p className="text-gray-900 truncate">{projectId}</p>
          </div>
          <div>
            <label className="font-medium text-gray-700">Version</label>
            <p className="text-gray-900">{version}</p>
          </div>
          <div>
            <label className="font-medium text-gray-700">Execution</label>
            <p className="text-gray-900 truncate">{executionId}</p>
          </div>
          <div>
            <label className="font-medium text-gray-700">Size</label>
            <p className="text-gray-900">
              {metadata ? formatFileSize(metadata.file_size) : formatFileSize(artifact.content.length)}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-4">
          {artifact.content ? (
            <div className="relative">
              <pre className={`bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-auto font-mono ${getSyntaxHighlightClass()}`}>
                <code className={getLanguageClass()}>
                  {formatContent(artifact.content)}
                </code>
              </pre>
              
              {/* Copy success indicator */}
              {copySuccess && (
                <div className="absolute top-2 right-2 flex items-center space-x-1 bg-green-600 text-white px-2 py-1 rounded text-xs">
                  <CheckCircle className="w-3 h-3" />
                  <span>Copied!</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-500">
              <div className="text-center">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">This artifact appears to be empty</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 bg-gray-50 border-t border-gray-200">
        <div className="flex justify-between items-center text-xs text-gray-600">
          <span>
            {fileType} • {artifact.content.split('\n').length} lines
          </span>
          <div className="flex items-center space-x-4">
            {metadata?.timestamp && (
              <span>Created: {new Date(metadata.timestamp).toLocaleString()}</span>
            )}
            {metadata?.checksum && (
              <span title={`Checksum: ${metadata.checksum}`}>
                <span className="mr-1">🔒</span>
                Verified
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}