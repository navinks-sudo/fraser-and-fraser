import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Search, ChevronDown, LogOut, LayoutDashboard, FolderRoot, ArrowRight } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import SblLogo from '../SblLogo';

const NAV = [
  { label: 'Dashboard',  to: '/dashboard', icon: LayoutDashboard },
  { label: 'Projects',   to: '/dashboard', icon: FolderRoot },
];

const TopNav = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const initial = user?.username?.[0]?.toUpperCase() || 'R';

  return (
    <header className="sticky top-0 z-30 bg-surface-canvas/90 backdrop-blur border-b border-line-subtle">
      <div className="max-w-[1400px] mx-auto px-8 h-20 flex items-center justify-between">
        <div className="flex items-center gap-10">
          <Link to="/" className="flex items-center gap-3" title="Back to home">
            <SblLogo size={44} showTagline={false} />
            <div className="leading-none">
              <div className="font-display font-extrabold text-[17px] tracking-tight text-navy-800">SBL Knowledge Services</div>
              <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-orange-500 mt-1">Genealogy AI</div>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-8">
            {NAV.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                end
                className={({ isActive }) =>
                  `relative flex items-center gap-2 text-[14px] font-semibold transition-colors ${
                    isActive ? 'text-navy-800' : 'text-ink-secondary hover:text-navy-800'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={15} strokeWidth={2.4} />
                    {item.label}
                    {isActive && <span className="absolute -bottom-7 left-0 right-0 h-[3px] bg-orange-500 rounded-t-sm" />}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="w-10 h-10 border border-line rounded-md flex items-center justify-center text-navy-800 hover:bg-surface-raised transition-colors"
            title="Search"
          >
            <Search size={16} strokeWidth={2.5} />
          </button>

          <div className="group relative">
            <button className="flex items-center gap-3 pl-1.5 pr-3 py-1.5 rounded-md border border-line hover:bg-surface-raised transition-colors">
              <div className="w-8 h-8 rounded-md bg-navy-800 text-white font-display font-bold flex items-center justify-center text-[13px]">
                {initial}
              </div>
              <div className="text-left leading-tight">
                <div className="text-[12px] font-bold text-navy-800">{user?.username || 'Researcher'}</div>
                <div className="text-[10px] tracking-[0.18em] uppercase text-ink-tertiary">Standard</div>
              </div>
              <ChevronDown size={14} strokeWidth={2.4} className="text-ink-tertiary" />
            </button>
            <div className="absolute right-0 mt-2 w-56 bg-surface border border-line-subtle rounded-md shadow-warm-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible translate-y-1 group-hover:translate-y-0 transition-all">
              <div className="p-3 border-b border-line-subtle">
                <div className="text-[11px] uppercase tracking-[0.18em] text-ink-tertiary mb-1">Signed in as</div>
                <div className="font-semibold text-navy-800 truncate">{user?.username || 'Researcher'}</div>
              </div>
              <button
                onClick={() => { logout(); navigate('/login'); }}
                className="w-full flex items-center justify-between px-4 py-3 text-[13px] font-semibold text-ink-secondary hover:bg-orange-50 hover:text-orange-600 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <LogOut size={15} />
                  Sign out
                </span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

const MainLayout = ({ children }) => (
  <div className="min-h-screen bg-surface-canvas flex flex-col">
    <TopNav />
    <main className="flex-1">{children}</main>
  </div>
);

export default MainLayout;
