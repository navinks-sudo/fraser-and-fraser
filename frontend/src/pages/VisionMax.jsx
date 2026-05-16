import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { assetUrl } from '../api/axios';
import StageProgress from '../components/Layout/StageProgress';
import { Sliders, RotateCcw, Save, ChevronLeft, ChevronRight, Gauge, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

// Innovative quality gauge — radial donut + breakdown bars
const QualityGauge = ({ score, label, delta }) => {
  const s = Math.max(0, Math.min(100, score || 0));
  const angle = (s / 100) * 360;
  // hue: 0 (red) → 130 (green) tied to score
  const hue = (s / 100) * 130;
  const ringColor = `hsl(${hue}, 70%, 50%)`;
  const grade =
    s >= 85 ? 'EXCELLENT' : s >= 70 ? 'GOOD' : s >= 55 ? 'FAIR' : s >= 40 ? 'POOR' : 'VERY POOR';
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center text-sm font-semibold relative"
        style={{
          background: `conic-gradient(${ringColor} ${angle}deg, #E2E8F0 ${angle}deg 360deg)`,
        }}
      >
        <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center">
          <span style={{ color: ringColor }}>{Math.round(s)}</span>
        </div>
      </div>
      <div className="text-xs">
        <div className="text-ink-tertiary uppercase tracking-wider text-[9px] mb-0.5">{label}</div>
        <div className="font-medium" style={{ color: ringColor }}>{grade}</div>
        {delta != null && (
          <div className={`text-[10px] flex items-center gap-0.5 mt-0.5 ${
            delta > 1 ? 'text-green-600' : delta < -1 ? 'text-red-600' : 'text-ink-tertiary'
          }`}>
            {delta > 1 ? <ArrowUpRight size={10} /> : delta < -1 ? <ArrowDownRight size={10} /> : <Minus size={10} />}
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}
          </div>
        )}
      </div>
    </div>
  );
};

const MetricBar = ({ label, value, before }) => {
  const v = Math.max(0, Math.min(100, value || 0));
  const hue = (v / 100) * 130;
  const beforeShown = before != null && Math.abs(before - v) > 0.5;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-ink-secondary">
        <span className="capitalize">{label}</span>
        <span className="tabular-nums">
          {beforeShown && <span className="text-ink-tertiary">{Math.round(before)} → </span>}
          <span className="font-semibold" style={{ color: `hsl(${hue}, 70%, 40%)` }}>{Math.round(v)}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-line-subtle relative overflow-hidden">
        {beforeShown && (
          <div
            className="absolute inset-y-0 bg-line"
            style={{ width: `${before}%` }}
          />
        )}
        <div
          className="absolute inset-y-0 rounded-full transition-all"
          style={{ width: `${v}%`, backgroundColor: `hsl(${hue}, 70%, 50%)` }}
        />
      </div>
    </div>
  );
};

