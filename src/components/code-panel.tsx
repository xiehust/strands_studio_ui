import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { type Node, type Edge } from '@xyflow/react';
import { Code, Download, Play, AlertCircle, AlertTriangle, Sparkles, Loader, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { type CodeState } from '../lib/project-manager';
import { apiClient, type CodegenStatus, type CodegenValidationError } from '../lib/api-client';
import { defineLaunchpadMonacoTheme, LAUNCHPAD_MONACO_THEME } from '../lib/monaco-theme';

interface CodePanelProps {
  nodes: Node[];
  edges: Edge[];
  graphMode?: boolean;
  codeState: CodeState;
  codeErrors: string[];
  onManualEdit: (code: string) => void;
  onAiGenerated: (code: string) => void;
  onRegenerateTemplate: () => void;
  getTemplateCode: () => string;
  className?: string;
}

interface AiProgressEvent {
  id: number;
  kind: 'progress' | 'activity' | 'validation' | 'error';
  text: string;
}

interface FallbackInfo {
  reason?: string;
  errors: CodegenValidationError[];
}

export function CodePanel({
  nodes,
  edges,
  graphMode = false,
  codeState,
  codeErrors,
  onManualEdit,
  onAiGenerated,
  onRegenerateTemplate,
  getTemplateCode,
  className = '',
}: CodePanelProps) {
  const [codegenStatus, setCodegenStatus] = useState<CodegenStatus | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiEvents, setAiEvents] = useState<AiProgressEvent[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [fallbackInfo, setFallbackInfo] = useState<FallbackInfo | null>(null);
  const [showFallbackDetails, setShowFallbackDetails] = useState(false);

  const eventIdRef = useRef(0);
  const progressScrollRef = useRef<HTMLDivElement | null>(null);

  // Check codegen backend availability on mount (drives AI button state)
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getCodegenStatus()
      .then((status) => {
        if (!cancelled) setCodegenStatus(status);
      })
      .catch(() => {
        if (!cancelled) {
          setCodegenStatus({ backend: 'unknown', available: false, reason: 'Codegen status unavailable (backend not reachable)' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll AI progress list
  useEffect(() => {
    if (progressScrollRef.current) {
      progressScrollRef.current.scrollTop = progressScrollRef.current.scrollHeight;
    }
  }, [aiEvents]);

  const appendAiEvent = (kind: AiProgressEvent['kind'], text: string) => {
    eventIdRef.current += 1;
    const id = eventIdRef.current;
    setAiEvents((prev) => [...prev, { id, kind, text }]);
  };

  const handleCodeChange = (value: string | undefined) => {
    if (value === undefined) return;
    // Programmatic value updates (template refresh / AI result) either don't fire
    // onChange (guarded inside @monaco-editor/react) or echo the current state
    // value exactly - both cases must not switch the source to 'manual'.
    if (value === codeState.code) return;
    onManualEdit(value);
  };

  const handleAiGenerate = () => {
    if (isGenerating || !codegenStatus?.available) return;
    if (codeState.source === 'manual') {
      if (!confirm('The code has been manually edited. Generating with AI will overwrite your edits. Continue?')) {
        return;
      }
    }

    setIsGenerating(true);
    setAiEvents([]);
    setAiError(null);
    setFallbackInfo(null);
    setShowFallbackDetails(false);
    appendAiEvent('progress', 'Starting AI code generation...');

    const templateCode = getTemplateCode();

    apiClient.generateCodeStream(
      {
        flow_data: {
          nodes: nodes as unknown as Record<string, unknown>[],
          edges: edges as unknown as Record<string, unknown>[],
        },
        graph_mode: graphMode,
        template_code: templateCode,
      },
      {
        onProgress: (message) => appendAiEvent('progress', message),
        onAgentActivity: (summary) => appendAiEvent('activity', summary),
        onValidation: (round, errors) => {
          if (errors.length > 0) {
            appendAiEvent('validation', `Validation round ${round}: ${errors.length} error(s)`);
            errors.forEach((err) => appendAiEvent('validation', `[${err.stage}] ${err.message}`));
          } else {
            appendAiEvent('progress', `Validation round ${round}: passed`);
          }
        },
        onDone: (result) => {
          setIsGenerating(false);
          if (result.source === 'fallback') {
            setFallbackInfo({
              reason: result.fallback_reason,
              errors: result.validation_report?.errors || [],
            });
            // The returned code is the template code - keep template semantics
            onRegenerateTemplate();
          } else {
            const label = result.source === 'cache' ? 'cache' : 'agent';
            appendAiEvent('progress', `Done (source: ${label}${result.duration_ms != null ? `, ${(result.duration_ms / 1000).toFixed(1)}s` : ''})`);
            onAiGenerated(result.code);
          }
        },
        onError: (message) => {
          setIsGenerating(false);
          setAiError(message);
          appendAiEvent('error', message);
        },
      }
    );
  };

  const handleRegenerateTemplateClick = () => {
    setFallbackInfo(null);
    setAiError(null);
    onRegenerateTemplate();
  };

  const handleDownload = () => {
    const blob = new Blob([codeState.code], { type: 'text/plain' });
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

  const sourceBadge =
    codeState.source === 'ai' ? (
      <span className="lp-chip violet"><Sparkles className="w-3 h-3" />AI GENERATED</span>
    ) : codeState.source === 'manual' ? (
      <span className="lp-chip warn"><i>◍</i>MANUAL · LOCKED</span>
    ) : (
      <span className="lp-chip muted">TEMPLATE</span>
    );

  const aiButtonTitle = !codegenStatus
    ? 'Checking AI codegen availability...'
    : codegenStatus.available
      ? 'Generate code with the backend coding agent'
      : codegenStatus.reason || 'AI code generation is not available';

  return (
    <div className={`bg-panel border-l border-line flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="lp-phead">
        <Code className="w-4 h-4 text-ink-3" />
        <h3 className="lp-ptitle">Generated Code</h3>
        <span className="lp-sub">strands · python</span>
        {sourceBadge}
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleAiGenerate}
            disabled={!codegenStatus?.available || isGenerating}
            className="lp-btn sm"
            title={aiButtonTitle}
          >
            {isGenerating ? (
              <Loader className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            AI Generate
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
        </div>
      </div>

      {/* Stale flow banner */}
      {codeState.flowStale && (
        <div className="p-3 lp-note border-b border-line">
          <span className="text-amber font-mono">[⚠]</span>
          <div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-amber block mb-1">Canvas Changed</span>
            <p className="text-xs text-ink-2 mb-2">
              The canvas has changed since this code was {codeState.source === 'ai' ? 'generated by AI' : 'manually edited'}. The code was not overwritten.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleRegenerateTemplateClick}
                className="lp-btn sm"
              >
                <RefreshCw className="w-3 h-3" />
                Regenerate (Template)
              </button>
              <button
                onClick={handleAiGenerate}
                disabled={!codegenStatus?.available || isGenerating}
                className="lp-btn sm primary"
                title={aiButtonTitle}
              >
                <Sparkles className="w-3 h-3" />
                Regenerate with AI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI fallback warning */}
      {fallbackInfo && (
        <div className="p-3 bg-warn/10 border-b border-warn/40">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warn mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-mono text-[10px] uppercase tracking-wider text-warn block mb-1">AI Generation Fell Back to Template</span>
              <p className="text-xs text-ink-2 mb-1">
                AI-generated code did not pass validation. The template-generated code is shown instead.
              </p>
              {fallbackInfo.reason && (
                <p className="font-mono text-[10px] text-ink-3 mb-1 break-words">{fallbackInfo.reason}</p>
              )}
              {fallbackInfo.errors.length > 0 && (
                <button
                  onClick={() => setShowFallbackDetails((v) => !v)}
                  className="font-mono text-[10px] uppercase tracking-wider text-warn hover:text-yellow-600 flex items-center gap-1"
                >
                  {showFallbackDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showFallbackDetails ? 'Hide' : 'Show'} validation report ({fallbackInfo.errors.length})
                </button>
              )}
              {showFallbackDetails && (
                <ul className="mt-1 max-h-32 overflow-auto font-mono text-[10px] text-ink-2 space-y-1">
                  {fallbackInfo.errors.map((err, index) => (
                    <li key={index} className="break-words">• [{err.stage}] {err.message}</li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={() => setFallbackInfo(null)}
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* AI generation progress */}
      {(isGenerating || aiError) && (
        <div className="border-b border-line">
          <div className="px-3 py-2 flex items-center gap-2 bg-panel2">
            {isGenerating ? (
              <Loader className="w-3.5 h-3.5 text-amber animate-spin" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-crit" />
            )}
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-2">
              {isGenerating ? 'AI Generating…' : 'AI Generation Failed'}
            </span>
            {!isGenerating && aiError && (
              <button
                onClick={() => {
                  setAiError(null);
                  setAiEvents([]);
                }}
                className="ml-auto font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink"
              >
                Dismiss
              </button>
            )}
          </div>
          <div ref={progressScrollRef} className="max-h-36 overflow-auto px-3 py-2 space-y-0.5">
            {aiEvents.map((event) => (
              <div
                key={event.id}
                className={`font-mono text-[10px] break-words ${
                  event.kind === 'validation' || event.kind === 'error'
                    ? 'text-red-500'
                    : event.kind === 'activity'
                      ? 'text-ink-3'
                      : 'text-ink-2'
                }`}
              >
                {event.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Template generation errors */}
      {codeErrors.length > 0 && (
        <div className="p-4 bg-crit/10 border-b border-crit/40">
          <div className="flex items-center mb-2">
            <AlertCircle className="w-4 h-4 text-crit mr-2" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-crit">Code Generation Errors</span>
          </div>
          <ul className="text-sm text-red-700">
            {codeErrors.map((error, index) => (
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
          value={codeState.code}
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
            readOnly: isGenerating,
          }}
        />
      </div>

      {/* Footer Info */}
      <div className="px-3 py-2 border-t border-line font-mono text-[9.5px] text-ink-3 tracking-wider uppercase">
        <div className="flex justify-between">
          <span>Python · Strands Agent SDK · {codeState.source === 'ai' ? 'AI' : codeState.source === 'manual' ? 'Manual' : 'Template'}</span>
          <span>{codeState.code.split('\n').length} lines</span>
        </div>
      </div>
    </div>
  );
}
