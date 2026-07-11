import { useCallback, useRef, useState } from 'react';
import { apiClient, type FixCodeRequest, type FixDiagnosis } from '../lib/api-client';

export interface FixProgressEvent {
  id: number;
  kind: 'progress' | 'activity' | 'validation' | 'error';
  text: string;
}

export interface UseAiFixOptions {
  // Returns true when the fixed code was applied to the app code state
  // (false when the user declined to overwrite manual edits).
  onApplied?: (code: string) => boolean;
}

// Shared AI Fix state machine (backend coding agent, POST /api/fix-code/stream).
// Used by the Execution Panel and the Chat Modal.
export function useAiFix({ onApplied }: UseAiFixOptions = {}) {
  const [isFixing, setIsFixing] = useState(false);
  const [fixEvents, setFixEvents] = useState<FixProgressEvent[]>([]);
  const [fixError, setFixError] = useState<string | null>(null);
  const [fixDiagnosis, setFixDiagnosis] = useState<FixDiagnosis | null>(null);
  const [fixApplied, setFixApplied] = useState(false);
  const fixEventIdRef = useRef(0);
  const isFixingRef = useRef(false);
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  const appendFixEvent = useCallback((kind: FixProgressEvent['kind'], text: string) => {
    fixEventIdRef.current += 1;
    const id = fixEventIdRef.current;
    setFixEvents((prev) => [...prev, { id, kind, text }]);
  }, []);

  const resetFixState = useCallback(() => {
    setFixEvents([]);
    setFixError(null);
    setFixDiagnosis(null);
    setFixApplied(false);
  }, []);

  const dismissDiagnosis = useCallback(() => setFixDiagnosis(null), []);

  // Surface follow-up failures (e.g. session code sync) the same way as fix failures.
  const reportFixError = useCallback((message: string) => {
    setFixError(message);
    appendFixEvent('error', message);
  }, [appendFixEvent]);

  const startFix = useCallback((request: FixCodeRequest) => {
    if (isFixingRef.current) return;
    isFixingRef.current = true;

    setIsFixing(true);
    resetFixState();
    appendFixEvent('progress', 'Starting AI fix...');

    apiClient.fixCodeStream(request, {
      onProgress: (message) => appendFixEvent('progress', message),
      onAgentActivity: (summary) => appendFixEvent('activity', summary),
      onValidation: (round, errors) => {
        if (errors.length > 0) {
          appendFixEvent('validation', `Validation round ${round}: ${errors.length} error(s)`);
          errors.forEach((err) => appendFixEvent('validation', `[${err.stage}] ${err.message}`));
        } else {
          appendFixEvent('progress', `Validation round ${round}: passed`);
        }
      },
      onDone: (result) => {
        isFixingRef.current = false;
        setIsFixing(false);
        setFixDiagnosis(result.diagnosis ?? null);
        if (result.changed && onAppliedRef.current) {
          const applied = onAppliedRef.current(result.code);
          setFixApplied(applied);
        }
      },
      onError: (message) => {
        isFixingRef.current = false;
        setIsFixing(false);
        setFixError(message);
        appendFixEvent('error', message);
      },
    });
  }, [appendFixEvent, resetFixState]);

  return {
    isFixing,
    fixEvents,
    fixError,
    fixDiagnosis,
    fixApplied,
    startFix,
    resetFixState,
    dismissDiagnosis,
    reportFixError,
  };
}
