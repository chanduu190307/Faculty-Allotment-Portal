import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Calendar, Plus, Trash2, CheckCircle2 } from 'lucide-react';

export const ExaminationManagement: React.FC = () => {
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExam, setSelectedExam] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Date editing state
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [examDates, setExamDates] = useState<any[]>([]);
  const [newDateStr, setNewDateStr] = useState('');

  // New Exam modal
  const [isNewExamModalOpen, setIsNewExamModalOpen] = useState(false);
  const [newExamName, setNewExamName] = useState('');
  const [newAcademicYear, setNewAcademicYear] = useState('2026-2027');
  const [newMaxDuties, setNewMaxDuties] = useState(6);
  const [newRestDays, setNewRestDays] = useState(1);

  async function loadExams() {
    try {
      setLoading(true);
      const res = await api.getExaminations();
      setExams(res.data);
      if (res.data.length > 0) {
        const full = await api.getExaminationById(res.data[0].id);
        setSelectedExam(full.data);
      }
    } catch (err) {
      console.error('Failed to load examinations:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadExams();
  }, []);

  async function selectExam(id: string) {
    try {
      const res = await api.getExaminationById(id);
      setSelectedExam(res.data);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCreateExam(e: React.FormEvent) {
    e.preventDefault();
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await api.createExamination({
        name: newExamName,
        academicYear: newAcademicYear,
        startDate: today,
        endDate: today,
        maxDutiesPerFaculty: newMaxDuties,
        restDays: newRestDays,
      });
      setIsNewExamModalOpen(false);
      setNewExamName('');
      loadExams();
      selectExam(res.data.id);
    } catch (err) {
      alert('Failed to create examination: ' + (err as Error).message);
    }
  }

  function openDateEditor() {
    if (!selectedExam) return;
    setExamDates([...(selectedExam.dates || [])]);
    setIsDateModalOpen(true);
  }

  function handleAddDate() {
    if (!newDateStr) return;
    if (examDates.some((d) => d.date === newDateStr)) {
      alert('Date already exists in calendar.');
      return;
    }
    const updated = [
      ...examDates,
      { date: newDateStr, sequenceOrder: examDates.length + 1, isExamDay: true },
    ].sort((a, b) => a.date.localeCompare(b.date));
    setExamDates(updated);
    setNewDateStr('');
  }

  function handleToggleExamDay(dateStr: string) {
    const updated = examDates.map((d) =>
      d.date === dateStr ? { ...d, isExamDay: !d.isExamDay } : d
    );
    setExamDates(updated);
  }

  function handleRemoveDate(dateStr: string) {
    const updated = examDates.filter((d) => d.date !== dateStr);
    setExamDates(updated);
  }

  // Helper to generate non-consecutive alternating calendar
  function applyNonConsecutiveTemplate() {
    const dates: any[] = [];
    const base = new Date('2026-10-15T00:00:00Z');
    for (let i = 0; i < 6; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i * 2); // Every alternate day (Oct 15, 17, 19, 21, 23, 25)
      dates.push({
        date: d.toISOString().slice(0, 10),
        sequenceOrder: i + 1,
        isExamDay: true,
      });
    }
    setExamDates(dates);
  }

  async function handleSaveDates() {
    try {
      await api.updateExamDates(selectedExam.id, examDates);
      setIsDateModalOpen(false);
      selectExam(selectedExam.id);
    } catch (err) {
      alert('Failed to save dates: ' + (err as Error).message);
    }
  }

  async function handleUpdateStatus(status: string) {
    try {
      await api.updateExamStatus(selectedExam.id, status);
      selectExam(selectedExam.id);
      loadExams();
    } catch (err) {
      alert('Failed to update status: ' + (err as Error).message);
    }
  }

  if (loading) {
    return <p style={{ color: 'var(--text-secondary)' }}>Loading examinations...</p>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1>Examination Management</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Academic terms, examination calendars, session structures & constraints
          </p>
        </div>
        <button onClick={() => setIsNewExamModalOpen(true)} className="btn btn-primary">
          <Plus size={16} /> New Examination Term
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px' }}>
        {/* Examination List */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Examinations</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {exams.map((e) => (
              <div
                key={e.id}
                onClick={() => selectExam(e.id)}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid',
                  borderColor: selectedExam?.id === e.id ? 'var(--primary-forest)' : 'var(--border-subtle)',
                  backgroundColor: selectedExam?.id === e.id ? 'var(--primary-forest-subtle)' : 'var(--surface-card)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.95rem' }}>{e.name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <span>{e.academicYear}</span>
                  <Badge variant={e.status === 'SCHEDULED' ? 'success' : 'forest'}>{e.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Selected Examination Detail */}
        {selectedExam && (
          <div>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">{selectedExam.name}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    ID: <span className="mono-metric">{selectedExam.id}</span> | Term: {selectedExam.academicYear}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <select
                    value={selectedExam.status}
                    onChange={(e) => handleUpdateStatus(e.target.value)}
                    className="form-select"
                    style={{ width: '160px', padding: '6px 10px' }}
                  >
                    <option value="DRAFT">DRAFT</option>
                    <option value="SCHEDULED">SCHEDULED</option>
                    <option value="IN_PROGRESS">IN_PROGRESS</option>
                    <option value="COMPLETED">COMPLETED</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                </div>
              </div>

              {/* Parameters Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
                <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
                  <div className="metric-label">Max Duties per Faculty</div>
                  <div className="mono-metric" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-forest)' }}>
                    {selectedExam.maxDutiesPerFaculty} duties
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Rule F Cap</div>
                </div>

                <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
                  <div className="metric-label">Staffing per Room</div>
                  <div className="mono-metric" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-forest)' }}>
                    {selectedExam.defaultStaffingPerRoom} invigilator
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Rule A Coverage</div>
                </div>

                <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
                  <div className="metric-label">Daily Sessions</div>
                  <div className="mono-metric" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-forest)' }}>
                    {selectedExam.sessionsPerDay} shifts
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Rule B: Max 1/day</div>
                </div>

                <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
                  <div className="metric-label">Sequence Rest Days</div>
                  <div className="mono-metric" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-forest)' }}>
                    {selectedExam.restDays ?? 1} day(s)
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Rule H3 Spacing</div>
                </div>
              </div>

              {/* Examination Dates Schedule */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h4>Examination Calendar Dates ({selectedExam.dates?.length || 0})</h4>
                <button onClick={openDateEditor} className="btn btn-secondary btn-sm">
                  <Calendar size={14} /> Edit Dates & Break Days
                </button>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Seq #</th>
                      <th>Date</th>
                      <th>Day of Week</th>
                      <th>Examination Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!selectedExam.dates || selectedExam.dates.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                          No examination dates configured yet.
                        </td>
                      </tr>
                    ) : (
                      selectedExam.dates.map((d: any, idx: number) => {
                        const dayName = new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long' });
                        return (
                          <tr key={d.date}>
                            <td><span className="mono-metric">Day {idx + 1}</span></td>
                            <td><strong>{d.date}</strong></td>
                            <td>{dayName}</td>
                            <td>
                              {d.isExamDay ? (
                                <Badge variant="success"><CheckCircle2 size={12} /> Active Exam Day</Badge>
                              ) : (
                                <Badge variant="sage">Rest / Holiday Break</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Sessions Details */}
              <div style={{ marginTop: '24px' }}>
                <h4 style={{ marginBottom: '12px' }}>Configured Daily Examination Sessions</h4>
                <div style={{ display: 'flex', gap: '16px' }}>
                  {selectedExam.sessionConfig?.map((sess: any) => (
                    <div
                      key={sess.name}
                      style={{
                        flex: 1,
                        padding: '14px',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: 'var(--surface-card)',
                      }}
                    >
                      <strong style={{ fontSize: '1rem', color: 'var(--primary-forest)' }}>{sess.name} Session</strong>
                      <div className="mono-metric" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        {sess.startTime} — {sess.endTime}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Date Editor Modal */}
      <Modal
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        title={`Configure Calendar Dates: ${selectedExam?.name}`}
      >
        <div>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <input
              type="date"
              value={newDateStr}
              onChange={(e) => setNewDateStr(e.target.value)}
              className="form-input"
              style={{ flex: 1 }}
            />
            <button type="button" onClick={handleAddDate} className="btn btn-primary btn-sm">
              <Plus size={14} /> Add Date
            </button>
            <button
              type="button"
              onClick={applyNonConsecutiveTemplate}
              className="btn btn-sage btn-sm"
              title="Populates 6 alternating exam dates with rest days (avoids Rule C consecutive collision)"
            >
              Apply Alternating Feasible Template
            </button>
          </div>

          <div className="table-container" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Exam Day?</th>
                  <th style={{ textAlign: 'right' }}>Remove</th>
                </tr>
              </thead>
              <tbody>
                {examDates.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      No dates added.
                    </td>
                  </tr>
                ) : (
                  examDates.map((d) => (
                    <tr key={d.date}>
                      <td><strong>{d.date}</strong></td>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleToggleExamDay(d.date)}
                          className={`btn btn-sm ${d.isExamDay ? 'btn-sage' : 'btn-secondary'}`}
                        >
                          {d.isExamDay ? 'Active Exam Day' : 'Rest / Break'}
                        </button>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => handleRemoveDate(d.date)}
                          className="btn btn-danger btn-sm"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={() => setIsDateModalOpen(false)} className="btn btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={handleSaveDates} className="btn btn-primary">
              Save Calendar Dates
            </button>
          </div>
        </div>
      </Modal>

      {/* New Exam Modal */}
      <Modal
        isOpen={isNewExamModalOpen}
        onClose={() => setIsNewExamModalOpen(false)}
        title="Create New Examination Term"
      >
        <form onSubmit={handleCreateExam}>
          <div className="form-group">
            <label className="form-label">Examination Name</label>
            <input
              type="text"
              required
              placeholder="e.g. End-Semester Examination Autumn 2026"
              value={newExamName}
              onChange={(e) => setNewExamName(e.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Academic Year</label>
            <input
              type="text"
              required
              placeholder="2026-2027"
              value={newAcademicYear}
              onChange={(e) => setNewAcademicYear(e.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Maximum Duties per Faculty Member</label>
            <input
              type="number"
              min="1"
              max="20"
              value={newMaxDuties}
              onChange={(e) => setNewMaxDuties(Number(e.target.value))}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Sequence Rest Days (Rule H3 Spacing)</label>
            <input
              type="number"
              min="0"
              max="5"
              value={newRestDays}
              onChange={(e) => setNewRestDays(Number(e.target.value))}
              className="form-input"
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
              0 = Consecutive allowed; 1 = Adjacent examination dates forbidden; &gt;1 = Intervening exam dates required.
            </span>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={() => setIsNewExamModalOpen(false)} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create Term
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
