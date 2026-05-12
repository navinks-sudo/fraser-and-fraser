import React from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, Scan, FileSearch, Database, GitBranch, TreeDeciduous,
  ArrowRight, Camera, Languages, ShieldCheck, ChevronRight, Cpu,
  Users, Heart,
} from 'lucide-react';
import useAuthStore from '../store/authStore';

// ─── Decorative animated family tree (SVG, hand-crafted) ────────────────────
const FloatingTree = () => (
  <svg
    viewBox="0 0 480 540"
    className="w-full max-w-md mx-auto drop-shadow-[0_30px_40px_rgba(30,58,138,0.15)]"
    fill="none"
  >
    <defs>
      <linearGradient id="trunkGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1E3A8A" />
        <stop offset="100%" stopColor="#2563EB" />
      </linearGradient>
      <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.7" />
        <stop offset="100%" stopColor="#93C5FD" stopOpacity="0.4" />
      </linearGradient>
      <radialGradient id="orbBlue" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#DBEAFE" />
        <stop offset="100%" stopColor="#3B82F6" />
      </radialGradient>
      <radialGradient id="orbPink" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#FCE7F3" />
        <stop offset="100%" stopColor="#DB2777" />
      </radialGradient>
    </defs>

    {/* trunk */}
    <path
      d="M 240 540 Q 240 470 240 410"
      stroke="url(#trunkGrad)"
      strokeWidth="6"
      strokeLinecap="round"
    />

    {/* main branches */}
    <path d="M 240 410 Q 240 360 130 320" stroke="url(#lineGrad)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M 240 410 Q 240 360 350 320" stroke="url(#lineGrad)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M 240 410 Q 240 380 240 270" stroke="url(#lineGrad)" strokeWidth="2.5" strokeLinecap="round" />

    {/* upper branches */}
    <path d="M 130 320 Q 80 280 60 220" stroke="url(#lineGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M 130 320 Q 130 280 180 240" stroke="url(#lineGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M 350 320 Q 400 280 420 220" stroke="url(#lineGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M 350 320 Q 350 280 300 240" stroke="url(#lineGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M 240 270 Q 200 230 210 170" stroke="url(#lineGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M 240 270 Q 280 230 270 170" stroke="url(#lineGrad)" strokeWidth="2" strokeLinecap="round" />

    {/* root node — primary subject */}
    <g className="origin-center" style={{ transformBox: 'fill-box' }}>
      <circle cx="240" cy="410" r="22" fill="white" stroke="#1E3A8A" strokeWidth="3" />
      <circle cx="240" cy="410" r="14" fill="url(#trunkGrad)" />
    </g>

    {/* mid-level — couple */}
    <g style={{ animation: 'float 6s ease-in-out infinite' }}>
      <circle cx="130" cy="320" r="18" fill="url(#orbBlue)" />
      <circle cx="130" cy="320" r="18" fill="white" fillOpacity="0.3" />
    </g>
    <g style={{ animation: 'float 6s ease-in-out infinite', animationDelay: '0.7s' }}>
      <circle cx="350" cy="320" r="18" fill="url(#orbPink)" />
      <circle cx="350" cy="320" r="18" fill="white" fillOpacity="0.3" />
    </g>
    <g style={{ animation: 'float 5s ease-in-out infinite', animationDelay: '1.3s' }}>
      <circle cx="240" cy="270" r="16" fill="url(#orbBlue)" />
    </g>

    {/* leaves — top generation */}
    <g style={{ animation: 'float 5s ease-in-out infinite', animationDelay: '0.2s' }}>
      <circle cx="60" cy="220" r="14" fill="url(#orbBlue)" />
    </g>
    <g style={{ animation: 'float 4.5s ease-in-out infinite', animationDelay: '0.9s' }}>
      <circle cx="180" cy="240" r="14" fill="url(#orbPink)" />
    </g>
    <g style={{ animation: 'float 5.2s ease-in-out infinite', animationDelay: '1.6s' }}>
      <circle cx="420" cy="220" r="14" fill="url(#orbPink)" />
    </g>
    <g style={{ animation: 'float 4.8s ease-in-out infinite', animationDelay: '0.4s' }}>
      <circle cx="300" cy="240" r="14" fill="url(#orbBlue)" />
    </g>
    <g style={{ animation: 'float 5.5s ease-in-out infinite', animationDelay: '1.1s' }}>
      <circle cx="210" cy="170" r="13" fill="url(#orbPink)" />
    </g>
    <g style={{ animation: 'float 5s ease-in-out infinite', animationDelay: '0.6s' }}>
      <circle cx="270" cy="170" r="13" fill="url(#orbBlue)" />
    </g>

    {/* sparkle particles */}
    {[
      { x: 90, y: 80, d: 0 }, { x: 380, y: 100, d: 1.2 }, { x: 50, y: 380, d: 2.4 },
      { x: 410, y: 400, d: 1.8 }, { x: 250, y: 50, d: 3.0 },
    ].map((s, i) => (
      <circle
        key={i}
        cx={s.x}
        cy={s.y}
        r="2"
        fill="#3B82F6"
        style={{ animation: `twinkle 3s ease-in-out infinite`, animationDelay: `${s.d}s` }}
      />
    ))}
  </svg>
);

