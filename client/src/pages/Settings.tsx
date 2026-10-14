import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Badge } from '../components/Badge';
import { Save, Database, Shield, Server } from 'lucide-react';

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);

  async function loadSettings() {
    try {
      setLoading(true);
      const res = await api.getSettings();
      setSettings(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.updateSettings(settings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      alert('System settings updated successfully.');
    } catch (err) {
      alert('Failed to update settings: ' + (err as Error).message);
    }
  }

  if (loading) {
    return <p>Loading settings...</p>;
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1>System Settings & Institutional Defaults</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Configurable institutional parameters, default capacities, database integrity & backup policies
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        {/* Settings Form */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Default Examination Configuration</div>
            {saveSuccess && <Badge variant="success">Saved Successfully</Badge>}
          </div>

          <form onSubmit={handleSave}>
            <div className="form-group">
              <label className="form-label">Institution Name</label>
              <input
                type="text"
                placeholder="Institution Name"
                value={settings.college_name !== undefined ? settings.college_name : ''}
                onChange={(e) => setSettings({ ...settings, college_name: e.target.value, institution_name: e.target.value })}
                className="form-input"
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Configurable institution name used on official examination schedules, daily reports, and final PDF/Excel headers.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Configured Examination Rooms (Default)</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={settings.default_room_count || '200'}
                  onChange={(e) => setSettings({ ...settings, default_room_count: e.target.value })}
                  className="form-input"
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Default benchmark: 200 rooms (editable default, not hardcoded limit).
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Configured Registered Faculty (Default)</label>
                <input
                  type="number"
                  min="1"
                  max="2000"
                  value={settings.default_faculty_count || '500'}
                  onChange={(e) => setSettings({ ...settings, default_faculty_count: e.target.value })}
                  className="form-input"
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Default benchmark: 500 faculty members.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Maximum Duties per Faculty Member</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={settings.default_max_duties || '6'}
                  onChange={(e) => setSettings({ ...settings, default_max_duties: e.target.value })}
                  className="form-input"
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Rule F standard cap across all examination dates.
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Daily Examination Sessions</label>
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={settings.sessions_per_day || '2'}
                  onChange={(e) => setSettings({ ...settings, sessions_per_day: e.target.value })}
                  className="form-input"
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Standard daily shifts (Default: 2 - Morning & Afternoon).
                </div>
              </div>
            </div>

            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-primary">
                <Save size={16} /> Save Configuration Changes
              </button>
            </div>
          </form>
        </div>

        {/* Database & Infrastructure Information */}
        <div>
          <div className="card">
            <div className="card-header">
              <div className="card-title">Database & Reliability</div>
              <Badge variant="success">Active</Badge>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <Database size={18} color="var(--primary-forest)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Storage Engine</strong>
                  <div style={{ color: 'var(--text-secondary)' }}>SQLite (better-sqlite3) with Write-Ahead Logging (WAL) and strict foreign keys.</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <Shield size={18} color="var(--primary-forest)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Single-Writer Transaction Safety</strong>
                  <div style={{ color: 'var(--text-secondary)' }}>Atomic generation and updates prevent corrupt partial writes or duplicate room assignments.</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <Server size={18} color="var(--primary-forest)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Backup & Recovery</strong>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Backup database file `faculty_allotment.db` using standard atomic online snapshotting (`sqlite3 .backup`).
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
