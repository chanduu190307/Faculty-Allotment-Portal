import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import {
  CheckCircle,
  XCircle,
  UserCheck,
  Calendar,
  Clock,
  Sparkles,
} from 'lucide-react';

export const DailyOperations: React.FC = () => {
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [schedule, setSchedule] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSession, setSelectedSession] = useState<string>('Morning');
  const [loading, setLoading] = useState(true);

  // Substitute modal
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [selectedAssignmentForSub, setSelectedAssignmentForSub] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [subReason, setSubReason] = useState('');
  const [subLoading, setSubLoading] = useState(false);

  async function loadData() {
    try {
      setLoading(true);
      const res = await api.getExaminations();
      setExams(res.data);
      if (res.data.length > 0) {
        const id = res.data[0].id;
        setSelectedExamId(id);
        await loadSchedule(id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadSchedule(examId: string) {
    setSelectedExamId(examId);
    try {
      const sched = await api.getLatestSchedule(examId);
      setSchedule(sched.data);
      if (sched.data?.assignments?.length > 0) {
        setSelectedDate(sched.data.assignments[0].date);
      }
    } catch (e) {
      setSchedule(null);
    }
  }

  async function handleMarkAttendance(assignmentId: string, status: 'COMPLETED' | 'ABSENT') {
    try {
      await api.markAttendance({
        assignmentId,
        status,
        notes: status === 'COMPLETED' ? 'Verified present by Superintendent' : 'Reported absent from duty',
      });
      // Refresh
      const updated = await api.getLatestSchedule(selectedExamId);
      setSchedule(updated.data);
    } catch (err) {
      alert('Failed to record attendance: ' + (err as Error).message);
    }
  }

  async function openSubstituteModal(asgn: any) {
    setSelectedAssignmentForSub(asgn);
    setSubReason('Emergency substitution for absent faculty member');
    setIsSubModalOpen(true);
    setSubLoading(true);
    try {
      const recs = await api.getSubstituteRecommendations(asgn.id);
      setRecommendations(recs.data);
    } catch (err) {
      console.error(err);
    } finally {
      setSubLoading(false);
    }
  }

  async function handleApproveSubstitution(substituteFacultyId: string) {
    if (!selectedAssignmentForSub) return;
    try {
      await api.approveSubstitution({
        assignmentId: selectedAssignmentForSub.id,
        substituteFacultyId,
        reason: subReason,
      });
      setIsSubModalOpen(false);
      const updated = await api.getLatestSchedule(selectedExamId);
      setSchedule(updated.data);
      alert('Faculty substitution verified and approved!');
    } catch (err: any) {
      alert('Substitution failed: ' + (err.message || 'Rule violation'));
    }
  }

  const availableDates: string[] = Array.from(
    new Set((schedule?.assignments || []).map((a: any) => a.date))
  );

  const currentAssignments = (schedule?.assignments || []).filter(
    (a: any) => a.date === selectedDate && a.session === selectedSession
  );

  const stats = {
    total: currentAssignments.length,
    completed: currentAssignments.filter((a: any) => a.status === 'COMPLETED').length,
    absent: currentAssignments.filter((a: any) => a.status === 'ABSENT').length,
    substituted: currentAssignments.filter((a: any) => a.status === 'SUBSTITUTED').length,
    pending: currentAssignments.filter((a: any) => a.status === 'SCHEDULED').length,
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1>Daily Examination Operations</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Real-time attendance tracking, absence recording & verified substitute assignment
          </p>
        </div>

        <select
          value={selectedExamId}
          onChange={(e) => loadSchedule(e.target.value)}
          className="form-select"
          style={{ width: '280px' }}
        >
          {exams.map((e) => (
            <option key={e.id} value={e.id}>{e.name} ({e.academicYear})</option>
          ))}
        </select>
      </div>

      {!schedule ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <p style={{ color: 'var(--text-muted)' }}>No published schedule available for this examination.</p>
        </div>
      ) : (
        <div>
          {/* Shift & Date Controls */}
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Exam Date:</span>
                {availableDates.map((d) => (
                  <button
                    key={d}
                    onClick={() => setSelectedDate(d)}
                    className={`btn btn-sm ${selectedDate === d ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <Calendar size={14} /> {d}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Session Shift:</span>
                {['Morning', 'Afternoon'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSelectedSession(s)}
                    className={`btn btn-sm ${selectedSession === s ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <Clock size={14} /> {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Operational Metrics Bar */}
          <div className="metric-grid" style={{ marginBottom: '20px' }}>
            <div className="metric-card">
              <div className="metric-label">Session Required Rooms</div>
              <div className="metric-value">{stats.total}</div>
            </div>

            <div className="metric-card">
              <div className="metric-label">Present & Completed</div>
              <div className="metric-value" style={{ color: 'var(--success)' }}>{stats.completed}</div>
            </div>

            <div className="metric-card">
              <div className="metric-label">Absences Recorded</div>
              <div className="metric-value" style={{ color: 'var(--error)' }}>{stats.absent}</div>
            </div>

            <div className="metric-card">
              <div className="metric-label">Approved Substitutions</div>
              <div className="metric-value" style={{ color: 'var(--sage-muted)' }}>{stats.substituted}</div>
            </div>
          </div>

          {/* Room-wise Operations Table */}
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Room ID</th>
                  <th>Venue & Block</th>
                  <th>Assigned Faculty</th>
                  <th>Department</th>
                  <th>Attendance State</th>
                  <th style={{ textAlign: 'right' }}>Superintendent Controls</th>
                </tr>
              </thead>
              <tbody>
                {currentAssignments.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                      No room assignments for this date and session shift.
                    </td>
                  </tr>
                ) : (
                  currentAssignments.map((a: any) => (
                    <tr key={a.id}>
                      <td><span className="room-id">{a.room_id}</span></td>
                      <td>{a.room_name} ({a.building})</td>
                      <td>
                        <strong>{a.faculty_name}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <span className="faculty-id">{a.faculty_id}</span>
                        </div>
                      </td>
                      <td>{a.department}</td>
                      <td>
                        <Badge
                          variant={
                            a.status === 'COMPLETED'
                              ? 'success'
                              : a.status === 'ABSENT'
                              ? 'error'
                              : a.status === 'SUBSTITUTED'
                              ? 'sage'
                              : 'forest'
                          }
                        >
                          {a.status}
                        </Badge>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          {a.status !== 'COMPLETED' && (
                            <button
                              onClick={() => handleMarkAttendance(a.id, 'COMPLETED')}
                              className="btn btn-sage btn-sm"
                              title="Mark Present & Completed"
                            >
                              <CheckCircle size={14} /> Mark Present
                            </button>
                          )}

                          {a.status !== 'ABSENT' && (
                            <button
                              onClick={() => handleMarkAttendance(a.id, 'ABSENT')}
                              className="btn btn-danger btn-sm"
                              title="Record Absence"
                            >
                              <XCircle size={14} /> Mark Absent
                            </button>
                          )}

                          <button
                            onClick={() => openSubstituteModal(a)}
                            className="btn btn-secondary btn-sm"
                            title="Find & Assign Standby Substitute"
                          >
                            <UserCheck size={14} /> Substitute
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Substitute Recommendation Modal */}
      <Modal
        isOpen={isSubModalOpen}
        onClose={() => setIsSubModalOpen(false)}
        title={`Recommend Standby Substitute: Room ${selectedAssignmentForSub?.room_id}`}
      >
        {selectedAssignmentForSub && (
          <div>
            <div style={{ padding: '12px', backgroundColor: 'var(--surface-muted)', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '0.85rem' }}>
              <div>Original Invigilator: <strong>{selectedAssignmentForSub.faculty_name}</strong> (<span className="faculty-id">{selectedAssignmentForSub.faculty_id}</span>)</div>
              <div>Room: <strong>{selectedAssignmentForSub.room_id}</strong> on <strong>{selectedAssignmentForSub.date} ({selectedAssignmentForSub.session})</strong></div>
            </div>

            <div className="form-group">
              <label className="form-label">Substitution Rationale</label>
              <input
                type="text"
                value={subReason}
                onChange={(e) => setSubReason(e.target.value)}
                className="form-input"
              />
            </div>

            <h4>Eligible Standby Substitute Candidates (Ranked by Fairness):</h4>
            <div style={{ marginTop: '10px' }}>
              {subLoading ? (
                <p>Analyzing eligible substitutes against constraints...</p>
              ) : recommendations.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No eligible standby substitutes found without rule conflicts.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
                  {recommendations.map((rec: any) => (
                    <div
                      key={rec.faculty.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--surface-card)',
                      }}
                    >
                      <div>
                        <strong>{rec.faculty.name}</strong> (<span className="faculty-id">{rec.faculty.id}</span>)
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {rec.faculty.department} • Duties: <span className="mono-metric">{rec.currentDuties}</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--success)' }}>{rec.eligibilityReason}</div>
                      </div>

                      <button
                        onClick={() => handleApproveSubstitution(rec.faculty.id)}
                        className="btn btn-primary btn-sm"
                      >
                        <Sparkles size={14} /> Assign & Approve
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button onClick={() => setIsSubModalOpen(false)} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
