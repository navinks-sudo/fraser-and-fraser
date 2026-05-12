import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import StageProgress from '../components/Layout/StageProgress';
import {
  FileText, Wand2, Save, ChevronLeft, ChevronRight, RotateCcw,
  ScanLine, Eye, EyeOff, Languages,
} from 'lucide-react';

// Innovative confidence colour scheme — smooth HSL gradient
//   1.00 → vivid green   (hue 130)
//   0.80 → soft yellow   (hue 70)
//   0.60 → orange        (hue 30)
//   0.30 → red           (hue 0)
// Background opacity scales inversely with confidence so uncertain words
// "stand out" while certain ones are essentially transparent.
const confStyle = (c) => {
  if (c == null) return null;
  const v = Math.max(0, Math.min(1, c));
  const hue = v * 130;                  // 0 = red, 130 = green
  const bgL = 92 - (1 - v) * 6;         // 92% → 86%
  const bgA = (1 - v) * 0.7 + 0.05;     // ≥0.05 always so a hint of color shows
  const fgL = 25 + v * 8;               // darker text for low confidence
  return {
    backgroundColor: `hsla(${hue}, 75%, ${bgL}%, ${bgA})`,
    color: `hsl(${hue}, 60%, ${fgL}%)`,
    boxShadow: v < 0.6 ? `inset 0 -2px 0 hsl(${hue}, 75%, 55%)` : undefined,
    borderRadius: 3,
    padding: '1px 2px',
    transition: 'all 0.15s',
  };
};

// Per-character heat dots — toggle via prop
const charStyle = (c) => {
  if (c == null) return null;
  const v = Math.max(0, Math.min(1, c));
  const hue = v * 130;
  return {
    backgroundColor: `hsla(${hue}, 80%, 88%, ${(1 - v) * 0.85 + 0.1})`,
    color: `hsl(${hue}, 60%, ${22 + v * 8}%)`,
  };
};

const ConfidenceText = ({ words, chars, fallbackText, charLevel = false }) => {
  // Character-level rendering — every char a span, colour-coded
  if (charLevel && chars && chars.length > 0) {
    return (
      <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
        {chars.map((ch, i) => (
          <span
            key={i}
            style={charStyle(ch.conf)}
            title={`${(ch.conf * 100).toFixed(0)}%`}
          >
            {ch.text}
          </span>
        ))}
      </pre>
    );
  }

  if (!words || words.length === 0) {
    return <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">{fallbackText || ''}</pre>;
  }

  const text = fallbackText || '';
  const out = [];
  let cursor = 0;
  words.forEach((w, idx) => {
    if (w.start > cursor) {
      out.push(<span key={`gap-${idx}`}>{text.slice(cursor, w.start)}</span>);
    }
    out.push(
      <span
        key={`w-${idx}`}
        style={confStyle(w.conf)}
        title={`${(w.conf * 100).toFixed(0)}% confidence`}
      >
        {w.text}
      </span>
    );
    cursor = w.end;
  });
  if (cursor < text.length) {
    out.push(<span key="tail">{text.slice(cursor)}</span>);
  }
  return <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">{out}</pre>;
};

