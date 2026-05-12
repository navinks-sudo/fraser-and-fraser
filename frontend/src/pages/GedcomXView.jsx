import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import StageProgress from '../components/Layout/StageProgress';
import {
  Code, Wand2, Download, ChevronLeft, ChevronRight, Users, Network,
  User, UserRound, HelpCircle, Heart, ArrowRight, FileJson, LayoutGrid,
  Sparkles,
} from 'lucide-react';

const GENDER_PALETTE = {
  M: { ring: '#2563EB', soft: '#DBEAFE', deep: '#1D4ED8', label: 'Male' },
  F: { ring: '#DB2777', soft: '#FCE7F3', deep: '#9D174D', label: 'Female' },
  U: { ring: '#94A3B8', soft: '#F1F5F9', deep: '#475569', label: 'Unknown' },
};

const GenderIcon = ({ g, size = 18, color }) => {
  if (g === 'F') return <UserRound size={size} color={color} strokeWidth={1.8} />;
  if (g === 'M') return <User size={size} color={color} strokeWidth={1.8} />;
  return <HelpCircle size={size} color={color} strokeWidth={1.8} />;
};

const nameOf = (p) => (p.names || [])[0]?.nameForms?.[0]?.fullText || p.id;
const genderOf = (p) => {
  const t = (p.gender || {}).type || '';
  if (t.endsWith('Male')) return 'M';
  if (t.endsWith('Female')) return 'F';
  return 'U';
};
const factOf = (p, suffix) =>
  (p.facts || []).find((f) => (f.type || '').endsWith(suffix));

