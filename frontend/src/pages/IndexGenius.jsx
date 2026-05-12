import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import StageProgress from '../components/Layout/StageProgress';
import {
  Database, Wand2, ChevronLeft, ChevronRight, User, UserRound, Users,
  Network, Tag, ArrowRight, Calendar, MapPin, Briefcase, HelpCircle, Sparkles,
  FileSpreadsheet, Layers,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────
// Confidence helpers — smooth HSL gradient (red ⇒ amber ⇒ green)
// ──────────────────────────────────────────────────────────────────────────
const confPalette = (c) => {
  if (c == null) return null;
  const v = Math.max(0, Math.min(1, c));
  const hue = v * 130;
  return {
    bg: `hsla(${hue}, 75%, 88%, ${(1 - v) * 0.7 + 0.15})`,
    fg: `hsl(${hue}, 60%, ${25 + v * 8}%)`,
    border: `hsl(${hue}, 70%, ${45 + v * 10}%)`,
    ring: `hsl(${hue}, 70%, 50%)`,
    raw: v,
  };
};

const ConfBadge = ({ conf, size = 'sm' }) => {
  const c = confPalette(conf);
  if (!c) return null;
  const sz = size === 'lg' ? 'text-xs px-2 py-0.5' : 'text-[9px] px-1.5 py-0.5';
  return (
    <span
      className={`font-semibold rounded-full tabular-nums ${sz}`}
      style={{ backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
      title={`Model confidence: ${(c.raw * 100).toFixed(0)}%`}
    >
      {Math.round(c.raw * 100)}%
    </span>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// Gender palette (matches TreeViewer)
// ──────────────────────────────────────────────────────────────────────────
const G_PALETTE = {
  M: { ring: '#2563EB', soft: '#DBEAFE', deep: '#1D4ED8', label: 'Male' },
  F: { ring: '#DB2777', soft: '#FCE7F3', deep: '#9D174D', label: 'Female' },
  U: { ring: '#94A3B8', soft: '#F1F5F9', deep: '#475569', label: 'Unknown' },
};
const GenderIcon = ({ gender, size = 18, color }) => {
  if (gender === 'F') return <UserRound size={size} color={color} strokeWidth={1.8} />;
  if (gender === 'M') return <User size={size} color={color} strokeWidth={1.8} />;
  return <HelpCircle size={size} color={color} strokeWidth={1.8} />;
};

// ──────────────────────────────────────────────────────────────────────────
// Person card — visual replacement for the old form fields.
// ──────────────────────────────────────────────────────────────────────────
const PersonCard = ({ p, isSelected, onSelect }) => {
  const g = p.gender || 'U';
  const pal = G_PALETTE[g];
  const dates = [
    p.date_of_birth && `b. ${p.date_of_birth}`,
    p.date_of_death && `d. ${p.date_of_death}`,
  ].filter(Boolean).join(' / ');
  return (
    <button
      type="button"
      onClick={() => onSelect?.(p.name)}
      className={`relative w-full text-left p-3 rounded-xl border transition-all hover:-translate-y-0.5 ${
        isSelected
          ? 'border-brand-amber-dark shadow-lg ring-2 ring-brand-amber/40'
          : 'border-line-subtle hover:border-brand-amber bg-white shadow-warm-xs'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: pal.soft, border: `2.5px solid ${pal.ring}` }}
        >
          <GenderIcon gender={g} size={22} color={pal.deep} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm text-ink truncate">{p.name}</span>
            <ConfBadge conf={p.confidence} />
          </div>
          {p.role && (
            <span
              className="inline-block text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded mr-1"
              style={{ backgroundColor: pal.soft, color: pal.deep }}
            >
              {p.role.replace(/_/g, ' ')}
            </span>
          )}
          {(dates || p.age) && (
            <div className="text-[11px] text-ink-tertiary mt-1 flex items-center gap-1">
              <Calendar size={10} />
              {dates || (p.age ? `age ${p.age}` : '')}
            </div>
          )}
          {p.occupation && (
            <div className="text-[11px] text-ink-tertiary mt-0.5 flex items-center gap-1">
              <Briefcase size={10} />
              {p.occupation}
            </div>
          )}
          {p.place && (
            <div className="text-[11px] text-ink-tertiary mt-0.5 flex items-center gap-1">
              <MapPin size={10} />
              {p.place}
            </div>
          )}
        </div>
      </div>
    </button>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// Relation row — Person A → [type pill] → Person B, with mini avatars.
// ──────────────────────────────────────────────────────────────────────────
const RelationRow = ({ rel, getPerson, focusedName, onFocus }) => {
  const a = getPerson(rel.person_a);
  const b = getPerson(rel.person_b);
  const aGender = a?.gender || 'U';
  const bGender = b?.gender || 'U';
  const aPal = G_PALETTE[aGender];
  const bPal = G_PALETTE[bGender];

  const typeLabel = (rel.type || '').replace(/_/g, ' ');
  const isFocused = focusedName && (rel.person_a === focusedName || rel.person_b === focusedName);

  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
        isFocused ? 'bg-brand-amber-light/40 border-brand-amber/40' : 'border-line-subtle hover:bg-surface-raised'
      }`}
    >
      <button onClick={() => onFocus?.(rel.person_a)} className="flex items-center gap-2 min-w-0 flex-1 text-left hover:underline">
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: aPal.soft, border: `2px solid ${aPal.ring}` }}
        >
          <GenderIcon gender={aGender} size={11} color={aPal.deep} />
        </div>
        <span className="text-xs font-medium truncate">{rel.person_a}</span>
      </button>

      <div className="flex flex-col items-center shrink-0">
        <span
          className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-brand-amber-light text-brand-amber-dark whitespace-nowrap"
          title={typeLabel}
        >
          {typeLabel}
        </span>
        <ArrowRight size={12} className="text-brand-amber mt-0.5" />
      </div>

      <button onClick={() => onFocus?.(rel.person_b)} className="flex items-center gap-2 min-w-0 flex-1 text-left hover:underline justify-end">
        <span className="text-xs font-medium truncate">{rel.person_b}</span>
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: bPal.soft, border: `2px solid ${bPal.ring}` }}
        >
          <GenderIcon gender={bGender} size={11} color={bPal.deep} />
        </div>
      </button>

      <ConfBadge conf={rel.confidence} />
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────────
const IndexGenius = () => {
  const { project_id, batch_id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [focusedName, setFocusedName] = useState(null); // for highlighting in relations

  const { data: images } = useQuery({
    queryKey: ['images', batch_id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/${batch_id}/images/`);
      return response.data;
    },
  });

  const currentImage = images?.[currentImageIndex];

  const isSpreadsheet = currentImage?.file_type === 'spreadsheet';

  const { data: ocrData } = useQuery({
    queryKey: ['ocr', currentImage?.id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/${batch_id}/textiq/${currentImage.id}`);
      return response.data;
    },
    enabled: !!currentImage && !isSpreadsheet,
  });

  const { data: spreadsheet } = useQuery({
    queryKey: ['spreadsheet', currentImage?.id],
    queryFn: async () => {
      const r = await api.get(`/projects/${project_id}/batches/${batch_id}/images/${currentImage.id}/spreadsheet`);
      return r.data;
    },
    enabled: !!currentImage && isSpreadsheet,
  });

  const [activeSheet, setActiveSheet] = useState(0);
  useEffect(() => setActiveSheet(0), [currentImage?.id]);

  const { data: records } = useQuery({
    queryKey: ['records', currentImage?.id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/${batch_id}/indexgenius/${currentImage.id}`);
      return response.data;
    },
    enabled: !!currentImage,
  });

  const extractMutation = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${project_id}/batches/${batch_id}/indexgenius/${currentImage.id}/extract`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records', currentImage.id] });
      queryClient.invalidateQueries({ queryKey: ['images', batch_id] });
    },
    onError: (err) => {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err.message;
      if (status === 503) {
        alert(`Gemini is overloaded right now.\n\n${detail}\n\nPlease click Re-extract in a minute.`);
      } else if (status === 429) {
        alert(`Gemini quota exhausted.\n\n${detail}`);
      } else if (!status && (err?.code === 'ERR_NETWORK' || /network/i.test(err?.message || ''))) {
        alert(
          'Network error reaching the backend.\n\n' +
            'AI extraction on large spreadsheets can take 1–2 minutes. ' +
            "If the request was cut off, give it another try — the server may " +
            "still be processing. Also confirm the backend is running on port 8000.",
        );
      } else if (err?.code === 'ECONNABORTED') {
        alert('The request timed out after 10 minutes. The spreadsheet may be too large — try splitting it into smaller files.');
      } else {
        alert(detail || 'Unknown error during AI extraction.');
      }
    },
  });

  const handleNext = () => currentImageIndex < images.length - 1 && setCurrentImageIndex((i) => i + 1);
  const handlePrev = () => currentImageIndex > 0 && setCurrentImageIndex((i) => i - 1);

  const record = records?.[0];
  const persons = record?.persons || [];
  const relations = record?.relations || [];
  const metadata = record?.metadata || [];

  const getPerson = (name) => persons.find((p) => p.name === name);

  // Group metadata by category
  const metaByCategory = {};
  metadata.forEach((m) => {
    const cat = (m.category || 'other').toLowerCase();
    (metaByCategory[cat] = metaByCategory[cat] || []).push(m);
  });
  const catOrder = [
    'date', 'place', 'name', 'occupation', 'age',
    'civil_status', 'religious', 'event', 'identifier',
    'language', 'military', 'medical', 'other',
  ];
  const orderedCats = [
    ...catOrder.filter((k) => metaByCategory[k]),
    ...Object.keys(metaByCategory).filter((k) => !catOrder.includes(k)),
  ];

  // Average overall confidence (for the banner)
  const allConfs = [
    ...persons.map((p) => p.confidence).filter((v) => v != null),
    ...relations.map((r) => r.confidence).filter((v) => v != null),
    ...metadata.map((m) => m.confidence).filter((v) => v != null),
  ];
  const avgConf = allConfs.length ? allConfs.reduce((s, v) => s + v, 0) / allConfs.length : null;

  const genderCounts = persons.reduce(
    (acc, p) => {
      acc[p.gender || 'U'] = (acc[p.gender || 'U'] || 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <div className="flex flex-col h-screen bg-surface-canvas">
      <StageProgress />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel — source: OCR text OR spreadsheet table */}
        <div className="flex-1 flex flex-col bg-surface-sunken border-r border-line overflow-hidden">
          <div className="p-4 border-b border-line bg-surface-raised flex justify-between items-center">
            <div className="flex items-center gap-2 min-w-0">
              {isSpreadsheet ? (
                <FileSpreadsheet size={16} className="text-emerald-600 shrink-0" />
              ) : (
                <Database size={16} className="text-brand-amber shrink-0" />
              )}
              <span className="text-xs font-mono text-ink-secondary truncate">
                {currentImage?.original_filename}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePrev}
                disabled={currentImageIndex === 0}
                className="p-1 hover:text-brand-amber disabled:opacity-30"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={handleNext}
                disabled={currentImageIndex === images?.length - 1}
                className="p-1 hover:text-brand-amber disabled:opacity-30"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>

          {isSpreadsheet ? (
            <SpreadsheetView spreadsheet={spreadsheet} active={activeSheet} setActive={setActiveSheet} />
          ) : (
            <div className="flex-1 p-8 overflow-y-auto">
              <div className="max-w-2xl mx-auto bg-surface p-8 shadow-warm-sm border border-line-subtle rounded-lg min-h-full font-mono text-sm leading-relaxed whitespace-pre-wrap">
                {ocrData?.current_text || (
                  <span className="text-ink-tertiary italic">No OCR text available for this image.</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel — AI-extracted graph */}
        <div className="w-[600px] flex flex-col bg-surface overflow-hidden">
          <div className="p-4 border-b border-line bg-surface-raised flex items-center justify-between">
            <h2 className="heading-section flex items-center gap-2">
              <Sparkles size={20} className="text-brand-amber" />
              AI-Extracted Graph
            </h2>
            <button
              onClick={() => extractMutation.mutate()}
              disabled={
                extractMutation.isPending ||
                (!isSpreadsheet && !ocrData?.current_text)
              }
              className="btn-primary text-xs py-1.5 flex items-center gap-1.5"
              title={
                isSpreadsheet
                  ? 'AI reads the full spreadsheet on the server (no need to wait for the preview)'
                  : 'Run Gemini on the OCR text'
              }
            >
              <Wand2 size={14} />
              {extractMutation.isPending ? 'Extracting…' : 'Re-extract'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {!record && !extractMutation.isPending ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-surface-sunken rounded-xl border-2 border-dashed border-line">
                <Sparkles size={40} className="text-brand-amber mb-4" />
                <p className="text-ink-secondary mb-2 max-w-sm">
                  Run AI extraction to map every person, every relationship, and every datum
                  in this document.
                </p>
                <p className="text-xs text-ink-tertiary mb-4 max-w-sm">
                  Powered by Gemini — no fixed templates, no rigid schema.
                </p>
                <button
                  onClick={() => extractMutation.mutate()}
                  disabled={!isSpreadsheet && !ocrData?.current_text}
                  className="btn-primary"
                >
                  Run AI Extraction
                </button>
              </div>
            ) : (
              <>
                {/* Truncation warning for very large spreadsheets */}
                {record?.additional_info?.truncated && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-3 text-sm text-amber-900">
                    <span className="text-base">⚠️</span>
                    <div>
                      <div className="font-semibold mb-0.5">Large spreadsheet — only the first rows were analysed</div>
                      <div className="text-xs">
                        {record.additional_info.rows_sent_to_ai} of{' '}
                        {record.additional_info.total_rows_in_file} rows sent to AI. Split the
                        file into smaller batches for full coverage.
                      </div>
                    </div>
                  </div>
                )}

                {/* Summary banner */}
                {(persons.length > 0 || relations.length > 0) && (
                  <div className="bg-gradient-to-r from-blue-50 via-cyan-50 to-blue-50 rounded-2xl p-4 border border-blue-100 flex items-center gap-4">
                    <div className="flex-1 grid grid-cols-3 gap-3 text-center">
                      <div>
                        <div className="text-xl font-bold font-display text-blue-700">{persons.length}</div>
                        <div className="text-[9px] uppercase tracking-widest text-ink-tertiary mt-0.5">persons</div>
                      </div>
                      <div className="border-x border-blue-100">
                        <div className="text-xl font-bold font-display text-blue-700">{relations.length}</div>
                        <div className="text-[9px] uppercase tracking-widest text-ink-tertiary mt-0.5">relations</div>
                      </div>
                      <div>
                        <div className="text-xl font-bold font-display text-blue-700">{metadata.length}</div>
                        <div className="text-[9px] uppercase tracking-widest text-ink-tertiary mt-0.5">metadata</div>
                      </div>
                    </div>
                    {avgConf != null && (
                      <div className="pl-4 border-l border-blue-100 text-right">
                        <div
                          className="text-2xl font-bold font-display tabular-nums"
                          style={{ color: `hsl(${avgConf * 130}, 70%, 40%)` }}
                        >
                          {Math.round(avgConf * 100)}%
                        </div>
                        <div className="text-[9px] uppercase tracking-widest text-ink-tertiary mt-0.5">avg conf</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Persons ────────────────────────────────────────────── */}
                {persons.length > 0 && (
                  <section>
                    <header className="flex items-center gap-2 mb-3 border-b border-line pb-2">
                      <Users size={16} className="text-brand-amber" />
                      <h3 className="text-sm font-semibold">People in this record</h3>
                      <span className="ml-auto flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-tertiary">
                        {genderCounts.M ? <span className="text-blue-600">{genderCounts.M} M</span> : null}
                        {genderCounts.F ? <span className="text-pink-600">{genderCounts.F} F</span> : null}
                        {genderCounts.U ? <span className="text-slate-500">{genderCounts.U} ?</span> : null}
                      </span>
                    </header>
                    <div className="grid grid-cols-1 gap-2">
                      {persons.map((p, i) => (
                        <PersonCard
                          key={i}
                          p={p}
                          isSelected={focusedName === p.name}
                          onSelect={(name) => setFocusedName((prev) => (prev === name ? null : name))}
                        />
                      ))}
                    </div>
                    {focusedName && (
                      <div className="mt-2 text-xs text-ink-tertiary italic flex items-center gap-1">
                        <Network size={11} />
                        Showing relations involving <span className="font-medium text-ink">{focusedName}</span>.
                        <button onClick={() => setFocusedName(null)} className="text-blue-700 hover:underline ml-1">
                          clear
                        </button>
                      </div>
                    )}
                  </section>
                )}

                {/* Relations / mapping ───────────────────────────────── */}
                {relations.length > 0 && (
                  <section>
                    <header className="flex items-center gap-2 mb-3 border-b border-line pb-2">
                      <Network size={16} className="text-brand-amber" />
                      <h3 className="text-sm font-semibold">Relationship mapping</h3>
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-tertiary">
                        {relations.length}
                      </span>
                    </header>
                    <div className="space-y-1.5">
                      {(focusedName
                        ? relations.filter((r) => r.person_a === focusedName || r.person_b === focusedName)
                        : relations
                      ).map((rel, i) => (
                        <RelationRow
                          key={i}
                          rel={rel}
                          getPerson={getPerson}
                          focusedName={focusedName}
                          onFocus={(name) => setFocusedName((prev) => (prev === name ? null : name))}
                        />
                      ))}
                      {focusedName &&
                        relations.filter(
                          (r) => r.person_a === focusedName || r.person_b === focusedName,
                        ).length === 0 && (
                          <div className="text-xs text-ink-tertiary italic p-2 text-center">
                            No relations involve {focusedName} in this record.
                          </div>
                        )}
                    </div>
                  </section>
                )}

                {/* Metadata ──────────────────────────────────────────── */}
                {metadata.length > 0 && (
                  <section>
                    <header className="flex items-center gap-2 mb-3 border-b border-line pb-2">
                      <Tag size={16} className="text-brand-amber" />
                      <h3 className="text-sm font-semibold">All metadata</h3>
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-tertiary">
                        {metadata.length}
                      </span>
                    </header>
                    <div className="space-y-3">
                      {orderedCats.map((cat) => (
                        <div key={cat}>
                          <div className="text-[9px] uppercase tracking-widest text-ink-tertiary font-bold mb-1.5">
                            {cat.replace(/_/g, ' ')}
                          </div>
                          <div className="space-y-1">
                            {metaByCategory[cat].map((m, i) => (
                              <div
                                key={i}
                                className="flex items-start gap-3 p-2 rounded-md bg-white border border-line-subtle hover:border-brand-amber transition-colors"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="text-[10px] uppercase tracking-wider text-ink-tertiary font-medium">
                                    {m.label}
                                  </div>
                                  <div className="text-sm text-ink mt-0.5 break-words">{m.value}</div>
                                  {m.notes && (
                                    <div className="text-[10px] text-ink-tertiary italic mt-0.5">{m.notes}</div>
                                  )}
                                </div>
                                <ConfBadge conf={m.confidence} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Empty (after extract returns nothing) */}
                {persons.length === 0 && relations.length === 0 && metadata.length === 0 && record && (
                  <div className="text-sm text-ink-tertiary italic text-center p-8">
                    AI didn't find any persons, relationships, or metadata in this OCR text. Try
                    re-running OCR or extracting again.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Continue button */}
          <div className="p-4 border-t border-line bg-surface-raised">
            <button
              onClick={() => navigate(`/projects/${project_id}/batches/${batch_id}/gedcomx`)}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2"
            >
              Continue to GedcomX
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SpreadsheetView — innovative tabular display for Excel / CSV uploads
// ─────────────────────────────────────────────────────────────────────────────
const SpreadsheetView = ({ spreadsheet, active, setActive }) => {
  if (!spreadsheet) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-tertiary text-sm">
        Loading spreadsheet…
      </div>
    );
  }
  const sheets = spreadsheet.sheets || [];
  if (!sheets.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-tertiary text-sm italic">
        Empty spreadsheet — no sheets found.
      </div>
    );
  }

  const sheet = sheets[active] || sheets[0];
  const cols = sheet.columns || [];
  const rows = sheet.rows || [];
  const totalRows = sheet.total_rows ?? rows.length;
  const truncated = !!sheet.preview_truncated;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="px-4 pt-3 pb-2 bg-surface-raised border-b border-line-subtle flex items-center gap-1 overflow-x-auto">
          <Layers size={13} className="text-ink-tertiary mr-1 shrink-0" />
          {sheets.map((s, i) => (
            <button
              key={s.name + i}
              onClick={() => setActive(i)}
              className={`px-3 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
                i === active
                  ? 'bg-emerald-600 text-white shadow-warm-sm'
                  : 'text-ink-secondary hover:bg-surface-sunken'
              }`}
            >
              {s.name}
              <span className="ml-1.5 opacity-70 text-[10px]">{s.total_rows ?? s.row_count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Quick stats banner */}
      <div className="px-4 py-2 bg-emerald-50/50 border-b border-emerald-100 text-xs text-emerald-900 flex items-center gap-4 flex-wrap">
        <span>
          <strong>{totalRows.toLocaleString()}</strong> rows
        </span>
        <span className="border-l border-emerald-200 pl-4">
          <strong>{cols.length}</strong> columns
        </span>
        <span className="border-l border-emerald-200 pl-4">{sheet.name}</span>
        {truncated && (
          <span className="ml-auto text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full text-[10px] font-medium">
            preview: first {rows.length.toLocaleString()} rows
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4 bg-surface-sunken">
        <div className="bg-surface rounded-lg border border-line-subtle shadow-warm-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-emerald-50 sticky top-0">
              <tr>
                <th className="text-left px-2 py-2 font-bold uppercase tracking-wider text-emerald-800 text-[10px] border-b-2 border-emerald-200 w-8">#</th>
                {cols.map((c) => (
                  <th
                    key={c}
                    className="text-left px-3 py-2 font-bold uppercase tracking-wider text-emerald-800 text-[10px] border-b-2 border-emerald-200 whitespace-nowrap"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className={`border-b border-line-subtle hover:bg-emerald-50/40 transition-colors ${
                    i % 2 === 0 ? 'bg-white' : 'bg-surface-raised'
                  }`}
                >
                  <td className="px-2 py-1.5 text-ink-tertiary text-[10px] tabular-nums">{i + 1}</td>
                  {cols.map((c) => (
                    <td key={c} className="px-3 py-1.5 align-top text-ink whitespace-pre-wrap">
                      {row[c] == null || row[c] === '' ? (
                        <span className="text-ink-tertiary italic">—</span>
                      ) : (
                        String(row[c])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 1} className="px-3 py-8 text-center text-ink-tertiary italic">
                    No data rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default IndexGenius;