const PIPELINE = [
  { icon: Camera,       title: 'Upload',       sub: 'Any image format — JPEG, PNG, TIFF, WEBP', color: '#3B82F6' },
  { icon: Sparkles,     title: 'VisionMax',    sub: 'Auto-quality scoring · sharpen · denoise · deskew', color: '#06B6D4' },
  { icon: Scan,         title: 'TextIQ',       sub: 'Region-aware OCR with word + char confidence', color: '#8B5CF6' },
  { icon: Database,     title: 'IndexGenius',  sub: 'Gemini extracts every name, date, place, role',   color: '#10B981' },
  { icon: GitBranch,    title: 'GedcomX',      sub: 'Industry-standard genealogy graph',                color: '#F59E0B' },
  { icon: TreeDeciduous,title: 'Family Tree',  sub: 'AI-deduped persons, gender-coloured nodes',        color: '#DB2777' },
];

const FEATURES = [
  { icon: Cpu,           title: 'Local OCR via Ollama Qwen 2.5-VL', body: 'Run vision OCR fully on your machine. No data leaves until you choose Gemini fallback.' },
  { icon: ShieldCheck,   title: 'Word-level confidence scoring',    body: 'Every transcribed word ships with a probability. Suspect characters glow red, certain ones fade in.' },
  { icon: Languages,     title: 'Detect & translate any language',  body: 'French, Latin, Spanish, German registers — auto-detected, one click to English.' },
  { icon: Users,         title: 'AI relationship mapping',          body: 'Gemini reads dozens of records, deduplicates the same person across pages, infers every kinship.' },
  { icon: FileSearch,    title: 'Open-ended metadata extraction',   body: 'Not just names + dates — occupations, witnesses, dioceses, page numbers, civil status, and more.' },
  { icon: Heart,         title: 'Innovative tree visualisation',    body: 'Gender-colored circular avatars, click any node for a full ancestry side-panel.' },
];

