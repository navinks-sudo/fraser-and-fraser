import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { TreeDeciduous, Mail, Lock, ArrowRight, Sparkles, Eye, EyeOff, AtSign } from 'lucide-react';

const RegisterTreeArt = () => (
  <svg viewBox="0 0 600 700" className="w-full h-full" fill="none" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="trunkReg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7" />
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.2" />
      </linearGradient>
      <linearGradient id="branchReg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#A5F3FC" stopOpacity="0.65" />
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.15" />
      </linearGradient>
      <radialGradient id="dotRegM" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#DBEAFE" />
        <stop offset="100%" stopColor="#3B82F6" />
      </radialGradient>
      <radialGradient id="dotRegF" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#FCE7F3" />
        <stop offset="100%" stopColor="#DB2777" />
      </radialGradient>
    </defs>
    <path d="M 300 700 Q 300 600 300 500" stroke="url(#trunkReg)" strokeWidth="6" strokeLinecap="round" />
    <path d="M 300 500 Q 300 430 150 380" stroke="url(#branchReg)" strokeWidth="2" strokeLinecap="round" />
    <path d="M 300 500 Q 300 430 450 380" stroke="url(#branchReg)" strokeWidth="2" strokeLinecap="round" />
    <path d="M 300 500 Q 300 450 300 320" stroke="url(#branchReg)" strokeWidth="2" strokeLinecap="round" />
    <path d="M 150 380 Q 70 320 80 250" stroke="url(#branchReg)" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M 450 380 Q 530 320 520 250" stroke="url(#branchReg)" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M 300 320 Q 250 270 260 200" stroke="url(#branchReg)" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M 300 320 Q 350 270 340 200" stroke="url(#branchReg)" strokeWidth="1.5" strokeLinecap="round" />

    <circle cx="300" cy="500" r="24" fill="white" fillOpacity="0.95" stroke="#06B6D4" strokeWidth="2" />
    <g style={{ animation: 'float 5s ease-in-out infinite' }}>
      <circle cx="150" cy="380" r="18" fill="url(#dotRegM)" opacity="0.9" />
    </g>
    <g style={{ animation: 'float 5s ease-in-out infinite', animationDelay: '0.6s' }}>
      <circle cx="450" cy="380" r="18" fill="url(#dotRegF)" opacity="0.9" />
    </g>
    <g style={{ animation: 'float 4.5s ease-in-out infinite', animationDelay: '1.2s' }}>
      <circle cx="300" cy="320" r="16" fill="url(#dotRegM)" opacity="0.85" />
    </g>
    <g style={{ animation: 'float 5.5s ease-in-out infinite', animationDelay: '0.3s' }}>
      <circle cx="80" cy="250" r="14" fill="url(#dotRegM)" opacity="0.8" />
    </g>
    <g style={{ animation: 'float 5.2s ease-in-out infinite', animationDelay: '0.9s' }}>
      <circle cx="520" cy="250" r="14" fill="url(#dotRegF)" opacity="0.8" />
    </g>
    <g style={{ animation: 'float 5.5s ease-in-out infinite', animationDelay: '0.4s' }}>
      <circle cx="260" cy="200" r="13" fill="url(#dotRegF)" opacity="0.8" />
    </g>
    <g style={{ animation: 'float 5s ease-in-out infinite', animationDelay: '1.0s' }}>
      <circle cx="340" cy="200" r="13" fill="url(#dotRegM)" opacity="0.8" />
    </g>
    {[[80, 150], [500, 130], [40, 480], [560, 460], [290, 80], [120, 600], [490, 580]].map(
      ([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2" fill="#A5F3FC"
          style={{ animation: 'twinkle 3s ease-in-out infinite', animationDelay: `${i * 0.4}s` }}
        />
      )
    )}
  </svg>
);

const passwordStrength = (pw) => {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  return { score: Math.min(5, score), label: labels[Math.min(5, score)] };
};

const Register = () => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const strength = passwordStrength(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/register', { email, username, password });
      navigate('/login');
    } catch (err) {
      setError(err?.response?.data?.detail || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-cyan-50 via-white to-blue-50 relative overflow-hidden">
      {/* ---------------- Left art panel ---------------- */}
      <div className="hidden lg:flex relative lg:w-[55%] bg-gradient-to-br from-cyan-700 via-blue-700 to-blue-900 overflow-hidden">
        <div className="absolute -top-32 -left-20 w-[400px] h-[400px] bg-cyan-300/30 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-0 -right-20 w-[400px] h-[400px] bg-blue-400/20 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '2s' }} />
        <div className="absolute inset-0">
          <RegisterTreeArt />
        </div>

        <div className="relative z-10 p-12 flex flex-col justify-between w-full">
          <Link to="/" className="flex items-center gap-2.5 group w-fit">
            <div className="w-10 h-10 bg-white/15 backdrop-blur rounded-xl flex items-center justify-center text-white border border-white/20">
              <TreeDeciduous size={20} strokeWidth={2} />
            </div>
            <div>
              <div className="font-display font-bold text-lg text-white">GenealogIQ</div>
              <div className="text-[10px] uppercase tracking-widest text-cyan-200">Researcher Portal</div>
            </div>
          </Link>

          <div>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur text-cyan-100 text-xs font-medium mb-5 border border-white/15">
              <Sparkles size={12} />
              Plant your first tree
            </span>
            <h2 className="font-display text-4xl xl:text-5xl text-white font-bold leading-tight mb-4">
              Every family has a story.<br />
              <span className="text-cyan-200">Let's find yours.</span>
            </h2>
            <p className="text-cyan-100 max-w-md leading-relaxed">
              Free account. Local OCR via Ollama. Bring your own Gemini key for AI-driven
              extraction and cross-batch tree synthesis.
            </p>
          </div>

          <div className="flex gap-6 text-cyan-200 text-xs">
            <span>v1.0 · 2026</span>
            <Link to="/" className="hover:text-white transition-colors">← Back to home</Link>
          </div>
        </div>
      </div>

      {/* ---------------- Right form panel ---------------- */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-12 relative z-10">
        <div className="absolute inset-0 lg:hidden">
          <div className="absolute -top-20 -right-20 w-80 h-80 bg-cyan-300/30 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-blue-300/20 rounded-full blur-3xl" />
        </div>

        <div className="relative w-full max-w-md">
          <div className="bg-white/80 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl shadow-blue-900/10 p-8 lg:p-10">
            <div className="lg:hidden flex items-center gap-2 mb-6">
              <div className="w-9 h-9 bg-gradient-to-br from-cyan-500 to-blue-700 rounded-xl flex items-center justify-center text-white shadow">
                <TreeDeciduous size={18} />
              </div>
              <div className="font-display font-bold text-lg">GenealogIQ</div>
            </div>

            <h1 className="font-display text-3xl font-bold text-ink mb-1.5">Create your account</h1>
            <p className="text-sm text-ink-secondary mb-7">
              Already a researcher?{' '}
              <Link to="/login" className="text-blue-700 font-medium hover:underline">
                Sign in instead
              </Link>
            </p>

            {error && (
              <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2">
                <span className="mt-0.5">⚠</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-ink-tertiary mb-1.5 block">
                  Email address
                </label>
                <div className="relative">
                  <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="name@example.com"
                    className="w-full pl-10 pr-4 py-3 bg-white border border-line rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-ink-tertiary mb-1.5 block">
                  Username
                </label>
                <div className="relative">
                  <AtSign size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                    placeholder="your_handle"
                    className="w-full pl-10 pr-4 py-3 bg-white border border-line rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-ink-tertiary mb-1.5 block">
                  Password
                </label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="w-full pl-10 pr-11 py-3 bg-white border border-line rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary hover:text-ink"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {/* strength meter */}
                {password && (
                  <div className="mt-2">
                    <div className="flex gap-1 h-1 mb-1">
                      {[1, 2, 3, 4, 5].map((tier) => {
                        const filled = tier <= strength.score;
                        const hue = (strength.score / 5) * 130;
                        return (
                          <div
                            key={tier}
                            className="flex-1 rounded-full transition-colors"
                            style={{
                              backgroundColor: filled ? `hsl(${hue}, 70%, 50%)` : '#E2E8F0',
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="text-[11px] text-ink-tertiary">
                      {strength.label}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-700 hover:to-blue-800 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-blue-500/30 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:transform-none flex items-center justify-center gap-2 mt-2"
              >
                {loading ? 'Creating account…' : 'Create account'}
                {!loading && <ArrowRight size={18} />}
              </button>
            </form>

            <p className="mt-6 text-center text-[11px] text-ink-tertiary leading-relaxed">
              By creating an account you agree to our terms. Your batches and OCR data stay private to your account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
