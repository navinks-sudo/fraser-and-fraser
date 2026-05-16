import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { assetUrl } from '../api/axios';
import { Users, GitBranch, ArrowRight, Trash2, FileSpreadsheet } from 'lucide-react';

/**
 * Persistent panel that lists every family group currently applied to this
 * batch. For each group it shows:
 *   - a colour stripe in the group's ribbon colour
 *   - the family label + count
 *   - a thumbnail strip of constituent certificates
 *   - one-click "View merged family tree" → opens TreeViewer in group mode
 *   - optional "Dissolve" to release members back to standalone
 *
 * Renders nothing if there are no applied groups yet (suggestions are
 * handled by FamilyGroupBanner which sits above this panel).
 */
const FamilyGroupsPanel = ({ projectId, batchId, images }) => {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['family-groups', batchId],
    queryFn: async () =>
      (await api.get(`/projects/${projectId}/batches/${batchId}/family-groups`)).data,
    enabled: !!batchId,
    staleTime: 30_000,
  });

  const dissolveMutation = useMutation({
    mutationFn: async (groupId) =>
      api.delete(`/projects/${projectId}/batches/${batchId}/family-groups/${groupId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['family-groups', batchId] });
      qc.invalidateQueries({ queryKey: ['family-groups-suggest', batchId] });
      qc.invalidateQueries({ queryKey: ['images', batchId] });
    },
    onError: (err) => alert(err?.response?.data?.detail || 'Failed to dissolve group'),
  });

  // Build a quick lookup so we can render each member's thumbnail.
  // IMPORTANT: this hook must be called on every render. Don't put a
  // conditional `return null` above it — that triggers the React rules-of-hooks
  // "rendered more hooks than during the previous render" error when data
  // transitions from empty → loaded.
  const imageById = React.useMemo(() => {
    const m = new Map();
    (images || []).forEach((img) => m.set(img.id, img));
    return m;
  }, [images]);

  const groups = data?.groups || [];
  if (!groups.length) return null;

  const openMergedTree = (group) => {
    // TreeViewer reads ?mode=group&image=<id> from the URL and pre-selects
    // group-mode for the merged view. We hand it the first member image
    // so the per-image fallback also has something sensible to render.
    const firstId = group.image_ids?.[0];
    navigate(
      `/projects/${projectId}/batches/${batchId}/tree?mode=group&image=${firstId}`,
    );
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="eyebrow eyebrow-rule">
          Family groups · {groups.length}
        </div>
        <div className="text-[12px] text-ink-tertiary">
          Each group merges every member certificate into one deduped tree.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {groups.map((g) => {
          const members = (g.image_ids || []).map((id) => imageById.get(id)).filter(Boolean);
          return (
            <div
              key={g.id}
              className="relative bg-surface border border-line-subtle rounded-md overflow-hidden hover:shadow-warm-md transition-shadow"
            >
              {/* Coloured top stripe — matches the ribbon colour on thumbnails */}
              <div className="h-1.5 w-full" style={{ background: g.color }} />

              <div className="p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: g.color }}
                      />
                      <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink-tertiary">
                        Family
                      </span>
                    </div>
                    <h3 className="font-display font-extrabold text-[18px] text-navy-800 leading-tight">
                      {g.label}
                    </h3>
                    <p className="text-[12px] text-ink-secondary mt-1">
                      {g.image_ids.length} certificates · click to view their merged tree
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      if (window.confirm(
                        `Dissolve "${g.label}"?\n\nIts ${g.image_ids.length} member certificates will become standalone again. Tree data and OCR are not affected.`,
                      )) {
                        dissolveMutation.mutate(g.id);
                      }
                    }}
                    disabled={dissolveMutation.isPending}
                    className="w-8 h-8 rounded-md text-ink-tertiary hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition-colors disabled:opacity-50 shrink-0"
                    title="Dissolve this group — members become standalone"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Member thumbnail strip */}
                <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                  {members.slice(0, 8).map((img) => (
                    <button
                      key={img.id}
                      onClick={() =>
                        navigate(
                          `/projects/${projectId}/batches/${batchId}/tree?mode=image&image=${img.id}`,
                        )
                      }
                      title={`${img.original_filename} — click to view individually`}
                      className="shrink-0 w-14 h-18 rounded overflow-hidden border-2 hover:border-navy-800 transition-colors"
                      style={{ borderColor: `${g.color}55` }}
                    >
                      {img.file_type === 'spreadsheet' ? (
                        <div className="w-full h-full bg-gradient-to-br from-orange-100 to-orange-300 flex items-center justify-center">
                          <FileSpreadsheet size={20} className="text-orange-700" />
                        </div>
                      ) : (
                        <img
                          src={assetUrl(img.original_path)}
                          alt=""
                          className="w-full h-full object-cover"
                          style={{ transform: `rotate(${img.rotation || 0}deg)` }}
                        />
                      )}
                    </button>
                  ))}
                  {members.length > 8 && (
                    <div className="shrink-0 w-14 h-18 rounded border-2 border-dashed flex items-center justify-center text-[10px] font-bold text-ink-tertiary"
                         style={{ borderColor: `${g.color}55` }}>
                      +{members.length - 8}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => openMergedTree(g)}
                  className="group w-full inline-flex items-center justify-between bg-navy-800 hover:bg-navy-900 text-white font-semibold text-[13px] pl-4 pr-2 py-2.5 rounded-md shadow-warm-sm transition-all"
                >
                  <span className="flex items-center gap-2">
                    <GitBranch size={14} />
                    View merged family tree
                  </span>
                  <span
                    className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
                    style={{ background: g.color }}
                  >
                    <ArrowRight size={12} strokeWidth={2.5} />
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FamilyGroupsPanel;
