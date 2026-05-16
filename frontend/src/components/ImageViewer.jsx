import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import {
  X, RotateCw, RotateCcw, ZoomIn, ZoomOut, Maximize2,
  ChevronLeft, ChevronRight, Download, FileText, Users, Network,
  ChevronsRight, ChevronsLeft, Wand2, Copy, Check, GitBranch,
  Tag, ArrowRight, MapPin, Calendar, Briefcase, Heart, Sparkles,
} from 'lucide-react';
import api, { assetUrl } from '../api/axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import SblLogo from './SblLogo';

// Gender palette — harmonised with the new navy + orange brand.
// Male = navy, Female = warm orange, Unknown = warm grey.
const GENDER_PALETTE = {
  M: { ring: '#0B1F3A', soft: '#DDE3ED', deep: '#0B1F3A', label: 'Male',    symbol: '♂' },
  F: { ring: '#E25E10', soft: '#FDEADA', deep: '#7C2F06', label: 'Female',  symbol: '♀' },
  U: { ring: '#8A8470', soft: '#EFEBE1', deep: '#5B6478', label: 'Unknown', symbol: '?' },
};

// Section accent palettes — distinct visual identity per panel.
const PALETTE_OCR     = { ink: '#7C2F06', bg: '#FFF5EC', border: '#FBD0AC', button: '#C84F0D' };
const PALETTE_INSIGHT = { ink: '#0B1F3A', bg: '#F2F4F8', border: '#DDE3ED', button: '#0B1F3A' };
const PALETTE_TREE    = { ink: '#7C2F06', bg: '#FDEADA', border: '#FBD0AC', button: '#E25E10' };

