import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import {
  Plus, FolderOpen, Trash2, ArrowRight, X, Sparkles, Users, Layers,
} from 'lucide-react';

const Dashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  // Form state for the inline create-project panel
  const [newName, setNewName] = useState('');
  const [researchMode, setResearchMode] = useState('mixed');   // 'mixed' | 'single_family'
  const [familyLabel, setFamilyLabel] = useState('');

  const resetForm = () => {
    setNewName('');
    setResearchMode('mixed');
    setFamilyLabel('');
  };

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get('/projects/')).data,
  });

  const createMutation = useMutation({
    mutationFn: async (payload) => api.post('/projects/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setCreating(false);
      resetForm();
    },
    onError: (err) =>
      alert(err?.response?.data?.detail || 'Failed to create project'),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId) => api.delete(`/projects/${projectId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    onError: (err) => alert(err?.response?.data?.detail || 'Failed to delete project'),
  });

  const handleDelete = (e, project) => {
    e.stopPropagation();
    if (window.confirm(`Delete project "${project.name}" and ALL its batches, images, OCR data, and trees? This cannot be undone.`)) {
      deleteProjectMutation.mutate(project.id);
    }
  };

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    if (researchMode === 'single_family' && !familyLabel.trim()) {
      alert('Family name is required for single-family research projects.');
      return;
    }
    createMutation.mutate({
      name: newName.trim(),
      research_mode: researchMode,
      family_label: researchMode === 'single_family' ? familyLabel.trim() : null,
    });
  };

  return (
    <div className="max-w-[1400px] mx-auto px-8 py-12">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-12">
        <div>
          <div className="eyebrow eyebrow-rule mb-5">Workspace · Projects</div>
          <h1 className="display-heading text-5xl lg:text-6xl">
            My research
            <br />
            <span className="italic-accent text-4xl lg:text-5xl">projects.</span>
          </h1>
          <p className="text-ink-secondary text-[15px] mt-5 max-w-xl">
            Manage your genealogical collections and processing pipelines.
            Each project holds batches of documents; each batch runs through the AI pipeline independently.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="group inline-flex items-center gap-3 bg-navy-800 hover:bg-navy-900 text-white font-semibold pl-5 pr-2 py-3 rounded-md transition-all shadow-warm-md self-start lg:self-end"
        >
          <Plus size={16} strokeWidth={2.5} />
          <span>New project</span>
          <span className="w-8 h-8 rounded-md bg-orange-500 group-hover:bg-orange-600 flex items-center justify-center transition-colors">
            <ArrowRight size={14} strokeWidth={2.5} />
          </span>
        </button>
      </div>

      {creating && (
        <div className="mb-8 bg-surface rounded-md border border-line-subtle shadow-warm-sm p-6 animate-fade-up">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-orange-500" />
              <span className="font-display font-bold text-navy-800">Create a new project</span>
            </div>
            <button
              onClick={() => { setCreating(false); resetForm(); }}
              className="text-ink-tertiary hover:text-ink p-1"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleCreate} className="space-y-5">
            {/* Project name */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-tertiary mb-1.5 block">
                Project name
              </label>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Parish Records — Cork 1870–1890"
                className="input"
              />
            </div>

            {/* Research scope — this drives auto-grouping */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-tertiary mb-2 block">
                Research scope
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <ScopeOption
                  selected={researchMode === 'single_family'}
                  onClick={() => setResearchMode('single_family')}
                  icon={Users}
                  title="Single family"
                  body="All documents I upload belong to one family. Tree merges every certificate automatically."
                />
                <ScopeOption
                  selected={researchMode === 'mixed'}
                  onClick={() => setResearchMode('mixed')}
                  icon={Layers}
                  title="Mixed / archive"
                  body="Documents may span many families. AI detects groupings after processing."
                />
              </div>
            </div>

            {/* Family name — only when single-family */}
            {researchMode === 'single_family' && (
              <div className="animate-fade-up">
                <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-tertiary mb-1.5 block">
                  Family surname (or label)
                </label>
                <input
                  type="text"
                  value={familyLabel}
                  onChange={(e) => setFamilyLabel(e.target.value)}
                  placeholder="e.g. Clifford family · Morkowski family"
                  className="input"
                />
                <p className="text-[11px] text-ink-tertiary mt-1.5 leading-relaxed">
                  Every certificate uploaded here will be auto-grouped under this label.
                  The family tree page will show the merged view by default.
                </p>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={!newName.trim() || (researchMode === 'single_family' && !familyLabel.trim()) || createMutation.isPending}
                className="btn-orange disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating…' : 'Create project'}
              </button>
              <button
                type="button"
                onClick={() => { setCreating(false); resetForm(); }}
                className="btn-ghost text-[13px]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 bg-surface-raised border border-line-subtle rounded-md animate-pulse" />
          ))}
        </div>
      ) : projects?.length === 0 ? (
        <div className="relative bg-surface-raised border border-dashed border-line rounded-md text-center py-24 px-6">
          <div className="w-14 h-14 rounded-md bg-orange-100 text-orange-500 flex items-center justify-center mx-auto mb-5">
            <FolderOpen size={24} strokeWidth={2} />
          </div>
          <h3 className="font-display font-extrabold text-2xl text-navy-800 mb-2">No projects yet</h3>
          <p className="text-ink-secondary mb-6 max-w-md mx-auto">Create your first project to start processing documents.</p>
          <button onClick={() => setCreating(true)} className="btn-orange">Create first project</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects?.map((project, i) => {
            const isSingle = project.research_mode === 'single_family';
            return (
              <div
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="group relative bg-surface border border-line-subtle rounded-md p-7 cursor-pointer hover:border-orange-500 hover:-translate-y-1 hover:shadow-warm-md transition-all duration-300"
                style={{ animation: `fadeUp 0.5s ease-out ${i * 0.04}s both` }}
              >
                <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-orange-500 via-orange-500 to-orange-300 rounded-t-md opacity-0 group-hover:opacity-100 transition-opacity" />

                <button
                  onClick={(e) => handleDelete(e, project)}
                  disabled={deleteProjectMutation.isPending}
                  title="Delete project"
                  className="absolute top-3 right-3 w-8 h-8 rounded-md text-ink-tertiary hover:bg-red-50 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                >
                  <Trash2 size={15} />
                </button>

                <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-ink-tertiary mb-4 flex items-center gap-2">
                  <span className="font-display font-extrabold text-2xl text-navy-100 group-hover:text-orange-500 transition-colors leading-none">
                    0{(i % 9) + 1}
                  </span>
                  <span className="flex-1 h-px bg-line-subtle" />
                  {isSingle ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] rounded bg-orange-100 text-orange-700 border border-orange-200">
                      <Users size={9} strokeWidth={2.5} />
                      Single family
                    </span>
                  ) : (
                    <span className="badge-pending">{project.status || 'active'}</span>
                  )}
                </div>

                <h3 className="font-display font-extrabold text-[20px] tracking-tight text-navy-800 mb-2 pr-8 leading-snug">
                  {project.name}
                </h3>

                {isSingle && project.family_label && (
                  <div className="text-[12px] font-semibold text-orange-600 mb-2">
                    {project.family_label}
                  </div>
                )}

                <p className="text-ink-secondary text-[13px] mb-5 line-clamp-2 leading-relaxed">
                  {project.description || (isSingle
                    ? 'All certificates in this project auto-merge into one family tree.'
                    : 'Multiple families · AI detects groupings after processing.')}
                </p>
                <div className="flex justify-between items-center text-[11px] text-ink-tertiary">
                  <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
                  <span className="inline-flex items-center gap-1 text-orange-500 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                    Open
                    <ArrowRight size={12} strokeWidth={2.5} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Two-option scope card used in the create-project form.
const ScopeOption = ({ selected, onClick, icon: Icon, title, body }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group text-left p-4 rounded-md border-2 transition-all ${
      selected
        ? 'border-orange-500 bg-orange-50 shadow-warm-sm'
        : 'border-line bg-surface hover:border-orange-300 hover:bg-orange-50/40'
    }`}
  >
    <div className="flex items-start gap-3">
      <div
        className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 transition-colors ${
          selected ? 'bg-orange-500 text-white' : 'bg-surface-sunken text-navy-800'
        }`}
      >
        <Icon size={16} strokeWidth={2.2} />
      </div>
      <div className="min-w-0">
        <div className={`font-display font-bold text-[14px] tracking-tight mb-1 ${
          selected ? 'text-orange-700' : 'text-navy-800'
        }`}>
          {title}
        </div>
        <div className="text-[11px] text-ink-secondary leading-relaxed">{body}</div>
      </div>
      <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-1 transition-all flex items-center justify-center ${
        selected ? 'border-orange-500 bg-orange-500' : 'border-line'
      }`}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>
    </div>
  </button>
);

export default Dashboard;
