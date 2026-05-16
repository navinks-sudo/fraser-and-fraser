import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { assetUrl, apiUrl } from '../api/axios';
import ImageViewer from '../components/ImageViewer';
import SblLogo from '../components/SblLogo';
import FamilyGroupBanner from '../components/FamilyGroupBanner';
import FamilyGroupsPanel from '../components/FamilyGroupsPanel';
import {
  ArrowLeft, Upload, Trash2, FileSpreadsheet,
  CheckCircle2, AlertCircle, Loader2, GitBranch,
  Workflow, RotateCw, Download, ArrowRight, ChevronDown, Wand2,
} from 'lucide-react';

const BrandMark = ({ size = 42 }) => <SblLogo size={size} showTagline={false} />;

const Workspace = () => {
  const { project_id, batch_id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [viewingImage, setViewingImage] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Batch + images
  const { data: batch } = useQuery({
    queryKey: ['batch', batch_id],
    queryFn: async () => (await api.get(`/projects/${project_id}/batches/`)).data.find(b => b.id === parseInt(batch_id)),
  });
  const { data: images } = useQuery({
    queryKey: ['images', batch_id],
    queryFn: async () => (await api.get(`/projects/${project_id}/batches/${batch_id}/images/`)).data,
  });

  // Job status polling
  const { data: job } = useQuery({
    queryKey: ['process-status', batch_id],
    queryFn: async () => (await api.get(`/projects/${project_id}/batches/${batch_id}/process/status`)).data,
    refetchInterval: (query) =>
      query?.state?.data?.status === 'running' ? 1500 : false,
    refetchIntervalInBackground: false,
  });

  // Auto-build status polling — used to show "Tree auto-building…" in the
  // toolbar without the user clicking anything.
  const { data: autoStatus } = useQuery({
    queryKey: ['tree-build-status', batch_id],
    queryFn: async () =>
      (await api.get(`/projects/${project_id}/batches/${batch_id}/tree/build/status`)).data,
    refetchInterval: (query) =>
      query?.state?.data?.status === 'building' ? 2000 : 5000,
    refetchIntervalInBackground: false,
  });
  const isAutoBuilding = autoStatus?.status === 'building';

  // When the auto-build finishes, refresh batch (tree_built_at) so the View
  // tree button flips out of the "building" state automatically.
  useEffect(() => {
    if (autoStatus?.status === 'idle' && autoStatus?.last_built_at) {
      qc.invalidateQueries({ queryKey: ['batch', batch_id] });
    }
  }, [autoStatus?.last_built_at, autoStatus?.status, batch_id, qc]);

  useEffect(() => {
    if (job?.status && job.status.startsWith('complete')) {
      qc.invalidateQueries({ queryKey: ['batch', batch_id] });
      qc.invalidateQueries({ queryKey: ['images', batch_id] });
      qc.invalidateQueries({ queryKey: ['record-summary', batch_id] });
    }
  }, [job?.status, batch_id, qc]);

  const { data: recordSummary } = useQuery({
    queryKey: ['record-summary', batch_id],
    queryFn: async () => {
      if (!images?.length) return {};
      const out = {};
      await Promise.all(
        images.map(async (im) => {
          try {
            const r = await api.get(`/projects/${project_id}/batches/${batch_id}/indexgenius/${im.id}`);
            const rec = (r.data || [])[0];
            out[im.id] = {
              persons: rec?.persons?.length || 0,
              relations: rec?.relations?.length || 0,
              metadata: rec?.metadata?.length || 0,
            };
          } catch {
            out[im.id] = { persons: 0, relations: 0, metadata: 0 };
          }
        }),
      );
      return out;
    },
    enabled: !!images?.length,
  });

  const upload = useMutation({
    mutationFn: async (files) => {
      const fd = new FormData();
      for (let f of files) fd.append('files', f);
      return api.post(`/projects/${project_id}/batches/${batch_id}/images/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['images', batch_id] });
      setIsUploading(false);
    },
    onError: () => setIsUploading(false),
  });

  const processAll = useMutation({
    mutationFn: async () => api.post(`/projects/${project_id}/batches/${batch_id}/process`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['process-status', batch_id] }),
    onError: (err) => alert(err?.response?.data?.detail || 'Failed to start pipeline'),
  });

  const retryFailed = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${project_id}/batches/${batch_id}/retry-empty?scope=incomplete`),
    onSuccess: (res) => {
      if (res.data?.started === false && res.data?.message) {
        alert(res.data.message);
      }
      qc.invalidateQueries({ queryKey: ['process-status', batch_id] });
    },
    onError: (err) => alert(err?.response?.data?.detail || 'Failed to retry'),
  });

  // Force re-extraction on EVERY image (not just incomplete ones).
  // Use after a prompt upgrade — re-runs extract with the latest pipeline
  // against every record. Preserves OCR (no re-OCR cost).
  const reExtractAll = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${project_id}/batches/${batch_id}/retry-empty?scope=all`),
    onSuccess: (res) => {
      if (res.data?.started === false && res.data?.message) {
        alert(res.data.message);
      }
      qc.invalidateQueries({ queryKey: ['process-status', batch_id] });
    },
    onError: (err) => alert(err?.response?.data?.detail || 'Failed to re-extract'),
  });

  // Nuclear option: wipe ALL derived state (OCR + records + tree) and re-run
  // the entire pipeline from scratch using the latest multimodal extraction.
  // Image files themselves are NOT deleted — only AI-derived data.
  const startFresh = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${project_id}/batches/${batch_id}/reset-and-process`),
    onSuccess: (res) => {
      if (res.data?.started === false && res.data?.message) {
        alert(res.data.message);
      }
      qc.invalidateQueries({ queryKey: ['process-status', batch_id] });
      qc.invalidateQueries({ queryKey: ['batch', batch_id] });
      qc.invalidateQueries({ queryKey: ['images', batch_id] });
      qc.invalidateQueries({ queryKey: ['record-summary', batch_id] });
      qc.invalidateQueries({ queryKey: ['batch-tree-summary', batch_id] });
    },
    onError: (err) => alert(err?.response?.data?.detail || 'Reset failed'),
  });

  // Build the batch tree from whatever extractions exist now.
  // Useful when you don't want to re-run OCR/extract but DO want the tree
  // re-synthesised from the persons that are already in the DB.
  const buildTree = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${project_id}/batches/${batch_id}/tree/build`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batch', batch_id] });
      qc.invalidateQueries({ queryKey: ['batch-tree-summary', batch_id] });
      // Navigate straight to the tree once it's built
      navigate(`/projects/${project_id}/batches/${batch_id}/tree`);
    },
    onError: (err) => alert(err?.response?.data?.detail || 'Tree build failed'),
  });

  const deleteImage = useMutation({
    mutationFn: async (imageId) =>
      api.delete(`/projects/${project_id}/batches/${batch_id}/images/${imageId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['images', batch_id] }),
  });

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      setIsUploading(true);
      upload.mutate(e.dataTransfer.files);
    }
  }, [upload]);
  const handleFile = (e) => {
    if (e.target.files.length > 0) {
      setIsUploading(true);
      upload.mutate(e.target.files);
    }
  };

  const handleDeleteImage = (e, img) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${img.original_filename}"?`)) deleteImage.mutate(img.id);
  };

  const running = job?.status === 'running';
  // Add a half-step of "in progress" credit so the bar moves the moment a
  // step starts (instead of waiting until it finishes). 0 of 11 → 5%, 1 of 11
  // → 14%, etc. Floors at 100 once the pipeline completes.
  const pct = React.useMemo(() => {
    if (!job || !job.total) return 0;
    if (!running) return Math.round((job.done / job.total) * 100);
    const fractional = (job.done + 0.5) / job.total;
    return Math.min(99, Math.max(3, Math.round(fractional * 100)));
  }, [job, running]);

  // Aggregate richness for header summary cards
  const totals = React.useMemo(() => {
    if (!recordSummary) return { persons: 0, relations: 0, metadata: 0 };
    return Object.values(recordSummary).reduce((acc, v) => ({
      persons: acc.persons + v.persons,
      relations: acc.relations + v.relations,
      metadata: acc.metadata + v.metadata,
    }), { persons: 0, relations: 0, metadata: 0 });
  }, [recordSummary]);

  // How many images have INCOMPLETE extractions — meaning either:
  //   (a) errored or never ran
  //   (b) zero persons extracted
  //   (c) ≥2 persons but zero relations (tree-incomplete)
  // Drives the visibility of "Re-extract incomplete" button.
  const failedCount = React.useMemo(() => {
    if (!images?.length) return 0;
    return images.filter((img) => {
      if (img.file_type === 'spreadsheet') {
        if (img.indexgenius_status === 'error') return true;
      } else {
        if (img.textiq_status !== 'done') return false;
        if (img.indexgenius_status === 'error') return true;
        if (img.indexgenius_status !== 'done') return false;
      }
      const persons = recordSummary?.[img.id]?.persons ?? 0;
      const relations = recordSummary?.[img.id]?.relations ?? 0;
      // No persons → broken
      if (persons === 0) return true;
      // 2+ persons but no relations → tree-incomplete
      if (persons >= 2 && relations === 0) return true;
      return false;
    }).length;
  }, [images, recordSummary]);

  return (
    <div className="min-h-screen bg-surface-canvas" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      {/* ───── Top bar (matches MainLayout style but self-contained) ───── */}
      <header className="sticky top-0 z-30 bg-surface-canvas/90 backdrop-blur border-b border-line-subtle">
        <div className="max-w-[1400px] mx-auto px-8 h-20 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-3 group"
            title="Back to home"
          >
            <BrandMark size={44} />
            <div className="leading-none text-left">
              <div className="font-display font-extrabold text-[17px] tracking-tight text-navy-800">SBL Knowledge Services</div>
              <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-orange-500 mt-1">Workspace</div>
            </div>
          </button>
          <button
            onClick={() => navigate(`/projects/${project_id}`)}
            className="btn-secondary flex items-center gap-2 text-[13px]"
          >
            <ArrowLeft size={14} /> Back to project
          </button>
        </div>
      </header>

      {/* ───── Hero block ───── */}
      <section className="max-w-[1400px] mx-auto px-8 pt-10 pb-6">
        <div className="eyebrow eyebrow-rule mb-5">Batch · Workspace</div>
        <div className="grid lg:grid-cols-[1.3fr_1fr] gap-8 items-end">
          <div>
            <h1 className="display-heading text-4xl lg:text-5xl">
              {batch?.name || 'Workspace'}
              <span className="italic-accent text-[26px] lg:text-[30px] block mt-2">
                {images?.length || 0} files · process, inspect, export.
              </span>
            </h1>
            {batch?.tree_built_at && (
              <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12px] font-semibold">
                <CheckCircle2 size={14} />
                Tree built {new Date(batch.tree_built_at).toLocaleDateString()}
              </div>
            )}
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap gap-2.5 justify-end">
            <label className="btn-secondary flex items-center gap-2 cursor-pointer text-[13px]">
              <Upload size={14} />
              {isUploading ? 'Uploading…' : 'Upload files'}
              <input
                type="file" multiple className="hidden"
                onChange={handleFile} disabled={isUploading}
                accept="image/*,.xlsx,.xls,.csv,.tsv,.pdf"
              />
            </label>

            <button
              onClick={() => processAll.mutate()}
              disabled={running || !images?.length}
              className="group inline-flex items-center gap-2.5 bg-navy-800 hover:bg-navy-900 disabled:opacity-50 disabled:hover:bg-navy-800 text-white text-[13px] font-semibold pl-4 pr-2 py-2 rounded-md shadow-warm-md transition-all"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Workflow size={14} />}
              <span>{running ? 'Processing…' : 'Process all'}</span>
              <span className="w-7 h-7 rounded-md bg-orange-500 group-hover:bg-orange-600 flex items-center justify-center transition-colors">
                <ArrowRight size={12} strokeWidth={2.5} />
              </span>
            </button>

            {/* Nuclear option — wipes all derived data and reprocesses everything */}
            {(images?.length || 0) > 0 && (
              <button
                onClick={() => {
                  if (window.confirm(
                    `Start FROM SCRATCH on all ${images.length} images?\n\n` +
                    `This will DELETE every OCR transcription, every extracted ` +
                    `record (persons, relations, metadata), and the current ` +
                    `family tree for this batch. Your uploaded image files are NOT ` +
                    `affected.\n\n` +
                    `Then the full pipeline (OCR → multimodal extraction → tree) ` +
                    `will run again from zero.\n\n` +
                    `Continue?`
                  )) {
                    startFresh.mutate();
                  }
                }}
                disabled={running}
                className="inline-flex items-center gap-2 text-[13px] font-semibold px-3 py-2 rounded-md border border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300 disabled:opacity-50 transition-colors"
                title="Wipe all OCR/extractions/tree and re-run the full pipeline from scratch"
              >
                {startFresh.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Start fresh
              </button>
            )}

            {failedCount > 0 && (
              <button
                onClick={() => retryFailed.mutate()}
                disabled={running}
                className="group inline-flex items-center gap-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-[13px] font-semibold pl-4 pr-2 py-2 rounded-md shadow-warm-md transition-all"
                title={`${failedCount} image${failedCount !== 1 ? 's' : ''} extracted with NO persons or NO relations — retry only those (preserves OCR, multimodal vision pass)`}
              >
                <Wand2 size={14} />
                <span>Re-extract {failedCount} incomplete</span>
                <span className="w-7 h-7 rounded-md bg-white/15 group-hover:bg-white/25 flex items-center justify-center transition-colors">
                  <ArrowRight size={12} strokeWidth={2.5} />
                </span>
              </button>
            )}

            {/* Force re-extract on every image — use after prompt upgrades */}
            {(images?.length || 0) > 0 && (
              <button
                onClick={() => {
                  if (window.confirm(
                    `Re-run extraction on ALL ${images.length} images?\n\n` +
                    `This uses the latest multimodal (image + OCR) prompt, ` +
                    `preserves OCR (no re-OCR cost), and overwrites every record's ` +
                    `extracted persons/relations/metadata.\n\n` +
                    `Existing OCR text and image files are untouched.`
                  )) {
                    reExtractAll.mutate();
                  }
                }}
                disabled={running}
                className="btn-secondary flex items-center gap-2 text-[13px] disabled:opacity-50"
                title="Force-rerun multimodal extraction on every image in the batch"
              >
                <Wand2 size={14} className={reExtractAll.isPending ? 'animate-pulse' : ''} />
                Re-extract all
              </button>
            )}

            {/* Normalise relations across ALL records — runs the scalar-fields
                safety-net (no AI cost) on every image in the batch and
                rebuilds the tree. Cheap; instant fix for missing father/
                mother/spouse edges. */}
            {totals.persons > 0 && (
              <button
                onClick={() => buildTree.mutate()}
                disabled={buildTree.isPending || running || isAutoBuilding}
                className="btn-secondary flex items-center gap-2 text-[13px] disabled:opacity-50"
                title="Re-derive parent/spouse relations from scalar fields for EVERY image in this batch and rebuild the tree (no AI cost)"
              >
                <Wand2 size={14} className={buildTree.isPending ? 'animate-pulse' : ''} />
                {buildTree.isPending ? 'Normalising…' : 'Normalise relations'}
              </button>
            )}

            {/* View tree button — four states:
                - Auto-build in progress → show "Tree auto-building…" pulse
                - Tree already built     → "View tree"
                - Persons exist but no tree (auto-build not yet fired or failed)
                  → "Build & view tree" manual fallback
                - Nothing extracted yet  → disabled */}
            {isAutoBuilding ? (
              <button
                disabled
                className="inline-flex items-center gap-2.5 bg-orange-500/90 text-white text-[13px] font-semibold pl-4 pr-3 py-2 rounded-md shadow-warm-md cursor-wait"
                title="AI is synthesising the family tree from your extractions"
              >
                <Wand2 size={14} className="animate-pulse" />
                <span>Auto-building tree…</span>
              </button>
            ) : batch?.tree_built_at ? (
              <button
                onClick={() => navigate(`/projects/${project_id}/batches/${batch_id}/tree`)}
                className="btn-secondary flex items-center gap-2 text-[13px]"
                title="Open the family tree"
              >
                <GitBranch size={14} />
                View tree
              </button>
            ) : totals.persons > 0 ? (
              <button
                onClick={() => buildTree.mutate()}
                disabled={buildTree.isPending || running}
                className="group inline-flex items-center gap-2.5 bg-navy-800 hover:bg-navy-900 disabled:opacity-50 text-white text-[13px] font-semibold pl-4 pr-2 py-2 rounded-md shadow-warm-md transition-all"
                title={`Build the family tree from the ${totals.persons} extracted ${totals.persons === 1 ? 'person' : 'persons'} and open it`}
              >
                {buildTree.isPending ? <Loader2 size={14} className="animate-spin" /> : <GitBranch size={14} />}
                <span>{buildTree.isPending ? 'Building tree…' : 'Build & view tree'}</span>
                <span className="w-7 h-7 rounded-md bg-orange-500 group-hover:bg-orange-600 flex items-center justify-center transition-colors">
                  <ArrowRight size={12} strokeWidth={2.5} />
                </span>
              </button>
            ) : (
              <button
                disabled
                className="btn-secondary flex items-center gap-2 text-[13px] opacity-50"
                title="No persons extracted yet — run Process all or Re-extract first"
              >
                <GitBranch size={14} />
                View tree
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setExportOpen((v) => !v)}
                className="btn-secondary flex items-center gap-2 text-[13px] disabled:opacity-50"
                disabled={!batch?.tree_built_at}
              >
                <Download size={14} />
                Export
                <ChevronDown size={12} />
              </button>
              {exportOpen && batch?.tree_built_at && (
                <div className="absolute right-0 top-full mt-2 bg-surface border border-line-subtle shadow-warm-lg rounded-md py-1 min-w-[220px] z-30">
                  <a href={apiUrl(`projects/${project_id}/batches/${batch_id}/export.ged`)}
                     target="_blank" rel="noreferrer"
                     className="block px-4 py-2.5 text-[12px] hover:bg-orange-50">
                    <div className="font-bold text-navy-800">GEDCOM (.ged)</div>
                    <div className="text-[10px] text-ink-tertiary mt-0.5">For FamilySearch, Ancestry, Gramps…</div>
                  </a>
                  <a href={apiUrl(`projects/${project_id}/batches/${batch_id}/export.json`)}
                     target="_blank" rel="noreferrer"
                     className="block px-4 py-2.5 text-[12px] hover:bg-orange-50 border-t border-line-subtle">
                    <div className="font-bold text-navy-800">GedcomX JSON</div>
                    <div className="text-[10px] text-ink-tertiary mt-0.5">For developers / re-import</div>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stat strip */}
        {(images?.length || 0) > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line-subtle border border-line-subtle rounded-md overflow-hidden mt-8">
            {[
              { label: 'Files',     value: images?.length || 0,    hint: 'documents in batch' },
              { label: 'Persons',   value: totals.persons,         hint: 'extracted by AI' },
              { label: 'Relations', value: totals.relations,       hint: 'parent · spouse · child' },
              { label: 'Metadata',  value: totals.metadata,        hint: 'dates · places · roles' },
            ].map((s) => (
              <div key={s.label} className="bg-surface px-6 py-5">
                <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-ink-tertiary">{s.label}</div>
                <div className="font-display font-extrabold text-3xl text-navy-800 tabular-nums mt-1">{s.value}</div>
                <div className="text-[11px] text-ink-tertiary mt-0.5">{s.hint}</div>
              </div>
            ))}
          </div>
        )}

        {/* Progress */}
        {job && job.status !== 'idle' && (
          <div className="mt-6 bg-surface rounded-md border border-line-subtle p-5 shadow-warm-sm">
            <div className="flex items-center justify-between text-[13px] mb-2">
              <span className="flex items-center gap-2 font-semibold text-navy-800">
                {running
                  ? <Loader2 size={14} className="animate-spin text-orange-500" />
                  : job.status?.startsWith('complete')
                    ? <CheckCircle2 size={14} className="text-emerald-600" />
                    : <AlertCircle size={14} className="text-red-600" />}
                {running ? `Step ${job.done + 1} / ${job.total}` : job.status?.startsWith('complete') ? 'Pipeline complete' : 'Pipeline error'}
                {job.current_stage && (
                  <span className="text-ink-tertiary font-normal ml-1">· {job.current_stage}{job.current_image_id ? ` · image #${job.current_image_id}` : ''}</span>
                )}
              </span>
              <span className="text-ink-tertiary tabular-nums font-semibold">{pct}%</span>
            </div>
            <div className="relative h-1.5 bg-surface-raised rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-orange-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
              {/* Leading edge pulse — shows the bar is "live" even when the
                  percentage hasn't ticked over yet. */}
              {running && (
                <div
                  className="absolute inset-y-0 w-1 bg-orange-300 animate-pulse"
                  style={{ left: `calc(${pct}% - 2px)` }}
                />
              )}
            </div>
            {job.errors?.length > 0 && (
              <div className="mt-2 text-[11px] text-red-700">
                {job.errors.length} error{job.errors.length > 1 ? 's' : ''} —{' '}
                {job.errors.slice(0, 2).map((e, i) => (
                  <span key={i} className="mr-2">{e.stage}{e.image_id ? ` #${e.image_id}` : ''}: {e.error?.slice(0, 60)}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ───── Thumbnail grid ───── */}
      <section className="max-w-[1400px] mx-auto px-8 pb-14">
        {!images?.length ? (
          <div className="border-2 border-dashed border-line rounded-md bg-surface-raised p-16 text-center mt-6">
            <div className="w-14 h-14 rounded-md bg-orange-100 text-orange-500 flex items-center justify-center mx-auto mb-5">
              <Upload size={22} />
            </div>
            <h3 className="font-display font-extrabold text-2xl text-navy-800 mb-2">Drop files anywhere on this page</h3>
            <p className="text-ink-secondary mb-5">Images (JPG, PNG, TIFF, WEBP), PDFs, and spreadsheets (.xlsx, .csv).</p>
            <label className="btn-orange inline-flex items-center gap-2 cursor-pointer">
              <Upload size={14} /> Choose files
              <input type="file" multiple className="hidden" onChange={handleFile} accept="image/*,.xlsx,.xls,.csv,.tsv,.pdf" />
            </label>
          </div>
        ) : (
          <>
            <FamilyGroupBanner
              projectId={project_id}
              batchId={batch_id}
              images={images}
            />
            <FamilyGroupsPanel
              projectId={project_id}
              batchId={batch_id}
              images={images}
            />
            <div className="flex items-center justify-between mt-2 mb-4">
              <div className="eyebrow">Files in batch</div>
              <div className="text-[12px] text-ink-tertiary">Click a thumbnail to inspect OCR, insights, and tree contribution.</div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
              {images.map((img) => (
                <Thumb
                  key={img.id}
                  img={img}
                  summary={recordSummary?.[img.id]}
                  onOpen={() => img.file_type === 'spreadsheet' ? null : setViewingImage(img)}
                  onDelete={(e) => handleDeleteImage(e, img)}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {viewingImage && (
        <ImageViewer
          image={viewingImage}
          images={(images || []).filter((i) => i.file_type !== 'spreadsheet')}
          projectId={project_id}
          batchId={batch_id}
          onClose={() => setViewingImage(null)}
          onNavigate={(img) => setViewingImage(img)}
        />
      )}
    </div>
  );
};

const STAGE_BADGES = [
  { key: 'textiq_status',      label: 'OCR' },
  { key: 'indexgenius_status', label: 'EXT' },
  { key: 'gedcomx_status',     label: 'GX' },
];

// Same fixed palette as backend `_color_for` so frontend can compute the
// ribbon colour for any group_id without a round-trip.
const GROUP_COLORS = [
  '#E25E10', '#1F8AE6', '#5BB12F', '#9333EA', '#0EA5A4', '#DB2777',
];
const colorForGroup = (gid) => {
  if (!gid) return null;
  let h = 0;
  for (let i = 0; i < gid.length; i++) h = (h * 31 + gid.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
};

const Thumb = ({ img, summary, onOpen, onDelete }) => {
  const isSheet = img.file_type === 'spreadsheet';
  const rotation = img.rotation || 0;
  const personsFound = summary?.persons ?? 0;
  const extState = img.indexgenius_status === 'done'
    ? (personsFound > 0 ? 'done' : 'empty')
    : img.indexgenius_status;
  const groupColor = colorForGroup(img.family_group_id);
  return (
    <div
      onClick={onOpen}
      className="group relative aspect-[3/4] bg-white border border-line-subtle rounded-md overflow-hidden cursor-pointer hover:border-orange-500 hover:shadow-warm-md transition-all"
      style={groupColor ? { borderColor: groupColor, boxShadow: `0 0 0 1px ${groupColor}33` } : undefined}
      title={img.family_group_label ? `Part of ${img.family_group_label}` : undefined}
    >
      {groupColor && (
        // Top stripe + label badge — same colour as ribbon so the group is
        // visually identifiable at a glance across the file grid.
        <>
          <div
            className="absolute top-0 inset-x-0 h-1.5 z-10"
            style={{ background: groupColor }}
          />
          <span
            className="absolute top-2 left-1.5 z-10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.18em] rounded text-white shadow-warm-xs"
            style={{ background: groupColor }}
          >
            {img.family_group_label || 'group'}
          </span>
        </>
      )}
      {isSheet ? (
        <div className="h-full flex flex-col items-center justify-center p-2 bg-gradient-to-br from-orange-50 to-orange-100 text-orange-900">
          <FileSpreadsheet size={36} strokeWidth={1.4} className="text-orange-600 mb-2" />
          <div className="text-[9px] uppercase tracking-widest font-semibold">Spreadsheet</div>
          {img.spreadsheet_summary && (
            <div className="text-[10px] text-orange-800 mt-1 text-center">
              {img.spreadsheet_summary.row_count} rows
            </div>
          )}
        </div>
      ) : (
        <img
          src={assetUrl(img.original_path)}
          alt={img.original_filename}
          className="w-full h-full object-cover"
          style={{ transform: `rotate(${rotation}deg)` }}
        />
      )}

      <div className="absolute bottom-0 inset-x-0 p-1.5 bg-gradient-to-t from-navy-900/80 to-transparent">
        <p className="text-[10px] text-white truncate font-mono">{img.original_filename}</p>
      </div>

      <div className="absolute top-1.5 right-1.5 flex flex-col gap-0.5 items-end">
        {STAGE_BADGES.map(({ key, label }) => {
          let s = img[key];
          if (key === 'indexgenius_status') s = extState;
          const color =
            s === 'done' ? 'bg-emerald-500 text-white' :
            s === 'empty' ? 'bg-navy-300 text-white' :
            s === 'error' ? 'bg-red-500 text-white' :
            s === 'skipped' ? 'bg-navy-200 text-navy-700' :
            'bg-orange-400/90 text-white';
          const titleText = key === 'indexgenius_status' && s === 'empty'
            ? 'EXT: extracted but no persons/relations found (poor OCR / table format)'
            : `${label}: ${s}`;
          return (
            <span key={key} className={`px-1 py-0 text-[8px] font-bold rounded ${color}`} title={titleText}>
              {label}
            </span>
          );
        })}
        {personsFound > 0 && (
          <span className="px-1 py-0 text-[8px] font-bold rounded bg-navy-800 text-white"
                title={`${personsFound} person${personsFound !== 1 ? 's' : ''} extracted`}>
            {personsFound}♟
          </span>
        )}
      </div>

      <button
        onClick={onDelete}
        className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-white/90 text-red-600 opacity-0 group-hover:opacity-100 hover:bg-red-600 hover:text-white flex items-center justify-center transition-all"
        title="Delete file"
      >
        <Trash2 size={12} />
      </button>

      {rotation !== 0 && (
        <span className="absolute bottom-7 left-1.5 px-1 py-0 text-[8px] bg-white/90 rounded font-mono text-ink-secondary flex items-center gap-0.5">
          <RotateCw size={8} /> {rotation}°
        </span>
      )}
    </div>
  );
};

export default Workspace;
