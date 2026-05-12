import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import StageProgress from '../components/Layout/StageProgress';
import { gedcomxToD3 } from '../utils/gedcomxToD3';
import Tree from 'react-d3-tree';
import {
  Network, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2,
  User, UserRound, Heart, TreeDeciduous, Users, HelpCircle, Sparkles,
  X, Calendar, MapPin, Briefcase, ArrowUpRight,
  Edit3, Save, Trash2, Plus, ImageIcon, Eye, EyeOff, Download,
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

  // Raw GedcomX for the node-detail side panel
  const { data: gedcomxPayload } = useQuery({
    queryKey: ['batch-tree-gedcomx', batch_id],
    queryFn: async () => {
      const res = await api.get(`/projects/${project_id}/batches/${batch_id}/tree/data?format=gedcomx`);
      return res.data;
    },
    enabled: mode === 'batch',
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

  // The "working" GedcomX in edit mode — local copy of what's in Gemini's saved tree
  const workingGedcomx = editedGedcomx || gedcomxPayload?.gedcomx || null;
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
        <div className="p-4 bg-surface border-b border-line flex justify-between items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Network size={20} className="text-brand-amber" />
            <h2 className="heading-section">Family Tree</h2>
            {mode === 'batch' && batchTreePayload && (
              <span className="text-xs text-ink-tertiary">
                · {batchTreePayload.persons_count} persons · {batchTreePayload.relationships_count} relationships
                {batchTreePayload.built_at && ` · built ${new Date(batchTreePayload.built_at).toLocaleString()}`}
              </span>
            )}
            {mode === 'record' && (
              <span className="text-xs text-ink-tertiary">| {currentImage?.original_filename}</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Mode toggle */}
            <div className="flex bg-surface-sunken rounded-md p-0.5">
              <button
                onClick={() => setMode('batch')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  mode === 'batch' ? 'bg-brand-amber text-white' : 'text-ink-secondary hover:bg-surface'
                }`}
                title="Whole-batch tree built by Gemini"
              >
                Whole batch
              </button>
              <button
                onClick={() => setMode('record')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  mode === 'record' ? 'bg-brand-amber text-white' : 'text-ink-secondary hover:bg-surface'
                }`}
                title="Per-record tree (deterministic)"
              >
                Per record
              </button>
            </div>

            {/* Build / Edit / Save / Compare — only in batch mode */}
            {mode === 'batch' && (
              <>
                <button
                  onClick={() => buildTreeMutation.mutate()}
                  disabled={buildTreeMutation.isPending || editMode}
                  className="btn-primary text-xs py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                  title="Use Gemini to dedupe persons across all records and infer the full relationship graph"
                >
                  <Sparkles size={14} />
                  {buildTreeMutation.isPending ? 'Building…' : 'Build with AI'}
                </button>

                {workingGedcomx && (
                  <button
                    onClick={() => setEditMode((v) => !v)}
                    className={`text-xs py-1.5 flex items-center gap-1.5 px-2.5 rounded-md transition-colors ${
                      editMode
                        ? 'bg-brand-amber-dark text-white'
                        : 'btn-secondary'
                    }`}
                    title={editMode ? 'Exit edit mode' : 'Edit the tree manually'}
                  >
                    <Edit3 size={14} />
                    {editMode ? 'Editing' : 'Edit'}
                  </button>
                )}

                {editMode && (
                  <>
                    <button
                      onClick={handleAddPerson}
                      className="text-xs py-1.5 flex items-center gap-1.5 px-2.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                      title={
                        selectedNode?.attributes?.id &&
                        !String(selectedNode.attributes.id).startsWith('family-') &&
                        selectedNode.attributes.id !== 'root' &&
                        selectedNode.attributes.id !== 'orphans'
                          ? `Add a new person related to "${selectedNode.name}"`
                          : 'Add a new person (select a node first to auto-link)'
                      }
                    >
                      <Plus size={14} />
                      {selectedNode?.attributes?.id &&
                      !String(selectedNode.attributes.id).startsWith('family-') &&
                      selectedNode.attributes.id !== 'root' &&
                      selectedNode.attributes.id !== 'orphans'
                        ? `Add near ${selectedNode.name.split(' ')[0]}`
                        : 'Add person'}
                    </button>
                    <button
                      onClick={() => saveTreeMutation.mutate(workingGedcomx)}
                      disabled={saveTreeMutation.isPending || !hasUnsavedEdits}
                      className="text-xs py-1.5 flex items-center gap-1.5 px-2.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                      title="Save the edited tree to this batch"
                    >
                      <Save size={14} />
                      {saveTreeMutation.isPending ? 'Saving…' : hasUnsavedEdits ? 'Save changes' : 'Saved'}
                    </button>
                  </>
                )}

              </>
            )}

            {/* View source files — always available in both modes */}
            {(images?.length || 0) > 0 && (
              <button
                onClick={() => setShowCompare((v) => !v)}
                className={`text-xs py-1.5 flex items-center gap-1.5 px-2.5 rounded-md transition-colors ${
                  showCompare ? 'bg-brand-amber text-white' : 'btn-secondary'
                }`}
                title="Open the source file(s) for this batch side-by-side"
              >
                <ImageIcon size={14} />
                {showCompare ? 'Hide source' : 'View source'}
              </button>
            )}

            <div className="w-px h-6 bg-line mx-1" />

            <button
              onClick={handleZoomOut}
              disabled={zoom <= ZOOM_MIN}
              className="btn-secondary p-2 disabled:opacity-40"
              title="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <span className="text-xs text-ink-tertiary w-10 text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= ZOOM_MAX}
              className="btn-secondary p-2 disabled:opacity-40"
              title="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
            <button
              onClick={handleZoomReset}
              className="btn-secondary p-2"
              title="Reset view"
            >
              <Maximize2 size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex relative bg-surface-canvas overflow-hidden">
          <div className={`relative ${showCompare ? 'flex-1 border-r border-line' : 'flex-1'}`}>
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-amber"></div>
            </div>
          ) : treeData ? (
            <div id="treeWrapper" style={{ width: '100%', height: '100%' }}>
              <Tree
                data={treeData}
                orientation="vertical"
                translate={translate}
                zoom={zoom}
                scaleExtent={{ min: ZOOM_MIN, max: ZOOM_MAX }}
                pathFunc="step"
                depthFactor={170}
                nodeSize={{ x: 180, y: 180 }}
                separation={{ siblings: 1.05, nonSiblings: 1.35 }}
                renderCustomNodeElement={renderRectSvgNode}
                pathClassFunc={() => 'tree-link'}
              />
            </div>
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
const NodeDetailPanel = ({ node, gedcomx, onClose, onJump, editMode, onUpdatePerson, onDeletePerson, onAddRelation }) => {
  if (!node) return null;

  const persons = gedcomx?.persons || [];
  const rels = gedcomx?.relationships || [];

  const getName = (p) => (p.names || [])[0]?.nameForms?.[0]?.fullText || p.id;
  const getGender = (p) => {
    const t = (p.gender || {}).type || '';
    return t.endsWith('Male') ? 'M' : t.endsWith('Female') ? 'F' : 'U';
  };

  // ── Family-card click: surface the two parents
  const isFamilyNode = node.attributes?.type === 'Family' || node.name?.includes(' & ');

  // ── Person-node click: pull the person from GedcomX by id
  const targetId = node.attributes?.id;
  const person = !isFamilyNode && targetId ? persons.find((p) => p.id === targetId) : null;

  // Relationships — find parents/children/spouses for this person
  const parents = [];
  const children = [];
  const spouses = [];
  if (person) {
    rels.forEach((r) => {
      const ttail = (r.type || '').split('/').slice(-1)[0];
      const a = (r.person1 || {}).resource?.replace('#', '');
      const b = (r.person2 || {}).resource?.replace('#', '');
      if (ttail === 'ParentChild') {
        if (a === person.id) {
          const c = persons.find((p) => p.id === b);
          if (c) children.push(c);
        } else if (b === person.id) {
          const par = persons.find((p) => p.id === a);
          if (par) parents.push(par);
        }
      } else if (ttail === 'Couple') {
        if (a === person.id) {
          const sp = persons.find((p) => p.id === b);
          if (sp) spouses.push(sp);
        } else if (b === person.id) {
          const sp = persons.find((p) => p.id === a);
          if (sp) spouses.push(sp);
        }
      }
    });
  }

  // Family-node case: show both parents side-by-side
  let familyParents = [];
  if (isFamilyNode) {
    const fatherName = node.attributes?.fatherName || node.name?.split(' & ')[0];
    const motherName = node.attributes?.motherName || node.name?.split(' & ')[1];
    [fatherName, motherName].filter(Boolean).forEach((nm) => {
      const p = persons.find((x) => getName(x).trim().toLowerCase() === nm.trim().toLowerCase());
      if (p) familyParents.push(p);
    });
  }

  const palette = (g) => ({
    M: { ring: '#2563EB', soft: '#DBEAFE', deep: '#1D4ED8' },
    F: { ring: '#DB2777', soft: '#FCE7F3', deep: '#9D174D' },
    U: { ring: '#94A3B8', soft: '#F1F5F9', deep: '#475569' },
  })[g] || { ring: '#94A3B8', soft: '#F1F5F9', deep: '#475569' };

  const PersonChip = ({ p, onClick }) => {
    const g = getGender(p);
    const c = palette(g);
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-surface-raised transition-colors text-left"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: c.soft, border: `2px solid ${c.ring}` }}
        >
          {g === 'F' ? <UserRound size={16} color={c.deep} /> : g === 'M' ? <User size={16} color={c.deep} /> : <HelpCircle size={16} color={c.deep} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{getName(p)}</div>
          <div className="text-[10px] text-ink-tertiary uppercase tracking-wider">
            {p.principal ? 'Subject' : g === 'M' ? 'Male' : g === 'F' ? 'Female' : 'Unknown'}
          </div>
        </div>
        <ArrowUpRight size={14} className="text-ink-tertiary shrink-0" />
      </button>
    );
  };

  const PersonHeader = ({ p }) => {
    const g = getGender(p);
    const c = palette(g);
    const facts = p.facts || [];
    const factOf = (suffix) => facts.find((f) => (f.type || '').endsWith(suffix));
    const birth = factOf('Birth');
    const death = factOf('Death');
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: c.soft }}>
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: '#FFFFFF', border: `3px solid ${c.ring}` }}
        >
          {g === 'F' ? <UserRound size={32} color={c.deep} /> : g === 'M' ? <User size={32} color={c.deep} /> : <HelpCircle size={32} color={c.deep} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold text-ink truncate">{getName(p)}</div>
          <div className="text-xs text-ink-secondary mt-0.5">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: c.ring, color: 'white' }}>
              {g === 'M' ? 'Male' : g === 'F' ? 'Female' : 'Unknown'}
            </span>
            {p.principal && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-amber-light text-brand-amber-dark">
                Subject
              </span>
            )}
          </div>
          {(birth || death) && (
            <div className="mt-2 space-y-1 text-xs text-ink-secondary">
              {birth && (
                <div className="flex items-center gap-1.5">
                  <Calendar size={12} />
                  <span>Born {birth.date?.original || '—'}{birth.place?.original ? ` · ${birth.place.original}` : ''}</span>
                </div>
              )}
              {death && (
                <div className="flex items-center gap-1.5">
                  <Calendar size={12} />
                  <span>Died {death.date?.original || '—'}{death.place?.original ? ` · ${death.place.original}` : ''}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-surface border-l border-line shadow-warm-lg z-50 flex flex-col animate-in slide-in-from-right">
      <div className="p-3 border-b border-line flex items-center justify-between bg-surface-raised">
        <div className="text-xs uppercase tracking-widest text-ink-tertiary font-semibold">
          {isFamilyNode ? 'Family details' : 'Person details'}
        </div>
        <button onClick={onClose} className="text-ink-tertiary hover:text-ink p-1 rounded">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isFamilyNode ? (
          <>
            <div className="text-sm text-ink-secondary mb-2">Couple — both parents below.</div>
            {familyParents.length > 0 ? (
              familyParents.map((p) => (
                <PersonHeader key={p.id} p={p} />
              ))
            ) : (
              <div className="text-sm text-ink-tertiary">No detailed records found for this couple.</div>
            )}
            {familyParents.length === 2 && (
              <div className="text-center text-xs text-ink-tertiary flex items-center justify-center gap-2 py-1">
                <Heart size={12} className="text-pink-600" /> married
              </div>
            )}
          </>
        ) : person ? (
          <>
            <PersonHeader p={person} />

            {editMode && (
              <>
                <PersonEditor
                  person={person}
                  onSave={(updates) => onUpdatePerson?.(person.id, updates)}
                  onDelete={() => {
                    if (window.confirm(`Delete "${getName(person)}" from the tree?`)) {
                      onDeletePerson?.(person.id);
                    }
                  }}
                />
                <RelationAdder
                  person={person}
                  allPersons={persons}
                  onAdd={onAddRelation}
                />
              </>
            )}

            {parents.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-ink-tertiary font-semibold mb-1.5">
                  Parents · {parents.length}
                </div>
                <div className="space-y-1 border border-line-subtle rounded-lg p-1">
                  {parents.map((p) => <PersonChip key={p.id} p={p} onClick={() => onJump(p.id)} />)}
                </div>
              </div>
            )}

            {spouses.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-ink-tertiary font-semibold mb-1.5">
                  Spouse{spouses.length > 1 ? 's' : ''} · {spouses.length}
                </div>
                <div className="space-y-1 border border-line-subtle rounded-lg p-1">
                  {spouses.map((p) => <PersonChip key={p.id} p={p} onClick={() => onJump(p.id)} />)}
                </div>
              </div>
            )}

            {children.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-ink-tertiary font-semibold mb-1.5">
                  Children · {children.length}
                </div>
                <div className="space-y-1 border border-line-subtle rounded-lg p-1">
                  {children.map((p) => <PersonChip key={p.id} p={p} onClick={() => onJump(p.id)} />)}
                </div>
              </div>
            )}

            {parents.length === 0 && spouses.length === 0 && children.length === 0 && (
              <div className="text-sm text-ink-tertiary italic">
                No relationships recorded for this person yet.
              </div>
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
