import React from 'react';
import {
  LayoutDashboard,
  Users,
  DoorOpen,
  CalendarDays,
  Sparkles,
  ClipboardCheck,
  FileSpreadsheet,
  Settings as SettingsIcon,
  ScrollText,
} from 'lucide-react';

export type PageId =
  | 'dashboard'
  | 'faculty'
  | 'rooms'
  | 'examinations'
  | 'allotment'
  | 'operations'
  | 'reports'
  | 'audit'
  | 'settings';

interface NavigationProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ currentPage, onNavigate }) => {
  const navItems: Array<{ id: PageId; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: 'Executive Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'allotment', label: 'Automatic Allotment', icon: <Sparkles size={18} /> },
    { id: 'operations', label: 'Daily Operations', icon: <ClipboardCheck size={18} /> },
    { id: 'reports', label: 'Reports & Exports', icon: <FileSpreadsheet size={18} /> },
    { id: 'faculty', label: 'Faculty Management', icon: <Users size={18} /> },
    { id: 'rooms', label: 'Room Management', icon: <DoorOpen size={18} /> },
    { id: 'examinations', label: 'Examination Setup', icon: <CalendarDays size={18} /> },
    { id: 'audit', label: 'Audit Trail', icon: <ScrollText size={18} /> },
    { id: 'settings', label: 'System Settings', icon: <SettingsIcon size={18} /> },
  ];

  return (
    <aside className="app-sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Faculty Allotment System</h1>
        <div className="sidebar-subtitle">Examination Administration</div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-subtle)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        <div>Role: <strong style={{ color: 'var(--primary-forest)' }}>Administrator</strong></div>
        <div style={{ marginTop: '2px' }}>Engine: <strong style={{ color: 'var(--primary-forest)' }}>SQLite WAL Mode</strong></div>
      </div>
    </aside>
  );
};
