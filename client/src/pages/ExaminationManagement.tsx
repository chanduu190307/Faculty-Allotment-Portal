import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import {
  Calendar,
  Plus,
  Trash2,
  CheckCircle2,
  Upload,
  FileText,
  AlertTriangle,
  Edit2,
  XCircle,
  Clock,
  BookOpen,
} from 'lucide-react';

export const ExaminationManagement: React.FC = () => {
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExam, setSelectedExam] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Confirmed timetable state for selected exam
  const [confirmedTimetable, setConfirmedTimetable] = useState<any[]>([]);
  const [timetableLoading, setTimetableLoading] = useState(false);

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

  // Timetable PDF Upload & Review Modal State (Feature A, B, C)
  const [isTimetableModalOpen, setIsTimetableModalOpen] = useState(false);
  const [timetableFile, setTimetableFile] = useState<File | null>(null);
  const [timetablePreview, setTimetablePreview] = useState<any>(null);
  const [timetableRows, setTimetableRows] = useState<any[]>([]);
  const [timetableModalLoading, setTimetableModalLoading] = useState(false);
  const [timetableError, setTimetableError] = useState<string | null>(null);
  const [timetableSuccess, setTimetableSuccess] = useState<string | null>(null);
  const [timetableSearchQuery, setTimetableSearchQuery] = useState('');
  const [timetableFilterIssuesOnly, setTimetableFilterIssuesOnly] = useState(false);

  // Multi-semester tabs & filters for Confirmed and Preview views
  const [selectedSemesterTab, setSelectedSemesterTab] = useState('ALL');
  const [ttFilterGroup, setTtFilterGroup] = useState('');
  const [ttFilterDate, setTtFilterDate] = useState('');
  const [ttFilterSession, setTtFilterSession] = useState('');
  const [ttSearch, setTtSearch] = useState('');
  const [previewSemesterTab, setPreviewSemesterTab] = useState('ALL');

  async function loadExams() {
    try {
      setLoading(true);
      const res = await api.getExaminations();
      setExams(res.data);
      if (res.data.length > 0) {
        const full = await api.getExaminationById(res.data[0].id);
        setSelectedExam(full.data);
        loadExamTimetable(full.data.id);
      }
    } catch (err) {
      console.error('Failed to load examinations:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadExamTimetable(examId: string) {
    try {
      setTimetableLoading(true);
      const res = await api.getExamTimetable(examId);
      setConfirmedTimetable(res.data || []);
    } catch (err) {
      console.error('Failed to load timetable:', err);
      setConfirmedTimetable([]);
    } finally {
      setTimetableLoading(false);
    }
  }

  useEffect(() => {
    loadExams();
  }, []);

  async function selectExam(id: string) {
    try {
      const res = await api.getExaminationById(id);
      setSelectedExam(res.data);
      loadExamTimetable(id);
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
      await loadExams();
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

  // =========================================================================
  // Timetable PDF Handlers (Features A, B, C)
  // =========================================================================
  function handleOpenTimetableModal() {
    handleResetTimetableImport();
    setIsTimetableModalOpen(true);
  }

  function handleResetTimetableImport() {
    setTimetableFile(null);
    setTimetablePreview(null);
    setTimetableRows([]);
    setTimetableError(null);
    setTimetableSuccess(null);
    setTimetableSearchQuery('');
    setTimetableFilterIssuesOnly(false);
  }

  async function handleTimetableFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side extension validation
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setTimetableError('Please select a valid PDF file (.pdf).');
      return;
    }

    // Client-side size limit check: 10MB
    if (file.size > 10 * 1024 * 1024) {
      setTimetableError('File size exceeds the 10MB safe upload limit.');
      return;
    }

    setTimetableFile(file);
    setTimetableError(null);
    setTimetableSuccess(null);
    setTimetableModalLoading(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const res = await api.previewTimetablePdfImport({
            fileBase64: base64,
            filename: file.name,
            examinationId: selectedExam.id,
          });

          setTimetablePreview(res.preview);
          const rawRecords = res.preview.records || res.preview.rows || [];
          setTimetableRows(rawRecords);
        } catch (err: any) {
          setTimetableError(err.message || 'Failed to parse timetable PDF.');
        } finally {
          setTimetableModalLoading(false);
        }
      };
      reader.onerror = () => {
        setTimetableError('Failed to read uploaded PDF file.');
        setTimetableModalLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setTimetableError(err.message || 'Error processing PDF file.');
      setTimetableModalLoading(false);
    }
  }

  function handleTimetableRowChange(index: number, field: string, value: string) {
    const updated = [...timetableRows];
    const row = { ...updated[index], [field]: value };

    // Recompute duration if times change
    if (field === 'startTime' || field === 'endTime') {
      const s = field === 'startTime' ? value : row.startTime;
      const e = field === 'endTime' ? value : row.endTime;
      if (s && e && s < e) {
        const [sh, sm] = s.split(':').map(Number);
        const [eh, em] = e.split(':').map(Number);
        if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
          row.durationMinutes = (eh * 60 + em) - (sh * 60 + sm);
        }
      }
    }

    // Dynamic basic validation check
    const issues: string[] = [];
    if (!row.date || !row.date.trim()) issues.push('Examination date is required.');
    if (!row.subjectCode || !row.subjectCode.trim()) issues.push('Subject code is required.');
    if (!row.subjectName || !row.subjectName.trim()) issues.push('Subject name is required.');
    if (!row.startTime) issues.push('Start time is required.');
    if (!row.endTime) issues.push('End time is required.');
    if (row.startTime && row.endTime && row.endTime <= row.startTime) {
      issues.push('End time must be after start time.');
    }

    row.issues = issues;
    row.status = issues.length > 0 ? 'INCOMPLETE' : 'VALID';
    updated[index] = row;
    setTimetableRows(updated);
  }

  function handleRemoveTimetableRow(index: number) {
    const updated = timetableRows.filter((_, idx) => idx !== index);
    // Renumber rows
    const renumbered = updated.map((r, idx) => ({ ...r, rowNumber: idx + 1 }));
    setTimetableRows(renumbered);
  }

  async function handleConfirmTimetableImport() {
    if (!selectedExam || timetableRows.length === 0) return;

    setTimetableModalLoading(true);
    setTimetableError(null);
    setTimetableSuccess(null);

    try {
      const res = await api.commitTimetablePdfImport({
        examinationId: selectedExam.id,
        records: timetableRows,
      });

      setTimetableSuccess(
        `Timetable imported successfully! Added ${res.imported} new subject examination(s), updated ${res.updated}, skipped ${res.skipped}. Calendar dates and session shifts synchronized.`
      );

      // Refresh examination and confirmed timetable
      await selectExam(selectedExam.id);
      await loadExamTimetable(selectedExam.id);
      await loadExams();

      // Close modal after brief confirmation pause
      setTimeout(() => {
        setIsTimetableModalOpen(false);
        handleResetTimetableImport();
      }, 1600);
    } catch (err: any) {
      console.error('Timetable commit error:', err);
      setTimetableError(err.message || 'Failed to commit timetable to database.');
    } finally {
      setTimetableModalLoading(false);
    }
  }

  async function handleDeleteTimetable() {
    if (!selectedExam) return;
    const confirmed = window.confirm(
      'Are you sure you want to clear the confirmed examination timetable? The system will revert to default Cartesian product session staffing.'
    );
    if (!confirmed) return;

    try {
      await api.deleteExamTimetable(selectedExam.id);
      await selectExam(selectedExam.id);
      await loadExamTimetable(selectedExam.id);
      await loadExams();
    } catch (err: any) {
      alert('Failed to delete timetable: ' + err.message);
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
            {exams.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No examination terms created yet. Click "New Examination Term" above to create an academic term.
              </div>
            ) : (
              exams.map((e) => (
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
              ))
            )}
          </div>
        </div>

        {/* Selected Examination Detail */}
        {selectedExam ? (
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
                  <button
                    onClick={handleOpenTimetableModal}
                    className="btn btn-primary btn-sm"
                    title="Upload and extract examination timetable PDF"
                  >
                    <FileText size={15} /> Import Timetable (PDF)
                  </button>
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

              {/* Confirmed Examination Timetable Section (Feature C & D) */}
              <div style={{ marginBottom: '28px', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-card)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <BookOpen size={18} color="var(--primary-forest)" />
                    <h4 style={{ margin: 0 }}>Confirmed Examination Timetable</h4>
                    {confirmedTimetable.length > 0 ? (
                      <Badge variant="success">Confirmed ({confirmedTimetable.length} Subjects)</Badge>
                    ) : (
                      <Badge variant="sage">Default Cartesian Mode</Badge>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={handleOpenTimetableModal}
                      className="btn btn-secondary btn-sm"
                    >
                      <Upload size={14} /> {confirmedTimetable.length > 0 ? 'Re-import / Update PDF' : 'Upload Timetable PDF'}
                    </button>
                    {confirmedTimetable.length > 0 && (
                      <button
                        onClick={handleDeleteTimetable}
                        className="btn btn-danger btn-sm"
                        title="Delete confirmed timetable and revert to default Cartesian product"
                      >
                        <Trash2 size={14} /> Clear Timetable
                      </button>
                    )}
                  </div>
                </div>

                {timetableLoading ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading confirmed timetable...</p>
                ) : confirmedTimetable.length === 0 ? (
                  <div style={{ padding: '16px', backgroundColor: 'var(--canvas-bg)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-subtle)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                      No Examination Timetable PDF Confirmed
                    </div>
                    <div>
                      The scheduling engine is currently operating in standard Cartesian mode across all configured daily sessions. Upload an official multi-semester timetable PDF to restrict staffing demand strictly to active examination subjects and timings.
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* Multi-Semester Tabs */}
                    <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-subtle)', marginBottom: '14px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedSemesterTab('ALL')}
                        style={{
                          padding: '8px 14px',
                          fontSize: '0.85rem',
                          fontWeight: selectedSemesterTab === 'ALL' ? 700 : 500,
                          borderBottom: selectedSemesterTab === 'ALL' ? '2px solid var(--primary-forest)' : '2px solid transparent',
                          color: selectedSemesterTab === 'ALL' ? 'var(--primary-forest)' : 'var(--text-secondary)',
                          background: 'none',
                          borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        All Semesters ({confirmedTimetable.length})
                      </button>
                      {['I', 'III', 'V'].map((sem) => {
                        const count = confirmedTimetable.filter((r) => r.semester === sem).length;
                        return (
                          <button
                            key={sem}
                            type="button"
                            onClick={() => setSelectedSemesterTab(sem)}
                            style={{
                              padding: '8px 14px',
                              fontSize: '0.85rem',
                              fontWeight: selectedSemesterTab === sem ? 700 : 500,
                              borderBottom: selectedSemesterTab === sem ? '2px solid var(--primary-forest)' : '2px solid transparent',
                              color: selectedSemesterTab === sem ? 'var(--primary-forest)' : 'var(--text-secondary)',
                              background: 'none',
                              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            Semester {sem} ({count})
                          </button>
                        );
                      })}
                      {Array.from(new Set(confirmedTimetable.map((r) => r.semester).filter((s) => s && !['I', 'III', 'V'].includes(s))))
                        .sort()
                        .map((sem) => {
                          const count = confirmedTimetable.filter((r) => r.semester === sem).length;
                          return (
                            <button
                              key={sem}
                              type="button"
                              onClick={() => setSelectedSemesterTab(sem)}
                              style={{
                                padding: '8px 14px',
                                fontSize: '0.85rem',
                                fontWeight: selectedSemesterTab === sem ? 700 : 500,
                                borderBottom: selectedSemesterTab === sem ? '2px solid var(--primary-forest)' : '2px solid transparent',
                                color: selectedSemesterTab === sem ? 'var(--primary-forest)' : 'var(--text-secondary)',
                                background: 'none',
                                borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              Semester {sem} ({count})
                            </button>
                          );
                        })}
                    </div>

                    {/* Filter Toolbar */}
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: '180px' }}>
                        <input
                          type="text"
                          placeholder="Search code, title, department..."
                          value={ttSearch}
                          onChange={(e) => setTtSearch(e.target.value)}
                          className="form-input"
                          style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                        />
                      </div>

                      {Array.from(new Set(confirmedTimetable.map((r) => r.programGroup).filter(Boolean))).length > 0 && (
                        <select
                          value={ttFilterGroup}
                          onChange={(e) => setTtFilterGroup(e.target.value)}
                          className="form-select"
                          style={{ width: 'auto', minWidth: '170px', padding: '6px 10px', fontSize: '0.8rem' }}
                        >
                          <option value="">All Programs / Cohorts</option>
                          {Array.from(new Set(confirmedTimetable.map((r) => r.programGroup).filter(Boolean)))
                            .sort()
                            .map((g: any) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                        </select>
                      )}

                      {Array.from(new Set(confirmedTimetable.map((r) => r.examDate).filter(Boolean))).length > 0 && (
                        <select
                          value={ttFilterDate}
                          onChange={(e) => setTtFilterDate(e.target.value)}
                          className="form-select"
                          style={{ width: 'auto', minWidth: '140px', padding: '6px 10px', fontSize: '0.8rem' }}
                        >
                          <option value="">All Exam Dates</option>
                          {Array.from(new Set(confirmedTimetable.map((r) => r.examDate).filter(Boolean)))
                            .sort()
                            .map((d: any) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                        </select>
                      )}

                      <select
                        value={ttFilterSession}
                        onChange={(e) => setTtFilterSession(e.target.value)}
                        className="form-select"
                        style={{ width: 'auto', minWidth: '130px', padding: '6px 10px', fontSize: '0.8rem' }}
                      >
                        <option value="">All Sessions</option>
                        <option value="Morning">Morning</option>
                        <option value="Afternoon">Afternoon</option>
                      </select>

                      {(ttSearch || ttFilterGroup || ttFilterDate || ttFilterSession || selectedSemesterTab !== 'ALL') && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSemesterTab('ALL');
                            setTtFilterGroup('');
                            setTtFilterDate('');
                            setTtFilterSession('');
                            setTtSearch('');
                          }}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        >
                          Reset Filters
                        </button>
                      )}
                    </div>

                    {/* Confirmed Timetable Table */}
                    <div className="table-container" style={{ maxHeight: '340px', overflowY: 'auto' }}>
                      <table className="data-table" style={{ fontSize: '0.8rem' }}>
                        <thead>
                          <tr>
                            <th>Semester</th>
                            <th>Cohort / Program</th>
                            <th>Date</th>
                            <th>Session / Slot</th>
                            <th>Subject Code</th>
                            <th>Subject / Exam Name</th>
                            <th>Timings</th>
                            <th>Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {confirmedTimetable
                            .filter((r) => {
                              if (selectedSemesterTab !== 'ALL' && r.semester !== selectedSemesterTab) return false;
                              if (ttFilterGroup && r.programGroup !== ttFilterGroup) return false;
                              if (ttFilterDate && r.examDate !== ttFilterDate) return false;
                              if (ttFilterSession && r.session !== ttFilterSession) return false;
                              if (ttSearch) {
                                const q = ttSearch.toLowerCase();
                                const cMatch = r.subjectCode?.toLowerCase().includes(q);
                                const nMatch = r.subjectName?.toLowerCase().includes(q);
                                const dMatch = r.examDate?.toLowerCase().includes(q);
                                const gMatch = r.programGroup?.toLowerCase().includes(q);
                                if (!cMatch && !nMatch && !dMatch && !gMatch) return false;
                              }
                              return true;
                            })
                            .map((row) => (
                              <tr key={row.id}>
                                <td>
                                  <Badge variant={row.semester === 'I' ? 'forest' : row.semester === 'III' ? 'sage' : 'warning'}>
                                    Sem {row.semester || 'N/A'}
                                  </Badge>
                                </td>
                                <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                  {row.programGroup || 'General'}
                                </td>
                                <td><strong>{row.examDate}</strong></td>
                                <td>
                                  <Badge variant={row.session === 'Morning' ? 'forest' : 'sage'}>
                                    {row.session}{row.slot ? ` [Slot ${row.slot}]` : ''}
                                  </Badge>
                                </td>
                                <td><span className="mono-metric" style={{ fontWeight: 600 }}>{row.subjectCode}</span></td>
                                <td style={{ fontWeight: 600 }}>{row.subjectName}</td>
                                <td className="mono-metric">{row.startTime} — {row.endTime}</td>
                                <td className="mono-metric">
                                  {row.durationMinutes ? `${row.durationMinutes} mins` : '-'}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
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
        ) : (
          <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ maxWidth: '420px', margin: '0 auto' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--forest-green)', marginBottom: '8px' }}>
                {exams.length === 0 ? 'No Examination Terms Configured' : 'Select an Examination Term'}
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '16px' }}>
                {exams.length === 0
                  ? 'Create an examination term to configure academic dates, upload official examination timetables, and prepare room and teacher staffing.'
                  : 'Select an examination term from the left sidebar to view calendar dates, manage room allocations, and import timetables.'}
              </p>
              {exams.length === 0 && (
                <button type="button" onClick={() => setIsNewExamModalOpen(true)} className="btn btn-primary btn-sm">
                  <Plus size={15} /> Create First Examination Term
                </button>
              )}
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

      {/* Timetable PDF Upload, Review & Confirmation Modal (Features A, B, C) */}
      {isTimetableModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => {
            setIsTimetableModalOpen(false);
            handleResetTimetableImport();
          }}
          title={`Upload & Confirm Timetable PDF: ${selectedExam?.name}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '78vh', overflowY: 'auto' }}>
            {/* Step 1: File Selector */}
            {!timetablePreview && (
              <div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '12px' }}>
                  Upload an institutional examination timetable PDF. The schedule is parsed in-memory and thoroughly validated. You can review, correct, or discard records before confirming any database updates.
                </p>

                <div
                  style={{
                    border: '2px dashed var(--border-strong)',
                    borderRadius: 'var(--radius-md)',
                    padding: '36px 20px',
                    textAlign: 'center',
                    backgroundColor: 'var(--canvas-bg)',
                  }}
                >
                  <FileText size={42} color="var(--primary-forest)" style={{ marginBottom: '10px' }} />
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Select Examination Timetable PDF (.pdf)
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                    Digital selectable text supported • Deterministic extraction • Maximum file size: 10MB
                  </div>

                  <input
                    type="file"
                    accept=".pdf, application/pdf"
                    onChange={handleTimetableFileSelect}
                    disabled={timetableModalLoading}
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>
              </div>
            )}

            {timetableModalLoading && (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>Extracting and validating timetable data streams...</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Normalizing dates, resolving session shifts, and evaluating conflict constraints in-memory. Zero persistent data changes have occurred.
                </div>
              </div>
            )}

            {timetableError && (
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--error-bg)',
                  color: 'var(--error)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--error-border)',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '2px' }}>Timetable Notice:</div>
                {timetableError}
              </div>
            )}

            {timetableSuccess && (
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--success-bg)',
                  color: 'var(--success)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--success-border)',
                  fontSize: '0.85rem',
                }}
              >
                {timetableSuccess}
              </div>
            )}

            {/* Step 2: Extraction & In-Memory Preview Table (Feature C) */}
            {timetablePreview && !timetableSuccess && (
              <div>
                {/* Document metadata banner */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    backgroundColor: 'var(--surface-muted)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                    marginBottom: '12px',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div>
                    <strong>Document:</strong> <span className="mono-metric">{timetablePreview.filename}</span> ({timetablePreview.totalPages} {timetablePreview.totalPages === 1 ? 'page' : 'pages'}, {(timetablePreview.fileSizeBytes / 1024).toFixed(1)} KB)
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    In-Memory Preview • No DB Changes
                  </div>
                </div>

                {/* Summary badges */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Parsed Statistics:</span>
                  <Badge variant="forest">Parsed: {timetablePreview.totalParsed}</Badge>
                  <Badge variant="success">Valid: {timetablePreview.validCount}</Badge>
                  {timetablePreview.incompleteCount > 0 && (
                    <Badge variant="error">Incomplete: {timetablePreview.incompleteCount}</Badge>
                  )}
                  {timetablePreview.duplicateCount > 0 && (
                    <Badge variant="warning">Duplicates: {timetablePreview.duplicateCount}</Badge>
                  )}
                  {timetablePreview.ambiguousCount > 0 && (
                    <Badge variant="warning">Ambiguous Dates: {timetablePreview.ambiguousCount}</Badge>
                  )}
                  {timetablePreview.conflictCount > 0 && (
                    <Badge variant="error">Conflicts: {timetablePreview.conflictCount}</Badge>
                  )}
                  <Badge variant="sage">Distinct Dates: {timetablePreview.distinctDates?.length || 0}</Badge>
                  <Badge variant="sage">Sessions: {timetablePreview.distinctSessions?.join(', ') || 'N/A'}</Badge>
                </div>

                {/* Parser Warnings if any */}
                {timetablePreview.warnings && timetablePreview.warnings.length > 0 && (
                  <div style={{ marginBottom: '12px', padding: '8px 12px', backgroundColor: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--warning)' }}>
                    {timetablePreview.warnings.map((w: string, idx: number) => (
                      <div key={idx}>• {w}</div>
                    ))}
                  </div>
                )}

                {/* Search & Filter Toolbar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <input
                      type="text"
                      placeholder="Search timetable records by subject name, code, date..."
                      value={timetableSearchQuery}
                      onChange={(e) => setTimetableSearchQuery(e.target.value)}
                      className="form-input"
                      style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                    />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={timetableFilterIssuesOnly}
                      onChange={(e) => setTimetableFilterIssuesOnly(e.target.checked)}
                    />
                    <span>Show flagged / issues only</span>
                  </label>
                </div>

                {/* Reviewable, Editable Table */}
                <div className="table-container" style={{ maxHeight: '360px', overflowY: 'auto' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '35px', padding: '6px 8px' }}>#</th>
                        <th style={{ width: '115px', padding: '6px 8px' }}>Date (YYYY-MM-DD) *</th>
                        <th style={{ width: '105px', padding: '6px 8px' }}>Code *</th>
                        <th style={{ padding: '6px 8px' }}>Subject / Exam Name *</th>
                        <th style={{ width: '90px', padding: '6px 8px' }}>Session *</th>
                        <th style={{ width: '75px', padding: '6px 8px' }}>Start</th>
                        <th style={{ width: '75px', padding: '6px 8px' }}>End</th>
                        <th style={{ width: '65px', padding: '6px 8px' }}>Duration</th>
                        <th style={{ width: '85px', padding: '6px 8px' }}>Status</th>
                        <th style={{ width: '45px', padding: '6px 8px' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timetableRows
                        .map((row, originalIdx) => ({ row, originalIdx }))
                        .filter(({ row }) => {
                          if (timetableFilterIssuesOnly && row.status === 'VALID' && (!row.issues || row.issues.length === 0)) {
                            return false;
                          }
                          if (!timetableSearchQuery) return true;
                          const q = timetableSearchQuery.toLowerCase();
                          return (
                            row.subjectName?.toLowerCase().includes(q) ||
                            row.subjectCode?.toLowerCase().includes(q) ||
                            row.date?.toLowerCase().includes(q) ||
                            row.session?.toLowerCase().includes(q)
                          );
                        })
                        .map(({ row, originalIdx }) => (
                          <React.Fragment key={originalIdx}>
                            <tr
                              style={{
                                backgroundColor: row.status !== 'VALID' ? 'var(--warning-bg)' : undefined,
                              }}
                            >
                              <td style={{ padding: '6px 8px' }}>{row.rowNumber}</td>
                              <td style={{ padding: '4px 6px' }}>
                                <input
                                  type="text"
                                  value={row.date || ''}
                                  onChange={(e) => handleTimetableRowChange(originalIdx, 'date', e.target.value)}
                                  className="form-input"
                                  placeholder="YYYY-MM-DD"
                                  style={{
                                    padding: '4px 6px',
                                    fontSize: '0.75rem',
                                    fontFamily: 'var(--font-data)',
                                    borderColor: !row.date ? 'var(--error)' : undefined,
                                  }}
                                />
                              </td>
                              <td style={{ padding: '4px 6px' }}>
                                <input
                                  type="text"
                                  value={row.subjectCode || ''}
                                  onChange={(e) => handleTimetableRowChange(originalIdx, 'subjectCode', e.target.value)}
                                  className="form-input"
                                  placeholder="Code"
                                  style={{
                                    padding: '4px 6px',
                                    fontSize: '0.75rem',
                                    fontFamily: 'var(--font-data)',
                                    borderColor: !row.subjectCode ? 'var(--error)' : undefined,
                                  }}
                                />
                              </td>
                              <td style={{ padding: '4px 6px' }}>
                                <input
                                  type="text"
                                  value={row.subjectName || ''}
                                  onChange={(e) => handleTimetableRowChange(originalIdx, 'subjectName', e.target.value)}
                                  className="form-input"
                                  placeholder="Subject Title"
                                  style={{
                                    padding: '4px 6px',
                                    fontSize: '0.75rem',
                                    borderColor: !row.subjectName ? 'var(--error)' : undefined,
                                  }}
                                />
                              </td>
                              <td style={{ padding: '4px 6px' }}>
                                <select
                                  value={row.session || 'Morning'}
                                  onChange={(e) => handleTimetableRowChange(originalIdx, 'session', e.target.value)}
                                  className="form-select"
                                  style={{ padding: '4px 6px', fontSize: '0.75rem' }}
                                >
                                  <option value="Morning">Morning</option>
                                  <option value="Afternoon">Afternoon</option>
                                </select>
                              </td>
                              <td style={{ padding: '4px 6px' }}>
                                <input
                                  type="text"
                                  value={row.startTime || ''}
                                  onChange={(e) => handleTimetableRowChange(originalIdx, 'startTime', e.target.value)}
                                  className="form-input"
                                  placeholder="09:30"
                                  style={{ padding: '4px 6px', fontSize: '0.75rem', fontFamily: 'var(--font-data)' }}
                                />
                              </td>
                              <td style={{ padding: '4px 6px' }}>
                                <input
                                  type="text"
                                  value={row.endTime || ''}
                                  onChange={(e) => handleTimetableRowChange(originalIdx, 'endTime', e.target.value)}
                                  className="form-input"
                                  placeholder="12:30"
                                  style={{ padding: '4px 6px', fontSize: '0.75rem', fontFamily: 'var(--font-data)' }}
                                />
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }} className="mono-metric">
                                {row.durationMinutes ? `${row.durationMinutes}m` : '-'}
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <Badge
                                  variant={
                                    row.status === 'VALID'
                                      ? 'success'
                                      : row.status === 'CONFLICT' || row.status === 'INCOMPLETE'
                                      ? 'error'
                                      : 'warning'
                                  }
                                >
                                  {row.status}
                                </Badge>
                              </td>
                              <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTimetableRow(originalIdx)}
                                  className="btn btn-danger btn-sm"
                                  style={{ padding: '2px 6px' }}
                                  title="Remove this timetable row"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                            {row.issues && row.issues.length > 0 && (
                              <tr style={{ backgroundColor: 'var(--warning-bg)' }}>
                                <td colSpan={10} style={{ padding: '3px 12px 6px', fontSize: '0.75rem', color: 'var(--error)' }}>
                                  <span style={{ fontWeight: 600 }}>Diagnostics: </span>
                                  {row.issues.join('; ')}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                    </tbody>
                  </table>
                </div>

                {/* Actions (Feature C & D) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                  <button onClick={handleResetTimetableImport} className="btn btn-secondary btn-sm" disabled={timetableModalLoading}>
                    Select Another File
                  </button>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => {
                        setIsTimetableModalOpen(false);
                        handleResetTimetableImport();
                      }}
                      className="btn btn-secondary btn-sm"
                      disabled={timetableModalLoading}
                    >
                      Cancel (Zero Changes)
                    </button>
                    <button
                      onClick={handleConfirmTimetableImport}
                      className="btn btn-primary btn-sm"
                      disabled={timetableModalLoading || timetableRows.length === 0}
                    >
                      {timetableModalLoading ? 'Committing...' : `Confirm & Import (${timetableRows.length} Records)`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
