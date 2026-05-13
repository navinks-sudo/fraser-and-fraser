import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import StageProgress from '../components/Layout/StageProgress';
import { gedcomxToD3 } from '../utils/gedcomxToD3';
import PedigreeChart from '../components/Tree/PedigreeChart';
import Tree from 'react-d3-tree';
import {
  Network, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2,
  User, UserRound, Heart, TreeDeciduous, Users, HelpCircle, Sparkles,
  X, Calendar, MapPin, Briefcase, ArrowUpRight,
  Edit3, Save, Trash2, Plus, ImageIcon, Eye, EyeOff, Download,
  ArrowDown, ArrowRight,
} from 'lucide-react';

const GENDER_PALETTE = {
  M: { ring: '#2563EB', soft: '#DBEAFE', deep: '#1D4ED8', label: 'Male' },
  F: { ring: '#DB2777', soft: '#FCE7F3', deep: '#9D174D', label: 'Female' },
  U: { ring: '#94A3B8', soft: '#F1F5F9', deep: '#475569', label: 'Unknown' },
};

const GenderIcon = ({ gender, size = 28, color }) => {
  if (gender === 'F') return <UserRound size={size} color={color} strokeWidth={1.8} />;
  if (gender === 'M') return <User size={size} color={color} strokeWidth={1.8} />;
  return <HelpCircle size={size} color={color} strokeWidth={1.8} />;
};

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.15;
const DEFAULT_ZOOM = 0.6;

