import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Badge } from '../components/Badge';
import { WorkloadDistributionChart } from '../components/WorkloadDistributionChart';
import {
  Users,
  DoorOpen,
  CalendarDays,
  Sparkles,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';

interface DashboardProps {
  onNavigate: (page: any) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [facultyCount, setFacultyCount] = useState(0);
  const [roomCount, setRoomCount] = useState(0);
  const [exams, setExams] = useState<any[]>([]);
  const [latestSchedule, setLatestSchedule] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [preflightData, setPreflightData] = useState<any>(null);

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true);
        const [facRes, roomRes, examRes, logsRes] = await Promise.all([
          api.getFaculty({ limit: 1 }),
          api.getRooms({ limit: 1 }),
          api.getExaminations(),
          api.getAuditLogs(),
        ]);

        setFacultyCount(facRes.total);
        setRoomCount(roomRes.total);
        setExams(examRes.data);
        setAuditLogs(logsRes.data.slice(0, 8));

        if (examRes.data.length > 0) {
          const activeExam = examRes.data[0];
          try {
            const schedRes = await api.getLatestSchedule(activeExam.id);
            setLatestSchedule(schedRes.data);
          } catch (e) {
            // No schedule generated yet
          }

          try {
            const pfRes = await api.getPreflight(activeExam.id);
            setPreflightData(pfRes.data);
          } catch (e) {
            // Ignore
          }
        }
      } catch (err) {
        console.error('Failed to load dashboard:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
        <p>Loading examination metrics and audit history...</p>
      </div>
    );
  }

  const activeExam = exams[0];
  const workloadStats = latestSchedule?.validationResult?.workloadStats;

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ marginBottom: '6px' }}>Faculty Allotment System</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Automated Faculty Allotment, Constraint Scheduling & Daily Operations
        </p>
      </div>

      {/* Pre-flight Capacity Alert if Infeasible */}
      {preflightData && !preflightData.isFeasible && (
        <div className="alert alert-warning">
          <AlertTriangle size={24} color="var(--warning)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div className="alert-title">Pre-Flight Capacity Alert: Active Benchmark Infeasible</div>
            <div style={{ fontSize: '0.875rem', lineHeight: '1.5', marginTop: '4px' }}>
              The examination requires <strong className="mono-metric">{preflightData.totalRequiredSlots}</strong> room duties across {preflightData.diagnosticDetails.examDatesCount} consecutive dates.
              Under Rule C (no consecutive days) & Rule B (1 session/day), maximum achievable capacity is <strong className="mono-metric">{preflightData.totalPossibleCapacity}</strong> duties.
              Deficit: <strong className="mono-metric">{preflightData.deficit}</strong> duties.
            </div>
            <button
              onClick={() => onNavigate('allotment')}
              className="btn btn-sage btn-sm"
              style={{ marginTop: '12px' }}
            >
              Inspect Diagnostics & Adjust Rules <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Key Metric Tiles */}
      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">Registered Faculty</div>
          <div className="metric-value">{facultyCount}</div>
          <div className="metric-caption">Active teaching staff</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Examination Rooms</div>
          <div className="metric-value">{roomCount}</div>
          <div className="metric-caption">Configured venues & halls</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Current Examination</div>
          <div style={{ fontSize: '1.25rem', fontFamily: 'var(--font-editorial)', fontWeight: 600, color: 'var(--primary-forest)', margin: '8px 0' }}>
            {activeExam?.name || 'No Active Exam'}
          </div>
          <div className="metric-caption">
            Status: <Badge variant={activeExam?.status === 'SCHEDULED' ? 'success' : 'forest'}>{activeExam?.status || 'DRAFT'}</Badge>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Allocation Coverage</div>
          <div className="metric-value">
            {latestSchedule ? `${latestSchedule.validationResult?.validation?.coveragePercentage || 100}%` : 'N/A'}
          </div>
          <div className="metric-caption">
            {latestSchedule ? `Version ${latestSchedule.version} (${latestSchedule.state})` : 'Schedule not generated'}
          </div>
        </div>
      </div>

      {/* Workload Fairness Section */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Workload Distribution & Fairness (Rule G)</div>
          {latestSchedule && (
            <Badge variant="success">
              <ShieldCheck size={14} /> Validated Schedule V{latestSchedule.version}
            </Badge>
          )}
        </div>

        {workloadStats ? (
          <WorkloadDistributionChart
            distribution={workloadStats.distribution}
            avg={workloadStats.avg}
            median={workloadStats.median}
            variance={workloadStats.variance}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)' }}>
            <p>Generate an allotment to view distribution histogram and fairness variance.</p>
            <button
              onClick={() => onNavigate('allotment')}
              className="btn btn-primary btn-sm"
              style={{ marginTop: '12px' }}
            >
              Open Allotment Engine <Sparkles size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Quick Action Matrix & Audit Trail */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Quick Actions */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Administrative Actions</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button
              onClick={() => onNavigate('allotment')}
              className="btn btn-primary"
              style={{ justifyContent: 'space-between' }}
            >
              <span>Automatic Allotment Engine</span>
              <Sparkles size={16} />
            </button>

            <button
              onClick={() => onNavigate('operations')}
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between' }}
            >
              <span>Daily Operations & Attendance</span>
              <CheckCircle2 size={16} />
            </button>

            <button
              onClick={() => onNavigate('reports')}
              className="btn btn-sage"
              style={{ justifyContent: 'space-between' }}
            >
              <span>Daily & Final Examination Reports</span>
              <ArrowRight size={16} />
            </button>

            <button
              onClick={() => onNavigate('faculty')}
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between' }}
            >
              <span>Manage Faculty Roster & Leave</span>
              <Users size={16} />
            </button>
          </div>
        </div>

        {/* Recent Audit History */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Administrative Audit Trail</div>
          </div>
          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {auditLogs.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No audit events logged yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface-muted)',
                      fontSize: '0.8rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <strong style={{ color: 'var(--primary-forest)' }}>{log.action}</strong>
                      <span className="mono-metric" style={{ color: 'var(--text-muted)' }}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>
                      Entity: <span className="mono-metric">{log.entity}</span> ({log.entity_id}) by {log.actor}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
