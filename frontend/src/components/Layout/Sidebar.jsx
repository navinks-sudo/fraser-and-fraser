import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FolderRoot, 
  LogOut, 
  TreeDeciduous,
  User as UserIcon
} from 'lucide-react';
import useAuthStore from '../../store/authStore';

const Sidebar = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { id: 'projects', label: 'All Projects', icon: FolderRoot, path: '/dashboard' },
  ];

  return (
    <aside className="w-[260px] h-screen bg-surface-raised border-r border-line flex flex-col shadow-warm-sm">
      <div className="p-8 flex items-center gap-3">
        <div className="w-10 h-10 bg-brand-amber rounded-xl flex items-center justify-center text-white shadow-warm-md">
          <TreeDeciduous size={24} />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold text-brand-sepia tracking-tight">GenealogIQ</h1>
          <p className="text-[10px] uppercase tracking-widest text-brand-amber font-bold">Researcher Portal</p>
        </div>
      </div>

      <nav className="flex-1 px-4 mt-4 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.id}
            to={item.path}
            className={({ isActive }) => `
              flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all
              ${isActive 
                ? 'bg-brand-amber-light text-brand-sepia border-l-4 border-brand-amber' 
                : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'}
            `}
          >
            <item.icon size={20} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-6 border-t border-line space-y-4">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 rounded-full bg-brand-amber flex items-center justify-center text-white font-bold shadow-warm-sm">
            {user?.username?.[0].toUpperCase() || 'U'}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-bold text-ink truncate">{user?.username || 'Researcher'}</p>
            <p className="text-[10px] text-ink-tertiary uppercase font-medium">Standard License</p>
          </div>
        </div>
        
        <button 
          onClick={() => { logout(); navigate('/login'); }}
          className="w-full flex items-center gap-3 px-4 py-2 text-ink-secondary hover:text-red-600 transition-colors"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">Sign Out</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