const TreeViewer = () => {
  const { project_id, batch_id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [translate, setTranslate] = useState({ x: 400, y: 120 });
  const [mode, setMode] = useState('batch'); // 'batch' (Gemini) | 'record' (per-image)
  const [direction, setDirection] = useState('vertical'); // 'vertical' | 'horizontal'
  const [selectedNode, setSelectedNode] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editedGedcomx, setEditedGedcomx] = useState(null);   // local edits before save
  const [showCompare, setShowCompare] = useState(false);
  const [compareIndex, setCompareIndex] = useState(0);

  useEffect(() => {
    const recenter = () => setTranslate({ x: window.innerWidth / 2, y: 100 });
    recenter();
    window.addEventListener('resize', recenter);
    return () => window.removeEventListener('resize', recenter);
  }, []);

  const handleZoomIn = () => setZoom((z) => Math.min(+(z + ZOOM_STEP).toFixed(2), ZOOM_MAX));
  const handleZoomOut = () => setZoom((z) => Math.max(+(z - ZOOM_STEP).toFixed(2), ZOOM_MIN));
  const handleZoomReset = () => {
    setZoom(DEFAULT_ZOOM);
    setTranslate({ x: window.innerWidth / 2, y: 100 });
  };

  const { data: images } = useQuery({
    queryKey: ['images', batch_id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/${batch_id}/images/`);
      return response.data;
    }
  });

  const currentImage = images?.[currentImageIndex];

  // Per-image tree (legacy — uses local deterministic builder)
  const { data: recordTreeData, isLoading: isRecordLoading } = useQuery({
    queryKey: ['tree', currentImage?.id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/${batch_id}/treeviewer/${currentImage.id}`);
      return response.data;
    },
    enabled: !!currentImage && mode === 'record',
  });

  // Whole-batch Gemini-built tree (d3 hierarchy)
  const { data: batchTreePayload, isLoading: isBatchLoading } = useQuery({
    queryKey: ['batch-tree', batch_id],
    queryFn: async () => {
      const res = await api.get(`/projects/${project_id}/batches/${batch_id}/tree/data`);
      return res.data;
    },
    enabled: mode === 'batch',
  });

  // Raw GedcomX for the node-detail side panel (batch mode)
  const { data: gedcomxPayload } = useQuery({
    queryKey: ['batch-tree-gedcomx', batch_id],
    queryFn: async () => {
      const res = await api.get(`/projects/${project_id}/batches/${batch_id}/tree/data?format=gedcomx`);
      return res.data;
    },
    enabled: mode === 'batch',
  });

  // Per-record GedcomX (record mode) — pulls the saved GedcomX for the current image
  const { data: recordGedcomxRaw } = useQuery({
    queryKey: ['record-gedcomx', currentImage?.id],
    queryFn: async () => {
      if (!currentImage) return null;
      const res = await api.get(`/projects/${project_id}/batches/${batch_id}/gedcomx/${currentImage.id}`);
      return res.data;
    },
    enabled: !!currentImage && mode === 'record',
  });

  const buildTreeMutation = useMutation({
    mutationFn: async () =>
      api.post(`/projects/${project_id}/batches/${batch_id}/tree/build`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-tree', batch_id] });
      queryClient.invalidateQueries({ queryKey: ['batch-tree-gedcomx', batch_id] });
      setEditedGedcomx(null);
    },
    onError: (err) => alert(err?.response?.data?.detail || err.message),
  });

  const saveTreeMutation = useMutation({
    mutationFn: async (gedcomx) =>
      api.put(`/projects/${project_id}/batches/${batch_id}/tree/data`, { gedcomx }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-tree', batch_id] });
      queryClient.invalidateQueries({ queryKey: ['batch-tree-gedcomx', batch_id] });
      setEditedGedcomx(null);
      setEditMode(false);
    },
    onError: (err) => alert(err?.response?.data?.detail || err.message),
  });

  // The "working" GedcomX powering the chart. Editable in batch mode (edits go to
  // editedGedcomx). In record mode it's the per-image saved GedcomX, read-only.
  const workingGedcomx =
    mode === 'batch'
      ? (editedGedcomx || gedcomxPayload?.gedcomx || null)
      : (recordGedcomxRaw || null);
  const hasUnsavedEdits = !!editedGedcomx;

  const cloneGedcomx = () =>
    workingGedcomx
      ? JSON.parse(JSON.stringify(workingGedcomx))
      : { persons: [], relationships: [] };

  const nextPersonId = (gx) => {
    const used = new Set((gx.persons || []).map((p) => p.id));
    let i = (gx.persons || []).length + 1;
    while (used.has(`p${i}`)) i++;
    return `p${i}`;
  };

  const handleAddPerson = () => {
    const name = window.prompt('Name of the new person:');
    if (!name || !name.trim()) return;
    const genderInput = (window.prompt('Gender — M, F, or U?', 'U') || 'U').toUpperCase();
    const gender = ['M', 'F', 'U'].includes(genderInput) ? genderInput : 'U';

    // If a person node is currently selected, ask how the new person relates to them.
    // Family / Root / Other nodes can't host relationships directly, so we skip the prompt.
    const selectedId = selectedNode?.attributes?.id;
    const selectedType = selectedNode?.attributes?.type;
    const canRelate =
      selectedId &&
      !String(selectedId).startsWith('family-') &&
      selectedId !== 'root' &&
      selectedId !== 'orphans' &&
      selectedType !== 'Family' &&
      selectedType !== 'Root' &&
      selectedType !== 'Other';

    let relType = null;
    if (canRelate) {
      const ans = (
        window.prompt(
          `Relate to "${selectedNode.name}"?\n\n` +
            'Type one of:\n' +
            '  parent   — new person is parent of the selected\n' +
            '  child    — new person is child of the selected\n' +
            '  spouse   — new person is spouse of the selected\n' +
            '  none     — add as standalone',
          'child',
        ) || ''
      )
        .trim()
        .toLowerCase();
      if (['parent', 'child', 'spouse'].includes(ans)) relType = ans;
    }

    const base = cloneGedcomx();
    const newId = nextPersonId(base);
    const person = {
      id: newId,
      names: [{ nameForms: [{ fullText: name.trim() }] }],
    };
    if (gender === 'M') person.gender = { type: 'http://gedcomx.org/Male' };
    else if (gender === 'F') person.gender = { type: 'http://gedcomx.org/Female' };

    base.persons = [...(base.persons || []), person];

    // Auto-create the relationship to the selected node
    if (relType && selectedId) {
      const rel = (a, b, t) => ({
        type: t === 'Couple' ? 'http://gedcomx.org/Couple' : 'http://gedcomx.org/ParentChild',
        person1: { resource: `#${a}` },
        person2: { resource: `#${b}` },
      });
      base.relationships = base.relationships || [];
      if (relType === 'parent') base.relationships.push(rel(newId, selectedId, 'ParentChild'));
      else if (relType === 'child') base.relationships.push(rel(selectedId, newId, 'ParentChild'));
      else if (relType === 'spouse') base.relationships.push(rel(selectedId, newId, 'Couple'));
    }

    setEditedGedcomx(base);
    setSelectedNode({
      name: name.trim(),
      attributes: { id: newId, gender },
    });
  };

  const handleAddRelation = (fromId, toId, type) => {
    if (!fromId || !toId || fromId === toId) return;
    const base = cloneGedcomx();
    base.relationships = [
      ...(base.relationships || []),
      {
        type:
          type === 'Couple'
            ? 'http://gedcomx.org/Couple'
            : 'http://gedcomx.org/ParentChild',
        person1: { resource: `#${fromId}` },
        person2: { resource: `#${toId}` },
      },
    ];
    setEditedGedcomx(base);
  };

  // When the user has local edits (editedGedcomx), recompute the d3 tree
  // *locally* via the JS port of the backend's gedcomx_to_d3, so changes
  // appear immediately without a server round-trip.
  const liveBatchTree = editedGedcomx
    ? gedcomxToD3(editedGedcomx)
    : batchTreePayload?.tree;

  const treeData = mode === 'batch' ? liveBatchTree : recordTreeData;
  const isLoading = mode === 'batch' ? isBatchLoading : isRecordLoading;

  const handleNext = () => {
    if (currentImageIndex < images.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1);
    }
  };

  const renderRectSvgNode = ({ nodeDatum }) => {
    const a = nodeDatum.attributes || {};
    const onNodeClick = (e) => {
      e?.stopPropagation?.();
      // Skip the synthetic root
      if (a.type === 'Root') return;
      setSelectedNode({ name: nodeDatum.name, attributes: a });
    };
    const type = a.type;
    const relation = a.relation;
    const isRoot = type === 'Root';
    const isFamily = type === 'Family' || (type === 'Primary' && nodeDatum.name?.includes(' & '));
    const isOther = type === 'Other';
    const isPrimary = type === 'Primary' && !isFamily;
    const fontStack = "'Inter', system-ui, sans-serif";

    // Root — leaf-shaped pill
    if (isRoot) {
      return (
        <g style={{ fontFamily: fontStack }}>
          <rect
            width="320" height="64" x="-160" y="-32" rx="32"
            fill="#1E3A8A" stroke="#1E3A8A"
            style={{ filter: 'drop-shadow(0 6px 10px rgba(15,23,42,0.18))' }}
          />
          <g transform="translate(-138,-14)" color="#DBEAFE">
            <TreeDeciduous size={28} strokeWidth={1.8} />
          </g>
          <text fill="#FFFFFF" x="14" y="6" textAnchor="middle"
                style={{ fontSize: 14, fontWeight: 400, letterSpacing: '0.01em' }}>
            {nodeDatum.name}
          </text>
        </g>
      );
    }

    // Family — single rounded card with inline avatars + names
    if (isFamily) {
      const fatherName = a.fatherName || nodeDatum.name?.split(' & ')[0] || 'Father';
      const motherName = a.motherName || nodeDatum.name?.split(' & ')[1] || 'Mother';
      const fp = GENDER_PALETTE[a.fatherGender || 'M'] || GENDER_PALETTE.M;
      const mp = GENDER_PALETTE[a.motherGender || 'F'] || GENDER_PALETTE.F;
      const cardFill = isPrimary ? '#EFF6FF' : '#FFFFFF';
      const cardStroke = isPrimary ? '#1D4ED8' : '#CBD5E1';
      const cardStrokeW = isPrimary ? 2.5 : 1.5;
      return (
        <g style={{ fontFamily: fontStack, cursor: 'pointer' }} onClick={onNodeClick}>
          {/* card background */}
          <rect x="-90" y="-44" width="180" height="88" rx="14"
                fill={cardFill} stroke={cardStroke} strokeWidth={cardStrokeW}
                style={{ filter: 'drop-shadow(0 4px 8px rgba(15,23,42,0.08))' }} />

          {/* father row */}
          <circle cx="-66" cy="-22" r="14" fill={fp.soft} stroke={fp.ring} strokeWidth="2" />
          <g transform="translate(-74,-30)" style={{ color: fp.deep }}>
            <User size={16} strokeWidth={1.8} />
          </g>
          <text x="-46" y="-18" fill="#0F172A" style={{ fontSize: 11.5, fontWeight: 400, letterSpacing: '-0.005em' }}>
            {fatherName}
          </text>

          {/* mother row */}
          <circle cx="-66" cy="10" r="14" fill={mp.soft} stroke={mp.ring} strokeWidth="2" />
          <g transform="translate(-74,2)" style={{ color: mp.deep }}>
            <UserRound size={16} strokeWidth={1.8} />
          </g>
          <text x="-46" y="14" fill="#0F172A" style={{ fontSize: 11.5, fontWeight: 400, letterSpacing: '-0.005em' }}>
            {motherName}
          </text>

          {/* heart + couple label */}
          <g transform="translate(60,-32)" style={{ color: '#DB2777' }}>
            <Heart size={14} fill="#DB2777" strokeWidth={1.5} />
          </g>
          <text x="0" y="36" textAnchor="middle" fill="#94A3B8"
                style={{ fontSize: 8.5, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            Couple
          </text>
        </g>
      );
    }

    // Other — orphan group cluster
    if (isOther) {
      return (
        <g style={{ fontFamily: fontStack, cursor: 'pointer' }} onClick={onNodeClick}>
          <circle r="34" fill="#F1F5F9" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="4 3" />
          <g transform="translate(-14,-14)" color="#475569"><Users size={28} strokeWidth={1.8} /></g>
          <text fill="#0F172A" x="0" y="54" textAnchor="middle"
                style={{ fontSize: 12, fontWeight: 400 }}>{nodeDatum.name}</text>
        </g>
      );
    }

    // Person — circular avatar, gender-colored
    const g = a.gender || 'U';
    const palette = GENDER_PALETTE[g] || GENDER_PALETTE.U;
    const ringWidth = isPrimary ? 4 : 2.5;
    const ringColor = isPrimary ? '#1E3A8A' : palette.ring;
    return (
      <g style={{ fontFamily: fontStack, cursor: 'pointer' }} onClick={onNodeClick}>
        {isPrimary && (
          <circle r="38" fill="none" stroke="#2563EB" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
        )}
        <circle r="28" fill={palette.soft} stroke={ringColor} strokeWidth={ringWidth}
                style={{ filter: 'drop-shadow(0 3px 5px rgba(15,23,42,0.1))' }} />
        <g transform="translate(-14,-14)" style={{ color: palette.deep }}>
          <GenderIcon gender={g} size={28} color={palette.deep} />
        </g>
        <text fill="#0F172A" x="0" y="48" textAnchor="middle"
              style={{ fontSize: 12, fontWeight: 400, letterSpacing: '-0.005em' }}>
          {nodeDatum.name}
        </text>
        {relation && (
          <text fill={palette.deep} x="0" y="62" textAnchor="middle"
                style={{ fontSize: 9.5, fontWeight: 400, fontStyle: 'italic', letterSpacing: '0.01em' }}>
            {relation}
          </text>
        )}
        {isPrimary && (
          <text fill="#1E3A8A" x="0" y="-44" textAnchor="middle"
                style={{ fontSize: 8.5, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            Subject
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-surface-canvas">
      <StageProgress />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ── Slim top bar: identity · mode toggle · primary CTA ───────── */}
        <div className="p-3 bg-surface border-b border-line flex justify-between items-center gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-amber to-brand-amber-dark flex items-center justify-center text-white shadow-warm-sm shrink-0">
              <Network size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-bold text-base leading-tight text-ink truncate">
                Family Tree
              </h2>
              <div className="text-[11px] text-ink-tertiary truncate">
                {mode === 'batch' && batchTreePayload
                  ? `${batchTreePayload.persons_count} persons · ${batchTreePayload.relationships_count} relationships`
                  : mode === 'record'
                  ? currentImage?.original_filename
                  : 'No AI tree built yet'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode segmented control */}
            <div className="flex bg-surface-sunken rounded-full p-0.5 shadow-warm-xs">
              <button
                onClick={() => setMode('batch')}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                  mode === 'batch' ? 'bg-brand-amber text-white shadow-warm-sm' : 'text-ink-secondary hover:text-ink'
                }`}
                title="Whole-batch tree built by Gemini"
              >
                Whole batch
              </button>
              <button
                onClick={() => setMode('record')}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                  mode === 'record' ? 'bg-brand-amber text-white shadow-warm-sm' : 'text-ink-secondary hover:text-ink'
                }`}
                title="Per-record tree"
              >
                Per record
              </button>
            </div>

            {/* Layout direction toggle */}
            <div className="flex bg-surface-sunken rounded-full p-0.5 shadow-warm-xs">
              <button
                onClick={() => setDirection('vertical')}
                title="Top-to-bottom layout — generations flow downward"
                className={`px-2.5 py-1 text-xs font-medium rounded-full transition-all flex items-center gap-1 ${
                  direction === 'vertical' ? 'bg-ink text-white shadow-warm-sm' : 'text-ink-secondary hover:text-ink'
                }`}
              >
                <ArrowDown size={12} /> Top→down
              </button>
              <button
                onClick={() => setDirection('horizontal')}
                title="Left-to-right layout — generations flow rightward"
                className={`px-2.5 py-1 text-xs font-medium rounded-full transition-all flex items-center gap-1 ${
                  direction === 'horizontal' ? 'bg-ink text-white shadow-warm-sm' : 'text-ink-secondary hover:text-ink'
                }`}
              >
                <ArrowRight size={12} /> Left→right
              </button>
            </div>

            {/* Primary CTA — Build with AI (batch mode only) */}
            {mode === 'batch' && (
              <button
                onClick={() => buildTreeMutation.mutate()}
                disabled={buildTreeMutation.isPending || editMode}
                className="text-xs py-2 px-3.5 rounded-full bg-gradient-to-r from-brand-amber to-brand-amber-dark text-white shadow-warm-md hover:shadow-warm-lg hover:-translate-y-0.5 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:translate-y-0 disabled:hover:shadow-warm-md font-semibold"
                title="Use Gemini to dedupe persons across all records and infer the full relationship graph"
              >
                <Sparkles size={14} />
                {buildTreeMutation.isPending ? 'Building…' : 'Build with AI'}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 flex relative bg-surface-canvas overflow-hidden">
          <div className={`relative ${showCompare ? 'flex-1 border-r border-line' : 'flex-1'}`}>
          {/* ── Floating action dock — right edge, vertical, icon-only ─── */}
          <ActionDock
            mode={mode}
            workingGedcomx={workingGedcomx}
            imagesCount={images?.length || 0}
            editMode={editMode}
            setEditMode={setEditMode}
            hasUnsavedEdits={hasUnsavedEdits}
            isSaving={saveTreeMutation.isPending}
            onSave={() => saveTreeMutation.mutate(workingGedcomx)}
            onAddPerson={handleAddPerson}
            selectedNode={selectedNode}
            showCompare={showCompare}
            setShowCompare={setShowCompare}
          />

          {/* ── Floating zoom dock — bottom-right, map-style ─────────── */}
          <div className="absolute bottom-4 right-4 z-30 flex flex-col bg-surface/95 backdrop-blur rounded-xl border border-line shadow-warm-lg overflow-hidden">
            <button
              onClick={handleZoomIn}
              disabled={zoom >= ZOOM_MAX}
              className="w-10 h-10 flex items-center justify-center hover:bg-surface-raised disabled:opacity-40 transition-colors border-b border-line-subtle"
              title="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
            <div className="w-10 h-7 flex items-center justify-center text-[10px] font-semibold text-ink-secondary tabular-nums border-b border-line-subtle bg-surface-raised">
              {Math.round(zoom * 100)}%
            </div>
            <button
              onClick={handleZoomOut}
              disabled={zoom <= ZOOM_MIN}
              className="w-10 h-10 flex items-center justify-center hover:bg-surface-raised disabled:opacity-40 transition-colors border-b border-line-subtle"
              title="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <button
              onClick={handleZoomReset}
              className="w-10 h-10 flex items-center justify-center hover:bg-surface-raised transition-colors"
              title="Reset view"
            >
              <Maximize2 size={16} />
            </button>
          </div>

          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-amber"></div>
            </div>
          ) : workingGedcomx ? (
            <PedigreeChart
              gedcomx={workingGedcomx}
              direction={direction}
              selectedId={selectedNode?.attributes?.id}
              onNodeClick={(p) => {
                setSelectedNode({
                  name: p.name,
                  attributes: { id: p.id, gender: p.gender, type: p.principal ? 'Primary' : undefined },
                });
              }}
            />
          ) : mode === 'batch' ? (
            <div className="h-full flex flex-col items-center justify-center text-ink-tertiary">
              <Sparkles size={64} className="opacity-20 mb-4 text-brand-amber" />
              <p className="mb-1">No AI-built tree for this batch yet.</p>
              <p className="text-xs mb-6 max-w-md text-center">
                Click "Build with AI" to let Gemini analyse every record in this batch,
                merge duplicate persons, and infer all parent/child/spouse relationships.
              </p>
              <button
                onClick={() => buildTreeMutation.mutate()}
                disabled={buildTreeMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                <Sparkles size={16} />
                {buildTreeMutation.isPending ? 'Building…' : 'Build Family Tree with AI'}
              </button>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-ink-tertiary">
              <Network size={64} className="opacity-10 mb-4" />
              <p>Tree data not available. Ensure GedcomX is generated for this image.</p>
            </div>
          )}
          </div>

          {/* Source-file viewer (works in both record and batch mode) */}
          {showCompare && (
            <ImageComparePane
              images={images || []}
              index={compareIndex}
              setIndex={setCompareIndex}
              onClose={() => setShowCompare(false)}
            />
          )}
        </div>

        {mode === 'record' && (
          <div className="p-4 bg-surface border-t border-line flex justify-center gap-4">
            <button onClick={handlePrev} disabled={currentImageIndex === 0} className="btn-secondary py-2 flex items-center gap-2">
              <ChevronLeft size={18} /> Previous Record
            </button>
            <button onClick={handleNext} disabled={currentImageIndex === images?.length - 1} className="btn-secondary py-2 flex items-center gap-2">
              Next Record <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      <NodeDetailPanel
        node={selectedNode}
        gedcomx={workingGedcomx}
        editMode={editMode}
        onAddRelation={handleAddRelation}
        onUpdatePerson={(personId, updates) => {
          // Apply edits to local working copy
          const base = workingGedcomx ? JSON.parse(JSON.stringify(workingGedcomx)) : { persons: [], relationships: [] };
          const p = (base.persons || []).find((x) => x.id === personId);
          if (!p) return;
          if (updates.name != null) {
            p.names = [{ nameForms: [{ fullText: updates.name }] }];
          }
          if (updates.gender != null) {
            if (updates.gender === 'M') p.gender = { type: 'http://gedcomx.org/Male' };
            else if (updates.gender === 'F') p.gender = { type: 'http://gedcomx.org/Female' };
            else delete p.gender;
          }
          setEditedGedcomx(base);
          // refresh selection
          const gt = (p.gender || {}).type || '';
          const g = gt.endsWith('Male') ? 'M' : gt.endsWith('Female') ? 'F' : 'U';
          setSelectedNode({
            name: (p.names || [])[0]?.nameForms?.[0]?.fullText || p.id,
            attributes: { id: p.id, gender: g, type: p.principal ? 'Primary' : undefined },
          });
        }}
        onDeletePerson={(personId) => {
          const base = workingGedcomx ? JSON.parse(JSON.stringify(workingGedcomx)) : { persons: [], relationships: [] };
          base.persons = (base.persons || []).filter((x) => x.id !== personId);
          base.relationships = (base.relationships || []).filter((r) => {
            const a = (r.person1 || {}).resource?.replace('#', '');
            const b = (r.person2 || {}).resource?.replace('#', '');
            return a !== personId && b !== personId;
          });
          setEditedGedcomx(base);
          setSelectedNode(null);
        }}
        onClose={() => setSelectedNode(null)}
        onJump={(personId) => {
          if (!workingGedcomx) return;
          const p = (workingGedcomx.persons || []).find((x) => x.id === personId);
          if (!p) return;
          const name = (p.names || [])[0]?.nameForms?.[0]?.fullText || personId;
          const gt = (p.gender || {}).type || '';
          const gender = gt.endsWith('Male') ? 'M' : gt.endsWith('Female') ? 'F' : 'U';
          setSelectedNode({
            name,
            attributes: { id: p.id, gender, type: p.principal ? 'Primary' : undefined },
          });
        }}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Person detail panel — shows when a tree node is clicked
// ─────────────────────────────────────────────────────────────────────────────
// ─── Insights helpers ──────────────────────────────────────────────────────
const PALETTE = {
  M: { ring: '#2563EB', soft: '#DBEAFE', deep: '#1D4ED8' },
  F: { ring: '#DB2777', soft: '#FCE7F3', deep: '#9D174D' },
  U: { ring: '#94A3B8', soft: '#F1F5F9', deep: '#475569' },
};
const palette = (g) => PALETTE[g] || PALETTE.U;

const getName = (p) => (p.names || [])[0]?.nameForms?.[0]?.fullText || p.id;
const getGender = (p) => {
  const t = (p.gender || {}).type || '';
  return t.endsWith('Male') ? 'M' : t.endsWith('Female') ? 'F' : 'U';
};
const factOf = (p, suffix) => (p.facts || []).find((f) => (f.type || '').endsWith(suffix));
const extractYear = (raw) => {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
};

// Walk ancestors and descendants to compute generation depth + counts
const computeLineage = (personId, persons, rels) => {
  const childrenOf = new Map();  // parentId → [childId]
  const parentsOf = new Map();   // childId → [parentId]
  for (const r of rels) {
    const t = (r.type || '').split('/').slice(-1)[0];
    if (t !== 'ParentChild') continue;
    const a = (r.person1 || {}).resource?.replace('#', '');
    const b = (r.person2 || {}).resource?.replace('#', '');
    if (!a || !b) continue;
    (childrenOf.get(a) || childrenOf.set(a, []).get(a)).push(b);
    (parentsOf.get(b) || parentsOf.set(b, []).get(b)).push(a);
  }

  // BFS ancestors
  let ancestors = 0;
  let maxAncestorDepth = 0;
  const visitedAnc = new Set();
  let frontier = [{ id: personId, depth: 0 }];
  while (frontier.length) {
    const next = [];
    for (const { id, depth } of frontier) {
      for (const pid of parentsOf.get(id) || []) {
        if (visitedAnc.has(pid)) continue;
        visitedAnc.add(pid);
        ancestors++;
        maxAncestorDepth = Math.max(maxAncestorDepth, depth + 1);
        next.push({ id: pid, depth: depth + 1 });
      }
    }
    frontier = next;
  }

  // BFS descendants
  let descendants = 0;
  let maxDescendantDepth = 0;
  const visitedDesc = new Set();
  frontier = [{ id: personId, depth: 0 }];
  while (frontier.length) {
    const next = [];
    for (const { id, depth } of frontier) {
      for (const cid of childrenOf.get(id) || []) {
        if (visitedDesc.has(cid)) continue;
        visitedDesc.add(cid);
        descendants++;
        maxDescendantDepth = Math.max(maxDescendantDepth, depth + 1);
        next.push({ id: cid, depth: depth + 1 });
      }
    }
    frontier = next;
  }

  return { ancestors, descendants, maxAncestorDepth, maxDescendantDepth };
};

const NodeDetailPanel = ({ node, gedcomx, onClose, onJump, editMode, onUpdatePerson, onDeletePerson, onAddRelation }) => {
  const [tab, setTab] = useState('profile');
  useEffect(() => { setTab('profile'); }, [node?.attributes?.id]);

  if (!node) return null;

  const persons = gedcomx?.persons || [];
  const rels = gedcomx?.relationships || [];

  const isFamilyNode = node.attributes?.type === 'Family' || node.name?.includes(' & ');
  const targetId = node.attributes?.id;
  const person = !isFamilyNode && targetId ? persons.find((p) => p.id === targetId) : null;

  // Build relationship buckets for this person
  const parents = [];
  const children = [];
  const spouses = [];
  if (person) {
    rels.forEach((r) => {
      const t = (r.type || '').split('/').slice(-1)[0];
      const a = (r.person1 || {}).resource?.replace('#', '');
      const b = (r.person2 || {}).resource?.replace('#', '');
      if (t === 'ParentChild') {
        if (a === person.id) {
          const c = persons.find((p) => p.id === b); if (c) children.push(c);
        } else if (b === person.id) {
          const par = persons.find((p) => p.id === a); if (par) parents.push(par);
        }
      } else if (t === 'Couple') {
        if (a === person.id) {
          const sp = persons.find((p) => p.id === b); if (sp) spouses.push(sp);
        } else if (b === person.id) {
          const sp = persons.find((p) => p.id === a); if (sp) spouses.push(sp);
        }
      }
    });
  }

  // Family-node case: surface both parents
  const familyParents = [];
  if (isFamilyNode) {
    const fatherName = node.attributes?.fatherName || node.name?.split(' & ')[0];
    const motherName = node.attributes?.motherName || node.name?.split(' & ')[1];
    [fatherName, motherName].filter(Boolean).forEach((nm) => {
      const p = persons.find((x) => getName(x).trim().toLowerCase() === nm.trim().toLowerCase());
      if (p) familyParents.push(p);
    });
  }

  // ── Computed insights for the selected person ──
  const birth = person ? factOf(person, 'Birth') : null;
  const death = person ? factOf(person, 'Death') : null;
  const birthYear = extractYear(birth?.date?.original);
  const deathYear = extractYear(death?.date?.original);
  const ageAtDeath = birthYear && deathYear ? deathYear - birthYear : null;
  const lineage = person ? computeLineage(person.id, persons, rels) : null;
  const places = person
    ? Array.from(
        new Set(
          (person.facts || [])
            .map((f) => f.place?.original)
            .filter(Boolean),
        ),
      )
    : [];
  const occupations = person
    ? (person.facts || [])
        .filter((f) => (f.type || '').toLowerCase().includes('occupation'))
        .map((f) => f.value)
        .filter(Boolean)
    : [];

  // ── Reusable sub-components ──
  const PersonChip = ({ p, onClick, label }) => {
    const g = getGender(p);
    const c = palette(g);
    const b = factOf(p, 'Birth');
    const d = factOf(p, 'Death');
    const by = extractYear(b?.date?.original);
    const dy = extractYear(d?.date?.original);
    return (
      <button onClick={onClick} className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-surface-raised transition-colors text-left">
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: c.soft, border: `2px solid ${c.ring}` }}>
          {g === 'F' ? <UserRound size={16} color={c.deep} /> : g === 'M' ? <User size={16} color={c.deep} /> : <HelpCircle size={16} color={c.deep} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{getName(p)}</div>
          <div className="text-[10px] text-ink-tertiary">
            {label && <span className="uppercase tracking-wider mr-1">{label}</span>}
            {by || dy ? `· ${by || '?'} – ${dy || '?'}` : ''}
          </div>
        </div>
        <ArrowUpRight size={14} className="text-ink-tertiary shrink-0" />
      </button>
    );
  };

  // Innovative header — avatar, name, lifespan timeline
  const Header = ({ p }) => {
    const g = getGender(p);
    const c = palette(g);
    const b = factOf(p, 'Birth');
    const d = factOf(p, 'Death');
    const by = extractYear(b?.date?.original);
    const dy = extractYear(d?.date?.original);
    return (
      <div className="rounded-2xl p-4 relative overflow-hidden" style={{ backgroundColor: c.soft }}>
        <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-20" style={{ backgroundColor: c.ring }} />
        <div className="relative flex items-start gap-3">
          <div className="w-20 h-20 rounded-full flex items-center justify-center shrink-0 shadow-warm-md" style={{ backgroundColor: 'white', border: `3px solid ${c.ring}` }}>
            {g === 'F' ? <UserRound size={40} color={c.deep} /> : g === 'M' ? <User size={40} color={c.deep} /> : <HelpCircle size={40} color={c.deep} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xl font-display font-bold text-ink leading-tight">{getName(p)}</div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: c.ring, color: 'white' }}>
                {g === 'M' ? 'Male' : g === 'F' ? 'Female' : 'Unknown'}
              </span>
              {p.principal && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-amber-light text-brand-amber-dark">Subject</span>
              )}
              {ageAtDeath != null && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-line text-ink-secondary">
                  age {ageAtDeath}
                </span>
              )}
              <span className="text-[10px] font-mono text-ink-tertiary px-1.5 py-0.5">id:{p.id}</span>
            </div>
            {/* Lifespan mini-timeline */}
            {(by || dy) && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] text-ink-secondary mb-1">
                  <span className="font-semibold">{by ?? '?'}</span>
                  <span className="text-ink-tertiary tabular-nums">
                    {ageAtDeath != null ? `${ageAtDeath} years` : 'lifespan'}
                  </span>
                  <span className="font-semibold">{dy ?? '?'}</span>
                </div>
                <div className="h-1.5 bg-white rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: '100%', backgroundColor: c.ring, opacity: 0.7 }} />
                </div>
                <div className="flex justify-between mt-0.5 text-[9px] uppercase tracking-wider text-ink-tertiary">
                  <span>born</span>
                  <span>died</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Stats grid — surfaces compute insights
  const StatCard = ({ label, value, sub, color = '#475569' }) => (
    <div className="bg-white border border-line-subtle rounded-xl p-3 text-center">
      <div className="text-2xl font-display font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-ink-tertiary mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-ink-tertiary mt-0.5">{sub}</div>}
    </div>
  );

  // Tab pill
  const TabBtn = ({ id, label, count }) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
        tab === id ? 'bg-white shadow-warm-sm text-ink' : 'text-ink-tertiary hover:text-ink'
      }`}
    >
      {label}
      {count != null && (
        <span className={`ml-1 text-[9px] tabular-nums ${tab === id ? 'text-ink-tertiary' : 'text-ink-tertiary/70'}`}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-surface border-l border-line shadow-warm-lg z-50 flex flex-col animate-in slide-in-from-right">
      <div className="p-3 border-b border-line flex items-center justify-between bg-surface-raised">
        <div className="text-xs uppercase tracking-widest text-ink-tertiary font-semibold">
          {isFamilyNode ? 'Family details' : 'Person insights'}
        </div>
        <button onClick={onClose} className="text-ink-tertiary hover:text-ink p-1 rounded" title="Close">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ─── Family node ─── */}
        {isFamilyNode ? (
          <>
            <div className="text-xs text-ink-tertiary">Married couple — click either person to drill in.</div>
            {familyParents.length > 0 ? familyParents.map((p) => <Header key={p.id} p={p} />)
              : <div className="text-sm text-ink-tertiary italic">No detailed records found for this couple.</div>}
            {familyParents.length === 2 && (
              <div className="text-center text-xs text-ink-tertiary flex items-center justify-center gap-2 py-1">
                <Heart size={12} className="text-pink-600" fill="#DB2777" /> married
              </div>
            )}
            {familyParents.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {familyParents.map((p) => (
                  <button
                    key={`jump-${p.id}`}
                    onClick={() => onJump(p.id)}
                    className="btn-secondary text-xs py-2 flex items-center justify-center gap-1"
                  >
                    <ArrowUpRight size={12} /> Inspect {getName(p).split(' ')[0]}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : person ? (
          <>
            <Header p={person} />

            {/* Stats grid — surfaces lineage insights */}
            {lineage && (
              <div className="grid grid-cols-4 gap-2">
                <StatCard label="parents" value={parents.length} color={palette('U').deep} />
                <StatCard label="spouses" value={spouses.length} color="#DB2777" />
                <StatCard label="children" value={children.length} color={palette('M').deep} />
                <StatCard label="ancestors" value={lineage.ancestors} sub={`${lineage.maxAncestorDepth} gen up`} color="#0E7490" />
              </div>
            )}
            {lineage && (lineage.descendants > 0 || places.length > 0) && (
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  label="descendants"
                  value={lineage.descendants}
                  sub={lineage.maxDescendantDepth ? `${lineage.maxDescendantDepth} gen down` : null}
                  color="#15803D"
                />
                <StatCard label="places" value={places.length} color="#B45309" />
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-surface-sunken rounded-lg p-1">
              <TabBtn id="profile" label="Profile" />
              <TabBtn id="family" label="Family" count={parents.length + spouses.length + children.length} />
              <TabBtn id="lineage" label="Lineage" />
            </div>

            {/* ─── Profile tab ─── */}
            {tab === 'profile' && (
              <div className="space-y-3">
                {(birth || death) && (
                  <div className="bg-white border border-line-subtle rounded-xl p-3 space-y-2">
                    <div className="text-[10px] uppercase tracking-widest text-ink-tertiary font-semibold flex items-center gap-1">
                      <Calendar size={11} /> Life events
                    </div>
                    {birth && (
                      <div className="flex items-start gap-2 text-sm">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-tertiary mt-1 w-12 shrink-0">Born</span>
                        <div>
                          <div className="text-ink">{birth.date?.original || '—'}</div>
                          {birth.place?.original && <div className="text-xs text-ink-tertiary flex items-center gap-1"><MapPin size={10} />{birth.place.original}</div>}
                        </div>
                      </div>
                    )}
                    {death && (
                      <div className="flex items-start gap-2 text-sm">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-tertiary mt-1 w-12 shrink-0">Died</span>
                        <div>
                          <div className="text-ink">{death.date?.original || '—'}</div>
                          {death.place?.original && <div className="text-xs text-ink-tertiary flex items-center gap-1"><MapPin size={10} />{death.place.original}</div>}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {occupations.length > 0 && (
                  <div className="bg-white border border-line-subtle rounded-xl p-3">
                    <div className="text-[10px] uppercase tracking-widest text-ink-tertiary font-semibold flex items-center gap-1 mb-2">
                      <Briefcase size={11} /> Occupations
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {occupations.map((o, i) => (
                        <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-900 border border-amber-200">{o}</span>
                      ))}
                    </div>
                  </div>
                )}

                {places.length > 0 && (
                  <div className="bg-white border border-line-subtle rounded-xl p-3">
                    <div className="text-[10px] uppercase tracking-widest text-ink-tertiary font-semibold flex items-center gap-1 mb-2">
                      <MapPin size={11} /> Places associated
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {places.map((pl, i) => (
                        <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-cyan-50 text-cyan-900 border border-cyan-200">{pl}</span>
                      ))}
                    </div>
                  </div>
                )}

                {!birth && !death && !occupations.length && !places.length && (
                  <div className="text-sm text-ink-tertiary italic text-center py-4">
                    No biographical facts captured for this person.
                  </div>
                )}
              </div>
            )}

            {/* ─── Family tab ─── */}
            {tab === 'family' && (
              <div className="space-y-3">
                {parents.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-tertiary font-semibold mb-1.5">Parents · {parents.length}</div>
                    <div className="space-y-1 bg-white border border-line-subtle rounded-lg p-1">
                      {parents.map((p) => <PersonChip key={p.id} p={p} onClick={() => onJump(p.id)} label={getGender(p) === 'F' ? 'mother' : getGender(p) === 'M' ? 'father' : 'parent'} />)}
                    </div>
                  </div>
                )}
                {spouses.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-tertiary font-semibold mb-1.5 flex items-center gap-1">
                      <Heart size={10} className="text-pink-600" /> Spouse{spouses.length > 1 ? 's' : ''} · {spouses.length}
                    </div>
                    <div className="space-y-1 bg-white border border-line-subtle rounded-lg p-1">
                      {spouses.map((p) => <PersonChip key={p.id} p={p} onClick={() => onJump(p.id)} />)}
                    </div>
                  </div>
                )}
                {children.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-tertiary font-semibold mb-1.5">Children · {children.length}</div>
                    <div className="space-y-1 bg-white border border-line-subtle rounded-lg p-1">
                      {children.map((p) => <PersonChip key={p.id} p={p} onClick={() => onJump(p.id)} />)}
                    </div>
                  </div>
                )}
                {parents.length === 0 && spouses.length === 0 && children.length === 0 && (
                  <div className="text-sm text-ink-tertiary italic text-center py-4">
                    No relatives recorded for this person yet.
                  </div>
                )}
              </div>
            )}

            {/* ─── Lineage tab — generation depth, ancestor/descendant tally ─── */}
            {tab === 'lineage' && lineage && (
              <div className="space-y-3">
                <div className="bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-100 rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-widest text-cyan-800 font-semibold mb-2">Ancestry</div>
                  {lineage.ancestors > 0 ? (
                    <>
                      <div className="text-sm text-ink">
                        <strong className="text-2xl font-display text-cyan-700 mr-1">{lineage.ancestors}</strong>
                        known ancestor{lineage.ancestors !== 1 ? 's' : ''} traced over{' '}
                        <strong>{lineage.maxAncestorDepth}</strong> generation{lineage.maxAncestorDepth !== 1 ? 's' : ''}
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        {Array.from({ length: lineage.maxAncestorDepth + 1 }).map((_, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <div className="flex-1 h-px bg-cyan-300" />}
                            <div className="w-2.5 h-2.5 rounded-full bg-cyan-600" />
                          </React.Fragment>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-ink-tertiary italic">No ancestors recorded.</div>
                  )}
                </div>

                <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-100 rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold mb-2">Descendants</div>
                  {lineage.descendants > 0 ? (
                    <>
                      <div className="text-sm text-ink">
                        <strong className="text-2xl font-display text-emerald-700 mr-1">{lineage.descendants}</strong>
                        known descendant{lineage.descendants !== 1 ? 's' : ''} over{' '}
                        <strong>{lineage.maxDescendantDepth}</strong> generation{lineage.maxDescendantDepth !== 1 ? 's' : ''}
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        {Array.from({ length: lineage.maxDescendantDepth + 1 }).map((_, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <div className="flex-1 h-px bg-emerald-300" />}
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                          </React.Fragment>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-ink-tertiary italic">No descendants recorded.</div>
                  )}
                </div>

                <div className="text-[10px] text-ink-tertiary text-center italic">
                  Lineage counts include every ancestor/descendant reachable via parent-child links in this batch.
                </div>
              </div>
            )}

            {/* Edit mode — full editor below the tabs */}
            {editMode && (
              <>
                <div className="border-t border-line-subtle pt-3" />
                <PersonEditor
                  person={person}
                  onSave={(updates) => onUpdatePerson?.(person.id, updates)}
                  onDelete={() => {
                    if (window.confirm(`Delete "${getName(person)}" from the tree?`)) {
                      onDeletePerson?.(person.id);
                    }
                  }}
                />
                <RelationAdder person={person} allPersons={persons} onAdd={onAddRelation} />
              </>
            )}
          </>
        ) : (
          <div className="text-sm text-ink-tertiary">
            <div className="font-medium text-ink mb-1">{node.name}</div>
            Couldn't find this node in the GedcomX graph. Try rebuilding the tree.
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Floating ActionDock — vertical icon dock on the right edge of the tree canvas
// Replaces the cluttered top toolbar with discoverable icon buttons + tooltips.
// ─────────────────────────────────────────────────────────────────────────────
const ActionDock = ({
  mode, workingGedcomx, imagesCount, editMode, setEditMode,
  hasUnsavedEdits, isSaving, onSave, onAddPerson, selectedNode,
  showCompare, setShowCompare,
}) => {
  const canEdit = mode === 'batch' && workingGedcomx;
  const items = [];

  if (imagesCount > 0) {
    items.push({
      key: 'view-source',
      onClick: () => setShowCompare((v) => !v),
      icon: <ImageIcon size={18} />,
      label: showCompare ? 'Hide source' : 'View source',
      active: showCompare,
    });
  }

  if (canEdit) {
    items.push({
      key: 'edit',
      onClick: () => setEditMode((v) => !v),
      icon: <Edit3 size={18} />,
      label: editMode ? 'Exit edit' : 'Edit tree',
      active: editMode,
    });
  }

  if (canEdit && editMode) {
    const selId = selectedNode?.attributes?.id;
    const selValid =
      selId && !String(selId).startsWith('family-') && selId !== 'root' && selId !== 'orphans';
    items.push({
      key: 'add',
      onClick: onAddPerson,
      icon: <Plus size={18} />,
      label: selValid ? `Add near ${selectedNode.name.split(' ')[0]}` : 'Add person',
      tint: 'blue',
    });
    items.push({
      key: 'save',
      onClick: onSave,
      icon: <Save size={18} />,
      label: isSaving ? 'Saving…' : hasUnsavedEdits ? 'Save changes' : 'Saved',
      tint: hasUnsavedEdits ? 'green' : 'muted',
      disabled: isSaving || !hasUnsavedEdits,
      badge: hasUnsavedEdits ? '•' : null,
    });
  }

  if (!items.length) return null;

  return (
    <div className="absolute top-4 right-4 z-30 flex flex-col gap-1.5 bg-surface/95 backdrop-blur rounded-xl border border-line shadow-warm-lg p-1.5">
      {items.map((it, i) => (
        <DockButton key={it.key} {...it} />
      ))}
    </div>
  );
};

const DockButton = ({ onClick, icon, label, active, tint, disabled, badge }) => {
  const base =
    'group relative h-10 rounded-lg flex items-center transition-all overflow-hidden';
  // Width starts at 40px (icon-only), expands on hover to fit label.
  const widthCls = 'w-10 hover:w-auto hover:px-3';
  let stateCls = 'bg-transparent text-ink-secondary hover:bg-surface-raised hover:text-ink';
  if (active) {
    stateCls = 'bg-brand-amber text-white hover:bg-brand-amber-dark';
  } else if (tint === 'blue') {
    stateCls = 'bg-blue-50 text-blue-700 hover:bg-blue-100';
  } else if (tint === 'green') {
    stateCls = 'bg-green-600 text-white hover:bg-green-700';
  } else if (tint === 'muted') {
    stateCls = 'bg-surface-sunken text-ink-tertiary';
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`${base} ${widthCls} ${stateCls} disabled:opacity-50 disabled:hover:w-10 disabled:hover:px-0`}
    >
      <span className="w-10 h-10 flex items-center justify-center shrink-0 relative">
        {icon}
        {badge && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        )}
      </span>
      <span className="text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity max-w-0 group-hover:max-w-[180px] overflow-hidden pr-2">
        {label}
      </span>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Person editor — inline form within the side panel when edit mode is on
// ─────────────────────────────────────────────────────────────────────────────
const PersonEditor = ({ person, onSave, onDelete }) => {
  const [name, setName] = useState((person.names || [])[0]?.nameForms?.[0]?.fullText || '');
  const [gender, setGender] = useState(() => {
    const t = (person.gender || {}).type || '';
    return t.endsWith('Male') ? 'M' : t.endsWith('Female') ? 'F' : 'U';
  });

  // Reset state when a different person is opened
  useEffect(() => {
    setName((person.names || [])[0]?.nameForms?.[0]?.fullText || '');
    const t = (person.gender || {}).type || '';
    setGender(t.endsWith('Male') ? 'M' : t.endsWith('Female') ? 'F' : 'U');
  }, [person.id]);

  return (
    <div className="border border-brand-amber/40 bg-brand-amber-light/40 rounded-xl p-3 space-y-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-brand-amber-dark flex items-center gap-1">
        <Edit3 size={11} /> Editing person
      </div>

      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-ink-secondary mb-1 block">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input bg-white"
        />
      </div>

      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-ink-secondary mb-1 block">
          Gender
        </label>
        <div className="flex gap-1">
          {[
            { v: 'M', label: 'Male', color: '#2563EB' },
            { v: 'F', label: 'Female', color: '#DB2777' },
            { v: 'U', label: 'Unknown', color: '#94A3B8' },
          ].map((g) => (
            <button
              key={g.v}
              type="button"
              onClick={() => setGender(g.v)}
              className={`flex-1 text-xs py-1.5 rounded-md border-2 font-medium transition-all ${
                gender === g.v ? 'text-white border-transparent' : 'bg-white text-ink-secondary border-line'
              }`}
              style={gender === g.v ? { backgroundColor: g.color } : {}}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onSave({ name, gender })}
          className="btn-primary text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1"
        >
          <Save size={12} /> Apply
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs py-1.5 px-3 rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 flex items-center justify-center gap-1"
          title="Delete person from tree"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
      <p className="text-[10px] text-ink-tertiary leading-tight">
        Apply caches your edit locally — click <strong>Save changes</strong> in the toolbar to persist
        to the database.
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Relationship adder — connect this person to another existing person
// ─────────────────────────────────────────────────────────────────────────────
const RelationAdder = ({ person, allPersons, onAdd }) => {
  const [relType, setRelType] = useState('parent_of');
  const [otherId, setOtherId] = useState('');

  const others = (allPersons || []).filter((p) => p.id !== person.id);
  const otherName = (p) => (p.names || [])[0]?.nameForms?.[0]?.fullText || p.id;

  const apply = () => {
    if (!otherId) return;
    if (relType === 'parent_of') onAdd?.(person.id, otherId, 'ParentChild');
    else if (relType === 'child_of') onAdd?.(otherId, person.id, 'ParentChild');
    else if (relType === 'spouse_of') onAdd?.(person.id, otherId, 'Couple');
    setOtherId('');
  };

  if (!others.length) return null;

  return (
    <div className="border border-blue-200 bg-blue-50 rounded-xl p-3 space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-blue-700 flex items-center gap-1">
        <Plus size={11} /> Add a relationship
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <select
          value={relType}
          onChange={(e) => setRelType(e.target.value)}
          className="bg-white border border-line rounded-md px-2 py-1.5 text-xs"
        >
          <option value="parent_of">is parent of</option>
          <option value="child_of">is child of</option>
          <option value="spouse_of">is spouse of</option>
        </select>
        <select
          value={otherId}
          onChange={(e) => setOtherId(e.target.value)}
          className="bg-white border border-line rounded-md px-2 py-1.5 text-xs"
        >
          <option value="">— select person —</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {otherName(p)}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={apply}
        disabled={!otherId}
        className="w-full text-xs py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Add relationship
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Image compare pane — side-by-side document viewer
// ─────────────────────────────────────────────────────────────────────────────
const ImageComparePane = ({ images, index, setIndex, onClose }) => {
  const img = images[index];
  if (!img) {
    return (
      <div className="w-[42%] bg-surface flex items-center justify-center text-ink-tertiary text-sm">
        No files in this batch.
      </div>
    );
  }
  const isSheet = img.file_type === 'spreadsheet';

  return (
    <div className="w-[42%] bg-surface flex flex-col">
      <div className="p-3 border-b border-line bg-surface-raised flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {isSheet ? (
            <span className="text-emerald-600 shrink-0 text-lg leading-none">📊</span>
          ) : (
            <ImageIcon size={16} className="text-brand-amber shrink-0" />
          )}
          <span className="text-xs font-mono text-ink-secondary truncate">
            {img.original_filename}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setIndex(Math.max(0, index - 1))}
            disabled={index === 0}
            className="w-7 h-7 rounded hover:bg-surface-sunken disabled:opacity-30 flex items-center justify-center"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs text-ink-tertiary tabular-nums px-1">
            {index + 1} / {images.length}
          </span>
          <button
            onClick={() => setIndex(Math.min(images.length - 1, index + 1))}
            disabled={index === images.length - 1}
            className="w-7 h-7 rounded hover:bg-surface-sunken disabled:opacity-30 flex items-center justify-center"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded hover:bg-surface-sunken flex items-center justify-center"
            title="Close source viewer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 bg-surface-sunken">
        {isSheet ? (
          <div className="bg-white rounded-lg border border-line-subtle shadow-warm-sm p-6 text-center">
            <div className="text-5xl mb-3">📊</div>
            <div className="font-semibold mb-1">Spreadsheet</div>
            <div className="text-xs text-ink-secondary mb-4">
              {img.spreadsheet_summary
                ? `${img.spreadsheet_summary.row_count} rows · ${img.spreadsheet_summary.column_count} columns`
                : 'Tabular data — not previewable here'}
            </div>
            <a
              href={`http://localhost:8000/${img.original_path}`}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary text-xs inline-flex items-center gap-1.5"
            >
              <Download size={12} />
              Download original
            </a>
          </div>
        ) : (
          <img
            src={`http://localhost:8000/${img.enhanced_path || img.original_path}`}
            alt={img.original_filename}
            className="max-w-full mx-auto shadow-warm-md rounded border border-line-subtle"
          />
        )}
      </div>

      {/* thumbnail strip */}
      {images.length > 1 && (
        <div className="border-t border-line bg-surface-raised p-2 flex gap-1 overflow-x-auto">
          {images.map((im, i) => {
            const sheet = im.file_type === 'spreadsheet';
            return (
              <button
                key={im.id}
                onClick={() => setIndex(i)}
                className={`shrink-0 w-12 h-16 rounded overflow-hidden border-2 transition-all ${
                  i === index ? 'border-brand-amber shadow-warm-sm' : 'border-transparent opacity-60 hover:opacity-100'
                }`}
                title={im.original_filename}
              >
                {sheet ? (
                  <div className="w-full h-full bg-gradient-to-br from-emerald-100 to-teal-200 flex items-center justify-center text-xl">
                    📊
                  </div>
                ) : (
                  <img
                    src={`http://localhost:8000/${im.enhanced_path || im.original_path}`}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TreeViewer;