const TextIQ = () => {
  const { project_id, batch_id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [editableText, setEditableText] = useState('');
  const [showRegions, setShowRegions] = useState(true);
  const [activeRegion, setActiveRegion] = useState(null); // null = whole page
  const [editMode, setEditMode] = useState(false);
  const [viewMode, setViewMode] = useState('original'); // 'original' | 'translation'
  const [charLevel, setCharLevel] = useState(false);
  const imgRef = useRef(null);

  const { data: images } = useQuery({
    queryKey: ['images', batch_id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/${batch_id}/images/`);
      return response.data;
    }
  });

  const currentImage = images?.[currentImageIndex];
  const isSheet = currentImage?.file_type === 'spreadsheet';

  const { data: ocrData } = useQuery({
    queryKey: ['ocr', currentImage?.id],
    queryFn: async () => {
      if (!currentImage) return null;
      const response = await api.get(`/projects/${project_id}/batches/${batch_id}/textiq/${currentImage.id}`);
      return response.data;
    },
    enabled: !!currentImage,
  });

  const { data: regionsData } = useQuery({
    queryKey: ['regions', currentImage?.id],
    queryFn: async () => {
      if (!currentImage) return null;
      const res = await api.get(`/projects/${project_id}/batches/${batch_id}/textiq/${currentImage.id}/regions`);
      return res.data;
    },
    enabled: !!currentImage,
  });

  const ocrRegions = ocrData?.regions || [];
  const detectedRegions = regionsData?.regions || [];

  // Pick which regions to render: prefer OCR-augmented (text + confidence), else detected (bbox only)
  const displayRegions = ocrRegions.length > 0 ? ocrRegions : detectedRegions;

  useEffect(() => {
    setActiveRegion(null);
    setEditMode(false);
    setViewMode('original');
  }, [currentImage?.id]);

  useEffect(() => {
    if (activeRegion == null) {
      setEditableText(ocrData?.current_text || '');
    } else {
      const r = ocrRegions.find((x) => x.index === activeRegion);
      setEditableText(r?.text || '');
    }
  }, [ocrData, activeRegion, ocrRegions]);

  const segmentMutation = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${project_id}/batches/${batch_id}/textiq/${currentImage.id}/segment`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regions', currentImage.id] });
      queryClient.invalidateQueries({ queryKey: ['images', batch_id] });
    },
    onError: (err) => alert(err?.response?.data?.detail || err.message),
  });

  const processMutation = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${project_id}/batches/${batch_id}/textiq/${currentImage.id}/process`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ocr', currentImage.id] });
      queryClient.invalidateQueries({ queryKey: ['images', batch_id] });
    },
    onError: (err) => alert(err?.response?.data?.detail || err.message),
  });

  const processRegionsMutation = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${project_id}/batches/${batch_id}/textiq/${currentImage.id}/process-regions`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ocr', currentImage.id] });
      queryClient.invalidateQueries({ queryKey: ['images', batch_id] });
    },
    onError: (err) => alert(err?.response?.data?.detail || err.message),
  });

  const translateMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({ target: 'en' });
      if (activeRegion != null) params.set('region_index', String(activeRegion));
      return api.post(
        `/projects/${project_id}/batches/${batch_id}/textiq/${currentImage.id}/translate?${params}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ocr', currentImage.id] });
      setViewMode('translation');
    },
    onError: (err) => alert(err?.response?.data?.detail || err.message),
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      api.put(
        `/projects/${project_id}/batches/${batch_id}/textiq/${currentImage.id}?text=${encodeURIComponent(editableText)}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ocr', currentImage.id] });
      setEditMode(false);
    },
  });

  const handleNext = () => {
    if (currentImageIndex < images.length - 1) setCurrentImageIndex((i) => i + 1);
  };
  const handlePrev = () => {
    if (currentImageIndex > 0) setCurrentImageIndex((i) => i - 1);
  };

  const activeRegionData = useMemo(
    () => (activeRegion != null ? ocrRegions.find((r) => r.index === activeRegion) : null),
    [activeRegion, ocrRegions]
  );

  const displayedTranslation =
    activeRegion != null ? activeRegionData?.translation_en : ocrData?.translation_en;
  const displayedLanguage =
    activeRegion != null ? activeRegionData?.language_detected : ocrData?.language_detected;
  const displayedWords = activeRegion != null ? activeRegionData?.words : null;
  const displayedText =
    activeRegion != null ? activeRegionData?.text || '' : ocrData?.current_text || '';
  const avgConf = activeRegion != null ? activeRegionData?.avg_confidence : null;
  const lowConfCount = activeRegion != null ? activeRegionData?.low_confidence_count : null;

  if (isSheet) {
    return (
      <div className="flex flex-col h-screen bg-surface-canvas">
        <StageProgress />
        <div className="flex-1 flex items-center justify-center p-8 bg-gradient-to-br from-emerald-50 to-teal-100">
          <div className="bg-white rounded-2xl shadow-warm-md border border-emerald-200 p-8 max-w-md text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 mx-auto flex items-center justify-center mb-4">
              <span className="text-2xl">📊</span>
            </div>
            <h2 className="heading-section mb-2">Spreadsheet — TextIQ skipped</h2>
            <p className="text-ink-secondary text-sm mb-6">
              No OCR is needed for tabular data. Continue to AI extraction.
            </p>
            <button
              onClick={() => navigate(`/projects/${project_id}/batches/${batch_id}/indexgenius`)}
              className="btn-primary flex items-center justify-center gap-2 mx-auto"
            >
              Continue to IndexGenius
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-surface-canvas">
      <StageProgress />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Image Viewer with region overlay */}
        <div className="flex-1 bg-surface-sunken border-r border-line flex items-center justify-center p-8 relative overflow-hidden">
          <div className="absolute top-4 left-4 text-ink-tertiary text-xs font-mono bg-white/80 px-2 py-1 rounded z-30">
            {currentImage?.original_filename}
          </div>

          <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
            <button
              onClick={() => segmentMutation.mutate()}
              disabled={segmentMutation.isPending || !currentImage}
              className="btn-secondary text-xs py-1.5 flex items-center gap-1.5"
              title="Detect record regions on this page"
            >
              <ScanLine size={14} />
              {segmentMutation.isPending ? 'Detecting…' : 'Detect Regions'}
            </button>
            {detectedRegions.length > 0 && (
              <button
                onClick={() => setShowRegions((v) => !v)}
                className="btn-ghost text-xs py-1.5 flex items-center gap-1.5"
                title={showRegions ? 'Hide region overlay' : 'Show region overlay'}
              >
                {showRegions ? <EyeOff size={14} /> : <Eye size={14} />}
                {detectedRegions.length} regions
              </button>
            )}
          </div>

          <div className="relative inline-block">
            <img
              ref={imgRef}
              src={`http://localhost:8000/${currentImage?.enhanced_path || currentImage?.original_path}`}
              alt="Document"
              className="max-h-[calc(100vh-180px)] max-w-full shadow-lg rounded border border-line-subtle block"
            />
            {showRegions && detectedRegions.length > 0 && regionsData?.image_width > 0 && (
              <div className="absolute inset-0 pointer-events-none">
                {detectedRegions.map((r) => {
                  const W = regionsData.image_width || 1;
                  const H = regionsData.image_height || 1;
                  const [x1, y1, x2, y2] = r.bbox;
                  const isActive = activeRegion === r.index;
                  return (
                    <button
                      key={r.index}
                      onClick={() => setActiveRegion(isActive ? null : r.index)}
                      style={{
                        position: 'absolute',
                        left: `${(x1 / W) * 100}%`,
                        top: `${(y1 / H) * 100}%`,
                        width: `${((x2 - x1) / W) * 100}%`,
                        height: `${((y2 - y1) / H) * 100}%`,
                      }}
                      className={`pointer-events-auto rounded-sm transition-all ${
                        isActive
                          ? 'border-[3px] border-brand-amber-dark bg-brand-amber/20'
                          : 'border-2 border-brand-amber bg-brand-amber/5 hover:bg-brand-amber/15'
                      }`}
                      title={r.summary || `Region ${r.index}`}
                    >
                      <span className={`absolute -top-3 -left-1 text-white text-[10px] font-medium px-1.5 py-0.5 rounded shadow-warm-sm ${
                        isActive ? 'bg-brand-amber-dark' : 'bg-brand-amber'
                      }`}>
                        {r.index}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="absolute bottom-8 flex gap-4 z-30">
            <button onClick={handlePrev} disabled={currentImageIndex === 0} className="w-10 h-10 rounded-full bg-white shadow-warm-md text-ink hover:text-brand-amber flex items-center justify-center disabled:opacity-30 transition-all">
              <ChevronLeft size={20} />
            </button>
            <button onClick={handleNext} disabled={currentImageIndex === images?.length - 1} className="w-10 h-10 rounded-full bg-white shadow-warm-md text-ink hover:text-brand-amber flex items-center justify-center disabled:opacity-30 transition-all">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Right Panel - Region tabs + OCR text */}
        <div className="w-[540px] flex flex-col bg-surface">
          <div className="p-4 border-b border-line bg-surface-raised">
            <div className="flex items-center justify-between mb-3">
              <h2 className="heading-section flex items-center gap-2">
                <FileText size={20} className="text-brand-amber" />
                Transcribed Text
              </h2>
              <div className="flex gap-2">
                {detectedRegions.length > 0 ? (
                  <button
                    onClick={() => processRegionsMutation.mutate()}
                    disabled={processRegionsMutation.isPending}
                    className="btn-secondary text-xs py-1.5 flex items-center gap-1.5"
                    title="Run OCR on every detected region"
                  >
                    <Wand2 size={14} />
                    {processRegionsMutation.isPending ? 'Processing…' : 'OCR Regions'}
                  </button>
                ) : (
                  <button
                    onClick={() => processMutation.mutate()}
                    disabled={processMutation.isPending}
                    className="btn-secondary text-xs py-1.5 flex items-center gap-1.5"
                    title="OCR the full page (no segmentation)"
                  >
                    <Wand2 size={14} />
                    {processMutation.isPending ? 'Processing…' : 'Run OCR'}
                  </button>
                )}
                <button
                  onClick={() => translateMutation.mutate()}
                  disabled={translateMutation.isPending || !displayedText}
                  className="btn-secondary text-xs py-1.5 flex items-center gap-1.5"
                  title="Translate to English"
                >
                  <Languages size={14} />
                  {translateMutation.isPending ? 'Translating…' : 'Translate'}
                </button>
              </div>
            </div>

            {/* Region selector */}
            {displayRegions.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setActiveRegion(null)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    activeRegion === null
                      ? 'bg-brand-amber text-white'
                      : 'bg-surface text-ink-secondary hover:bg-surface-sunken'
                  }`}
                >
                  Whole page
                </button>
                {displayRegions.map((r) => (
                  <button
                    key={r.index}
                    onClick={() => setActiveRegion(r.index)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      activeRegion === r.index
                        ? 'bg-brand-amber text-white'
                        : 'bg-surface text-ink-secondary hover:bg-surface-sunken'
                    }`}
                    title={r.summary}
                  >
                    R{r.index}
                  </button>
                ))}
              </div>
            )}

            {/* View mode toggle */}
            {(displayedTranslation || viewMode === 'translation') && (
              <div className="flex gap-1 mt-3 border-t border-line-subtle pt-3">
                <button
                  onClick={() => setViewMode('original')}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    viewMode === 'original'
                      ? 'bg-ink text-white'
                      : 'bg-surface text-ink-secondary hover:bg-surface-sunken'
                  }`}
                >
                  Original{displayedLanguage ? ` (${displayedLanguage})` : ''}
                </button>
                <button
                  onClick={() => setViewMode('translation')}
                  disabled={!displayedTranslation}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    viewMode === 'translation'
                      ? 'bg-ink text-white'
                      : 'bg-surface text-ink-secondary hover:bg-surface-sunken disabled:opacity-40'
                  }`}
                >
                  English
                </button>
              </div>
            )}
          </div>

          {/* Confidence summary */}
          {viewMode === 'original' && avgConf != null && (
            <div className="px-4 py-2 bg-surface-raised border-b border-line-subtle text-xs text-ink-tertiary flex items-center justify-between gap-2">
              <span>
                Avg confidence:{' '}
                <strong style={{ color: `hsl(${avgConf * 130}, 70%, 40%)` }}>
                  {(avgConf * 100).toFixed(0)}%
                </strong>
              </span>
              <div className="flex items-center gap-3">
                {lowConfCount > 0 && (
                  <span className="text-amber-700">{lowConfCount} low-conf words</span>
                )}
                <div className="flex gap-1 bg-surface-sunken rounded p-0.5">
                  <button
                    onClick={() => setCharLevel(false)}
                    className={`px-2 py-0.5 text-[10px] rounded ${!charLevel ? 'bg-brand-amber text-white' : 'text-ink-tertiary'}`}
                  >
                    Word
                  </button>
                  <button
                    onClick={() => setCharLevel(true)}
                    className={`px-2 py-0.5 text-[10px] rounded ${charLevel ? 'bg-brand-amber text-white' : 'text-ink-tertiary'}`}
                  >
                    Char
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            {viewMode === 'translation' ? (
              <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-ink">
                {displayedTranslation || ''}
              </pre>
            ) : !displayedText && !processMutation.isPending && !processRegionsMutation.isPending ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-surface-sunken rounded-xl border-2 border-dashed border-line">
                <Wand2 size={40} className="text-ink-tertiary mb-4" />
                <p className="text-ink-secondary mb-4">
                  {detectedRegions.length > 0
                    ? `${detectedRegions.length} regions ready. Run OCR per region for confidence-scored transcription.`
                    : 'No OCR yet. Detect regions for per-record OCR, or just run page-level OCR.'}
                </p>
                <button
                  onClick={() =>
                    detectedRegions.length > 0
                      ? processRegionsMutation.mutate()
                      : processMutation.mutate()
                  }
                  className="btn-primary"
                >
                  {detectedRegions.length > 0 ? 'OCR All Regions' : 'Run Page OCR'}
                </button>
              </div>
            ) : editMode ? (
              <textarea
                value={editableText}
                onChange={(e) => setEditableText(e.target.value)}
                className="w-full h-full p-3 font-mono text-sm bg-surface-sunken border border-line rounded-md focus:outline-none focus:border-line-accent resize-none leading-relaxed"
                placeholder="Edit transcribed text…"
              />
            ) : (
              <ConfidenceText
                words={displayedWords}
                chars={activeRegion != null ? activeRegionData?.chars : ocrRegions[0]?.chars}
                fallbackText={displayedText}
                charLevel={charLevel}
              />
            )}
          </div>

          <div className="p-4 border-t border-line bg-surface-raised flex flex-col gap-3 text-xs text-ink-tertiary">
            <div className="flex justify-between items-center">
              <span>{(displayedText || '').length} characters</span>
              <div className="flex items-center gap-3">
                {ocrData?.has_edits && (
                  <span className="flex items-center gap-1 text-brand-amber">
                    <RotateCcw size={12} />
                    Edited
                  </span>
                )}
                {viewMode === 'original' && (
                  editMode ? (
                    <button onClick={() => saveMutation.mutate()} className="btn-primary text-xs py-1 flex items-center gap-1.5">
                      <Save size={12} />
                      Save
                    </button>
                  ) : (
                    <button onClick={() => setEditMode(true)} className="btn-ghost text-xs py-1">
                      Edit
                    </button>
                  )
                )}
              </div>
            </div>
            <button
              onClick={() => navigate(`/projects/${project_id}/batches/${batch_id}/indexgenius`)}
              className="btn-primary w-full py-2 flex items-center justify-center gap-2"
            >
              Continue to Extraction
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TextIQ;
