import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, ChevronRight, ChevronDown, Search, Sparkles,
  Scan, Database, GitBranch, TreeDeciduous, ShieldCheck, Languages,
  Users, FileSearch, Cpu, Camera, Heart, MoveRight, Loader2,
} from 'lucide-react';
import api from '../api/axios';
import useAuthStore from '../store/authStore';
import SblLogo from '../components/SblLogo';

// Brand mark wrapper — uses the SBL Knowledge Services logo.
const BrandMark = ({ size = 40, showTagline = false }) => (
  <SblLogo size={size} showTagline={showTagline} />
);

// ───────────────────────────────────────────────────────────────────────
// Live-capture panel — REAL data from the signed-in user's account.
// Falls back to a "Sign in to see your live captures" prompt when guest.
// ───────────────────────────────────────────────────────────────────────
const LiveCapturePanel = ({ isAuth, projects, batches, loading }) => {
  const rows = React.useMemo(() => {
    // Build editorial rows out of real batches: each batch gets one bar.
    // The bar "width" is normalised against the largest batch in the set.
    const all = (batches || []).slice(0, 12);
    if (!all.length) return [];
    const max = Math.max(...all.map((b) => b.image_count || 0), 1);
    return all.map((b) => ({
      id: b.id,
      projectId: b.project_id,
      name: b.name || `Batch ${b.id}`,
      count: b.image_count || 0,
      pct: Math.max(8, Math.round(((b.image_count || 0) / max) * 100)),
      treeBuilt: !!b.tree_built_at,
    }));
  }, [batches]);

  const totalDocs = (batches || []).reduce((s, b) => s + (b.image_count || 0), 0);

  return (
    <div
      className="relative w-full rounded-md overflow-hidden"
      style={{
        background: 'linear-gradient(140deg, #07142A 0%, #0B1F3A 60%, #142849 100%)',
        boxShadow: '0 40px 80px -20px rgba(11, 31, 58, 0.45)',
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none mix-blend-overlay"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '3px 3px',
        }}
      />
      {/* heading */}
      <div className="relative px-7 py-5 border-b border-white/5 flex items-center justify-between">
        <div className="text-[11px] font-semibold tracking-[0.22em] uppercase text-navy-100/80">
          {isAuth ? 'Your collections · live' : 'Live capture'}
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase text-orange-300">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
          {loading ? 'Loading…' : isAuth ? `${rows.length} ${rows.length === 1 ? 'batch' : 'batches'}` : 'Demo view'}
        </div>
      </div>

      {/* body */}
      <div className="relative px-7 py-6 min-h-[300px]">
        {!isAuth ? (
          <GuestPanelBody />
        ) : loading ? (
          <div className="flex items-center justify-center h-[260px] text-navy-100/60">
            <Loader2 size={22} className="animate-spin mr-2" />
            <span className="text-[13px] font-semibold tracking-[0.18em] uppercase">Loading your batches</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[260px] text-center">
            <div className="text-[13px] font-semibold tracking-[0.18em] uppercase text-navy-100/70 mb-3">
              No batches yet
            </div>
            <p className="text-navy-100/55 text-[13px] max-w-xs leading-relaxed mb-5">
              Create a project, drop in some documents, and they'll show up here in real time.
            </p>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-[13px] font-semibold px-4 py-2 rounded-md transition-colors"
            >
              Create your first project
              <ArrowRight size={14} strokeWidth={2.5} />
            </Link>
          </div>
        ) : (
          <>
            {/* Group rows under the project they belong to */}
            {projects.slice(0, 3).map((proj) => {
              const projRows = rows.filter((r) => r.projectId === proj.id);
              if (!projRows.length) return null;
              const projDocs = projRows.reduce((s, r) => s + r.count, 0);
              return (
                <div key={proj.id} className="mb-5 last:mb-0">
                  <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-navy-100/55 mb-2.5 flex items-center justify-between">
                    <span className="truncate">{proj.name}</span>
                    <span className="text-navy-100/40 ml-3 shrink-0">
                      {projDocs} {projDocs === 1 ? 'doc' : 'docs'}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {projRows.slice(0, 4).map((r, i) => (
                      <Link
                        key={r.id}
                        to={`/projects/${r.projectId}/batches/${r.id}`}
                        className="group block"
                        title={`Open ${r.name}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative flex-1 h-2.5 bg-white/[0.04] rounded-sm overflow-hidden">
                            <div
                              className="h-full rounded-sm animate-bar-fill transition-all group-hover:brightness-125"
                              style={{
                                width: `${r.pct}%`,
                                background: r.treeBuilt
                                  ? 'linear-gradient(90deg, #E25E10, #F38B45)'
                                  : 'rgba(255,255,255,0.22)',
                                animationDelay: `${i * 0.08}s`,
                              }}
                            />
                          </div>
                          <div className="text-[10px] tabular-nums font-semibold text-navy-100/70 group-hover:text-orange-300 w-16 text-right shrink-0 transition-colors">
                            {r.count}
                          </div>
                        </div>
                        <div className="text-[10px] text-navy-100/40 group-hover:text-navy-100/70 mt-1 truncate transition-colors">
                          {r.name}{r.treeBuilt && <span className="text-orange-300 ml-2">· tree built</span>}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* footer */}
      <div className="relative px-7 py-4 border-t border-white/5 flex items-center justify-between text-[10px] tracking-[0.22em] uppercase">
        <div className="text-navy-100/55">
          {isAuth ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}` : 'Sign in to see your data'}
        </div>
        <div className="text-orange-300">
          {isAuth ? `${totalDocs} ${totalDocs === 1 ? 'doc' : 'docs'} total` : 'Real-time pipeline'}
        </div>
      </div>
    </div>
  );
};

const GuestPanelBody = () => (
  <div className="flex flex-col items-center justify-center h-[260px] text-center">
    <div className="w-12 h-12 rounded-md bg-orange-500/10 border border-orange-500/30 text-orange-300 flex items-center justify-center mb-4">
      <TreeDeciduous size={22} strokeWidth={1.8} />
    </div>
    <div className="text-[13px] font-semibold tracking-[0.18em] uppercase text-navy-100/85 mb-2">
      Live capture · streaming
    </div>
    <p className="text-navy-100/55 text-[13px] max-w-sm leading-relaxed mb-5">
      Sign in to see your collections, batch progress, and tree builds update in real time.
    </p>
    <Link
      to="/login"
      className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-[13px] font-semibold px-4 py-2 rounded-md transition-colors"
    >
      Sign in
      <ArrowRight size={14} strokeWidth={2.5} />
    </Link>
  </div>
);

// ───────────────────────────────────────────────────────────────────────
// Single top-nav item — anchor link, or hover dropdown of real products.
const NavItem = ({ item }) => {
  const [open, setOpen] = React.useState(false);
  const hasChildren = Array.isArray(item.children) && item.children.length > 0;

  const trigger = (
    <span
      className={`relative inline-flex items-center gap-1 text-[15px] font-semibold transition-colors ${
        item.active ? 'text-navy-800' : 'text-ink-secondary hover:text-navy-800'
      }`}
    >
      {item.label}
      {hasChildren && <ChevronDown size={14} strokeWidth={2.5} className={`opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />}
      {item.active && (
        <span className="absolute -bottom-7 left-0 right-0 h-[3px] bg-orange-500 rounded-t-sm" />
      )}
    </span>
  );

  return (
    <div
      className="relative"
      onMouseEnter={() => hasChildren && setOpen(true)}
      onMouseLeave={() => hasChildren && setOpen(false)}
    >
      {item.anchor ? (
        <a href={item.anchor} className="block py-2">
          {trigger}
        </a>
      ) : (
        <button type="button" className="py-2">
          {trigger}
        </button>
      )}

      {hasChildren && open && (
        <div className="absolute top-full mt-3 left-1/2 -translate-x-1/2 bg-surface rounded-md shadow-warm-lg border border-line-subtle w-[320px] py-2 z-30">
          <div className="px-4 py-2 text-[10px] font-semibold tracking-[0.22em] uppercase text-ink-tertiary border-b border-line-subtle">
            Pipeline modules
          </div>
          {item.children.map((c) => (
            <a
              key={c.name}
              href="#pipeline"
              className="group flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-orange-50 transition-colors"
            >
              <div>
                <div className="font-display font-bold text-[14px] tracking-tight text-navy-800 group-hover:text-orange-600 transition-colors">
                  {c.name}
                </div>
                <div className="text-[11px] text-ink-tertiary">{c.desc}</div>
              </div>
              <ArrowRight size={14} strokeWidth={2.5} className="text-line-strong group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────────
// Top-nav products dropdown — driven by the actual pipeline modules,
// not a placeholder. Each entry deep-links into the relevant section.
const TOP_NAV = [
  { label: 'Pipeline',     anchor: '#pipeline'     },
  { label: 'Capabilities', anchor: '#capabilities' },
  {
    label: 'Products',
    active: true,
    children: [
      { name: 'VisionMax',   desc: 'Image quality + enhancement' },
      { name: 'TextIQ',      desc: 'Region-aware OCR' },
      { name: 'IndexGenius', desc: 'Entity & relation extraction' },
      { name: 'GedcomX',     desc: 'Genealogy graph builder' },
      { name: 'Family Tree', desc: 'Editorial pedigree chart' },
    ],
  },
  { label: 'Docs',    anchor: '#capabilities' },
  { label: 'Contact', anchor: '#cta'          },
];

const PIPELINE = [
  { icon: Camera,        title: 'Upload',       sub: 'Any image format — JPEG, PNG, TIFF, WEBP' },
  { icon: Sparkles,      title: 'VisionMax',    sub: 'Auto-quality scoring · sharpen · denoise · deskew' },
  { icon: Scan,          title: 'TextIQ',       sub: 'Region-aware OCR with word + char confidence' },
  { icon: Database,      title: 'IndexGenius',  sub: 'AI extracts every name, date, place, role' },
  { icon: GitBranch,     title: 'GedcomX',      sub: 'Industry-standard genealogy graph' },
  { icon: TreeDeciduous, title: 'Family Tree',  sub: 'AI-deduped persons, gender-coloured nodes' },
];

const FEATURES = [
  { icon: Cpu,         title: 'Models in your control', body: 'Any OpenAI-compatible endpoint — Gemini, OpenAI, local. Per-stage model overrides in one .env.' },
  { icon: ShieldCheck, title: 'Word-level confidence',  body: 'Every transcribed word ships with a probability. Suspect characters glow, certain ones fade in.' },
  { icon: Languages,   title: 'Detect & translate',     body: 'French, Latin, Spanish, German registers — auto-detected, one click to English.' },
  { icon: Users,       title: 'Relationship mapping',   body: 'AI reads dozens of records, deduplicates the same person across pages, infers every kinship.' },
  { icon: FileSearch,  title: 'Open-ended metadata',    body: 'Not just names + dates — occupations, witnesses, dioceses, page numbers, civil status.' },
  { icon: Heart,       title: 'Editorial tree layout',  body: 'Anchor circles, U-connectors, paper grid background. A pedigree fit to print.' },
];

// ───────────────────────────────────────────────────────────────────────
const Landing = () => {
  const isAuth = useAuthStore((s) => s.isAuthenticated);

  // ── Real live data from the user's account ───────────────────────────
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['landing-projects'],
    queryFn: async () => (await api.get('/projects/')).data,
    enabled: isAuth,
    staleTime: 30_000,
  });

  // Fan-out batches for the first 3 projects so the Live panel has real rows
  const topProjectIds = React.useMemo(
    () => projects.slice(0, 3).map((p) => p.id).join(','),
    [projects],
  );

  const { data: allBatches = [], isLoading: batchesLoading } = useQuery({
    queryKey: ['landing-batches', topProjectIds],
    queryFn: async () => {
      const ids = topProjectIds ? topProjectIds.split(',').map(Number) : [];
      const results = await Promise.all(
        ids.map(async (pid) => {
          try {
            const r = await api.get(`/projects/${pid}/batches/`);
            // image_count comes back from the backend per batch
            return (r.data || []).map((b) => ({ ...b, project_id: pid }));
          } catch {
            return [];
          }
        }),
      );
      return results.flat();
    },
    enabled: isAuth && !!topProjectIds,
    staleTime: 30_000,
  });

  const liveLoading = isAuth && (projectsLoading || batchesLoading);

  // ── Real hero stats ──────────────────────────────────────────────────
  const projectCount = projects.length;
  const batchCount   = allBatches.length;
  const docCount     = allBatches.reduce((s, b) => s + (b.image_count || 0), 0);
  const treesBuilt   = allBatches.filter((b) => b.tree_built_at).length;

  return (
    <div className="min-h-screen bg-surface-canvas text-ink relative overflow-x-hidden">
      {/* ───────── Top nav ───────── */}
      <nav className="relative z-20 border-b border-line-subtle bg-surface-canvas/85 backdrop-blur sticky top-0">
        <div className="max-w-7xl mx-auto px-8 h-20 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <BrandMark size={44} />
            <div className="leading-none">
              <div className="font-display font-extrabold text-[17px] tracking-tight text-navy-800">SBL Knowledge Services</div>
              <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-orange-500 mt-1">Genealogy AI</div>
            </div>
          </Link>

          <div className="hidden lg:flex items-center gap-9">
            {TOP_NAV.map((n) => (
              <NavItem key={n.label} item={n} />
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button className="w-10 h-10 border border-line rounded-md flex items-center justify-center text-navy-800 hover:bg-surface-raised transition-colors">
              <Search size={16} strokeWidth={2.5} />
            </button>
            {isAuth ? (
              <Link to="/dashboard" className="btn-primary text-[14px]">
                Open Dashboard
              </Link>
            ) : (
              <Link to="/login" className="btn-primary text-[14px]">
                Talk to Leadership
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* ───────── Hero ───────── */}
      <section className="relative max-w-7xl mx-auto px-8 pt-14 pb-24">
        <div className="eyebrow eyebrow-rule mb-10 ml-1">Software · AI · Products</div>
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-14 items-end">
          {/* Big headline */}
          <div>
            <h1 className="display-heading text-[68px] lg:text-[88px] xl:text-[104px]">
              We build the
              <br />
              systems
              <br />
              <span className="text-navy-800">organisations</span>
              <br />
              <span className="text-navy-800">depend on</span>
              <br />
              <span className="italic-accent text-[64px] lg:text-[80px] xl:text-[92px] block leading-[0.95] mt-2">
                when failure is
                <br />
                not an option.
              </span>
            </h1>

            <p className="text-[17px] text-ink-secondary leading-relaxed mt-10 max-w-xl">
              Software and AI engineered for scale and correctness, structuring data,
              documents and workflows into reliable, audit-grade family records.
            </p>

            <div className="flex flex-wrap gap-3 mt-8">
              <Link
                to={isAuth ? '/dashboard' : '/register'}
                className="group inline-flex items-center gap-3 bg-navy-800 hover:bg-navy-900 text-white font-semibold pl-6 pr-3 py-3 rounded-md shadow-warm-md transition-all"
              >
                {isAuth ? 'Open Dashboard' : 'Start researching'}
                <span className="w-9 h-9 rounded-md bg-orange-500 group-hover:bg-orange-600 flex items-center justify-center transition-colors">
                  <ArrowRight size={16} strokeWidth={2.5} />
                </span>
              </Link>
              {!isAuth && (
                <Link to="/login" className="btn-secondary inline-flex items-center gap-2">
                  I have an account
                  <MoveRight size={16} />
                </Link>
              )}
            </div>

            {/* ── REAL stats (signed-in only) ── */}
            {isAuth && (
              <div className="grid grid-cols-4 gap-6 mt-12 max-w-xl">
                <Stat label="projects"  value={projectCount}  />
                <Stat label="batches"   value={batchCount}    />
                <Stat label="documents" value={docCount}      />
                <Stat label="trees"     value={treesBuilt}    />
              </div>
            )}
          </div>

          {/* Live-capture panel */}
          <div className="relative">
            <div className="absolute -top-6 -left-6 right-12 bottom-12 bg-orange-500/8 rounded-md pointer-events-none" />
            <LiveCapturePanel
              isAuth={isAuth}
              projects={projects}
              batches={allBatches}
              loading={liveLoading}
            />
            <div className="absolute -bottom-5 -right-5 px-4 py-2.5 bg-surface rounded-md border border-line shadow-warm-md text-[11px] font-semibold tracking-[0.22em] uppercase text-navy-800">
              {isAuth ? `${docCount} docs streaming` : 'Live · streaming'}
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Pipeline ───────── */}
      <section id="pipeline" className="relative max-w-7xl mx-auto px-8 py-24 scroll-mt-24">
        <div className="grid lg:grid-cols-[0.95fr_1.05fr] gap-14 mb-14 items-end">
          <div>
            <div className="eyebrow eyebrow-rule mb-6">The Pipeline</div>
            <h2 className="display-heading text-5xl lg:text-6xl">
              From scan to <span className="italic-accent text-[44px] lg:text-[54px]">family tree</span>
              <br />in six stages.
            </h2>
          </div>
          <p className="text-[17px] text-ink-secondary leading-relaxed lg:pb-3">
            Each stage is independently inspectable. Re-run any step, edit any extracted
            field, and watch the downstream tree update — no batch reruns, no lost work.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-px bg-line-subtle rounded-md overflow-hidden border border-line-subtle shadow-warm-sm">
          {PIPELINE.map((p, i) => (
            <div
              key={p.title}
              className="group relative bg-surface p-8 hover:bg-orange-50 transition-colors"
              style={{ animation: `fadeUp 0.7s ease-out ${i * 0.06}s both` }}
            >
              <div className="flex items-start justify-between mb-5">
                <div className="w-12 h-12 rounded-md border border-line flex items-center justify-center text-navy-800 group-hover:bg-orange-500 group-hover:border-orange-500 group-hover:text-white transition-all">
                  <p.icon size={20} strokeWidth={2} />
                </div>
                <div className="font-display font-extrabold text-3xl text-navy-100 group-hover:text-orange-300 transition-colors">
                  0{i + 1}
                </div>
              </div>
              <div className="font-display font-extrabold text-xl tracking-tight text-navy-800 mb-1.5">
                {p.title}
              </div>
              <div className="text-[14px] text-ink-secondary leading-relaxed">{p.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── Features ───────── */}
      <section id="capabilities" className="relative bg-surface-raised border-y border-line-subtle py-24 scroll-mt-24">
        <div className="max-w-7xl mx-auto px-8">
          <div className="grid lg:grid-cols-[0.95fr_1.05fr] gap-14 mb-14">
            <div>
              <div className="eyebrow eyebrow-rule mb-6">Capabilities</div>
              <h2 className="display-heading text-5xl lg:text-6xl">
                Everything a serious
                <br />
                <span className="italic-accent text-[44px] lg:text-[54px]">genealogist</span> needs.
              </h2>
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="group relative bg-surface border border-line-subtle rounded-md p-7 hover:border-orange-500 hover:-translate-y-1 transition-all duration-300"
                style={{ animation: `fadeUp 0.7s ease-out ${i * 0.05}s both` }}
              >
                <div className="w-11 h-11 rounded-md bg-orange-100 text-orange-600 flex items-center justify-center mb-5 group-hover:bg-orange-500 group-hover:text-white transition-colors">
                  <f.icon size={20} strokeWidth={2} />
                </div>
                <div className="font-display font-bold text-[17px] tracking-tight text-navy-800 mb-1.5">{f.title}</div>
                <div className="text-[14px] text-ink-secondary leading-relaxed">{f.body}</div>
                <ArrowRight
                  size={18}
                  strokeWidth={2}
                  className="absolute bottom-6 right-6 text-navy-300 group-hover:text-orange-500 group-hover:translate-x-1 transition-all"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── CTA (live recent projects when authed) ───────── */}
      <section id="cta" className="relative max-w-7xl mx-auto px-8 py-24 scroll-mt-24">
        <div
          className="relative rounded-md overflow-hidden p-12 lg:p-16"
          style={{ background: 'linear-gradient(140deg, #07142A 0%, #0B1F3A 50%, #142849 100%)' }}
        >
          <div className="absolute -top-32 -right-20 w-80 h-80 bg-orange-500/15 rounded-full blur-3xl" />
          <div className="absolute -bottom-32 -left-20 w-80 h-80 bg-orange-500/10 rounded-full blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px)',
              backgroundSize: '4px 4px',
            }}
          />
          <div className="relative grid lg:grid-cols-[1.4fr_1fr] gap-10 items-center">
            <div>
              <div className="eyebrow eyebrow-rule mb-6" style={{ color: '#F7AE74' }}>
                {isAuth ? 'Pick up where you left off' : 'Ready when you are'}
              </div>
              <h3 className="display-heading text-white text-4xl lg:text-5xl mb-5">
                {isAuth ? (
                  <>
                    {projectCount > 0 ? (
                      <>
                        You've got <span className="italic-accent text-orange-300 text-4xl lg:text-5xl">{projectCount} {projectCount === 1 ? 'project' : 'projects'}</span>
                        <br />in flight.
                      </>
                    ) : (
                      <>
                        Spin up your
                        <br />
                        <span className="italic-accent text-orange-300 text-4xl lg:text-5xl">first project.</span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    Start tracing your
                    <br />
                    family tree in
                    <span className="italic-accent text-orange-300 text-4xl lg:text-5xl">
                      &nbsp;five minutes.
                    </span>
                  </>
                )}
              </h3>
              <p className="text-navy-100 max-w-md leading-relaxed mb-7">
                {isAuth
                  ? 'Jump straight back into the dashboard or pick one of your active batches below.'
                  : 'Free account. Bring your own model key. Per-stage overrides in .env so you control which model handles vision, extraction, and tree synthesis.'}
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to={isAuth ? '/dashboard' : '/register'}
                  className="group inline-flex items-center gap-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold pl-6 pr-3 py-3 rounded-md shadow-warm-lg transition-all"
                >
                  {isAuth ? 'Open Dashboard' : 'Create free account'}
                  <span className="w-9 h-9 rounded-md bg-white/15 group-hover:bg-white/25 flex items-center justify-center transition-colors">
                    <ChevronRight size={16} strokeWidth={2.5} />
                  </span>
                </Link>
                {!isAuth && (
                  <Link to="/login" className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-medium px-6 py-3 rounded-md backdrop-blur transition-colors">
                    Sign in
                  </Link>
                )}
              </div>
            </div>

            {/* Live recent batches when authed; product feature list otherwise */}
            <div className="hidden lg:block">
              {isAuth ? (
                <>
                  <div className="text-[11px] tracking-[0.22em] uppercase font-semibold text-orange-300 mb-5">
                    Recent batches
                  </div>
                  <div className="space-y-1">
                    {allBatches.slice(0, 4).map((b) => (
                      <Link
                        key={b.id}
                        to={`/projects/${b.project_id}/batches/${b.id}`}
                        className="group flex items-center justify-between py-3 border-b border-white/5 last:border-0 hover:px-1 transition-all"
                      >
                        <div className="min-w-0">
                          <div className="text-white font-semibold text-[14px] truncate">
                            {b.name || `Batch ${b.id}`}
                          </div>
                          <div className="text-navy-100/55 text-[11px] mt-0.5">
                            {b.image_count || 0} {b.image_count === 1 ? 'document' : 'documents'}
                            {b.tree_built_at && <span className="text-orange-300 ml-2">· tree built</span>}
                          </div>
                        </div>
                        <ArrowRight
                          size={14}
                          strokeWidth={2.5}
                          className="text-navy-100/40 group-hover:text-orange-300 group-hover:translate-x-1 transition-all shrink-0 ml-3"
                        />
                      </Link>
                    ))}
                    {allBatches.length === 0 && !liveLoading && (
                      <div className="text-navy-100/55 text-[13px] italic">
                        No batches yet — head to your dashboard to create one.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[11px] tracking-[0.22em] uppercase font-semibold text-orange-300 mb-5">
                    The pipeline ships
                  </div>
                  <div className="space-y-3">
                    {[
                      { k: 'Audit-grade OCR transcriptions', v: 'word + char confidence' },
                      { k: 'Deduplicated person graph',      v: 'token-subset matching' },
                      { k: 'GEDCOM 5.5 + GedcomX exports',   v: 'FamilySearch & Ancestry' },
                      { k: 'Print-ready pedigree chart',     v: 'pan / zoom / save' },
                    ].map((row) => (
                      <div key={row.k} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                        <div className="text-white font-semibold text-[14px]">{row.k}</div>
                        <div className="text-navy-100/70 text-[12px] tracking-wide">{row.v}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Footer ───────── */}
      <footer className="border-t border-line-subtle bg-surface-canvas">
        <div className="max-w-7xl mx-auto px-8 py-10 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-ink-tertiary">
          <div className="flex items-center gap-3">
            <BrandMark size={32} />
            <span className="font-display font-bold text-navy-800">SBL Knowledge Services</span>
            <span className="text-ink-tertiary">— Genealogy AI Portal</span>
          </div>
          <div className="flex gap-7 font-medium">
            <a href="#" className="hover:text-orange-500 transition-colors">Documentation</a>
            <a href="#" className="hover:text-orange-500 transition-colors">Privacy</a>
            <a href="#" className="hover:text-orange-500 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

const Stat = ({ label, value }) => (
  <div>
    <div className="font-display font-extrabold text-4xl text-navy-800 tabular-nums leading-none">
      {value}
    </div>
    <div className="text-[10px] uppercase tracking-[0.22em] text-ink-tertiary font-semibold mt-2">
      {label}
    </div>
  </div>
);

export default Landing;
