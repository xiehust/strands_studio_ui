import { useEffect, useRef } from 'react';
import { Loader, AlertTriangle, Sparkles, Wrench, XCircle } from 'lucide-react';
import type { FixDiagnosis } from '../lib/api-client';
import type { FixProgressEvent } from '../hooks/use-ai-fix';

interface AiFixProgressProps {
  isFixing: boolean;
  fixEvents: FixProgressEvent[];
  fixError: string | null;
  fixDiagnosis: FixDiagnosis | null;
  fixApplied: boolean;
  appliedMessage?: string;
  onDismissError: () => void;
  onDismissDiagnosis: () => void;
}

// Presentational AI Fix UI: progress event list, failure header, applied notice,
// and diagnosis card. Shared by the Execution Panel and the Chat Modal.
export function AiFixProgress({
  isFixing,
  fixEvents,
  fixError,
  fixDiagnosis,
  fixApplied,
  appliedMessage = 'Code fixed by AI — re-run to verify.',
  onDismissError,
  onDismissDiagnosis,
}: AiFixProgressProps) {
  const fixProgressScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll AI Fix progress list
  useEffect(() => {
    if (fixProgressScrollRef.current) {
      fixProgressScrollRef.current.scrollTop = fixProgressScrollRef.current.scrollHeight;
    }
  }, [fixEvents]);

  return (
    <>
      {/* AI Fix progress */}
      {(isFixing || fixError) && (
        <div className="mt-3 border border-line">
          <div className="px-3 py-2 flex items-center gap-2 bg-panel2">
            {isFixing ? (
              <Loader className="w-3.5 h-3.5 text-amber animate-spin" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-crit" />
            )}
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-2">
              {isFixing ? 'AI Fixing…' : 'AI Fix Failed'}
            </span>
            {!isFixing && fixError && (
              <button
                onClick={onDismissError}
                className="ml-auto font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink"
              >
                Dismiss
              </button>
            )}
          </div>
          <div ref={fixProgressScrollRef} className="max-h-36 overflow-auto px-3 py-2 space-y-0.5">
            {fixEvents.map((event) => (
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

      {/* Fixed code applied notice */}
      {fixApplied && (
        <div className="mt-3 bg-good/10 border border-good/40 p-3 flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-good mt-0.5 flex-shrink-0" />
          <p className="text-sm text-ink-2">{appliedMessage}</p>
        </div>
      )}

      {/* AI diagnosis card */}
      {fixDiagnosis && (
        <div className="mt-3 border border-line p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">AI Diagnosis</span>
            {fixDiagnosis.category === 'code' ? (
              <span className="lp-chip violet"><Wrench className="w-3 h-3" />CODE</span>
            ) : fixDiagnosis.category === 'config' ? (
              <span className="lp-chip warn"><AlertTriangle className="w-3 h-3" />CONFIG</span>
            ) : (
              <span className="lp-chip crit"><XCircle className="w-3 h-3" />ENVIRONMENT</span>
            )}
            <button
              onClick={onDismissDiagnosis}
              className="ml-auto font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-ink-2 mb-2">{fixDiagnosis.summary}</p>
          {fixDiagnosis.suggestions && fixDiagnosis.suggestions.length > 0 && (
            <ul className="space-y-1">
              {fixDiagnosis.suggestions.map((suggestion, index) => (
                <li key={index} className="text-xs text-ink-2 break-words">
                  •{' '}
                  {suggestion.node_label && suggestion.property
                    ? `Node '${suggestion.node_label}' → property '${suggestion.property}': ${suggestion.action}`
                    : suggestion.node_label
                      ? `Node '${suggestion.node_label}': ${suggestion.action}`
                      : suggestion.action}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
