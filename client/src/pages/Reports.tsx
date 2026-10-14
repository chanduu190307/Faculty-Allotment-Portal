import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Badge } from '../components/Badge';
import {
  FileText,
  Download,
  Printer,
  Calendar,
  History,
  FileSpreadsheet,
  DoorOpen,
} from 'lucide-react';

export const Reports: React.FC = () => {
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'daily' | 'final' | 'history' | 'roomSheets'>('daily');

  // Reports data
  const [dailyReport, setDailyReport] = useState<any>(null);
  const [finalReport, setFinalReport] = useState<any>(null);
  const [historicalReports, setHistoricalReports] = useState<any[]>([]);
  const [roomSheets, setRoomSheets] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [roomSheetsLoading, setRoomSheetsLoading] = useState(false);

  async function loadExams() {
    try {
      const res = await api.getExaminations();
      setExams(res.data);
      if (res.data.length > 0) {
        const id = res.data[0].id;
        setSelectedExamId(id);
        const examDetails = await api.getExaminationById(id);
        if (examDetails.data?.dates?.length > 0) {
          setSelectedDate(examDetails.data.dates[0].date);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadExams();
  }, []);

  async function loadDailyReport() {
    if (!selectedExamId || !selectedDate) return;
    setLoading(true);
    try {
      const res = await api.getDailyReport(selectedExamId, selectedDate);
      setDailyReport(res.data);
    } catch (err) {
      console.error(err);
      setDailyReport(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadFinalReport() {
    if (!selectedExamId) return;
    setLoading(true);
    try {
      const res = await api.getFinalReport(selectedExamId);
      setFinalReport(res.data);
    } catch (err) {
      console.error(err);
      setFinalReport(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistoricalReports() {
    if (!selectedExamId) return;
    try {
      const res = await api.getHistoricalReports(selectedExamId);
      setHistoricalReports(res.data);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadRoomSheets() {
    if (!selectedExamId) return;
    setRoomSheetsLoading(true);
    try {
      const res = await api.getRoomSheets(selectedExamId, {
        date: selectedDate || undefined,
        session: selectedSession || undefined,
        roomId: selectedRoomId || undefined,
      });
      setRoomSheets(res.data || []);
    } catch (err) {
      console.error(err);
      setRoomSheets([]);
    } finally {
      setRoomSheetsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'daily') {
      loadDailyReport();
    } else if (activeTab === 'final') {
      loadFinalReport();
    } else if (activeTab === 'history') {
      loadHistoricalReports();
    } else if (activeTab === 'roomSheets') {
      loadRoomSheets();
    }
  }, [activeTab, selectedExamId, selectedDate, selectedSession, selectedRoomId]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1>Examination Reports & Audits</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Immutable historical snapshots, daily duty ledgers & verified Excel / PDF exports
          </p>
        </div>

        <select
          value={selectedExamId}
          onChange={(e) => setSelectedExamId(e.target.value)}
          className="form-select"
          style={{ width: '280px' }}
        >
          {exams.map((e) => (
            <option key={e.id} value={e.id}>{e.name} ({e.academicYear})</option>
          ))}
        </select>
      </div>

      {/* Tabs Nav */}
      <div className="tabs-nav">
        <button
          onClick={() => setActiveTab('daily')}
          className={`tab-btn ${activeTab === 'daily' ? 'active' : ''}`}
        >
          Daily Examination Report
        </button>
        <button
          onClick={() => setActiveTab('final')}
          className={`tab-btn ${activeTab === 'final' ? 'active' : ''}`}
        >
          Final Consolidated Examination Report
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
        >
          Historical Saved Snapshots
        </button>
        <button
          onClick={() => setActiveTab('roomSheets')}
          className={`tab-btn ${activeTab === 'roomSheets' ? 'active' : ''}`}
        >
          Print-Ready Room Sheets
        </button>
      </div>

      {/* TAB 1: DAILY REPORT */}
      {activeTab === 'daily' && (
        <div>
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Select Examination Date:</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="form-input"
                  style={{ width: '180px', padding: '6px 10px' }}
                />
                <button onClick={loadDailyReport} className="btn btn-secondary btn-sm">
                  Load Report
                </button>
              </div>

              {dailyReport && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <a
                    href={`/api/reports/allotment-excel/${selectedExamId}?date=${selectedDate}`}
                    download
                    className="btn btn-sage btn-sm"
                    title="Exact 6-column post-allotment Excel template"
                  >
                    <FileSpreadsheet size={14} /> 6-Col Template Excel (.xlsx)
                  </a>
                  <a
                    href={`/api/reports/daily/${selectedExamId}/${selectedDate}/excel`}
                    download
                    className="btn btn-secondary btn-sm"
                  >
                    <Download size={14} /> Daily Ledger (.xlsx)
                  </a>
                  <a
                    href={`/api/reports/daily/${selectedExamId}/${selectedDate}/pdf`}
                    download
                    className="btn btn-primary btn-sm"
                  >
                    <FileText size={14} /> Export PDF (.pdf)
                  </a>
                  <button onClick={() => window.print()} className="btn btn-secondary btn-sm">
                    <Printer size={14} /> Print
                  </button>
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <p>Compiling historical daily report...</p>
          ) : !dailyReport ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
              <p style={{ color: 'var(--text-muted)' }}>No report found for this date. Check that an approved schedule exists.</p>
            </div>
          ) : (
            <div>
              {/* Daily Report Header Card */}
              <div className="card">
                <div style={{ textAlign: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px', marginBottom: '20px' }}>
                  <h2 style={{ color: 'var(--primary-forest)' }}>{dailyReport.collegeName}</h2>
                  <h3>Daily Examination Allotment Report</h3>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {dailyReport.examinationName} ({dailyReport.academicYear}) • Date: <strong>{dailyReport.date}</strong>
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <Badge variant={dailyReport.isProvisional ? 'warning' : 'success'}>
                      {dailyReport.isProvisional ? 'PROVISIONAL REPORT' : `OFFICIAL FINALIZED SNAPSHOT V${dailyReport.reportVersion}`}
                    </Badge>
                  </div>
                </div>

                <div className="metric-grid" style={{ marginBottom: '20px' }}>
                  <div className="metric-card">
                    <div className="metric-label">Active Rooms</div>
                    <div className="metric-value">{dailyReport.summary.totalRooms}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Allocated Teachers</div>
                    <div className="metric-value">{dailyReport.summary.totalAssignments}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Verified Present</div>
                    <div className="metric-value" style={{ color: 'var(--success)' }}>{dailyReport.summary.completedCount}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Absences / Substitutions</div>
                    <div className="metric-value" style={{ color: 'var(--warning)' }}>
                      {dailyReport.summary.absentCount} / {dailyReport.summary.substitutedCount}
                    </div>
                  </div>
                </div>

                <h4>Room-wise Invigilation Roster</h4>
                <div className="table-container" style={{ marginTop: '12px', marginBottom: '24px' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Shift</th>
                        <th>Room ID</th>
                        <th>Venue & Block</th>
                        <th>Faculty ID</th>
                        <th>Invigilator Name</th>
                        <th>Department</th>
                        <th>Duty State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyReport.roomAssignments?.map((a: any) => (
                        <tr key={a.id}>
                          <td><strong>{a.session}</strong></td>
                          <td><span className="room-id">{a.room_id}</span></td>
                          <td>{a.room_name} ({a.building})</td>
                          <td><span className="faculty-id">{a.faculty_id}</span></td>
                          <td>{a.faculty_name}</td>
                          <td>{a.department}</td>
                          <td>
                            <Badge
                              variant={
                                a.status === 'COMPLETED'
                                  ? 'success'
                                  : a.status === 'ABSENT'
                                  ? 'error'
                                  : 'forest'
                              }
                            >
                              {a.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h4>Unassigned & Resting Faculty (Rule H Accounting)</h4>
                <div className="table-container" style={{ marginTop: '12px' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Faculty ID</th>
                        <th>Name</th>
                        <th>Department</th>
                        <th>Cumulative Duties</th>
                        <th>Remaining Capacity</th>
                        <th>Exemption / Rationale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyReport.unassignedFaculty?.slice(0, 15).map((u: any) => (
                        <tr key={u.facultyId}>
                          <td><span className="faculty-id">{u.facultyId}</span></td>
                          <td><strong>{u.name}</strong></td>
                          <td>{u.department}</td>
                          <td><span className="mono-metric">{u.cumulativeDuties}</span></td>
                          <td><span className="mono-metric">{u.remainingCapacity}</span></td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{u.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: '24px', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Generated By: {dailyReport.generatedBy} on {new Date(dailyReport.generatedAt).toLocaleString()}</span>
                  <span>Approved By: {dailyReport.approvedBy || 'Dean Academic'}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: FINAL REPORT */}
      {activeTab === 'final' && (
        <div>
          {loading ? (
            <p>Generating consolidated examination ledger...</p>
          ) : !finalReport ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
              <p style={{ color: 'var(--text-muted)' }}>No consolidated data available. Generate and approve a schedule first.</p>
            </div>
          ) : (
            <div>
              <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: '1.1rem' }}>Final Consolidated Examination Report</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Total Duties: {finalReport.totalAssignedSlots} | Completed: {finalReport.totalCompletedDuties}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <a
                      href={`/api/reports/final/${selectedExamId}/excel`}
                      download
                      className="btn btn-sage btn-sm"
                    >
                      <Download size={14} /> Export Final Excel (.xlsx)
                    </a>
                    <a
                      href={`/api/reports/final/${selectedExamId}/pdf`}
                      download
                      className="btn btn-primary btn-sm"
                    >
                      <FileText size={14} /> Export Final PDF (.pdf)
                    </a>
                    <button onClick={() => window.print()} className="btn btn-secondary btn-sm">
                      <Printer size={14} /> Print
                    </button>
                  </div>
                </div>
              </div>

              {/* Final Summary Card */}
              <div className="card">
                <div style={{ textAlign: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px', marginBottom: '20px' }}>
                  <h2 style={{ color: 'var(--primary-forest)' }}>{finalReport.collegeName}</h2>
                  <h3>CONSOLIDATED FINAL EXAMINATION REPORT</h3>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {finalReport.examinationName} ({finalReport.academicYear}) • Dates: {finalReport.startDate} to {finalReport.endDate}
                  </div>
                </div>

                <div className="metric-grid">
                  <div className="metric-card">
                    <div className="metric-label">Exam Dates</div>
                    <div className="metric-value">{finalReport.totalExamDates}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Active Rooms</div>
                    <div className="metric-value">{finalReport.totalActiveRooms}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Faculty Pool</div>
                    <div className="metric-value">{finalReport.totalParticipatingFaculty}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Total Assigned Duties</div>
                    <div className="metric-value">{finalReport.totalAssignedSlots}</div>
                  </div>
                </div>

                <h4>Faculty Duty Ledger & Workload Compliance</h4>
                <div className="table-container" style={{ marginTop: '12px' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Faculty ID</th>
                        <th>Name</th>
                        <th>Department</th>
                        <th>Assigned</th>
                        <th>Completed</th>
                        <th>Absent</th>
                        <th>Max Limit</th>
                        <th>Remaining</th>
                        <th>Workload Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finalReport.facultySummary?.slice(0, 50).map((f: any) => (
                        <tr key={f.facultyId}>
                          <td><span className="faculty-id">{f.facultyId}</span></td>
                          <td><strong>{f.facultyName}</strong></td>
                          <td>{f.department}</td>
                          <td><span className="mono-metric" style={{ fontWeight: 600 }}>{f.assignedDuties}</span></td>
                          <td><span className="mono-metric" style={{ color: 'var(--success)' }}>{f.completedDuties}</span></td>
                          <td><span className="mono-metric" style={{ color: 'var(--error)' }}>{f.absentDuties}</span></td>
                          <td><span className="mono-metric">{f.maxLimit}</span></td>
                          <td><span className="mono-metric">{f.remainingCapacity}</span></td>
                          <td>
                            <Badge
                              variant={
                                f.status === 'AT_LIMIT'
                                  ? 'forest'
                                  : f.status === 'UNDER_LIMIT'
                                  ? 'sage'
                                  : 'warning'
                              }
                            >
                              {f.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: HISTORICAL SNAPSHOTS */}
      {activeTab === 'history' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Saved Historical Snapshots</div>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Report ID</th>
                  <th>Date</th>
                  <th>Version</th>
                  <th>Provisional?</th>
                  <th>Generated By</th>
                  <th>Generated At</th>
                  <th>Approved By</th>
                </tr>
              </thead>
              <tbody>
                {historicalReports.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                      No archived snapshots yet.
                    </td>
                  </tr>
                ) : (
                  historicalReports.map((h: any) => (
                    <tr key={h.id}>
                      <td><span className="mono-metric">{h.id}</span></td>
                      <td><strong>{h.date}</strong></td>
                      <td>V{h.report_version}</td>
                      <td>
                        <Badge variant={h.is_provisional ? 'warning' : 'success'}>
                          {h.is_provisional ? 'Provisional' : 'Finalized'}
                        </Badge>
                      </td>
                      <td>{h.generated_by}</td>
                      <td className="mono-metric">{new Date(h.generated_at).toLocaleString()}</td>
                      <td>{h.approved_by || 'Dean Academic'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: PRINT-READY ROOM SHEETS */}
      {activeTab === 'roomSheets' && (
        <div>
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '2px', color: 'var(--text-secondary)' }}>
                    Exam Date
                  </label>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="form-input"
                    style={{ width: '160px', padding: '6px 10px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '2px', color: 'var(--text-secondary)' }}>
                    Session
                  </label>
                  <select
                    value={selectedSession}
                    onChange={(e) => setSelectedSession(e.target.value)}
                    className="form-select"
                    style={{ width: '140px', padding: '6px 10px' }}
                  >
                    <option value="">All Sessions</option>
                    <option value="MORNING">Morning</option>
                    <option value="AFTERNOON">Afternoon</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '2px', color: 'var(--text-secondary)' }}>
                    Room Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. A-202"
                    value={selectedRoomId}
                    onChange={(e) => setSelectedRoomId(e.target.value)}
                    className="form-input"
                    style={{ width: '130px', padding: '6px 10px' }}
                  />
                </div>

                <div style={{ alignSelf: 'flex-end' }}>
                  <button onClick={loadRoomSheets} className="btn btn-secondary btn-sm">
                    Load Room Sheets
                  </button>
                </div>
              </div>

              {roomSheets.length > 0 && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <a
                    href={`/api/reports/room-sheets/${selectedExamId}/pdf?${new URLSearchParams({
                      ...(selectedDate ? { date: selectedDate } : {}),
                      ...(selectedSession ? { session: selectedSession } : {}),
                      ...(selectedRoomId ? { roomId: selectedRoomId } : {}),
                    }).toString()}`}
                    download
                    className="btn btn-primary btn-sm"
                  >
                    <Download size={14} /> Download Room Sheets PDF
                  </a>
                  <button onClick={() => window.print()} className="btn btn-secondary btn-sm">
                    <Printer size={14} /> Print Room Sheets
                  </button>
                </div>
              )}
            </div>
          </div>

          {roomSheetsLoading ? (
            <p style={{ textAlign: 'center', padding: '32px' }}>Loading examination room invigilation sheets...</p>
          ) : roomSheets.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
              <DoorOpen size={32} style={{ marginBottom: '12px', opacity: 0.5, color: 'var(--text-secondary)' }} />
              <h3 style={{ fontSize: '1.1rem', marginBottom: '4px' }}>No Room Duty Records Available</h3>
              <p style={{ color: 'var(--text-muted)' }}>
                Ensure an approved schedule exists with room assignments for the selected date and session.
              </p>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Total Printable Room Sheets: <strong>{roomSheets.length}</strong>
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Each sheet is pre-formatted for standard A4 printing with handwriting boxes
                </span>
              </div>

              {/* Grid of room sheets */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {roomSheets.map((sheet: any, idx: number) => (
                  <div
                    key={`${sheet.date}-${sheet.session}-${sheet.roomId}-${idx}`}
                    className="card room-sheet-card"
                    style={{
                      padding: '24px',
                      backgroundColor: 'var(--surface-card)',
                      border: '1px solid var(--border-subtle)',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px', marginBottom: '16px' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sage-muted)', fontWeight: 600 }}>
                          Examination Duty Sheet
                        </div>
                        <h2 style={{ fontSize: '1.3rem', color: 'var(--primary-forest)', margin: '2px 0' }}>
                          {sheet.examinationName} ({sheet.academicYear})
                        </h2>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          Date: <strong>{sheet.date}</strong> • Shift: <strong>{sheet.session}</strong> ({sheet.sessionTime})
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-forest)' }}>
                          Room {sheet.roomId}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {sheet.building}, Floor {sheet.floor}
                        </div>
                      </div>
                    </div>

                    {/* Invigilator Information */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', padding: '12px 16px', backgroundColor: 'var(--canvas-bg)', borderRadius: 'var(--radius-md)', marginBottom: '20px' }}>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Invigilator Name:</span>
                        <strong style={{ fontSize: '1rem', color: 'var(--text-main)' }}>{sheet.facultyName}</strong>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Faculty ID:</span>
                        <span className="mono-metric" style={{ fontWeight: 600 }}>{sheet.facultyId}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Department:</span>
                        <span>{sheet.department}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Designation:</span>
                        <span>{sheet.designation}</span>
                      </div>
                    </div>

                    {/* Handwriting Sign-Off Section */}
                    <div style={{ border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-md)', padding: '16px', backgroundColor: 'var(--surface-elevated)' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary-forest)', marginBottom: '12px', textTransform: 'uppercase' }}>
                        Physical Attendance & Verification (Handwritten)
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', alignItems: 'end' }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            Time-In / Reporting:
                          </div>
                          <div style={{ height: '36px', border: '1px solid var(--border-strong)', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 8px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                            ______ : ______ AM / PM
                          </div>
                        </div>

                        <div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            Invigilator Signature:
                          </div>
                          <div style={{ height: '36px', borderBottom: '1px solid var(--text-main)', display: 'flex', alignItems: 'flex-end', paddingBottom: '2px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            Sign on duty entry
                          </div>
                        </div>

                        <div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            Control Room Officer Verification:
                          </div>
                          <div style={{ height: '36px', borderBottom: '1px solid var(--text-main)', display: 'flex', alignItems: 'flex-end', paddingBottom: '2px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            Official Signature
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
