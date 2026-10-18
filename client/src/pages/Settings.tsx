import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import {
  Save,
  Database,
  Shield,
  Server,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Sparkles,
  RefreshCw,
  AlertOctagon,
  Eye,
  Check,
} from 'lucide-react';

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Safe Demo Cleanup Modal State
  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<any>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupSuccess, setCleanupSuccess] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  // Institutional Reset Modal State
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetConfirmationInput, setResetConfirmationInput] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  async function loadData() {
    try {
      setLoading(true);
      const [settingsRes, summaryRes] = await Promise.all([
        api.getSettings(),
        api.getSettingsSummary(),
      ]);
      setSettings(settingsRes.data);
      setSummary(summaryRes.data);
      setErrorMessage(null);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Failed to load system settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    try {
      const res = await api.updateSettings(settings);
      setSettings(res.data);
      if (res.summary) {
        setSummary(res.summary);
      } else {
        const sumRes = await api.getSettingsSummary();
        setSummary(sumRes.data);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save configuration settings.');
    }
  }

  // Cleanup Handlers
  async function handleOpenCleanupPreview() {
    setIsCleanupModalOpen(true);
    setCleanupLoading(true);
    setCleanupError(null);
    setCleanupSuccess(null);
    try {
      const res = await api.getCleanupPreview();
      setCleanupPreview(res.data);
    } catch (err: any) {
      setCleanupError(err.message || 'Failed to fetch cleanup preview.');
    } finally {
      setCleanupLoading(false);
    }
  }

  async function handleExecuteCleanup() {
    setCleanupLoading(true);
    setCleanupError(null);
    try {
      const res = await api.executeCleanup();
      const r = res.data;
      setCleanupSuccess(
        `Atomic cleanup successful: Removed ${r.deletedFacultyCount} unwanted demo faculty, ${r.deletedRoomCount} unwanted demo rooms. Skipped ${r.skippedDueToAssignments} records with active assignment history.`
      );
      await loadData();
      setTimeout(() => {
        setIsCleanupModalOpen(false);
        setCleanupPreview(null);
        setCleanupSuccess(null);
      }, 3000);
    } catch (err: any) {
      setCleanupError(err.message || 'Cleanup execution failed.');
    } finally {
      setCleanupLoading(false);
    }
  }

  // Reset Handlers
  async function handleExecuteReset(e: React.FormEvent) {
    e.preventDefault();
    if (resetConfirmationInput.trim() !== 'RESET_DATABASE_CONFIRMED') {
      setResetError('Exact confirmation string "RESET_DATABASE_CONFIRMED" is required to proceed.');
      return;
    }
    setResetLoading(true);
    setResetError(null);
    try {
      const res = await api.resetDatabase('RESET_DATABASE_CONFIRMED');
      setResetSuccess(
        `Institutional operational reset complete. Database cleaned with audit event logged: ${res.data?.auditLogged ? 'YES' : 'NO'}`
      );
      setResetConfirmationInput('');
      await loadData();
      setTimeout(() => {
        setIsResetModalOpen(false);
        setResetSuccess(null);
      }, 3000);
    } catch (err: any) {
      setResetError(err.message || 'Database reset failed.');
    } finally {
      setResetLoading(false);
    }
  }

  if (loading) {
    return <p style={{ color: 'var(--text-secondary)', padding: '24px 0' }}>Loading settings and capacity registry...</p>;
  }

  const hasMismatch = summary && (summary.roomsMismatch || summary.facultyMismatch);

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1>System Settings & Institutional Configuration</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Configurable institutional parameters, editable room & teacher targets, data hygiene & capacity synchronization
        </p>
      </div>

      {/* Discrepancy / Mismatch Warning Banner */}
      {hasMismatch && (
        <div className="alert alert-warning" style={{ marginBottom: '24px' }}>
          <AlertTriangle size={24} color="var(--warning)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div className="alert-title">Configuration & Registered Record Mismatch Detected</div>
            <div style={{ marginTop: '4px', fontSize: '0.875rem' }}>
              Configured planning targets differ from registered database records:
            </div>
            <ul style={{ margin: '8px 0 0 16px', fontSize: '0.85rem' }}>
              {summary.roomsMismatch && (
                <li>
                  <strong>Examination Rooms:</strong> Target configured as{' '}
                  <span className="mono-metric">{summary.expectedRooms}</span> rooms, but there are{' '}
                  <span className="mono-metric">{summary.registeredRoomsActive}</span> active rooms registered in the database ({summary.registeredRoomsTotal} total).
                </li>
              )}
              {summary.facultyMismatch && (
                <li>
                  <strong>Teachers:</strong> Target configured as{' '}
                  <span className="mono-metric">{summary.expectedFaculty}</span> faculty members, but there are{' '}
                  <span className="mono-metric">{summary.registeredFacultyActive}</span> active teachers registered in the database ({summary.eligibleFacultyCount} eligible, {summary.registeredFacultyUnavailable} exempt/unavailable).
                </li>
              )}
            </ul>
            <div style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <em>
                Note: Changing configured expected counts modifies planning targets only. It does not automatically create, delete, or duplicate database records. Register or import additional records to match target scale.
              </em>
            </div>
          </div>
        </div>
      )}

      {/* Save Success Notice */}
      {saveSuccess && (
        <div className="alert alert-success" style={{ marginBottom: '20px' }}>
          <CheckCircle2 size={20} color="var(--success)" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '0.875rem' }}>
            System configuration updated successfully and persistent across sessions.
          </div>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && (
        <div className="alert alert-error" style={{ marginBottom: '20px' }}>
          <AlertTriangle size={20} color="var(--error)" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '0.875rem' }}>
            <strong>Configuration Error:</strong> {errorMessage}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', marginBottom: '24px' }}>
        {/* Settings Form */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Editable Planning Configuration</div>
            <Badge variant="forest">Authoritative Parameters</Badge>
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
                <label className="form-label">Expected Examination Rooms</label>
                <input
                  type="number"
                  min="1"
                  max="2000"
                  value={settings.default_room_count || '200'}
                  onChange={(e) => setSettings({ ...settings, default_room_count: e.target.value })}
                  className="form-input"
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Target scale: 200 rooms (configurable value, not hard-coded scheduling limit).
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Expected Registered Teachers</label>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={settings.default_faculty_count || '500'}
                  onChange={(e) => setSettings({ ...settings, default_faculty_count: e.target.value })}
                  className="form-input"
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Target scale: 500 faculty members (configurable value).
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Maximum Duties per Faculty Member</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={settings.default_max_duties || '6'}
                  onChange={(e) => setSettings({ ...settings, default_max_duties: e.target.value })}
                  className="form-input"
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Rule F configurable default cap (Standard default: 6).
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Daily Examination Sessions</label>
                <input
                  type="number"
                  min="1"
                  max="6"
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

        {/* System & Registry Summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Target vs Actual Comparison Card */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Expected vs Registered Scale</div>
              <Badge variant={hasMismatch ? 'warning' : 'success'}>
                {hasMismatch ? 'Mismatch Detected' : 'Scale Aligned'}
              </Badge>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.85rem' }}>
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--surface-muted)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 600 }}>Examination Rooms</span>
                  <Badge variant={summary?.roomsMismatch ? 'warning' : 'sage'}>
                    {summary?.roomsMismatch ? 'Mismatch' : 'Aligned'}
                  </Badge>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Configured Target:</span>
                  <span className="mono-metric"><strong>{summary?.expectedRooms || 200}</strong></span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Actual Registered:</span>
                  <span className="mono-metric"><strong>{summary?.registeredRoomsActive || 0}</strong> active ({summary?.registeredRoomsTotal || 0} total)</span>
                </div>
              </div>

              <div style={{ padding: '10px 12px', backgroundColor: 'var(--surface-muted)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 600 }}>Faculty Members</span>
                  <Badge variant={summary?.facultyMismatch ? 'warning' : 'sage'}>
                    {summary?.facultyMismatch ? 'Mismatch' : 'Aligned'}
                  </Badge>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Configured Target:</span>
                  <span className="mono-metric"><strong>{summary?.expectedFaculty || 500}</strong></span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Actual Registered:</span>
                  <span className="mono-metric"><strong>{summary?.registeredFacultyActive || 0}</strong> active</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '2px' }}>
                  <span>Eligible for Duty:</span>
                  <span className="mono-metric">{summary?.eligibleFacultyCount || 0} (non-exempt)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  <span>Exempt / Unavailable:</span>
                  <span className="mono-metric">{summary?.registeredFacultyUnavailable || 0}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Database & Infrastructure Information */}
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
                  <strong>Verified Backup Active</strong>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    SHA-256 verified snapshot preserved at `server/faculty_allotment.active_backup_20261016_gsd.db`.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION: DATA HYGIENE, DEMO CLEANUP & INSTITUTIONAL RESET */}
      <div className="card" style={{ border: '1px solid var(--border-subtle)' }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Trash2 size={20} color="var(--primary-forest)" />
            <div className="card-title">Data Hygiene, Demo Cleanup & Operational Reset</div>
          </div>
          <Badge variant="sage">Audit-Protected</Badge>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '18px' }}>
          Safely remove unwanted demo/seed records with verified provenance without cascading to approved examination schedules, or initiate a fully guarded institutional reset.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Action 1: Safe Demo Record Cleanup */}
          <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                <Sparkles size={16} color="var(--primary-forest)" />
                Safe Unwanted Demo Cleanup
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                Scans for confirmed unwanted demo faculty and rooms (e.g. Alice Demo, DEMO-*, TEST-*). Inspects foreign keys and assignment history before deletion.
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenCleanupPreview}
              className="btn btn-secondary"
              style={{ alignSelf: 'flex-start' }}
            >
              <Eye size={16} /> Preview Demo Cleanup
            </button>
          </div>

          {/* Action 2: Institutional Database Reset */}
          <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--error-bg)', border: '1px solid var(--error-border)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--error)', marginBottom: '6px' }}>
                <AlertOctagon size={16} color="var(--error)" />
                Institutional Operational Reset
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                Resets operational records (timetables, faculty, rooms, drafts) for a clean semester startup. Requires exact phrase confirmation and keeps audit logs intact.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setResetConfirmationInput('');
                setResetError(null);
                setResetSuccess(null);
                setIsResetModalOpen(true);
              }}
              className="btn btn-danger"
              style={{ alignSelf: 'flex-start' }}
            >
              <Trash2 size={16} /> Institutional Reset
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Safe Demo Cleanup Preview & Execution */}
      {isCleanupModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setIsCleanupModalOpen(false)}
          title="Safe Demo Record Cleanup — Pre-Deletion Preview"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              The system identifies unwanted demo records using known demo identifiers, seed patterns, and audit logs. Records linked to active approved schedules are protected.
            </p>

            {cleanupLoading && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Analyzing database provenance and assignment dependencies...
              </div>
            )}

            {cleanupError && (
              <div className="alert alert-error" style={{ fontSize: '0.85rem' }}>
                {cleanupError}
              </div>
            )}

            {cleanupSuccess && (
              <div className="alert alert-success" style={{ fontSize: '0.85rem' }}>
                {cleanupSuccess}
              </div>
            )}

            {cleanupPreview && (
              <div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <Badge variant="forest">Demo Faculty: {cleanupPreview.summary?.unwantedFacultyCount || 0}</Badge>
                  <Badge variant="sage">Demo Rooms: {cleanupPreview.summary?.unwantedRoomsCount || 0}</Badge>
                  <Badge variant="success">Safe for Deletion: {cleanupPreview.summary?.safeToDeleteCount || 0}</Badge>
                  {cleanupPreview.summary?.blockedCount > 0 && (
                    <Badge variant="warning">Protected by History: {cleanupPreview.summary.blockedCount}</Badge>
                  )}
                </div>

                <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem', width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>ID</th>
                        <th>Name / Label</th>
                        <th>Provenance Reason</th>
                        <th>Safety Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cleanupPreview.candidates?.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                            No unwanted demo records found. Your database is clean!
                          </td>
                        </tr>
                      ) : (
                        cleanupPreview.candidates?.map((c: any) => (
                          <tr key={`${c.entityType}-${c.id}`}>
                            <td><Badge variant="sage">{c.entityType}</Badge></td>
                            <td className="mono-metric">{c.id}</td>
                            <td><strong>{c.label}</strong></td>
                            <td style={{ color: 'var(--text-secondary)' }}>{c.reason}</td>
                            <td>
                              {c.safeToDelete ? (
                                <Badge variant="success"><Check size={12} /> Safe to Remove</Badge>
                              ) : (
                                <Badge variant="warning">Protected ({c.blockingAssignments} duties)</Badge>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="modal-footer" style={{ marginTop: '16px' }}>
                  <button
                    type="button"
                    onClick={() => setIsCleanupModalOpen(false)}
                    className="btn btn-secondary"
                    disabled={cleanupLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteCleanup}
                    className="btn btn-primary"
                    disabled={cleanupLoading || (cleanupPreview.summary?.safeToDeleteCount || 0) === 0}
                  >
                    {cleanupLoading ? 'Cleaning...' : `Execute Atomic Cleanup (${cleanupPreview.summary?.safeToDeleteCount || 0} Records)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Modal: Institutional Reset */}
      {isResetModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setIsResetModalOpen(false)}
          title="Institutional Operational Reset"
        >
          <form onSubmit={handleExecuteReset}>
            <div className="alert alert-error" style={{ marginBottom: '16px', fontSize: '0.85rem' }}>
              <AlertTriangle size={24} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>High-Consequence Action:</strong> This procedure resets active operational records (draft timetables, faculty, rooms, unapproved schedules) to prepare for a new academic semester.
                <div style={{ marginTop: '4px' }}>Audit log entries and verified physical database backup files remain preserved.</div>
              </div>
            </div>

            {resetError && (
              <div className="alert alert-error" style={{ marginBottom: '14px', fontSize: '0.85rem' }}>
                {resetError}
              </div>
            )}

            {resetSuccess && (
              <div className="alert alert-success" style={{ marginBottom: '14px', fontSize: '0.85rem' }}>
                {resetSuccess}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">
                To confirm this operation, type <strong>RESET_DATABASE_CONFIRMED</strong> below:
              </label>
              <input
                type="text"
                required
                value={resetConfirmationInput}
                onChange={(e) => setResetConfirmationInput(e.target.value)}
                placeholder="RESET_DATABASE_CONFIRMED"
                className="form-input mono-metric"
                style={{ fontWeight: 600, letterSpacing: '0.5px' }}
              />
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                className="btn btn-secondary"
                disabled={resetLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-danger"
                disabled={resetLoading || resetConfirmationInput.trim() !== 'RESET_DATABASE_CONFIRMED'}
              >
                {resetLoading ? 'Resetting Database...' : 'Confirm Operational Reset'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