const VisionMax = () => {
  const { project_id, batch_id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);
  const [sharpness, setSharpness] = useState(1.0);

  const { data: images } = useQuery({
    queryKey: ['images', batch_id],
    queryFn: async () => {
      const response = await api.get(`/projects/${project_id}/batches/${batch_id}/images/`);
      return response.data;
    }
  });

  const currentImage = images?.[currentImageIndex];
  const isSheet = currentImage?.file_type === 'spreadsheet';

  const { data: quality, refetch: refetchQuality } = useQuery({
    queryKey: ['quality', currentImage?.id, currentImage?.has_enhancement],
    queryFn: async () => {
      if (!currentImage) return null;
      const r = await api.get(`/projects/${project_id}/batches/${batch_id}/visionmax/${currentImage.id}/quality`);
      return r.data;
    },
    enabled: !!currentImage,
  });

  const enhanceMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/projects/${project_id}/batches/${batch_id}/visionmax/${currentImage.id}/enhance?brightness=${brightness}&contrast=${contrast}&sharpness=${sharpness}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images', batch_id] });
      refetchQuality();
    }
  });

  const revertMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/projects/${project_id}/batches/${batch_id}/visionmax/${currentImage.id}/revert`);
    },
    onSuccess: () => {
      setBrightness(1.0);
      setContrast(1.0);
      setSharpness(1.0);
      queryClient.invalidateQueries(['images', batch_id]);
    }
  });

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

  if (isSheet) {
    return (
      <div className="flex flex-col h-screen bg-surface-canvas">
        <StageProgress />
        <div className="flex-1 flex items-center justify-center p-8 bg-gradient-to-br from-emerald-50 to-teal-100">
          <div className="bg-white rounded-2xl shadow-warm-md border border-emerald-200 p-8 max-w-md text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 mx-auto flex items-center justify-center mb-4">
              <span className="text-2xl">📊</span>
            </div>
            <h2 className="heading-section mb-2">Spreadsheet — VisionMax skipped</h2>
            <p className="text-ink-secondary text-sm mb-6">
              Image enhancement is not needed for tabular data. Spreadsheet rows go
              straight into AI extraction.
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
        {/* Left Panel - Image Canvas */}
        <div className="flex-1 bg-[#2D2B27] flex flex-col items-center justify-center p-8 relative">
          <div className="absolute top-4 left-4 text-white/50 text-sm font-mono">
            {currentImage?.original_filename} ({currentImageIndex + 1} / {images?.length})
          </div>
          
          <div className="max-h-full max-w-full shadow-2xl relative">
            <img 
              src={assetUrl(currentImage?.has_enhancement ? currentImage.enhanced_path : currentImage?.original_path)}
              alt="Document"
              className="max-h-[80vh] object-contain border border-white/10"
              key={currentImage?.id} // Force reload on image change
            />
          </div>

          <div className="absolute bottom-8 flex gap-4">
            <button 
              onClick={handlePrev} 
              disabled={currentImageIndex === 0}
              className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-30 transition-all"
            >
              <ChevronLeft />
            </button>
            <button 
              onClick={handleNext} 
              disabled={currentImageIndex === images?.length - 1}
              className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-30 transition-all"
            >
              <ChevronRight />
            </button>
          </div>
        </div>

        {/* Right Panel - Controls */}
        <div className="w-80 bg-surface border-l border-line p-6 flex flex-col gap-6 shadow-warm-lg overflow-y-auto">
          {/* Quality gauge */}
          <div>
            <h2 className="heading-section flex items-center gap-2 mb-3">
              <Gauge size={18} className="text-brand-amber" />
              Image Quality
            </h2>
            {quality?.before ? (
              <div className="space-y-3">
                <div className="flex gap-4">
                  <QualityGauge
                    score={quality.before.composite}
                    label="Original"
                  />
                  {quality.after && (
                    <QualityGauge
                      score={quality.after.composite}
                      label="Enhanced"
                      delta={quality.delta?.composite_delta}
                    />
                  )}
                </div>
                <div className="space-y-2 pt-2 border-t border-line-subtle">
                  {['sharpness', 'contrast', 'noise', 'brightness', 'skew'].map((key) => (
                    <MetricBar
                      key={key}
                      label={key}
                      value={quality.after?.metrics?.[key] ?? quality.before.metrics[key]}
                      before={quality.after ? quality.before.metrics[key] : null}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-16 bg-surface-sunken rounded animate-pulse" />
            )}
          </div>

          <div className="border-t border-line-subtle pt-4">
            <h2 className="heading-section flex items-center gap-2 mb-4">
              <Sliders size={20} className="text-brand-amber" />
              Enhancement
            </h2>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <label>Brightness</label>
                  <span className="text-brand-amber">{brightness.toFixed(1)}x</span>
                </div>
                <input 
                  type="range" min="0.5" max="2.0" step="0.1" 
                  value={brightness} 
                  onChange={(e) => setBrightness(parseFloat(e.target.value))}
                  className="w-full accent-brand-amber"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <label>Contrast</label>
                  <span className="text-brand-amber">{contrast.toFixed(1)}x</span>
                </div>
                <input 
                  type="range" min="0.5" max="2.0" step="0.1" 
                  value={contrast} 
                  onChange={(e) => setContrast(parseFloat(e.target.value))}
                  className="w-full accent-brand-amber"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <label>Sharpness</label>
                  <span className="text-brand-amber">{sharpness.toFixed(1)}x</span>
                </div>
                <input 
                  type="range" min="0.5" max="3.0" step="0.1" 
                  value={sharpness} 
                  onChange={(e) => setSharpness(parseFloat(e.target.value))}
                  className="w-full accent-brand-amber"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 mt-auto">
            <button 
              onClick={() => enhanceMutation.mutate()}
              disabled={enhanceMutation.isPending}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2"
            >
              <Save size={18} />
              {enhanceMutation.isPending ? 'Processing...' : 'Apply Changes'}
            </button>
            <button 
              onClick={() => revertMutation.mutate()}
              className="btn-secondary w-full py-3 flex items-center justify-center gap-2"
            >
              <RotateCcw size={18} />
              Revert to Original
            </button>
            <button 
              onClick={() => navigate(`/projects/${project_id}/batches/${batch_id}/textiq`)}
              className="btn-ghost w-full py-2 flex items-center justify-center gap-2 text-brand-amber font-bold mt-2"
            >
              Continue to TextIQ
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VisionMax;
