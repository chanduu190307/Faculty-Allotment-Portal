import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import {
  ScrollText,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Calendar,
  User,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export const AuditLog: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [actorSearch, setActorSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [generalSearch, setGeneralSearch] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Selected Log Modal for detailed diff/inspection
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const actionOptions = [
    'ALL',
    'SCHEDULE_GENERATED',
    'SCHEDULE_VALIDATED',
    'SCHEDULE_APPROVED',
    'SCHEDULE_PUBLISHED',
    'SCHEDULE_REVISION_CREATED',
    'FACULTY_IMPORTED',
    'ROOMS_IMPORTED',
    'SUBSTITUTION_APPROVED',
    'ATTENDANCE_RECORDED',
    'SETTINGS_UPDATED',
  ];

  const entityOptions = ['ALL', 'schedules', 'faculty', 'rooms', 'assignments', 'settings'];

  async function loadAuditLogs() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getFilteredAuditLogs({
        entity: entityFilter && entityFilter !== 'ALL' ? entityFilter : undefined,
        action: actionFilter && actionFilter !== 'ALL' ? actionFilter : undefined,
        actor: actorSearch ? actorSearch.trim() : undefined,
        startDate: startDate ? startDate : undefined,
        endDate: endDate ? `${endDate}T23:59:59.999Z` : undefined,
        search: generalSearch ? generalSearch.trim() : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });

      setLogs(res.data || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      console.error('Failed to load audit logs:', err);
      setError(err.message || 'Unable to load audit logs.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAuditLogs();
  }, [page, entityFilter, actionFilter, startDate, endDate]);

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    loadAuditLogs();
  }

  function handleResetFilters() {
    setEntityFilter('');
    setActionFilter('');
    setActorSearch('');
    setStartDate('');
    setEndDate('');
    setGeneralSearch('');
    setPage(1);
  }

  function getActionBadgeVariant(action: string): 'success' | 'warning' | 'forest' | 'error' | 'sage' {
    if (action.includes('APPROVED') || action.includes('PUBLISHED') || action.includes('IMPORTED')) {
      return 'success';
    }
    if (action.includes('REVISION') || action.includes('SUBSTITUTION') || action.includes('VALIDATED')) {
      return 'warning';
    }
    if (action.includes('CANCELLED') || action.includes('DELETED') || action.includes('FAILED')) {
      return 'error';
    }
    return 'sage';
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1>System Audit Trail</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Immutable, permission-protected log of all administrative actions, lifecycle transitions, and imports
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <ShieldCheck size={16} color="var(--primary-forest)" />
            <span>Read-Only Audit Ledger</span>
          </div>
          <button onClick={loadAuditLogs} className="btn btn-secondary btn-sm" title="Refresh Audit Trail">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter Control Box */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
        <form onSubmit={handleFilterSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Action / Event Type
              </label>
              <select
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value);
                  setPage(1);
                }}
                className="form-select"
                style={{ width: '100%', padding: '6px 10px', fontSize: '0.85rem' }}
              >
                {actionOptions.map((opt) => (
                  <option key={opt} value={opt === 'ALL' ? '' : opt}>
                    {opt === 'ALL' ? 'All Actions' : opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Target Entity
              </label>
              <select
                value={entityFilter}
                onChange={(e) => {
                  setEntityFilter(e.target.value);
                  setPage(1);
                }}
                className="form-select"
                style={{ width: '100%', padding: '6px 10px', fontSize: '0.85rem' }}
              >
                {entityOptions.map((opt) => (
                  <option key={opt} value={opt === 'ALL' ? '' : opt}>
                    {opt === 'ALL' ? 'All Entities' : opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                From Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="form-input"
                style={{ width: '100%', padding: '6px 10px', fontSize: '0.85rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                To Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="form-input"
                style={{ width: '100%', padding: '6px 10px', fontSize: '0.85rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Actor (User)
              </label>
              <input
                type="text"
                placeholder="e.g. Officer"
                value={actorSearch}
                onChange={(e) => setActorSearch(e.target.value)}
                className="form-input"
                style={{ width: '100%', padding: '6px 10px', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                <Search size={14} /> Filter
              </button>
              <button type="button" onClick={handleResetFilters} className="btn btn-secondary btn-sm">
                Reset
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Error state */}
      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error)', padding: '16px', marginBottom: '20px' }}>
          <strong>Error loading audit records:</strong> {error}
        </div>
      )}

      {/* Main Table Card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Showing <strong>{logs.length}</strong> of <strong>{total}</strong> logged events
          </div>

          {/* Pagination controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="btn btn-secondary btn-sm"
              style={{ padding: '4px 8px' }}
            >
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="btn btn-secondary btn-sm"
              style={{ padding: '4px 8px' }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <RefreshCw size={24} className="spin" style={{ marginBottom: '8px' }} />
            <div>Loading authoritative audit entries...</div>
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '64px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <ScrollText size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: '4px' }}>No Audit Entries Found</h3>
            <p>No actions match your current filter parameters.</p>
          </div>
        ) : (
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--canvas-bg)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '10px 16px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Timestamp</th>
                <th style={{ padding: '10px 16px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Action</th>
                <th style={{ padding: '10px 16px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Entity</th>
                <th style={{ padding: '10px 16px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Entity ID</th>
                <th style={{ padding: '10px 16px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Actor</th>
                <th style={{ padding: '10px 16px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Context / Reason</th>
                <th style={{ padding: '10px 16px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', textAlign: 'center' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <span className="mono-metric">{new Date(log.timestamp).toLocaleString()}</span>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <Badge variant={getActionBadgeVariant(log.action)}>
                      {log.action}
                    </Badge>
                  </td>
                  <td style={{ padding: '10px 16px', fontSize: '0.85rem', fontWeight: 600 }}>
                    {log.entity}
                  </td>
                  <td style={{ padding: '10px 16px', fontSize: '0.85rem' }}>
                    <span className="mono-metric" style={{ backgroundColor: 'var(--canvas-bg)', padding: '2px 6px', borderRadius: '4px' }}>
                      {log.entityId}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                    {log.actor || 'System'}
                  </td>
                  <td style={{ padding: '10px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.reason || '-'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '4px 8px' }}
                      title="Inspect Snapshot"
                    >
                      <Eye size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Log Details Modal */}
      {selectedLog && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedLog(null)}
          title={`Audit Record #${selectedLog.id} — ${selectedLog.action}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.75rem' }}>Timestamp:</span>
                <strong>{new Date(selectedLog.timestamp).toLocaleString()}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.75rem' }}>Actor:</span>
                <strong>{selectedLog.actor}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.75rem' }}>Entity:</span>
                <strong>{selectedLog.entity} ({selectedLog.entityId})</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.75rem' }}>Action Status:</span>
                <Badge variant={getActionBadgeVariant(selectedLog.action)}>{selectedLog.action}</Badge>
              </div>
            </div>

            {selectedLog.reason && (
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>
                  Stated Justification / Context:
                </span>
                <div style={{ padding: '8px 12px', backgroundColor: 'var(--canvas-bg)', borderRadius: '4px', border: '1px solid var(--border-subtle)', fontSize: '0.85rem' }}>
                  {selectedLog.reason}
                </div>
              </div>
            )}

            {selectedLog.oldValues && (
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>
                  Pre-Mutation State (Old Values):
                </span>
                <pre style={{ maxHeight: '160px', overflowY: 'auto', backgroundColor: 'var(--canvas-bg)', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-subtle)', fontSize: '0.75rem' }}>
                  {JSON.stringify(selectedLog.oldValues, null, 2)}
                </pre>
              </div>
            )}

            {selectedLog.newValues && (
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>
                  Post-Mutation State (New Values / Summary):
                </span>
                <pre style={{ maxHeight: '160px', overflowY: 'auto', backgroundColor: 'var(--canvas-bg)', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-subtle)', fontSize: '0.75rem' }}>
                  {JSON.stringify(selectedLog.newValues, null, 2)}
                </pre>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button onClick={() => setSelectedLog(null)} className="btn btn-primary">
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
