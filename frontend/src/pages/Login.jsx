import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import useAuthStore from '../store/authStore';
import { User, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import SblLogo from '../components/SblLogo';

const BrandMark = ({ size = 44 }) => <SblLogo size={size} showTagline={false} />;

const AuthHeroPanel = ({ eyebrow, headline, accent, body }) => (
  <div
    className="hidden lg:flex relative lg:w-[55%] overflow-hidden"
    style={{ background: 'linear-gradient(140deg, #07142A 0%, #0B1F3A 55%, #142849 100%)' }}
  >
    {/* dot grid */}
    <div
      className="absolute inset-0 opacity-[0.05] pointer-events-none"
      style={{
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px)',
        backgroundSize: '4px 4px',
      }}
    />
    {/* orange glow */}
    <div className="absolute -top-32 -left-20 w-[420px] h-[420px] bg-orange-500/20 rounded-full blur-3xl animate-pulse-slow" />
    <div className="absolute bottom-0 -right-20 w-[420px] h-[420px] bg-orange-500/10 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '2s' }} />

    {/* Stylised editorial pedigree mark — anchor + branches */}
    <svg className="absolute right-[-60px] top-1/2 -translate-y-1/2 w-[640px] h-[640px] opacity-50" viewBox="0 0 600 600" fill="none">
      <defs>
        <linearGradient id="branchOrange" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="#F38B45" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#F38B45" stopOpacity="0.05" />
        </linearGradient>
        <radialGradient id="dotOrange" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FDEADA" />
          <stop offset="100%" stopColor="#E25E10" />
        </radialGradient>
      </defs>
      {/* trunk */}
      <path d="M 300 600 L 300 380" stroke="url(#branchOrange)" strokeWidth="2" />
      {/* U connector */}
      <path d="M 150 320 L 150 380 L 450 380 L 450 320" stroke="url(#branchOrange)" strokeWidth="2" />
      {/* parents */}
      <path d="M 150 320 L 150 220" stroke="url(#branchOrange)" strokeWidth="2" />
      <path d="M 450 320 L 450 220" stroke="url(#branchOrange)" strokeWidth="2" />
      {/* grand-parent rails */}
      <path d="M 80 160 L 80 220 L 220 220 L 220 160" stroke="url(#branchOrange)" strokeWidth="1.5" />
      <path d="M 380 160 L 380 220 L 520 220 L 520 160" stroke="url(#branchOrange)" strokeWidth="1.5" />
      {/* anchor dots */}
      {[[300,380],[150,320],[450,320],[150,220],[450,220],[80,160],[220,160],[380,160],[520,160]].map(([x,y],i)=>(
        <g key={i} style={{ animation: `float 5s ease-in-out infinite`, animationDelay: `${i*0.2}s`, transformOrigin: `${x}px ${y}px` }}>
          <circle cx={x} cy={y} r="10" fill="url(#dotOrange)" />
          <circle cx={x} cy={y} r="14" fill="none" stroke="#F38B45" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
        </g>
      ))}
    </svg>

    <div className="relative z-10 p-12 flex flex-col justify-between w-full">
      <Link to="/" className="flex items-center gap-3 group w-fit">
        <BrandMark size={42} />
        <div className="leading-none">
          <div className="font-display font-extrabold text-[17px] text-white">SBL Knowledge Services</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-orange-300 mt-1">Genealogy AI</div>
        </div>
      </Link>

      <div className="max-w-md">
        <div className="eyebrow text-orange-300 eyebrow-rule mb-7" style={{ color: '#F7AE74' }}>
          {eyebrow}
        </div>
        <h2 className="display-heading text-white text-5xl xl:text-6xl">
          {headline}
          <br />
          <span className="italic-accent text-orange-300 text-4xl xl:text-5xl">{accent}</span>
        </h2>
        <p className="text-navy-100/85 leading-relaxed mt-6 text-[15px]">{body}</p>
      </div>

      <div className="flex gap-6 text-navy-100/55 text-[11px] tracking-[0.22em] uppercase font-semibold">
        <span>v1.0 · 2026</span>
        <Link to="/" className="hover:text-white transition-colors">← Back to home</Link>
      </div>
    </div>
  </div>
);

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);
      const response = await api.post('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      setAuth({ username }, response.data.access_token);
      navigate('/dashboard');
    } catch (err) {
      setError(err?.response?.data?.detail || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-surface-canvas">
      <AuthHeroPanel
        eyebrow="Welcome back"
        headline={<>Continue tracing<br />the lineage<br />you started</>}
        accent="when failure is not an option."
        body="Pick up where you left off — your batches, OCR transcriptions, and AI-built family trees are exactly where you parked them."
      />

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-16 relative">
        <div className="lg:hidden absolute top-8 left-8">
          <Link to="/" className="flex items-center gap-3">
            <BrandMark size={36} />
            <div className="font-display font-extrabold text-navy-800 text-[16px]">SBL Knowledge Services</div>
          </Link>
        </div>

        <div className="w-full max-w-md">
          <div className="eyebrow eyebrow-rule mb-6">Researcher access</div>
          <h1 className="display-heading text-4xl mb-2">Sign in.</h1>
          <p className="text-[15px] text-ink-secondary mb-9">
            New here?{' '}
            <Link to="/register" className="text-orange-500 font-semibold hover:text-orange-600 underline underline-offset-4 decoration-2">
              Create an account
            </Link>
          </p>

          {error && (
            <div className="mb-5 p-3.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-[13px] font-medium flex items-start gap-2">
              <span className="mt-0.5">⚠</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-tertiary mb-2 block">
                Username
              </label>
              <div className="relative">
                <User size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="admin"
                  className="w-full pl-11 pr-4 py-3.5 bg-white border border-line rounded-md focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-tertiary mb-2 block">
                Password
              </label>
              <div className="relative">
                <Lock size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full pl-11 pr-11 py-3.5 bg-white border border-line rounded-md focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary hover:text-ink p-1"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="group w-full mt-2 inline-flex items-center justify-between bg-navy-800 hover:bg-navy-900 text-white font-semibold pl-5 pr-2 py-3 rounded-md transition-all shadow-warm-md disabled:opacity-60"
            >
              <span>{loading ? 'Signing in…' : 'Sign in'}</span>
              <span className="w-9 h-9 rounded-md bg-orange-500 group-hover:bg-orange-600 flex items-center justify-center transition-colors">
                <ArrowRight size={16} strokeWidth={2.5} />
              </span>
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-line-subtle text-[12px] text-ink-tertiary">
            Demo credentials: <code className="px-1.5 py-0.5 bg-surface-raised border border-line-subtle rounded font-mono text-navy-800">admin / password123</code>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
