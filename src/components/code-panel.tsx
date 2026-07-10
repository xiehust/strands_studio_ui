import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { type Node, type Edge } from '@xyflow/react';
import { Code, Download, Play, AlertCircle, Edit3, Save, X } from 'lucide-react';
import { generateStrandsAgentCode } from '../lib/code-generator';
import { defineLaunchpadMonacoTheme, LAUNCHPAD_MONACO_THEME } from '../lib/monaco-theme';

interface CodePanelProps {
  nodes: Node[];
  edges: Edge[];
  graphMode?: boolean;
  className?: string;
}

export function CodePanel({ nodes, edges, graphMode = false, className = '' }: CodePanelProps) {
  const [generatedCode, setGeneratedCode] = useState('');
  const [editedCode, setEditedCode] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [isInEditMode, setIsInEditMode] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [flowChangedWhileEditing, setFlowChangedWhileEditing] = useState(false);

  useEffect(() => {
    const result = generateStrandsAgentCode(nodes, edges, graphMode);
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
  }, [nodes, edges, graphMode, isInEditMode]);

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
    <div className={`bg-panel border-l border-line flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="lp-phead">
        <Code className="w-4 h-4 text-ink-3" />
        <h3 className="lp-ptitle">Generated Code</h3>
        <span className="lp-sub">strands · python</span>
        {isInEditMode && hasUnsavedChanges && (
          <span className="lp-chip warn"><i>◍</i>UNSAVED</span>
        )}
        {flowChangedWhileEditing && (
          <span className="lp-chip warn"><i>⚠</i>FLOW CHANGED</span>
        )}
        <div className="ml-auto flex gap-2">
          {!isInEditMode ? (
            <>
              <button
                onClick={handleEdit}
                className="lp-btn sm"
                title="Edit code manually"
              >
                <Edit3 className="w-3 h-3" />
                Edit
              </button>
              <button
                onClick={handleDownload}
                className="lp-btn sm"
                title="Download Python file"
              >
                <Download className="w-3 h-3" />
                Download
              </button>
              <button
                onClick={handleExecute}
                className="lp-btn sm primary"
                title="Execute code"
              >
                <Play className="w-3 h-3" />
                Execute
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleCancel}
                className="lp-btn sm"
                title="Cancel editing"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="lp-btn sm primary"
                title="Save changes"
              >
                <Save className="w-3 h-3" />
                Save
              </button>
            </>
          )}
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="p-4 bg-crit/10 border-b border-crit/40">
          <div className="flex items-center mb-2">
            <AlertCircle className="w-4 h-4 text-crit mr-2" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-crit">Code Generation Errors</span>
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
          theme={LAUNCHPAD_MONACO_THEME}
          beforeMount={defineLaunchpadMonacoTheme}
          value={isInEditMode ? editedCode : generatedCode}
          onChange={handleCodeChange}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
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
        <div className="p-3 lp-note border-t">
          <span className="text-amber font-mono">[⚠]</span>
          <div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-amber block mb-1">Flow Changed While Editing</span>
            <p className="text-xs text-ink-2 mb-2">
              The flow diagram was modified while you were editing the code. Your changes may conflict with the new generated code.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                className="lp-btn sm"
              >
                Discard & Use New Code
              </button>
              <button
                onClick={handleSave}
                className="lp-btn sm primary"
              >
                Keep My Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="px-3 py-2 border-t border-line font-mono text-[9.5px] text-ink-3 tracking-wider uppercase">
        <div className="flex justify-between">
          <span>Python · Strands Agent SDK</span>
          <span>{(isInEditMode ? editedCode : generatedCode).split('\n').length} lines</span>
        </div>
      </div>
    </div>
  );
}