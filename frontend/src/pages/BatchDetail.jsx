import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import { ArrowLeft, Upload, Image as ImageIcon, Play, CheckCircle2, Trash2, FileSpreadsheet } from 'lucide-react';

const BatchDetail = () => {
  const { project_id, batch_id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);

  const { data: batch } = useQuery({
    queryKey: ['batch', batch_id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/`);
      return response.data.find(b => b.id === parseInt(batch_id));
    }
  });

  const { data: images, isLoading } = useQuery({
    queryKey: ['images', batch_id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/${batch_id}/images/`);
      return response.data;
    }
  });

  const uploadMutation = useMutation({
    mutationFn: async (files) => {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
      return api.post(`/projects/${project_id}/batches/${batch_id}/images/`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['images', batch_id]);
      setIsUploading(false);
    }
  });

  const handleFileChange = (e) => {
    if (e.target.files.length > 0) {
      setIsUploading(true);
      uploadMutation.mutate(e.target.files);
    }
  };

  const deleteImageMutation = useMutation({
    mutationFn: async (imageId) =>
      api.delete(`/projects/${project_id}/batches/${batch_id}/images/${imageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images', batch_id] });
      queryClient.invalidateQueries({ queryKey: ['batch', batch_id] });
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: async () => api.delete(`/projects/${project_id}/batches/${batch_id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches', project_id] });
      navigate(`/projects/${project_id}`);
    },
  });

  const handleDeleteImage = (e, image) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${image.original_filename}"? This cannot be undone.`)) {
      deleteImageMutation.mutate(image.id);
    }
  };

  const handleDeleteBatch = () => {
    if (window.confirm(`Delete batch "${batch?.name}" and all its images? This cannot be undone.`)) {
      deleteBatchMutation.mutate();
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <button 
        onClick={() => navigate(`/projects/${project_id}`)}
        className="flex items-center gap-2 text-ink-secondary hover:text-brand-amber mb-6 transition-colors"
      >
        <ArrowLeft size={18} />
        Back to Project
      </button>

      <div className="flex justify-between items-start mb-12">
        <div>
          <h1 className="heading-display text-4xl mb-2">{batch?.name}</h1>
          <div className="flex items-center gap-3">
            <span className={`badge-${batch?.status}`}>{batch?.status}</span>
            <span className="text-ink-tertiary">•</span>
            <span className="text-ink-secondary">{images?.length || 0} Images uploaded</span>
          </div>
        </div>
        
        <div className="flex gap-3">
          <label className="btn-secondary flex items-center gap-2 cursor-pointer">
            <Upload size={18} />
            {isUploading ? 'Uploading...' : 'Upload Files'}
            <input
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={isUploading}
              accept="image/*,.xlsx,.xls,.csv,.tsv,.pdf"
            />
          </label>
          <button
            onClick={() => navigate(`/projects/${project_id}/batches/${batch_id}/visionmax`)}
            className="btn-primary flex items-center gap-2"
            disabled={!images?.length}
          >
            <Play size={18} />
            Start Processing
          </button>
          <button
            onClick={handleDeleteBatch}
            disabled={deleteBatchMutation.isPending}
            className="btn-danger flex items-center gap-2"
            title="Delete entire batch"
          >
            <Trash2 size={18} />
            {deleteBatchMutation.isPending ? 'Deleting...' : 'Delete Batch'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {isLoading ? (
          [1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="aspect-[3/4] bg-surface-raised animate-pulse rounded-lg" />
          ))
        ) : images?.length === 0 ? (
          <div className="col-span-full py-24 text-center bg-surface-raised rounded-xl border-2 border-dashed border-line">
            <ImageIcon size={48} className="mx-auto mb-4 text-ink-tertiary" />
            <h3 className="heading-section mb-2">No images in this batch</h3>
            <p className="text-ink-secondary">Upload scanned documents to begin the extraction pipeline.</p>
          </div>
        ) : (
          images?.map((image) => {
            const isSheet = image.file_type === 'spreadsheet';
            // Spreadsheets skip VisionMax/TextIQ — go straight to IndexGenius
            const targetPath = isSheet
              ? `/projects/${project_id}/batches/${batch_id}/indexgenius`
              : `/projects/${project_id}/batches/${batch_id}/visionmax`;
            return (
              <div
                key={image.id}
                onClick={() => navigate(targetPath)}
                className="group relative aspect-[3/4] card overflow-hidden cursor-pointer hover:border-brand-amber transition-all"
              >
                {isSheet ? (
                  <div className="h-full w-full bg-gradient-to-br from-emerald-50 to-teal-100 flex flex-col items-center justify-center p-3 text-emerald-900">
                    <FileSpreadsheet size={48} strokeWidth={1.6} className="text-emerald-600 mb-2" />
                    <div className="text-[10px] uppercase tracking-widest font-semibold text-emerald-700">
                      Spreadsheet
                    </div>
                    {image.spreadsheet_summary && (
                      <div className="mt-2 text-[10px] text-emerald-800 text-center">
                        <div>{image.spreadsheet_summary.row_count} rows</div>
                        <div>{image.spreadsheet_summary.column_count} columns</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="absolute inset-0 bg-ink/10 group-hover:bg-transparent transition-colors z-10" />
                    <img
                      src={`http://localhost:8000/${image.original_path}`}
                      alt="Thumbnail"
                      className="h-full w-full object-cover"
                    />
                  </>
                )}
                <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent z-20">
                  <p className="text-[10px] text-white truncate">{image.original_filename}</p>
                </div>
                <div className="absolute top-2 right-2 z-30">
                  {image.indexgenius_status === 'done' ? (
                    <CheckCircle2 size={16} className="text-green-500 fill-white" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-brand-amber" />
                  )}
                </div>
                <button
                  onClick={(e) => handleDeleteImage(e, image)}
                  disabled={deleteImageMutation.isPending}
                  title="Delete file"
                  className="absolute top-2 left-2 z-30 w-7 h-7 rounded-full bg-white/90 text-red-600 opacity-0 group-hover:opacity-100 hover:bg-red-600 hover:text-white shadow-warm-sm flex items-center justify-center transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default BatchDetail;
