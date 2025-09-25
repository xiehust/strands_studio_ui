import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { type Node, type Edge } from '@xyflow/react';
import { Code, Download, Play, AlertCircle, Edit3, Save, X } from 'lucide-react';
import { generateStrandsAgentCode } from '../lib/code-generator';

interface CodePanelProps {
  nodes: Node[];
  edges: Edge[];
  className?: string;
}

export function CodePanel({ nodes, edges, className = '' }: CodePanelProps) {
  const [generatedCode, setGeneratedCode] = useState('');
  const [editedCode, setEditedCode] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [isInEditMode, setIsInEditMode] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [flowChangedWhileEditing, setFlowChangedWhileEditing] = useState(false);

  useEffect(() => {
    const result = generateStrandsAgentCode(nodes, edges);
    const fullCode = result.imports.join('\n') + '\n\n' + result.code;

    if (isInEditMode) {
      // Flow changed while user is editing - mark as conflict
      setFlowChangedWhileEditing(true);
    } else {
      // Normal case - update both generated and edited code
      setGeneratedCode(fullCode);
      setEditedCode(fullCode);
      setFlowChangedWhileEditing(false);
    }

    setErrors(result.errors);
  }, [nodes, edges]);

  const handleCodeChange = (value: string | undefined) => {
    if (value !== undefined && isInEditMode) {
      setEditedCode(value);
      setHasUnsavedChanges(value !== generatedCode);
    }
  };

  const handleEdit = () => {
    setIsInEditMode(true);
    setEditedCode(generatedCode);
    setHasUnsavedChanges(false);
    setFlowChangedWhileEditing(false);
  };

  const handleSave = () => {
    setGeneratedCode(editedCode);
    setIsInEditMode(false);
    setHasUnsavedChanges(false);
    setFlowChangedWhileEditing(false);
  };

  const handleCancel = () => {
    setEditedCode(generatedCode);
    setIsInEditMode(false);
    setHasUnsavedChanges(false);
    setFlowChangedWhileEditing(false);
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
          {isInEditMode && hasUnsavedChanges && (
            <span className="ml-2 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
              Unsaved Changes
            </span>
          )}
          {flowChangedWhileEditing && (
            <span className="ml-2 px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded">
              Flow Changed
            </span>
          )}
        </div>
        <div className="flex space-x-2">
          {!isInEditMode ? (
            <>
              <button
                onClick={handleEdit}
                className="flex items-center px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600"
                title="Edit code manually"
              >
                <Edit3 className="w-3 h-3 mr-1" />
                Edit
              </button>
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
            </>
          ) : (
            <>
              <button
                onClick={handleCancel}
                className="flex items-center px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
                title="Cancel editing"
              >
                <X className="w-3 h-3 mr-1" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                title="Save changes"
              >
                <Save className="w-3 h-3 mr-1" />
                Save
              </button>
            </>
          )}
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
          value={isInEditMode ? editedCode : generatedCode}
          onChange={handleCodeChange}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            roundedSelection: false,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            readOnly: !isInEditMode,
          }}
        />
      </div>

      {/* Conflict Warning */}
      {flowChangedWhileEditing && (
        <div className="p-3 bg-orange-50 border-t border-orange-200">
          <div className="flex items-center mb-2">
            <AlertCircle className="w-4 h-4 text-orange-500 mr-2" />
            <span className="text-sm font-medium text-orange-800">Flow Changed While Editing</span>
          </div>
          <p className="text-sm text-orange-700 mb-2">
            The flow diagram was modified while you were editing the code. Your changes may conflict with the new generated code.
          </p>
          <div className="flex space-x-2 text-xs">
            <button
              onClick={handleCancel}
              className="px-2 py-1 bg-orange-200 text-orange-800 rounded hover:bg-orange-300"
            >
              Discard Changes & Use New Code
            </button>
            <button
              onClick={handleSave}
              className="px-2 py-1 bg-orange-600 text-white rounded hover:bg-orange-700"
            >
              Keep My Changes
            </button>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
        <div className="flex justify-between">
          <span>Python • Strands Agent SDK</span>
          <span>{(isInEditMode ? editedCode : generatedCode).split('\n').length} lines</span>
        </div>
      </div>
    </div>
  );
}