const ImageViewer = ({ image, images, projectId, batchId, onClose, onNavigate }) => {
  const [localRotation, setLocalRotation] = useState(image?.rotation || 0);
  const [showPanel, setShowPanel] = useState(true);
  const [copied, setCopied] = useState(false);
  const [activeSection, setActiveSection] = useState('all'); // 'all' | 'ocr' | 'insights' | 'tree'
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    setLocalRotation(image?.rotation || 0);
    setCopied(false);
  }, [image?.id]);

  const { data: ocr } = useQuery({
    queryKey: ['ocr', image?.id],
    queryFn: async () =>
      (await api.get(`/projects/${projectId}/batches/${batchId}/textiq/${image.id}`)).data,
    enabled: !!image,
  });

  const { data: records } = useQuery({
    queryKey: ['records', image?.id],
    queryFn: async () =>
      (await api.get(`/projects/${projectId}/batches/${batchId}/indexgenius/${image.id}`)).data,
    enabled: !!image,
  });
  const record = records?.[0];

  const { data: batchTree } = useQuery({
    queryKey: ['batch-tree-summary', batchId],
    queryFn: async () => (await api.get(`/projects/${projectId}/batches/${batchId}/tree/data`)).data,
  });

  const rotateMutation = useMutation({
    mutationFn: async ({ degrees }) =>
      api.post(`/projects/${projectId}/batches/${batchId}/images/${image.id}/rotate?degrees=${degrees}`),
    onSuccess: (res) => {
      setLocalRotation(res.data.rotation);
      qc.invalidateQueries({ queryKey: ['images', String(batchId)] });
    },
  });

  const ocrMutation = useMutation({
    mutationFn: async () => api.post(`/projects/${projectId}/batches/${batchId}/textiq/${image.id}/process`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr', image.id] });
      qc.invalidateQueries({ queryKey: ['images', String(batchId)] });
    },
    onError: (err) => alert(err?.response?.data?.detail || 'OCR failed'),
  });

  const extractMutation = useMutation({
    mutationFn: async () => api.post(`/projects/${projectId}/batches/${batchId}/indexgenius/${image.id}/extract`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['records', image.id] });
      qc.invalidateQueries({ queryKey: ['images', String(batchId)] });
      qc.invalidateQueries({ queryKey: ['record-summary', batchId] });
    },
    onError: (err) => alert(err?.response?.data?.detail || 'Extraction failed'),
  });

  const copyOcr = async () => {
    if (!ocr?.current_text) return;
    try {
      await navigator.clipboard.writeText(ocr.current_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  if (!image) return null;
  const idx = images.findIndex((i) => i.id === image.id);
  const canPrev = idx > 0;
  const canNext = idx < images.length - 1;

  const personCount = record?.persons?.length || 0;
  const relationCount = record?.relations?.length || 0;
  const metaCount = record?.metadata?.length || 0;
  const ocrLen = ocr?.current_text?.length || 0;
  const treePersons = batchTree?.persons_count || 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#07142A' }}>
      {/* ───── Top bar ───── */}
      <div className="flex items-center justify-between px-5 py-3 text-white text-[12px] shrink-0 border-b border-white/8"
           style={{ background: 'rgba(7, 20, 42, 0.92)', backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-white/95 shrink-0">
            <SblLogo size={28} showTagline={false} />
          </div>
          <span className="font-mono truncate text-white/90">{image.original_filename}</span>
          <span className="text-white/30">·</span>
          <span className="text-white/60">{idx + 1} of {images.length}</span>
          {localRotation ? <span className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] uppercase tracking-wider">{localRotation}°</span> : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowPanel((v) => !v)}
            className="px-2 h-8 hover:bg-white/10 rounded flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
            title={showPanel ? 'Hide insights panel' : 'Show insights panel'}
          >
            {showPanel ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
            <span>Insights</span>
          </button>
          <button onClick={onClose} className="w-8 h-8 hover:bg-white/10 rounded flex items-center justify-center" title="Close">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* ───── Image canvas (left) ───── */}
        <div className="flex-1 relative overflow-hidden"
             style={{ background: 'radial-gradient(ellipse at center, #142849 0%, #07142A 80%)' }}>
          {/* dot grid */}
          <div
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)',
              backgroundSize: '6px 6px',
            }}
          />
          <TransformWrapper
            key={`${image.id}-${localRotation}`}
            initialScale={1}
            minScale={0.2}
            maxScale={6}
            centerOnInit
            wheel={{ step: 0.15 }}
            doubleClick={{ mode: 'reset' }}
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <div className="absolute top-3 left-3 z-30 flex flex-col bg-navy-900/70 backdrop-blur rounded-md overflow-hidden border border-white/10">
                  <button onClick={() => zoomIn()} className="w-9 h-9 hover:bg-orange-500 text-white flex items-center justify-center transition-colors" title="Zoom in"><ZoomIn size={16} /></button>
                  <button onClick={() => zoomOut()} className="w-9 h-9 hover:bg-orange-500 text-white flex items-center justify-center border-t border-white/10 transition-colors" title="Zoom out"><ZoomOut size={16} /></button>
                  <button onClick={() => resetTransform()} className="w-9 h-9 hover:bg-orange-500 text-white flex items-center justify-center border-t border-white/10 transition-colors" title="Reset"><Maximize2 size={16} /></button>
                </div>

                <div className="absolute top-3 right-3 z-30 flex flex-col bg-navy-900/70 backdrop-blur rounded-md overflow-hidden border border-white/10">
                  <button onClick={() => rotateMutation.mutate({ degrees: -90 })} disabled={rotateMutation.isPending}
                          className="w-9 h-9 hover:bg-orange-500 text-white flex items-center justify-center transition-colors" title="Rotate left">
                    <RotateCcw size={16} />
                  </button>
                  <button onClick={() => rotateMutation.mutate({ degrees: 90 })} disabled={rotateMutation.isPending}
                          className="w-9 h-9 hover:bg-orange-500 text-white flex items-center justify-center border-t border-white/10 transition-colors" title="Rotate right">
                    <RotateCw size={16} />
                  </button>
                  <a href={assetUrl(image.enhanced_path || image.original_path)}
                     download={image.original_filename} target="_blank" rel="noreferrer"
                     className="w-9 h-9 hover:bg-orange-500 text-white flex items-center justify-center border-t border-white/10 transition-colors"
                     title="Download original">
                    <Download size={16} />
                  </a>
                </div>

                <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%' }}>
                  <div className="w-full h-full flex items-center justify-center">
                    <img
                      src={assetUrl(image.enhanced_path || image.original_path)}
                      alt={image.original_filename}
                      style={{
                        maxWidth: '92vw',
                        maxHeight: '82vh',
                        transform: `rotate(${localRotation}deg)`,
                        transformOrigin: 'center',
                        transition: 'transform 0.2s ease',
                        boxShadow: '0 30px 60px rgba(0,0,0,0.6)',
                      }}
                    />
                  </div>
                </TransformComponent>
              </>
            )}
          </TransformWrapper>

          <button onClick={() => canPrev && onNavigate(images[idx - 1])} disabled={!canPrev}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-md bg-navy-900/60 hover:bg-orange-500 disabled:opacity-20 disabled:cursor-not-allowed text-white flex items-center justify-center backdrop-blur border border-white/10 transition-colors">
            <ChevronLeft size={22} />
          </button>
          <button onClick={() => canNext && onNavigate(images[idx + 1])} disabled={!canNext}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-md bg-navy-900/60 hover:bg-orange-500 disabled:opacity-20 disabled:cursor-not-allowed text-white flex items-center justify-center backdrop-blur border border-white/10 transition-colors">
            <ChevronRight size={22} />
          </button>
        </div>

        {/* ───── Insights drawer (right) ───── */}
        {showPanel && (
          <div className="w-[480px] bg-surface-canvas text-ink flex flex-col border-l border-line-subtle shadow-2xl">
            {/* Tab strip */}
            <div className="px-3 pt-3 pb-2 bg-surface border-b border-line-subtle flex gap-1">
              <TabBtn icon={Sparkles}  label="All"      active={activeSection === 'all'}      onClick={() => setActiveSection('all')} />
              <TabBtn icon={FileText}  label="OCR"      count={ocrLen ? `${(ocrLen / 1000).toFixed(1)}k` : null} active={activeSection === 'ocr'}      onClick={() => setActiveSection('ocr')} />
              <TabBtn icon={Users}     label="Insights" count={personCount || null} active={activeSection === 'insights'} onClick={() => setActiveSection('insights')} />
              <TabBtn icon={GitBranch} label="Tree"     count={treePersons || null} active={activeSection === 'tree'}     onClick={() => setActiveSection('tree')} />
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* ═══ OCR SECTION (paper aesthetic — warm orange) ═══ */}
              {(activeSection === 'all' || activeSection === 'ocr') && (
                <section className="m-3">
                  <SectionHeader
                    icon={FileText}
                    palette={PALETTE_OCR}
                    title="OCR Transcription"
                    subtitle={ocrLen ? `${ocrLen.toLocaleString()} characters captured` : 'Not yet transcribed'}
                    action={
                      <>
                        {ocr?.current_text && (
                          <button onClick={copyOcr}
                                  className="w-7 h-7 rounded flex items-center justify-center"
                                  style={{ color: PALETTE_OCR.ink, background: 'rgba(124, 47, 6, 0.06)' }}
                                  title="Copy to clipboard">
                            {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                          </button>
                        )}
                        <button onClick={() => ocrMutation.mutate()} disabled={ocrMutation.isPending}
                                className="text-[11px] font-semibold py-1 px-2.5 rounded text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1 uppercase tracking-wider"
                                style={{ background: PALETTE_OCR.button }}>
                          <Wand2 size={11} />
                          {ocrMutation.isPending ? '…' : ocr?.current_text ? 'Re-OCR' : 'Run OCR'}
                        </button>
                      </>
                    }
                  />
                  <div className="rounded-b-md p-4 max-h-[480px] overflow-y-auto border border-t-0"
                       style={{
                         background: '#FFFBF4',
                         borderColor: PALETTE_OCR.border,
                         backgroundImage: 'linear-gradient(transparent 95%, rgba(124, 47, 6, 0.07) 95%)',
                         backgroundSize: '100% 18px',
                       }}>
                    {ocr?.current_text ? (
                      <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-[18px] text-stone-800">
                        {ocr.current_text}
                      </pre>
                    ) : (
                      <div className="text-xs italic py-8 text-center" style={{ color: PALETTE_OCR.ink + 'aa' }}>
                        No OCR yet. Click <strong>Run OCR</strong> or hit <strong>Process all</strong> on the workspace.
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* ═══ INSIGHTS SECTION (data-card — navy) ═══ */}
              {(activeSection === 'all' || activeSection === 'insights') && (
                <section className="m-3">
                  <SectionHeader
                    icon={Users}
                    palette={PALETTE_INSIGHT}
                    title="Extracted Insights"
                    subtitle={
                      record
                        ? `${personCount} ${plural('person', personCount)} · ${relationCount} ${plural('relation', relationCount)} · ${metaCount} metadata`
                        : 'AI extraction not yet run'
                    }
                    action={
                      <button onClick={() => extractMutation.mutate()} disabled={extractMutation.isPending || !ocr?.current_text}
                              className="text-[11px] font-semibold py-1 px-2.5 rounded text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1 uppercase tracking-wider"
                              style={{ background: PALETTE_INSIGHT.button }}>
                        <Wand2 size={11} />
                        {extractMutation.isPending ? '…' : record ? 'Re-extract' : 'Extract'}
                      </button>
                    }
                  />
                  <div className="rounded-b-md p-3 space-y-3 border border-t-0"
                       style={{ background: '#F8F6F1', borderColor: PALETTE_INSIGHT.border }}>
                    {!record ? (
                      <div className="text-xs italic py-6 text-center text-navy-500">
                        Run AI extraction to pull persons, relations and metadata from the OCR.
                      </div>
                    ) : personCount === 0 ? (
                      <div className="text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded p-3">
                        <strong>No entities found.</strong> The OCR may be too noisy or in an
                        unfamiliar format. Try clicking <strong>Re-extract</strong> after improving the OCR.
                      </div>
                    ) : (
                      <>
                        {/* Persons */}
                        <div>
                          <SubHeader icon={Users} label={`Persons · ${personCount}`} />
                          <div className="grid grid-cols-2 gap-1.5">
                            {record.persons.map((p, i) => {
                              const pal = GENDER_PALETTE[p.gender] || GENDER_PALETTE.U;
                              return (
                                <div key={i}
                                     className="bg-surface border rounded-md p-2 flex items-center gap-2 shadow-warm-xs"
                                     style={{ borderColor: pal.ring + '40' }}>
                                  <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 font-bold text-[12px]"
                                       style={{ backgroundColor: pal.soft, color: pal.deep, border: `1.5px solid ${pal.ring}` }}>
                                    {pal.symbol}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs font-semibold truncate text-navy-800">{p.name}</div>
                                    {p.role && (
                                      <div className="text-[9px] uppercase tracking-wider text-ink-tertiary">
                                        {p.role.replace(/_/g, ' ')}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Relations */}
                        {relationCount > 0 && (
                          <div>
                            <SubHeader icon={Network} label={`Relations · ${relationCount}`} />
                            <div className="bg-surface border border-line-subtle rounded-md overflow-hidden">
                              {record.relations.map((r, i) => (
                                <div key={i} className={`flex items-center gap-1.5 px-2 py-1.5 text-[11px] ${i > 0 ? 'border-t border-line-subtle' : ''}`}>
                                  <span className="font-medium truncate flex-1 text-right text-navy-800">{r.person_a}</span>
                                  <span className="px-1.5 py-0 rounded text-[9px] font-bold tracking-wider uppercase bg-orange-100 text-orange-800 whitespace-nowrap">
                                    {(r.type || '').replace(/_/g, ' ')}
                                  </span>
                                  <ArrowRight size={10} className="text-ink-tertiary shrink-0" />
                                  <span className="font-medium truncate flex-1 text-navy-800">{r.person_b}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Metadata */}
                        {metaCount > 0 && (
                          <div>
                            <SubHeader icon={Tag} label={`Metadata · ${metaCount}`} />
                            <MetadataPanel items={record.metadata} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>
              )}

              {/* ═══ TREE CONTRIBUTION SECTION ═══ */}
              {(activeSection === 'all' || activeSection === 'tree') && (
                <ImageTreeContribution
                  record={record}
                  batchTree={batchTree}
                  projectId={projectId}
                  batchId={batchId}
                  onOpenTree={() => navigate(`/projects/${projectId}/batches/${batchId}/tree`)}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ───── Bottom thumbnail strip ───── */}
      <div className="px-4 py-2 flex gap-1 overflow-x-auto border-t border-white/10 shrink-0"
           style={{ background: 'rgba(7, 20, 42, 0.92)' }}>
        {images.map((im) => (
          <button key={im.id} onClick={() => onNavigate(im)}
                  className={`shrink-0 w-14 h-14 rounded-md overflow-hidden border-2 transition-all ${
                    im.id === image.id ? 'border-orange-500 shadow-lg' : 'border-transparent opacity-45 hover:opacity-100'
                  }`}
                  title={im.original_filename}>
            {im.file_type === 'spreadsheet' ? (
              <div className="w-full h-full bg-gradient-to-br from-orange-200 to-orange-400 flex items-center justify-center text-2xl">📊</div>
            ) : (
              <img
                src={assetUrl(im.enhanced_path || im.original_path)}
                alt=""
                className="w-full h-full object-cover"
                style={{ transform: `rotate(${im.rotation || 0}deg)` }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

// ─── helpers ──────────────────────────────────────────────────────────────

const plural = (s, n) => `${s}${n === 1 ? '' : 's'}`;

const TabBtn = ({ icon: Icon, label, count, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex-1 px-2 py-1.5 text-[11px] font-semibold rounded-md flex items-center justify-center gap-1.5 transition-all uppercase tracking-wider ${
      active ? 'bg-navy-800 text-white shadow-warm-sm' : 'text-ink-secondary hover:bg-surface-raised'
    }`}
  >
    <Icon size={12} />
    {label}
    {count != null && (
      <span className={`text-[9px] tabular-nums px-1 rounded ${active ? 'bg-orange-500 text-white' : 'bg-line-subtle text-ink-secondary'}`}>
        {count}
      </span>
    )}
  </button>
);

const SectionHeader = ({ icon: Icon, palette, title, subtitle, action }) => (
  <div
    className="rounded-t-md px-3 py-2.5 flex items-center justify-between border border-b-0"
    style={{ backgroundColor: palette.bg, borderColor: palette.border }}
  >
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
           style={{ background: palette.button, color: '#fff' }}>
        <Icon size={13} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em]" style={{ color: palette.ink }}>{title}</div>
        <div className="text-[10px]" style={{ color: palette.ink + 'cc' }}>{subtitle}</div>
      </div>
    </div>
    <div className="flex items-center gap-1 shrink-0">{action}</div>
  </div>
);

const SubHeader = ({ icon: Icon, label }) => (
  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-ink-tertiary font-bold mb-1.5 mt-0.5">
    <Icon size={10} />
    {label}
  </div>
);

const MetadataPanel = ({ items }) => {
  const grouped = items.reduce((acc, m) => {
    const k = (m.category || 'other').toLowerCase();
    (acc[k] = acc[k] || []).push(m);
    return acc;
  }, {});
  const order = ['name', 'date', 'place', 'occupation', 'age', 'civil_status', 'religious', 'event', 'identifier', 'other'];
  const cats = [...order.filter((k) => grouped[k]), ...Object.keys(grouped).filter((k) => !order.includes(k))];
  const iconFor = { date: Calendar, place: MapPin, occupation: Briefcase, religious: Heart };
  return (
    <div className="space-y-2">
      {cats.map((cat) => {
        const Icon = iconFor[cat] || Tag;
        return (
          <div key={cat}>
            <div className="text-[9px] uppercase tracking-[0.18em] text-orange-600 font-bold mb-1 flex items-center gap-1">
              <Icon size={9} /> {cat.replace(/_/g, ' ')}
            </div>
            <div className="bg-surface border border-line-subtle rounded-md overflow-hidden">
              {grouped[cat].map((m, i) => (
                <div key={i} className={`flex items-start gap-2 px-2 py-1.5 text-[11px] ${i > 0 ? 'border-t border-line-subtle' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-ink-tertiary uppercase tracking-wider">{m.label}</div>
                    <div className="text-navy-800 font-medium truncate">{m.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Image-specific tree contribution ────────────────────────────────────
const ImageTreeContribution = ({ record, batchTree, projectId, batchId, onOpenTree }) => {
  const persons = record?.persons || [];
  const treeData = batchTree?.gedcomx || batchTree?.tree;
  const qc = useQueryClient();

  // Poll the auto-build worker so we can show "Tree auto-building…" without
  // the user having to click anything. Polls every 2s while building; stops
  // when idle.
  const { data: autoStatus } = useQuery({
    queryKey: ['tree-build-status', batchId],
    queryFn: async () =>
      (await api.get(`/projects/${projectId}/batches/${batchId}/tree/build/status`)).data,
    refetchInterval: (query) =>
      query?.state?.data?.status === 'building' ? 2000 : false,
    refetchIntervalInBackground: false,
  });
  const isAutoBuilding = autoStatus?.status === 'building';

  // When the auto-build finishes, refresh the batch-tree summary so the
  // section flips out of the "tree not built yet" state automatically.
  React.useEffect(() => {
    if (autoStatus?.status === 'idle' && autoStatus?.last_built_at) {
      qc.invalidateQueries({ queryKey: ['batch-tree-summary', batchId] });
      qc.invalidateQueries({ queryKey: ['batch', batchId] });
    }
  }, [autoStatus?.last_built_at, autoStatus?.status, batchId, qc]);

  // Manual fallback if the auto-build hasn't fired (very rare — only if the
  // AI key wasn't configured at the moment extraction ran).
  const buildTreeMutation = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${projectId}/batches/${batchId}/tree/build`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batch-tree-summary', batchId] });
      qc.invalidateQueries({ queryKey: ['batch', batchId] });
      onOpenTree?.();
    },
    onError: (err) => alert(err?.response?.data?.detail || 'Tree build failed'),
  });

  const treePersons = React.useMemo(() => {
    if (!treeData) return [];
    const names = new Set();
    const walk = (n) => {
      if (!n) return;
      if (n.name && !n.attributes?.type?.startsWith('Root')) names.add(n.name);
      for (const c of n.children || []) walk(c);
    };
    walk(batchTree?.tree);
    return [...names];
  }, [batchTree, treeData]);

  const matchedPersons = persons.filter((p) =>
    treePersons.some((tn) => tn.toLowerCase().includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(tn.toLowerCase())),
  );
  const unmatchedPersons = persons.filter((p) => !matchedPersons.includes(p));
  const treeBuilt = !!batchTree?.persons_count;
  const hasPersons = persons.length > 0;

  return (
    <section className="m-3">
      <SectionHeader
        icon={GitBranch}
        palette={PALETTE_TREE}
        title="This image in the family tree"
        subtitle={
          isAutoBuilding
            ? 'Auto-building family tree from your extractions…'
            : !treeBuilt
            ? hasPersons
              ? `${persons.length} ${plural('person', persons.length)} ready · tree will auto-build`
              : 'Tree not built yet'
            : persons.length === 0
            ? 'No persons extracted from this image yet'
            : `${matchedPersons.length} of ${persons.length} ${plural('person', persons.length)} connected to the tree`
        }
      />
      <div className="border border-t-0 rounded-b-md p-4"
           style={{ background: '#FFF5EC', borderColor: PALETTE_TREE.border }}>
        {isAutoBuilding ? (
          // Auto-build worker is running — show a calm "stay tuned" status,
          // no manual button needed. Section flips automatically when done.
          <div className="py-2">
            <div className="flex items-center gap-3 mb-3">
              <Wand2 size={16} className="text-orange-500 animate-pulse" />
              <div className="text-sm font-semibold text-orange-800">
                AI is weaving your family tree
              </div>
            </div>
            <div className="h-1.5 bg-orange-200/60 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-orange-500 animate-pulse" style={{ width: '60%' }} />
            </div>
            <div className="text-[11px] text-orange-700/85 leading-relaxed">
              Deduplicating persons across every record and inferring parent /
              spouse / child links. This usually takes 5–20 seconds depending
              on batch size.
            </div>
          </div>
        ) : !treeBuilt ? (
          hasPersons ? (
            // Persons exist but no tree yet — auto-build should already be
            // queued from the extract endpoint. Show a brief explainer +
            // manual rebuild fallback in case the queue didn't catch.
            <>
              <div className="text-xs text-orange-800/85 mb-3 leading-relaxed">
                This image contributed <strong>{persons.length}</strong>{' '}
                {plural('person', persons.length)}. The tree builds
                automatically after each extraction — if it doesn't appear
                within a few seconds, click below.
              </div>
              <button
                onClick={() => buildTreeMutation.mutate()}
                disabled={buildTreeMutation.isPending}
                className="group w-full inline-flex items-center justify-between bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold text-sm pl-4 pr-2 py-2.5 rounded-md shadow-warm-md transition-all"
              >
                <span className="flex items-center gap-2">
                  {buildTreeMutation.isPending ? <Wand2 size={14} className="animate-pulse" /> : <Sparkles size={14} />}
                  {buildTreeMutation.isPending ? 'Building family tree…' : 'Force rebuild now'}
                </span>
                <span className="w-7 h-7 rounded-md bg-white/15 group-hover:bg-white/25 flex items-center justify-center transition-colors">
                  <ArrowRight size={12} strokeWidth={2.5} />
                </span>
              </button>
              {autoStatus?.last_error && (
                <div className="text-[10px] text-red-700 italic mt-2">
                  Last auto-build error: {autoStatus.last_error}
                </div>
              )}
            </>
          ) : (
            <div className="text-xs italic py-3 text-center text-orange-800/80">
              Run AI extract above to identify persons in this image first —
              the tree will auto-build once any record has persons.
            </div>
          )
        ) : persons.length === 0 ? (
          <div className="text-xs italic py-3 text-center text-orange-800/80">
            Run AI extract above to identify persons in this image first.
          </div>
        ) : (
          <>
            {matchedPersons.length > 0 && (
              <div className="mb-3">
                <div className="text-[9px] uppercase tracking-[0.2em] text-emerald-700 font-bold mb-1.5 flex items-center gap-1">
                  <Check size={9} /> In the tree
                </div>
                <div className="space-y-1">
                  {matchedPersons.map((p, i) => {
                    const pal = GENDER_PALETTE[p.gender] || GENDER_PALETTE.U;
                    return (
                      <div key={i}
                           className="flex items-center gap-2 bg-surface border border-emerald-200 rounded-md px-2 py-1.5 shadow-warm-xs">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center font-bold text-[10px] shrink-0"
                             style={{ backgroundColor: pal.soft, color: pal.deep, border: `1.5px solid ${pal.ring}` }}>
                          {pal.symbol}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate text-navy-800">{p.name}</div>
                          {p.role && <div className="text-[9px] uppercase tracking-wider text-ink-tertiary">{p.role.replace(/_/g, ' ')}</div>}
                        </div>
                        <span className="text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
                          linked
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {unmatchedPersons.length > 0 && (
              <div className="mb-3">
                <div className="text-[9px] uppercase tracking-[0.2em] text-orange-700 font-bold mb-1.5">
                  Mentioned, not yet linked
                </div>
                <div className="space-y-1">
                  {unmatchedPersons.map((p, i) => (
                    <div key={i} className="text-[11px] text-navy-800 bg-white/70 border border-orange-200 rounded-md px-2 py-1">
                      <span className="font-medium">{p.name}</span>
                      {p.role && <span className="text-ink-tertiary ml-1.5">· {p.role.replace(/_/g, ' ')}</span>}
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-orange-700 italic mt-1.5">
                  These weren't found in the merged tree. Rebuild the tree to include them.
                </div>
              </div>
            )}

            {/* Tree-wide stats */}
            <div className="grid grid-cols-2 gap-2 mb-3 pt-3 border-t border-orange-200">
              <div className="bg-surface border border-orange-200 rounded-md p-2.5 text-center">
                <div className="text-2xl font-display font-extrabold text-navy-800 tabular-nums">{batchTree.persons_count}</div>
                <div className="text-[9px] uppercase tracking-[0.2em] text-ink-tertiary mt-0.5">total in tree</div>
              </div>
              <div className="bg-surface border border-orange-200 rounded-md p-2.5 text-center">
                <div className="text-2xl font-display font-extrabold text-navy-800 tabular-nums">{batchTree.relationships_count}</div>
                <div className="text-[9px] uppercase tracking-[0.2em] text-ink-tertiary mt-0.5">connections</div>
              </div>
            </div>

            <button
              onClick={onOpenTree}
              className="group w-full inline-flex items-center justify-between bg-navy-800 hover:bg-navy-900 text-white font-semibold text-sm pl-4 pr-2 py-2.5 rounded-md shadow-warm-md transition-all"
            >
              <span className="flex items-center gap-2">
                <GitBranch size={14} />
                Open full family tree
              </span>
              <span className="w-7 h-7 rounded-md bg-orange-500 group-hover:bg-orange-600 flex items-center justify-center transition-colors">
                <ArrowRight size={12} strokeWidth={2.5} />
              </span>
            </button>
          </>
        )}
      </div>
    </section>
  );
};

export default ImageViewer;
