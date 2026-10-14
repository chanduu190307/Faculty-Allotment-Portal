import React, { useState } from 'react';
import { Navigation, PageId } from './components/Navigation';
import { Dashboard } from './pages/Dashboard';
import { FacultyManagement } from './pages/FacultyManagement';
import { RoomManagement } from './pages/RoomManagement';
import { ExaminationManagement } from './pages/ExaminationManagement';
import { AllotmentEngine } from './pages/AllotmentEngine';
import { DailyOperations } from './pages/DailyOperations';
import { Reports } from './pages/Reports';
import { AuditLog } from './pages/AuditLog';
import { Settings } from './pages/Settings';
import { ShieldCheck } from 'lucide-react';

export const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <Navigation currentPage={currentPage} onNavigate={setCurrentPage} />

      {/* Main Content Viewport */}
      <div className="app-main">
        {/* Institutional Header */}
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <span style={{ fontWeight: 600, color: 'var(--primary-forest)' }}>Faculty Allotment System</span>
            <span>•</span>
            <span>Examination Administration</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--success)' }}>
              <ShieldCheck size={16} />
              <span>Strict Constraint Solver Active</span>
            </div>
            <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-subtle)' }} />
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Admin: <strong style={{ color: 'var(--text-main)' }}>Examination Officer</strong>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="app-content">
          {currentPage === 'dashboard' && <Dashboard onNavigate={setCurrentPage} />}
          {currentPage === 'allotment' && <AllotmentEngine />}
          {currentPage === 'operations' && <DailyOperations />}
          {currentPage === 'reports' && <Reports />}
          {currentPage === 'faculty' && <FacultyManagement />}
          {currentPage === 'rooms' && <RoomManagement />}
          {currentPage === 'examinations' && <ExaminationManagement />}
          {currentPage === 'audit' && <AuditLog />}
          {currentPage === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
};

export default App;