const Landing = () => {
  const isAuth = useAuthStore((s) => s.isAuthenticated);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 relative overflow-x-hidden text-ink">
      {/* Animated colour orbs */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[500px] h-[500px] bg-blue-400/25 rounded-full blur-3xl animate-pulse-slow" />
      <div className="pointer-events-none absolute top-1/4 -right-40 w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1.5s' }} />
      <div className="pointer-events-none absolute bottom-0 left-1/3 w-[600px] h-[600px] bg-violet-300/15 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '3s' }} />
      {/* Subtle grid backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(#1E3A8A 1px, transparent 1px), linear-gradient(90deg, #1E3A8A 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Nav */}
      <nav className="relative z-10 max-w-7xl mx-auto px-8 py-6 flex justify-between items-center">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-700 to-blue-500 rounded-xl flex items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform">
            <TreeDeciduous size={20} strokeWidth={2} />
          </div>
          <div>
            <div className="font-display font-bold text-xl text-ink tracking-tight">GenealogIQ</div>
            <div className="text-[10px] uppercase tracking-widest text-blue-700 font-semibold -mt-0.5">Researcher Portal</div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          {isAuth ? (
            <Link to="/dashboard" className="btn-primary text-sm flex items-center gap-2">
              Open Dashboard
              <ArrowRight size={16} />
            </Link>
          ) : (
            <>
              <Link to="/login" className="text-sm font-medium text-ink-secondary hover:text-blue-700 px-3 py-2 transition-colors">
                Sign in
              </Link>
              <Link to="/register" className="btn-primary text-sm flex items-center gap-2">
                Start Free
                <ArrowRight size={16} />
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-7xl mx-auto px-8 pt-12 pb-24 grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 border border-blue-200 text-blue-800 text-xs font-medium mb-6 shadow-sm">
            <Sparkles size={14} />
            AI-powered genealogy research
          </span>
          <h1 className="font-display text-5xl lg:text-6xl font-extrabold leading-[1.05] tracking-tight mb-6">
            Bring forgotten{' '}
            <span className="bg-gradient-to-r from-blue-700 via-blue-500 to-cyan-500 bg-clip-text text-transparent">
              family stories
            </span>{' '}
            back to life.
          </h1>
          <p className="text-lg text-ink-secondary mb-8 leading-relaxed max-w-xl">
            Upload any historical document — parish registers, civil records, ship manifests —
            and watch as AI transcribes every word, extracts every relationship, and weaves
            them into a living family tree.
          </p>

          <div className="flex flex-wrap gap-3 mb-12">
            <Link to="/register" className="btn-primary text-base px-6 py-3 flex items-center gap-2 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all">
              Start researching free
              <ArrowRight size={18} />
            </Link>
            <Link to="/login" className="btn-secondary text-base px-6 py-3 flex items-center gap-2">
              I have an account
            </Link>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-6 max-w-md">
            {[
              { v: '6', l: 'pipeline stages' },
              { v: '0.85+', l: 'avg confidence' },
              { v: '∞', l: 'document types' },
            ].map((s, i) => (
              <div key={i}>
                <div className="text-3xl font-display font-bold bg-gradient-to-r from-blue-700 to-cyan-500 bg-clip-text text-transparent">
                  {s.v}
                </div>
                <div className="text-[11px] uppercase tracking-widest text-ink-tertiary font-medium mt-0.5">
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <FloatingTree />
        </div>
      </section>

      {/* Pipeline showcase */}
      <section className="relative z-10 max-w-7xl mx-auto px-8 py-16">
        <div className="text-center mb-14">
          <div className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-2">The Pipeline</div>
          <h2 className="font-display text-4xl font-bold mb-3">From scan to family tree in six stages</h2>
          <p className="text-ink-secondary max-w-2xl mx-auto">
            Each stage is independently inspectable. Re-run any step, edit any extracted field, and watch the downstream tree update.
          </p>
        </div>

        <div className="relative">
          {/* connecting line */}
          <div className="hidden lg:block absolute top-8 left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-blue-300 to-transparent" />
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            {PIPELINE.map((p, i) => (
              <div
                key={p.title}
                className="relative bg-white/70 backdrop-blur border border-blue-100 rounded-2xl p-5 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                style={{ animation: `fadeUp 0.8s ease-out ${i * 0.1}s both` }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-md mb-3"
                  style={{ backgroundColor: p.color }}
                >
                  <p.icon size={22} strokeWidth={2} />
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-tertiary">
                  Stage {i + 1}
                </div>
                <div className="font-display font-bold text-lg mb-1">{p.title}</div>
                <div className="text-xs text-ink-secondary leading-relaxed">{p.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="relative z-10 max-w-7xl mx-auto px-8 py-16">
        <div className="text-center mb-14">
          <div className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-2">Capabilities</div>
          <h2 className="font-display text-4xl font-bold mb-3">Everything a serious genealogist needs</h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group bg-white border border-line-subtle rounded-2xl p-6 hover:border-blue-300 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
            >
              <div className="w-11 h-11 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center mb-4 group-hover:bg-blue-700 group-hover:text-white transition-colors">
                <f.icon size={20} strokeWidth={2} />
              </div>
              <div className="font-semibold text-ink mb-1.5">{f.title}</div>
              <div className="text-sm text-ink-secondary leading-relaxed">{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 py-20">
        <div className="relative bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-600 rounded-3xl p-12 lg:p-16 overflow-hidden shadow-2xl shadow-blue-900/30">
          <div className="absolute -top-24 -right-24 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-cyan-400/20 rounded-full blur-3xl" />
          <div className="relative z-10 grid lg:grid-cols-[1.5fr_1fr] gap-8 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/15 rounded-full text-xs text-blue-100 font-medium backdrop-blur mb-4">
                <Sparkles size={12} />
                Ready when you are
              </div>
              <h3 className="font-display text-3xl lg:text-4xl font-bold text-white leading-tight mb-4">
                Start tracing your family tree in five minutes
              </h3>
              <p className="text-blue-100 mb-6 leading-relaxed">
                Free account. Local OCR via Ollama. Bring your own Gemini key for AI-driven extraction and tree synthesis.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to="/register" className="bg-white text-blue-700 hover:bg-blue-50 font-semibold px-6 py-3 rounded-md flex items-center gap-2 shadow-lg transition-all hover:scale-105">
                  Create free account
                  <ChevronRight size={18} />
                </Link>
                <Link to="/login" className="bg-white/10 text-white hover:bg-white/20 font-medium px-6 py-3 rounded-md flex items-center gap-2 backdrop-blur transition-colors">
                  Sign in
                </Link>
              </div>
            </div>
            <div className="hidden lg:flex justify-center">
              <TreeDeciduous size={140} strokeWidth={1.2} className="text-white/20" />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 max-w-7xl mx-auto px-8 py-10 border-t border-line-subtle">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-ink-tertiary">
          <div className="flex items-center gap-2">
            <TreeDeciduous size={16} className="text-blue-700" />
            <span>GenealogIQ — Researcher Portal</span>
          </div>
          <div className="flex gap-6">
            <a href="#" className="hover:text-blue-700 transition-colors">Documentation</a>
            <a href="#" className="hover:text-blue-700 transition-colors">Privacy</a>
            <a href="#" className="hover:text-blue-700 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
