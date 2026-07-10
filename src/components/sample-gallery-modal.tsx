import { useEffect, useState } from 'react';
import { X, LayoutGrid, AlertTriangle, Loader2, Download } from 'lucide-react';
import { apiClient } from '../lib/api-client';
import { SAMPLE_FLOWS, type SampleFlow, type SampleSkillDefinition } from '../lib/sample-flows';

interface SampleGalleryModalProps {
  onClose: () => void;
  onLoadSample: (sample: SampleFlow) => void;
}

export function SampleGalleryModal({ onClose, onLoadSample }: SampleGalleryModalProps) {
  // Names of skills currently in the library; null = not loaded yet (treated as "missing")
  const [availableSkills, setAvailableSkills] = useState<string[] | null>(null);
  const [importingSampleId, setImportingSampleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listSkills()
      .then(skills => {
        if (!cancelled) setAvailableSkills(skills.map(s => s.name));
      })
      .catch(() => {
        // Library unreachable - keep null so required skills show the import path
        if (!cancelled) setAvailableSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const getMissingSkills = (sample: SampleFlow): SampleSkillDefinition[] => {
    if (!sample.requiredSkills || sample.requiredSkills.length === 0) return [];
    return sample.requiredSkills.filter(skill => !(availableSkills ?? []).includes(skill.name));
  };

  const handleImportAndLoad = async (sample: SampleFlow) => {
    setImportingSampleId(sample.id);
    setError(null);
    try {
      for (const skill of getMissingSkills(sample)) {
        try {
          await apiClient.importSkill({
            source_type: 'inline',
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // 409 = skill already in the library; safe to continue. The backend
          // detail reads "Skill '<name>' is already imported" (skills.py 409),
          // and the generic fallback message contains the status code itself.
          if (/409|already (exists|imported)/i.test(message)) continue;
          throw e;
        }
      }
      onLoadSample(sample);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import required skills');
    } finally {
      setImportingSampleId(null);
    }
  };

  const handleCardClick = (sample: SampleFlow) => {
    if (getMissingSkills(sample).length > 0) return; // load happens via Import & Load button
    onLoadSample(sample);
  };

  const renderCard = (sample: SampleFlow) => {
    const missingSkills = getMissingSkills(sample);
    const requiresImport = missingSkills.length > 0;
    const importing = importingSampleId === sample.id;

    return (
      <div
        key={sample.id}
        onClick={() => handleCardClick(sample)}
        className={`border border-line p-3 transition-colors ${
          requiresImport ? '' : 'cursor-pointer hover:border-line2 hover:bg-panel/60'
        }`}
        title={requiresImport ? undefined : `Load "${sample.name}" onto the canvas`}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-ink flex-1 truncate">{sample.name}</span>
          <span
            className={`font-mono text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 border flex-shrink-0 ${
              sample.level === 'advanced' ? 'border-amber/40 text-amber' : 'border-line text-ink-3'
            }`}
          >
            {sample.level}
          </span>
        </div>
        <p className="font-mono text-[10px] text-ink-3 mt-1.5 leading-relaxed">{sample.description}</p>
        <div className="font-mono text-[9.5px] text-ink-3 mt-1.5 uppercase tracking-wider">
          {sample.nodes.length} nodes · {sample.edges.length} edges
          {sample.graphMode ? ' · graph mode' : ''}
        </div>
        {requiresImport && (
          <div className="mt-2 pt-2 border-t border-line flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-warn flex-shrink-0" />
            <span className="font-mono text-[10px] text-warn flex-1">
              Requires skill{missingSkills.length > 1 ? 's' : ''}{' '}
              {missingSkills.map(s => `'${s.name}'`).join(', ')}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleImportAndLoad(sample);
              }}
              disabled={importing}
              className="lp-btn sm flex-shrink-0"
            >
              {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              Import &amp; Load
            </button>
          </div>
        )}
      </div>
    );
  };

  const basicSamples = SAMPLE_FLOWS.filter(s => s.level === 'basic');
  const advancedSamples = SAMPLE_FLOWS.filter(s => s.level === 'advanced');

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="lp-panel brk lp-rise w-full max-w-3xl max-h-[85vh] flex flex-col m-4">
        {/* Header */}
        <div className="lp-phead">
          <LayoutGrid className="w-4 h-4 text-s3" />
          <h2 className="lp-ptitle">Sample Gallery</h2>
          <span className="lp-sub">preset agent flows</span>
          <button
            onClick={onClose}
            className="ml-auto text-ink-3 hover:text-ink transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-crit/10 border border-crit/40 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-crit flex-shrink-0 mt-0.5" />
              <p className="text-sm text-crit break-all">{error}</p>
            </div>
          )}

          <div>
            <label className="lp-label">Basic ({basicSamples.length})</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
              {basicSamples.map(renderCard)}
            </div>
          </div>

          <div>
            <label className="lp-label !text-amber">Advanced ({advancedSamples.length})</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
              {advancedSamples.map(renderCard)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