// Person card for the persons grid
const PersonCard = ({ p }) => {
  const g = genderOf(p);
  const pal = GENDER_PALETTE[g];
  const birth = factOf(p, 'Birth');
  const death = factOf(p, 'Death');
  return (
    <div
      className="rounded-2xl p-3 border-2 transition-all hover:-translate-y-1 hover:shadow-warm-md"
      style={{ borderColor: pal.ring, backgroundColor: pal.soft }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-white"
          style={{ border: `2.5px solid ${pal.ring}` }}
        >
          <GenderIcon g={g} size={22} color={pal.deep} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-ink truncate">{nameOf(p)}</div>
          <div className="text-[10px] text-ink-tertiary uppercase tracking-wider">
            {pal.label}
            {p.principal && <span className="ml-1.5 text-brand-amber-dark">· Subject</span>}
          </div>
          {(birth || death) && (
            <div className="text-[11px] text-ink-secondary mt-1.5 space-y-0.5">
              {birth && (
                <div>
                  Born {birth.date?.original || '—'}
                  {birth.place?.original ? ` · ${birth.place.original}` : ''}
                </div>
              )}
              {death && (
                <div>
                  Died {death.date?.original || '—'}
                  {death.place?.original ? ` · ${death.place.original}` : ''}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Relationship row — visual person→relationship→person
const RelRow = ({ rel, byId }) => {
  const a = (rel.person1 || {}).resource?.replace('#', '');
  const b = (rel.person2 || {}).resource?.replace('#', '');
  const pa = byId[a];
  const pb = byId[b];
  const t = (rel.type || '').split('/').slice(-1)[0]; // "ParentChild" | "Couple"
  const labelMap = {
    ParentChild: 'parent of',
    Couple: 'married to',
  };
  const label = labelMap[t] || t;

  const Side = ({ p }) => {
    if (!p) return <span className="text-ink-tertiary italic text-xs">unknown</span>;
    const g = genderOf(p);
    const pal = GENDER_PALETTE[g];
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: pal.soft, border: `2px solid ${pal.ring}` }}
        >
          <GenderIcon g={g} size={13} color={pal.deep} />
        </div>
        <span className="text-sm font-medium text-ink truncate">{nameOf(p)}</span>
      </div>
    );
  };

  const isCouple = t === 'Couple';
  return (
    <div
      className="flex items-center gap-2 p-2.5 rounded-xl border bg-white border-line-subtle hover:border-brand-amber transition-colors"
    >
      <div className="flex-1 min-w-0">
        <Side p={pa} />
      </div>
      <div className="flex flex-col items-center shrink-0 px-2">
        <span
          className={`text-[9px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full ${
            isCouple
              ? 'bg-pink-100 text-pink-800'
              : 'bg-brand-amber-light text-brand-amber-dark'
          }`}
        >
          {label}
        </span>
        {isCouple ? (
          <Heart size={12} className="text-pink-600 mt-1" fill="#DB2777" />
        ) : (
          <ArrowRight size={12} className="text-brand-amber mt-1" />
        )}
      </div>
      <div className="flex-1 min-w-0 flex justify-end">
        <Side p={pb} />
      </div>
    </div>
  );
};

const GedcomXView = () => {
  const { project_id, batch_id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [view, setView] = useState('persons'); // 'persons' | 'relations' | 'json'

  const { data: images } = useQuery({
    queryKey: ['images', batch_id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/${batch_id}/images/`);
      return response.data;
    },
  });

  const currentImage = images?.[currentImageIndex];

  const { data: gedcomxData } = useQuery({
    queryKey: ['gedcomx', currentImage?.id],
    queryFn: async () => {
      const response = await api.get(
        `/projects/${project_id}/batches/${batch_id}/gedcomx/${currentImage.id}`,
      );
      return response.data;
    },
    enabled: !!currentImage,
  });

  const generateMutation = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${project_id}/batches/${batch_id}/gedcomx/${currentImage.id}/generate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gedcomx', currentImage.id] });
      queryClient.invalidateQueries({ queryKey: ['images', batch_id] });
    },
  });

  const handleNext = () => currentImageIndex < images.length - 1 && setCurrentImageIndex((i) => i + 1);
  const handlePrev = () => currentImageIndex > 0 && setCurrentImageIndex((i) => i - 1);

  const persons = gedcomxData?.persons || [];
  const relationships = gedcomxData?.relationships || [];
  const byId = Object.fromEntries(persons.filter((p) => p.id).map((p) => [p.id, p]));

  const genderCounts = persons.reduce(
    (acc, p) => {
      acc[genderOf(p)] = (acc[genderOf(p)] || 0) + 1;
      return acc;
    },
    {},
  );

  const downloadJSON = () => {
    if (!gedcomxData) return;
    const blob = new Blob([JSON.stringify(gedcomxData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gedcomx-${currentImage?.original_filename || 'record'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-screen bg-surface-canvas">
      <StageProgress />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col p-8 overflow-hidden">
          <div className="max-w-5xl mx-auto w-full flex flex-col h-full">
            {/* Header */}
            <div className="flex justify-between items-start mb-6 flex-wrap gap-4">
              <div>
                <h2 className="heading-page flex items-center gap-2">
                  <Code size={24} className="text-brand-amber" />
                  GedcomX Specification
                </h2>
                <p className="text-ink-secondary text-sm">
                  Machine-readable genealogical data for{' '}
                  <span className="font-mono">{currentImage?.original_filename}</span>
                </p>
              </div>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  className="btn-secondary text-xs py-1.5 flex items-center gap-1.5"
                >
                  <Wand2 size={14} />
                  {generateMutation.isPending ? 'Generating…' : 'Re-generate'}
                </button>
                <button
                  onClick={downloadJSON}
                  disabled={!gedcomxData}
                  className="btn-primary text-xs py-1.5 flex items-center gap-1.5"
                >
                  <Download size={14} />
                  Export JSON
                </button>
              </div>
            </div>

            {/* Empty state */}
            {!gedcomxData && !generateMutation.isPending ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center bg-surface rounded-2xl border-2 border-dashed border-line p-12">
                <Sparkles size={56} className="text-brand-amber mb-4" />
                <h3 className="heading-section mb-2">No GedcomX yet</h3>
                <p className="text-ink-secondary mb-6 max-w-md">
                  Generate a GedcomX representation from the indexed record. This is the
                  industry-standard format that downstream genealogy tools understand.
                </p>
                <button onClick={() => generateMutation.mutate()} className="btn-primary">
                  Generate Now
                </button>
              </div>
            ) : (
              <>
                {/* Stats banner */}
                <div className="bg-gradient-to-r from-blue-50 via-cyan-50 to-blue-50 rounded-2xl p-4 mb-5 border border-blue-100 grid grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold font-display text-blue-700">{persons.length}</div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-tertiary mt-0.5">Persons</div>
                  </div>
                  <div className="text-center border-l border-blue-100">
                    <div className="text-2xl font-bold font-display text-blue-700">{relationships.length}</div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-tertiary mt-0.5">Relations</div>
                  </div>
                  <div className="text-center border-l border-blue-100">
                    <div className="text-2xl font-bold font-display text-blue-700">
                      {genderCounts.M || 0}
                      <span className="text-base text-blue-500">M</span>
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-tertiary mt-0.5">Male</div>
                  </div>
                  <div className="text-center border-l border-blue-100">
                    <div className="text-2xl font-bold font-display text-pink-600">
                      {genderCounts.F || 0}
                      <span className="text-base text-pink-400">F</span>
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-tertiary mt-0.5">Female</div>
                  </div>
                </div>

                {/* View tabs */}
                <div className="flex items-center gap-1 bg-surface-sunken rounded-xl p-1 mb-4 w-fit">
                  {[
                    { v: 'persons', label: 'Persons', Icon: Users },
                    { v: 'relations', label: 'Relationships', Icon: Network },
                    { v: 'json', label: 'Raw JSON', Icon: FileJson },
                  ].map(({ v, label, Icon }) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`px-3 py-1.5 text-xs rounded-md flex items-center gap-1.5 transition-colors ${
                        view === v
                          ? 'bg-brand-amber text-white shadow-warm-sm'
                          : 'text-ink-secondary hover:text-ink'
                      }`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto bg-surface rounded-2xl border border-line-subtle p-5">
                  {view === 'persons' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {persons.map((p) => (
                        <PersonCard key={p.id} p={p} />
                      ))}
                      {persons.length === 0 && (
                        <div className="col-span-full text-center text-ink-tertiary text-sm py-8">
                          No persons in the GedcomX yet.
                        </div>
                      )}
                    </div>
                  )}

                  {view === 'relations' && (
                    <div className="space-y-2">
                      {relationships.map((rel, i) => (
                        <RelRow key={i} rel={rel} byId={byId} />
                      ))}
                      {relationships.length === 0 && (
                        <div className="text-center text-ink-tertiary text-sm py-8">
                          No relationships recorded.
                        </div>
                      )}
                    </div>
                  )}

                  {view === 'json' && (
                    <pre className="font-mono text-[11px] leading-relaxed text-ink-secondary whitespace-pre-wrap">
                      {JSON.stringify(gedcomxData, null, 2)}
                    </pre>
                  )}
                </div>
              </>
            )}

            {/* Footer nav */}
            <div className="flex justify-center gap-3 mt-6">
              <button
                onClick={handlePrev}
                disabled={currentImageIndex === 0}
                className="btn-secondary py-2 flex items-center gap-2"
              >
                <ChevronLeft size={18} /> Previous
              </button>
              <button
                onClick={() => navigate(`/projects/${project_id}/batches/${batch_id}/tree`)}
                className="btn-primary py-2 px-8 flex items-center gap-2"
              >
                <LayoutGrid size={16} />
                View Family Tree
                <ChevronRight size={18} />
              </button>
              <button
                onClick={handleNext}
                disabled={currentImageIndex === images?.length - 1}
                className="btn-secondary py-2 flex items-center gap-2"
              >
                Next <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GedcomXView;
