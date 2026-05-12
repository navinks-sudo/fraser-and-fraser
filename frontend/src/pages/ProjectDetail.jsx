import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import { Plus, ChevronRight, Layers, ArrowLeft, Trash2 } from 'lucide-react';

const ProjectDetail = () => {
  const { project_id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ['project', project_id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}`);
      return response.data;
    }
  });

  const { data: batches, isLoading } = useQuery({
    queryKey: ['batches', project_id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/`);
      return response.data;
    }
  });

  const createBatch = async () => {
    const name = prompt('Batch Name (e.g., Birth Registers 1850):');
    if (!name) return;
    try {
      await api.post(`/projects/${project_id}/batches/`, { name });
      window.location.reload();
    } catch (err) {
      alert('Failed to create batch');
    }
  };

  const deleteBatchMutation = useMutation({
    mutationFn: async (batchId) => api.delete(`/projects/${project_id}/batches/${batchId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches', project_id] });
    },
  });

  const handleDeleteBatch = (e, batch) => {
    e.stopPropagation();
    if (window.confirm(`Delete batch "${batch.name}" and all its images? This cannot be undone.`)) {
      deleteBatchMutation.mutate(batch.id);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <button 
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-2 text-ink-secondary hover:text-brand-amber mb-6 transition-colors"
      >
        <ArrowLeft size={18} />
        Back to Projects
      </button>

      <div className="flex justify-between items-end mb-12">
        <div>
          <h1 className="heading-display text-4xl mb-2">{project?.name}</h1>
          <p className="text-ink-secondary max-w-2xl">{project?.description || 'Historical document collection project.'}</p>
        </div>
        <button onClick={createBatch} className="btn-primary flex items-center gap-2">
          <Plus size={20} />
          New Batch
        </button>
      </div>

      <div className="space-y-4">
        <h2 className="heading-section mb-4 flex items-center gap-2">
          <Layers size={20} className="text-brand-amber" />
          Processing Batches
        </h2>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map(i => <div key={i} className="card h-24 animate-pulse" />)}
          </div>
        ) : batches?.length === 0 ? (
          <div className="card p-12 text-center bg-surface-raised">
            <p className="text-ink-secondary">No batches found. Create one to begin uploading images.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {batches?.map(batch => (
              <div 
                key={batch.id}
                onClick={() => navigate(`/projects/${project_id}/batches/${batch.id}`)}
                className="card p-6 flex items-center justify-between cursor-pointer group hover:border-brand-amber transition-all"
              >
                <div className="flex items-center gap-6">
                  <div className="w-12 h-12 bg-brand-amber-light rounded-lg flex items-center justify-center text-brand-amber-dark">
                    <Layers size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-ink">{batch.name}</h3>
                    <div className="flex items-center gap-4 text-sm text-ink-secondary">
                      <span>{batch.image_count} Images</span>
                      <span className="w-1 h-1 bg-ink-tertiary rounded-full" />
                      <span>Last updated {new Date(batch.updated_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`badge-${batch.status}`}>{batch.status}</span>
                  <button
                    onClick={(e) => handleDeleteBatch(e, batch)}
                    disabled={deleteBatchMutation.isPending}
                    title="Delete batch"
                    className="w-9 h-9 rounded-full text-ink-tertiary hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                  <ChevronRight size={20} className="text-ink-tertiary group-hover:text-brand-amber group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectDetail;
