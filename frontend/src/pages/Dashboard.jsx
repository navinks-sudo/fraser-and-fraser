import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { Plus, Folder, Trash2 } from 'lucide-react';

const Dashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const response = await api.get('/projects/');
      return response.data;
    },
  });

  const createProject = async () => {
    const name = prompt('Project Name:');
    if (!name) return;
    try {
      await api.post('/projects/', { name });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      alert('Failed to create project');
    }
  };

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId) => api.delete(`/projects/${projectId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => alert(err?.response?.data?.detail || 'Failed to delete project'),
  });

  const handleDelete = (e, project) => {
    e.stopPropagation();
    if (
      window.confirm(
        `Delete project "${project.name}" and ALL its batches, images, OCR data, and trees? This cannot be undone.`,
      )
    ) {
      deleteProjectMutation.mutate(project.id);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="flex justify-between items-center mb-12">
        <div>
          <h1 className="heading-display text-4xl mb-2">My Research Projects</h1>
          <p className="text-ink-secondary">Manage your genealogical collections and processing pipelines.</p>
        </div>
        <button onClick={createProject} className="btn-primary flex items-center gap-2">
          <Plus size={20} />
          New Project
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card h-48 animate-pulse bg-surface-raised"></div>
          ))}
        </div>
      ) : projects?.length === 0 ? (
        <div className="text-center py-24 bg-surface-raised rounded-xl border-2 border-dashed border-line">
          <Folder size={48} className="mx-auto mb-4 text-ink-tertiary" />
          <h3 className="heading-section mb-2">No projects yet</h3>
          <p className="text-ink-secondary mb-6">Create your first project to start processing documents.</p>
          <button onClick={createProject} className="btn-secondary">Create First Project</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects?.map((project) => (
            <div
              key={project.id}
              className="card p-6 cursor-pointer border-l-4 border-l-brand-amber group relative"
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <button
                onClick={(e) => handleDelete(e, project)}
                disabled={deleteProjectMutation.isPending}
                title="Delete project"
                className="absolute top-3 right-3 w-8 h-8 rounded-full text-ink-tertiary hover:bg-red-50 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
              >
                <Trash2 size={16} />
              </button>
              <h3 className="heading-section mb-2 pr-8">{project.name}</h3>
              <p className="text-ink-secondary text-sm mb-4 line-clamp-2">
                {project.description || 'No description provided.'}
              </p>
              <div className="flex justify-between items-center text-xs text-ink-tertiary">
                <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
                <span className="badge-pending">{project.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
