import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { type Node, type Edge } from '@xyflow/react';
import { Code, Download, Play, AlertCircle } from 'lucide-react';
import { generateStrandsAgentCode } from '../lib/code-generator';

interface CodePanelProps {
  nodes: Node[];
  edges: Edge[];
  className?: string;
}

export function CodePanel({ nodes, edges, className = '' }: CodePanelProps) {
  const [generatedCode, setGeneratedCode] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const result = generateStrandsAgentCode(nodes, edges);
    const fullCode = result.imports.join('\n') + '\n\n' + result.code;
    setGeneratedCode(fullCode);
    setErrors(result.errors);
    setIsEditing(false);
  }, [nodes, edges]);

  const handleCodeChange = (value: string | undefined) => {
    if (value !== undefined) {
      setGeneratedCode(value);
      setIsEditing(true);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([generatedCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strands_agent.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExecute = async () => {
    // Switch to execution panel for actual execution
    window.dispatchEvent(new CustomEvent('switchToExecution'));
  };

  return (
    <div className={`bg-white border-l border-gray-200 flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center">
          <Code className="w-4 h-4 text-gray-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Generated Code</h3>
          {isEditing && (
            <span className="ml-2 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
              Modified
            </span>
          )}
        </div>
        <div className="flex space-x-2">
          <button
            onClick={handleDownload}
            className="flex items-center px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
            title="Download Python file"
          >
            <Download className="w-3 h-3 mr-1" />
            Download
          </button>
          <button
            onClick={handleExecute}
            className="flex items-center px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
            title="Execute code"
          >
            <Play className="w-3 h-3 mr-1" />
            Execute
          </button>
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="p-4 bg-red-50 border-b border-red-200">
          <div className="flex items-center mb-2">
            <AlertCircle className="w-4 h-4 text-red-500 mr-2" />
            <span className="text-sm font-medium text-red-800">Code Generation Errors</span>
          </div>
          <ul className="text-sm text-red-700">
            {errors.map((error, index) => (
              <li key={index} className="mb-1">• {error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Code Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language="python"
          theme="vs-light"
          value={generatedCode}
          onChange={handleCodeChange}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            roundedSelection: false,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
          }}
        />
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
        <div className="flex justify-between">
          <span>Python • Strands Agent SDK</span>
          <span>{generatedCode.split('\n').length} lines</span>
        </div>
      </div>
    </div>
  );
}