import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Users,
  Search,
  Edit3,
  Calendar,
  Check,
  Globe,
  Clock,
} from 'lucide-react';

export const AllotmentEngine: React.FC = () => {
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [schedule, setSchedule] = useState<any>(null);
  const [allSchedules, setAllSchedules] = useState<any[]>([]);
  const [preflight, setPreflight] = useState<any>(null);
  const [generationLoading, setGenerationLoading] = useState(false);
  const [failureDiagnostics, setFailureDiagnostics] = useState<any>(null);
  const [seedInput, setSeedInput] = useState<string>('');

  // Filters for Matrix
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSession, setSelectedSession] = useState<string>('Morning');
  const [searchFilter, setSearchFilter] = useState('');

  // Reassignment Modal
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [targetAssignment, setTargetAssignment] = useState<any>(null);
  const [candidateFacultyId, setCandidateFacultyId] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignViolations, setReassignViolations] = useState<any[]>([]);
  const [isConflictError, setIsConflictError] = useState(false);
  const [allFaculty, setAllFaculty] = useState<any[]>([]);

  // Rule H Accounting Modal
  const [isAccountingModalOpen, setIsAccountingModalOpen] = useState(false);

  async function loadData() {
    try {
      const examRes = await api.getExaminations();
      setExams(examRes.data);
      if (examRes.data.length > 0) {
        const firstExamId = examRes.data[0].id;
        setSelectedExamId(firstExamId);
        await inspectExam(firstExamId);
      }
      const facRes = await api.getFaculty({ limit: 500 });
      setAllFaculty(facRes.data);
    } catch (err) {
      console.error('Failed to load exams:', err);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function inspectExam(examId: string, targetScheduleId?: string) {
    setSelectedExamId(examId);
    setFailureDiagnostics(null);
    try {
      const pf = await api.getPreflight(examId);
      setPreflight(pf.data);

      try {
        const schedListRes = await api.listSchedules(examId);
        const list = schedListRes.data || [];
        setAllSchedules(list);

        let schedData = null;
        if (targetScheduleId) {
          const sRes = await api.getScheduleById(targetScheduleId);
          schedData = sRes.data;
        } else {
          const sched = await api.getLatestSchedule(examId);
          schedData = sched.data;
        }
        setSchedule(schedData);
        if (schedData?.assignments?.length > 0) {
          const firstDate = schedData.assignments[0].date;
          setSelectedDate(firstDate);
        }
      } catch (e) {
        setSchedule(null);
        setAllSchedules([]);
      }
    } catch (err) {
      console.error('Preflight error:', err);
    }
  }

  async function handleGenerate() {
    if (!selectedExamId) return;
    setGenerationLoading(true);
    setFailureDiagnostics(null);
    try {
      const parsedSeed = seedInput.trim() !== '' ? parseInt(seedInput.trim(), 10) : undefined;
      const res = await api.generateAllotment(selectedExamId, parsedSeed);
      setSchedule(res.data);
      if (res.data.assignments.length > 0) {
        setSelectedDate(res.data.assignments[0].date);
      }
      alert(`Allotment generated and validated successfully in DRAFT state! (Seed: ${res.data.seed ?? 'N/A'})`);
      const listRes = await api.listSchedules(selectedExamId);
      setAllSchedules(listRes.data || []);
    } catch (err: any) {
      console.error('Generation failed:', err);
      setFailureDiagnostics(err.diagnostics || {
        provenInfeasible: true,
        reason: err.message,
        details: err.validation?.violations?.map((v: any) => v.message) || [],
        remedies: err.diagnostics?.remedies || preflight?.remedies,
      });
    } finally {
      setGenerationLoading(false);
      inspectExam(selectedExamId);
    }
  }

  async function handleValidateDraft() {
    if (!schedule) return;
    try {
      const res = await api.validateDraftSchedule(schedule.id);
      setSchedule(res.data);
      if (res.validation?.isValid) {
        alert('Draft schedule authoritatively validated with 0 hard-rule violations!');
      } else {
        alert(`Draft schedule has ${res.validation?.violations?.length || 0} violation(s).`);
      }
      const listRes = await api.listSchedules(selectedExamId);
      setAllSchedules(listRes.data || []);
    } catch (err) {
      alert('Draft validation failed: ' + (err as Error).message);
    }
  }

  async function handleApprove() {
    if (!schedule) return;
    try {
      const res = await api.approveSchedule(schedule.id, schedule.counter);
      setSchedule(res.data);
      alert('Schedule successfully APPROVED by Examination Officer.');
      const listRes = await api.listSchedules(selectedExamId);
      setAllSchedules(listRes.data || []);
    } catch (err) {
      alert('Approval failed: ' + (err as Error).message);
    }
  }

  async function handlePublish() {
    if (!schedule) return;
    try {
      const res = await api.publishSchedule(schedule.id, schedule.counter);
      setSchedule(res.data);
      alert('Schedule PUBLISHED and locked for daily examination operations.');
      const listRes = await api.listSchedules(selectedExamId);
      setAllSchedules(listRes.data || []);
    } catch (err) {
      alert('Publication failed: ' + (err as Error).message);
    }
  }

  function openReassignModal(asgn: any) {
    setTargetAssignment(asgn);
    setCandidateFacultyId('');
    setReassignReason('');
    setReassignError(null);
    setReassignViolations([]);
    setIsConflictError(false);
    setIsReassignModalOpen(true);
  }

  async function handleConfirmReassign(e: React.FormEvent) {
    e.preventDefault();
    if (!schedule || !targetAssignment || !candidateFacultyId) return;

    if (!reassignReason || reassignReason.trim() === '') {
      setReassignError('A non-empty revision reason is required.');
      return;
    }

    setReassignError(null);
    setReassignViolations([]);
    setIsConflictError(false);

    try {
      const res = await api.manualReassign(schedule.id, {
        assignmentId: targetAssignment.id,
        newFacultyId: candidateFacultyId,
        reason: reassignReason.trim(),
        expectedCounter: schedule.counter,
      });

      setIsReassignModalOpen(false);
      const targetId = res.isRevision && res.revisionScheduleId ? res.revisionScheduleId : schedule.id;
      await inspectExam(selectedExamId, targetId);

      if (res.isRevision) {
        alert(`Revision created successfully as ${res.revisionScheduleId} with full domain revalidation! Base approved version remains immutable.`);
      } else {
        alert('Teacher reassigned successfully with full domain revalidation.');
      }
    } catch (err: any) {
      if (err.conflict) {
        setIsConflictError(true);
        setReassignError(`Concurrency Conflict: Schedule counter #${schedule.counter} is stale. Another transaction has modified the schedule. Please refresh.`);
      } else {
        setReassignError(err.message || 'Reassignment rejected by domain validator.');
      }
      if (err.violations) {
        setReassignViolations(err.violations);
      }
    }
  }

  // Filter assignments for current view
  const currentAssignments = schedule?.assignments?.filter((a: any) => {
    if (selectedDate && a.date !== selectedDate) return false;
    if (selectedSession && a.session !== selectedSession) return false;
    if (searchFilter) {
      const s = searchFilter.toLowerCase();
      const matchRoom = a.room_id.toLowerCase().includes(s) || a.room_name?.toLowerCase().includes(s);
      const matchFaculty =
        a.faculty_id.toLowerCase().includes(s) ||
        a.faculty_name?.toLowerCase().includes(s) ||
        a.department?.toLowerCase().includes(s);
      return matchRoom || matchFaculty;
    }
    return true;
  }) || [];

  // Extract unique dates from assignments or preflight
  const availableDates: string[] = Array.from(
    new Set((schedule?.assignments || []).map((a: any) => a.date))
  );

  // Find session accounting for current date & session
  const currentAccounting = schedule?.validationResult?.sessionAccountings?.find(
    (sa: any) => sa.date === selectedDate && sa.session === selectedSession
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1>Automatic Allotment Engine</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Mathematical optimization solver, constraint verification & room-wise duty matrix
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <select
            value={selectedExamId}
            onChange={(e) => inspectExam(e.target.value)}
            className="form-select"
            style={{ width: '280px' }}
          >
            {exams.map((e) => (
              <option key={e.id} value={e.id}>{e.name} ({e.academicYear})</option>
            ))}
          </select>

          <input
            type="number"
            placeholder="Seed (e.g. 42)"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            className="form-input"
            style={{ width: '130px', padding: '6px 10px', fontSize: '0.85rem' }}
            title="Random seed for deterministic tie-breaking (Rule 5)"
          />

          <button
            onClick={handleGenerate}
            disabled={generationLoading}
            className="btn btn-primary btn-lg"
          >
            <Sparkles size={18} />
            {generationLoading ? 'Solving Allocations...' : 'Generate Allotment'}
          </button>
        </div>
      </div>

      {/* Pre-flight Capacity & Infeasibility Diagnostics */}
      {failureDiagnostics && (
        <div className="alert alert-error" style={{ marginBottom: '24px' }}>
          <AlertTriangle size={28} color="var(--error)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div className="alert-title">
              Allocation Engine Failed: {failureDiagnostics.provenInfeasible ? 'Proven Mathematical Infeasibility' : 'Constraint Exhaustion'}
            </div>
            <p style={{ marginTop: '4px', fontSize: '0.875rem' }}>{failureDiagnostics.reason}</p>
            {failureDiagnostics.details && (
              <ul style={{ marginTop: '10px', paddingLeft: '20px', fontSize: '0.85rem' }}>
                {failureDiagnostics.details.map((d: string, idx: number) => (
                  <li key={idx} style={{ marginBottom: '4px' }}>{d}</li>
                ))}
              </ul>
            )}
            {failureDiagnostics.remedies && failureDiagnostics.remedies.length > 0 && (
              <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)', marginBottom: '4px' }}>
                  Documented Infeasibility Remedies:
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {failureDiagnostics.remedies.map((rem: string, idx: number) => (
                    <li key={idx} style={{ marginBottom: '2px' }}>{rem}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <em>Notice: The engine never drops hard constraints (Rules A, B, C, D, F) to force an invalid schedule. Existing approved schedules remain safely preserved.</em>
            </div>
          </div>
        </div>
      )}

      {/* Capacity & Schedule State Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Schedule Status & Pre-Flight Capacity Analysis</div>
          {schedule && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {allSchedules.length > 1 && (
                <select
                  value={schedule.id}
                  onChange={async (e) => {
                    const schedId = e.target.value;
                    const res = await api.getScheduleById(schedId);
                    setSchedule(res.data);
                    if (res.data?.assignments?.length > 0) {
                      setSelectedDate(res.data.assignments[0].date);
                    }
                  }}
                  className="form-select"
                  style={{ width: 'auto', minWidth: '190px', padding: '3px 8px', fontSize: '0.8rem' }}
                  title="Switch between Schedule Versions & Revisions"
                >
                  {allSchedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.revision_number > 0 ? `V${s.version}.${s.revision_number} (Rev)` : `V${s.version}`} [{s.state}] • #{s.counter}
                    </option>
                  ))}
                </select>
              )}

              <Badge
                variant={
                  schedule.state === 'PUBLISHED'
                    ? 'success'
                    : schedule.state === 'APPROVED'
                    ? 'forest'
                    : schedule.state === 'VALIDATED'
                    ? 'sage'
                    : schedule.state === 'REVISED'
                    ? 'sage'
                    : 'warning'
                }
              >
                {schedule.revision_number > 0
                  ? `REV V${schedule.version}.${schedule.revision_number} (${schedule.state})`
                  : schedule.state}
              </Badge>
              <span className="mono-metric" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {schedule.id}
                {schedule.base_schedule_id ? ` (Base: ${schedule.base_schedule_id})` : ''}
                {` • Counter: #${schedule.counter}`}
                {schedule.seed !== null && schedule.seed !== undefined ? ` • Seed: ${schedule.seed}` : ''}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
            <div className="metric-label">Required Room Slots</div>
            <div className="metric-value" style={{ fontSize: '1.6rem' }}>
              {preflight?.totalRequiredSlots || 0}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Rooms × Sessions × Dates</div>
          </div>

          <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
            <div className="metric-label">Max Theoretical Capacity</div>
            <div className="metric-value" style={{ fontSize: '1.6rem', color: preflight?.isFeasible ? 'var(--success)' : 'var(--error)' }}>
              {preflight?.totalPossibleCapacity || 0}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Under Rule C ({preflight?.maxWorkingDaysPerTeacher || 0} max days/teacher)
            </div>
          </div>

          <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
            <div className="metric-label">Coverage Status</div>
            <div className="metric-value" style={{ fontSize: '1.6rem' }}>
              {schedule ? `${schedule.validationResult?.validation?.coveragePercentage || 100}%` : '0%'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {schedule ? `${schedule.assignments?.length} slots filled` : 'Awaiting generation'}
            </div>
          </div>

          <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
            <div className="metric-label">Approval Lifecycle</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
              {schedule?.state === 'DRAFT' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button onClick={handleValidateDraft} className="btn btn-sage btn-sm" title="Run Authoritative Validation">
                    <Check size={14} /> Validate Draft
                  </button>
                  <button onClick={handleApprove} className="btn btn-primary btn-sm" title="Authoritatively Validate & Approve">
                    <CheckCircle2 size={14} /> Approve Draft
                  </button>
                </div>
              )}
              {schedule?.state === 'VALIDATED' && (
                <button onClick={handleApprove} className="btn btn-primary btn-sm">
                  <Check size={14} /> Approve Schedule
                </button>
              )}
              {schedule?.state === 'APPROVED' && (
                <button onClick={handlePublish} className="btn btn-sage btn-sm">
                  <Globe size={14} /> Publish Schedule
                </button>
              )}
              {schedule?.state === 'REVISED' && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Superceded by newer revision
                </div>
              )}
              {schedule?.state === 'PUBLISHED' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--success)', fontWeight: 600 }}>
                  <CheckCircle2 size={16} /> Published & Active
                </div>
              )}
              {!schedule && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No active schedule</span>}
            </div>
          </div>
        </div>

        {!preflight?.isFeasible && preflight?.remedies && preflight.remedies.length > 0 && (
          <div style={{ marginTop: '20px', padding: '14px 18px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)', borderLeft: '4px solid var(--warning)' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-main)', marginBottom: '6px' }}>
              Actionable Capacity Remedies (Stage 1 Section 3 Policy):
            </div>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {preflight.remedies.map((rem: string, idx: number) => (
                <li key={idx} style={{ marginBottom: '4px' }}>{rem}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Roster & Assignment Matrix Section */}
      {schedule && (
        <div>
          {/* Controls Bar: Dates, Sessions, Search & Rule H Breakdown */}
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              {/* Date Selector */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Date:</span>
                {availableDates.map((dateStr) => (
                  <button
                    key={dateStr}
                    onClick={() => setSelectedDate(dateStr)}
                    className={`btn btn-sm ${selectedDate === dateStr ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <Calendar size={14} /> {dateStr}
                  </button>
                ))}
              </div>

              {/* Session Selector */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Shift:</span>
                {['Morning', 'Afternoon'].map((sess) => (
                  <button
                    key={sess}
                    onClick={() => setSelectedSession(sess)}
                    className={`btn btn-sm ${selectedSession === sess ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <Clock size={14} /> {sess}
                  </button>
                ))}
              </div>

              {/* Search Box */}
              <div style={{ position: 'relative', width: '260px' }}>
                <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '9px' }} />
                <input
                  type="text"
                  placeholder="Filter room or teacher..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="form-input"
                  style={{ paddingLeft: '34px', padding: '6px 10px 6px 34px', fontSize: '0.85rem' }}
                />
              </div>

              {/* Rule H Accounting Trigger */}
              <button
                onClick={() => setIsAccountingModalOpen(true)}
                className="btn btn-sage btn-sm"
              >
                <Users size={14} /> Faculty Roster Breakdown (Rule H)
              </button>
            </div>
          </div>

          {/* Session Accounting Summary Badge Bar */}
          {currentAccounting && (
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px', fontSize: '0.8rem' }}>
              <div style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                Assigned: <strong className="mono-metric" style={{ color: 'var(--primary-forest)' }}>{currentAccounting.breakdown.ASSIGNED}</strong>
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                Resting / Available: <strong className="mono-metric">{currentAccounting.breakdown.AVAILABLE_UNASSIGNED}</strong>
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                Standby Reserves: <strong className="mono-metric" style={{ color: 'var(--sage-muted)' }}>{currentAccounting.breakdown.RESERVED_SUBSTITUTE}</strong>
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                Excluded (Rule B Shift): <strong className="mono-metric">{currentAccounting.breakdown.EXCLUDED_DAILY_SESSION}</strong>
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                Excluded (Rule C Consec.): <strong className="mono-metric">{currentAccounting.breakdown.EXCLUDED_CONSECUTIVE_DAY}</strong>
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                On Leave: <strong className="mono-metric" style={{ color: 'var(--warning)' }}>{currentAccounting.breakdown.UNAVAILABLE_LEAVE}</strong>
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                At Duty Limit: <strong className="mono-metric">{currentAccounting.breakdown.MAX_CAPACITY_REACHED}</strong>
              </div>
            </div>
          )}

          {/* Room Allocation Matrix Grid */}
          <div className="matrix-grid">
            {currentAssignments.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                No rooms match the current date, shift, or filter criteria.
              </div>
            ) : (
              currentAssignments.map((a: any) => (
                <div key={a.id} className="matrix-room-card">
                  <div className="matrix-room-header">
                    <div>
                      <span className="room-id" style={{ fontSize: '1rem', fontWeight: 700 }}>{a.room_id}</span>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{a.building} (Fl. {a.floor})</div>
                    </div>
                    <Badge variant={a.status === 'COMPLETED' ? 'success' : a.status === 'ABSENT' ? 'error' : 'forest'}>
                      {a.status}
                    </Badge>
                  </div>

                  <div className="matrix-assignment">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--primary-forest)' }}>
                          {a.faculty_name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          <span className="faculty-id">{a.faculty_id}</span> • {a.department}
                        </div>
                      </div>

                      {schedule.state !== 'PUBLISHED' && (
                        <button
                          onClick={() => openReassignModal(a)}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 6px' }}
                          title="Reassign Teacher (Validates Constraints)"
                        >
                          <Edit3 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Manual Reassignment Modal with Domain Validator & Immutability Notice */}
      <Modal
        isOpen={isReassignModalOpen}
        onClose={() => setIsReassignModalOpen(false)}
        title={
          schedule?.state === 'APPROVED' || schedule?.state === 'PUBLISHED' || schedule?.state === 'REVISED'
            ? 'Create Immutable Revision / Reassign Invigilator'
            : `Manual Reassignment: Room ${targetAssignment?.room_id} (${targetAssignment?.date} - ${targetAssignment?.session})`
        }
      >
        {targetAssignment && (
          <form onSubmit={handleConfirmReassign}>
            {(schedule?.state === 'APPROVED' || schedule?.state === 'PUBLISHED' || schedule?.state === 'REVISED') && (
              <div className="alert alert-warning" style={{ marginBottom: '14px', fontSize: '0.85rem' }}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Immutable Approved Schedule:</strong> Modifying this duty creates a distinct 
                  revision (e.g. V{schedule.version}.{(schedule.revision_number || 0) + 1}) linked to base {schedule.base_schedule_id || schedule.id}.
                  Original assignments and snapshots remain permanently preserved. A mandatory non-empty reason is required.
                </div>
              </div>
            )}

            <div style={{ padding: '12px', backgroundColor: 'var(--surface-muted)', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '0.85rem' }}>
              <div>Current Teacher: <strong>{targetAssignment.faculty_name}</strong> (<span className="faculty-id">{targetAssignment.faculty_id}</span>)</div>
              <div>Room: <strong>{targetAssignment.room_id}</strong> ({targetAssignment.room_name})</div>
              <div>Date & Shift: <strong>{targetAssignment.date}</strong> — <strong>{targetAssignment.session}</strong></div>
              <div className="mono-metric" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Current Version Counter: #{schedule?.counter}
              </div>
            </div>

            {reassignError && (
              <div className="alert alert-error" style={{ padding: '10px 14px', marginBottom: '16px' }}>
                <AlertTriangle size={18} color="var(--error)" style={{ flexShrink: 0 }} />
                <div style={{ width: '100%' }}>
                  <div style={{ fontWeight: 600 }}>{reassignError}</div>
                  {reassignViolations.length > 0 && (
                    <ul style={{ marginTop: '6px', paddingLeft: '16px', fontSize: '0.8rem' }}>
                      {reassignViolations.map((v: any, idx: number) => (
                        <li key={idx}>[{v.rule}] {v.message}</li>
                      ))}
                    </ul>
                  )}
                  {isConflictError && (
                    <button
                      type="button"
                      onClick={async () => {
                        await inspectExam(selectedExamId);
                        setIsReassignModalOpen(false);
                      }}
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: '8px' }}
                    >
                      Refresh Schedule Now
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Select Replacement Faculty Member</label>
              <select
                required
                value={candidateFacultyId}
                onChange={(e) => setCandidateFacultyId(e.target.value)}
                className="form-select"
              >
                <option value="">-- Choose Candidate Faculty --</option>
                {allFaculty.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id} — {f.name} ({f.department})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">
                {schedule?.state === 'APPROVED' || schedule?.state === 'PUBLISHED' || schedule?.state === 'REVISED'
                  ? 'Reason for Revision (Mandatory)'
                  : 'Reason for Reassignment (Mandatory)'} <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <input
                type="text"
                required
                placeholder={
                  schedule?.state === 'APPROVED' || schedule?.state === 'PUBLISHED' || schedule?.state === 'REVISED'
                    ? 'e.g. Departmental duty clash resolution / Medical substitute'
                    : 'Administrative adjustment rationale'
                }
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                className="form-input"
              />
            </div>

            <div className="modal-footer">
              <button type="button" onClick={() => setIsReassignModalOpen(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {schedule?.state === 'APPROVED' || schedule?.state === 'PUBLISHED' || schedule?.state === 'REVISED'
                  ? 'Verify & Create Revision'
                  : 'Verify & Reassign'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Rule H Faculty Accounting Breakdown Modal */}
      <Modal
        isOpen={isAccountingModalOpen}
        onClose={() => setIsAccountingModalOpen(false)}
        title={`Faculty Roster Accounting (Rule H): ${selectedDate} — ${selectedSession}`}
      >
        {currentAccounting ? (
          <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '14px', fontSize: '0.85rem' }}>
              Every participating faculty member is accounted for with mutually exclusive classification:
            </p>

            <div className="table-container" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Faculty ID</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Category (Rule H)</th>
                    <th>Detailed Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {currentAccounting.facultyDetails?.map((fd: any) => (
                    <tr key={fd.facultyId}>
                      <td><span className="faculty-id">{fd.facultyId}</span></td>
                      <td><strong>{fd.facultyName}</strong></td>
                      <td>{fd.department}</td>
                      <td>
                        <Badge
                          variant={
                            fd.status === 'ASSIGNED'
                              ? 'success'
                              : fd.status === 'RESERVED_SUBSTITUTE'
                              ? 'sage'
                              : fd.status === 'UNAVAILABLE_LEAVE'
                              ? 'warning'
                              : 'forest'
                          }
                        >
                          {fd.status}
                        </Badge>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{fd.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p>No accounting record available for selected session.</p>
        )}
      </Modal>
    </div>
  );
};
