import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import {
  Users, Check, X, ChevronDown, ChevronUp, Sparkles, ArrowRight,
} from 'lucide-react';

/**
 * Banner that surfaces detected family groups across the batch's certificates.
 *
 * Behaviour:
 *  - Polls /family-groups/suggest to get candidate groupings
 *  - Filters out groups that are already applied (every member has the same
 *    family_group_id assigned in the Images table)
 *  - Lets the user accept all suggestions, review each, or dismiss for now
 *  - Dismissal is persisted in localStorage scoped to this batch
 */
const FamilyGroupBanner = ({ projectId, batchId, images }) => {
  const qc = useQueryClient();
  const dismissKey = `family-banner-dismissed-${batchId}`;
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(dismissKey) === 'true',
  );
  const [expanded, setExpanded] = useState(false);

  const { data: suggestions } = useQuery({
    queryKey: ['family-groups-suggest', batchId],
    queryFn: async () =>
      (await api.get(`/projects/${projectId}/batches/${batchId}/family-groups/suggest`)).data,
    enabled: !!batchId && !dismissed,
    staleTime: 60_000,
  });

  // Determine which suggestions are NOT already applied. We compare suggestion
  // members' image_ids against the family_group_id values on Image rows.
  const unappliedGroups = React.useMemo(() => {
    if (!suggestions?.groups?.length) return [];
    return suggestions.groups.filter((g) => {
      const members = (images || []).filter((img) => g.image_ids.includes(img.id));
      if (members.length === 0) return false;
      // Already applied if every member shares the same non-null family_group_id
      const uniqueGroupIds = new Set(members.map((m) => m.family_group_id));
      if (uniqueGroupIds.size === 1 && !uniqueGroupIds.has(null)) return false;
      return true;
    });
  }, [suggestions, images]);

  const applyMutation = useMutation({
    mutationFn: async (groups) =>
      api.post(`/projects/${projectId}/batches/${batchId}/family-groups/apply`, { groups }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['images', batchId] });
      qc.invalidateQueries({ queryKey: ['family-groups-suggest', batchId] });
      qc.invalidateQueries({ queryKey: ['family-groups', batchId] });
    },
    onError: (err) => alert(err?.response?.data?.detail || 'Failed to apply groups'),
  });

  const handleDismiss = () => {
    localStorage.setItem(dismissKey, 'true');
    setDismissed(true);
  };

  if (dismissed || unappliedGroups.length === 0) return null;

  const totalCerts = unappliedGroups.reduce((s, g) => s + g.image_ids.length, 0);

  return (
    <div
      className="relative rounded-md overflow-hidden border border-orange-200 shadow-warm-sm mb-6 animate-fade-up"
      style={{ background: 'linear-gradient(135deg, #07142A 0%, #0B1F3A 70%, #142849 100%)' }}
    >
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px)',
          backgroundSize: '4px 4px',
        }}
      />
      <div className="relative px-6 py-5 flex items-start gap-4">
        <div className="w-11 h-11 rounded-md bg-orange-500/15 border border-orange-500/40 text-orange-300 flex items-center justify-center shrink-0">
          <Sparkles size={20} strokeWidth={2} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-orange-300 mb-1">
            Family groups detected
          </div>
          <div className="font-display font-extrabold text-white text-[18px] leading-tight">
            We spotted {unappliedGroups.length}{' '}
            <span className="italic-accent text-orange-300">
              {unappliedGroups.length === 1 ? 'family' : 'families'}
            </span>{' '}
            spanning {totalCerts} certificates.
          </div>
          <div className="text-[13px] text-navy-100/80 mt-1.5 leading-relaxed">
            Their merged trees will dedupe shared people and link relationships across documents.
          </div>

          {expanded && (
            <div className="mt-4 space-y-2">
              {unappliedGroups.map((g) => (
                <div
                  key={g.suggested_id}
                  className="bg-white/5 backdrop-blur border border-white/10 rounded-md p-3"
                >
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: g.color }}
                      />
                      <span className="font-display font-bold text-white text-[14px] truncate">
                        {g.label}
                      </span>
                      <span className="text-[11px] text-navy-100/60 shrink-0">
                        · {g.image_ids.length} certs
                      </span>
                    </div>
                    <button
                      onClick={() => applyMutation.mutate([g])}
                      disabled={applyMutation.isPending}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
                    >
                      Apply this one
                    </button>
                  </div>
                  {g.shared_names?.length > 0 && (
                    <div className="text-[11px] text-navy-100/70">
                      Shared names:{' '}
                      <span className="text-orange-200">{g.shared_names.slice(0, 4).join(' · ')}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button
              onClick={() => applyMutation.mutate(unappliedGroups)}
              disabled={applyMutation.isPending}
              className="group inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-[13px] font-semibold pl-4 pr-2 py-2 rounded-md shadow-warm-md transition-all"
            >
              {applyMutation.isPending ? (
                <span>Applying…</span>
              ) : (
                <>
                  <Check size={14} strokeWidth={2.5} />
                  <span>
                    Apply all {unappliedGroups.length}{' '}
                    {unappliedGroups.length === 1 ? 'grouping' : 'groupings'}
                  </span>
                </>
              )}
              <span className="w-7 h-7 rounded-md bg-white/15 group-hover:bg-white/25 flex items-center justify-center transition-colors">
                <ArrowRight size={12} strokeWidth={2.5} />
              </span>
            </button>

            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[13px] font-semibold text-navy-100/85 hover:text-white flex items-center gap-1.5 px-3 py-2 rounded-md hover:bg-white/5 transition-colors"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expanded ? 'Hide details' : 'Review each'}
            </button>

            <button
              onClick={handleDismiss}
              className="text-[13px] font-medium text-navy-100/55 hover:text-white px-3 py-2 rounded-md hover:bg-white/5 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>

        <button
          onClick={handleDismiss}
          className="text-navy-100/55 hover:text-white p-1 shrink-0"
          title="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default FamilyGroupBanner;
