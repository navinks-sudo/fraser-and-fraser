import React from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';
import { Check, Home, ArrowLeft, Slash } from 'lucide-react';

const stages = [
  { id: 'upload',      label: 'Upload',      path: (pid, bid) => `/projects/${pid}/batches/${bid}` },
  { id: 'visionmax',   label: 'VisionMax',   path: (pid, bid) => `/projects/${pid}/batches/${bid}/visionmax` },
  { id: 'textiq',      label: 'TextIQ',      path: (pid, bid) => `/projects/${pid}/batches/${bid}/textiq` },
  { id: 'indexgenius', label: 'IndexGenius', path: (pid, bid) => `/projects/${pid}/batches/${bid}/indexgenius` },
  { id: 'gedcomx',     label: 'GedcomX',     path: (pid, bid) => `/projects/${pid}/batches/${bid}/gedcomx` },
  { id: 'tree',        label: 'Tree',        path: (pid, bid) => `/projects/${pid}/batches/${bid}/tree` },
];

// Stages that don't apply to spreadsheet uploads
const SHEET_SKIPPED = new Set(['visionmax', 'textiq']);

const StageProgress = () => {
  const navigate = useNavigate();
  const { project_id, batch_id } = useParams();
  const location = useLocation();

  // Pull the batch's files so we can detect whether they're spreadsheets
  const { data: images } = useQuery({
    queryKey: ['images', batch_id],
    queryFn: async () => {
      const res = await api.get(`/projects/${project_id}/batches/${batch_id}/images/`);
      return res.data;
    },
    enabled: !!batch_id,
  });

  // If any file in the batch is a spreadsheet (and none are images), treat the
  // batch as a "spreadsheet batch" — dim the OCR-related stages.
  const hasSpreadsheet = (images || []).some((im) => im.file_type === 'spreadsheet');
  const hasImage = (images || []).some((im) => (im.file_type || 'image') === 'image');
  const sheetOnly = hasSpreadsheet && !hasImage;

  const currentStageIndex = (() => {
    const i = stages.findIndex((s) => location.pathname.includes(s.id));
    return i === -1 ? 0 : i;
  })();

  return (
    <div className="bg-surface border-b border-line shadow-warm-xs py-3 px-6 flex items-center gap-4">
      {/* Home + back to batch */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => navigate('/dashboard')}
          title="Back to dashboard"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-ink-secondary hover:bg-blue-50 hover:text-blue-700 transition-colors"
        >
          <Home size={18} />
        </button>
        <button
          onClick={() => navigate(`/projects/${project_id}/batches/${batch_id}`)}
          title="Back to batch"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-ink-secondary hover:bg-blue-50 hover:text-blue-700 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
      </div>

      <div className="w-px h-8 bg-line-subtle" />

      <div className="flex-1 flex items-center justify-between max-w-4xl mx-auto">
        {stages.map((stage, index) => {
          const isSkipped = sheetOnly && SHEET_SKIPPED.has(stage.id);
          const isCurrent = index === currentStageIndex;
          const isPast = index < currentStageIndex;
          const reachable = !isSkipped;

          // Visual state buckets
          let circleClasses;
          let labelClasses;
          if (isSkipped) {
            circleClasses = 'border-dashed border-line bg-surface-sunken text-ink-tertiary';
            labelClasses = 'text-ink-tertiary line-through opacity-60';
          } else if (isPast) {
            circleClasses = 'bg-brand-amber border-brand-amber text-white';
            labelClasses = 'text-brand-amber';
          } else if (isCurrent) {
            circleClasses = 'border-brand-amber bg-brand-amber-light text-brand-amber-dark';
            labelClasses = 'text-brand-amber';
          } else {
            circleClasses = 'border-line bg-surface-raised text-ink-tertiary';
            labelClasses = 'text-ink-tertiary';
          }

          return (
            <React.Fragment key={stage.id}>
              <button
                type="button"
                onClick={() => reachable && navigate(stage.path(project_id, batch_id))}
                disabled={!reachable}
                title={isSkipped ? `${stage.label} is skipped for spreadsheet uploads` : stage.label}
                className={`flex flex-col items-center gap-1 transition-all min-w-0 ${
                  reachable ? 'cursor-pointer' : 'cursor-not-allowed'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${circleClasses}`}>
                  {isSkipped ? (
                    <Slash size={14} />
                  ) : isPast ? (
                    <Check size={16} />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${labelClasses}`}>
                  {stage.label}
                </span>
              </button>

              {index < stages.length - 1 && (
                <div
                  className={`flex-1 h-[2px] mx-2 ${
                    isPast && !(sheetOnly && SHEET_SKIPPED.has(stages[index + 1].id))
                      ? 'bg-brand-amber'
                      : sheetOnly && (SHEET_SKIPPED.has(stage.id) || SHEET_SKIPPED.has(stages[index + 1].id))
                      ? 'bg-line-subtle border-t border-dashed'
                      : 'bg-line-subtle'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {sheetOnly && (
        <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
          <Slash size={11} />
          spreadsheet — image stages skipped
        </div>
      )}
    </div>
  );
};

export default StageProgress;
