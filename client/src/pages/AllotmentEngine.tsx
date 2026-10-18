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
  UserCheck,
  ShieldAlert,
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
  const [requireDualRole, setRequireDualRole] = useState<boolean>(true);

  // Filters for Matrix
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSession, setSelectedSession] = useState<string>('Morning');
  const [searchFilter, setSearchFilter] = useState('');

  // Reassignment Modal
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [targetAssignment, setTargetAssignment] = useState<any>(null);
  const [reassignRoleTarget, setReassignRoleTarget] = useState<'INVIGILATOR' | 'FRISKING'>('INVIGILATOR');
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
        await inspectExam(firstExamId, undefined, requireDualRole);
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

  async function inspectExam(examId: string, targetScheduleId?: string, dualRole = requireDualRole) {
    setSelectedExamId(examId);
    setFailureDiagnostics(null);
    try {
      const pf = await api.getPreflight(examId, dualRole);
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

  async function handleToggleDualRole(checked: boolean) {
    setRequireDualRole(checked);
    if (selectedExamId) {
      await inspectExam(selectedExamId, schedule?.id, checked);
    }
  }

  async function handleGenerate() {
    if (!selectedExamId) return;
    setGenerationLoading(true);
    setFailureDiagnostics(null);
    try {
      const parsedSeed = seedInput.trim() !== '' ? parseInt(seedInput.trim(), 10) : undefined;
      const res = await api.generateAllotment(selectedExamId, parsedSeed, requireDualRole);
      setSchedule(res.data);
      if (res.data.assignments.length > 0) {
        setSelectedDate(res.data.assignments[0].date);
      }
      alert(
        `Allotment generated and validated successfully in DRAFT state! (Dual-Role: ${requireDualRole ? 'Enforced (2 Staff/Room)' : 'Standard'}, Seed: ${res.data.seed ?? 'N/A'})`
      );
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

  function openReassignModal(asgn: any, role: 'INVIGILATOR' | 'FRISKING' = 'INVIGILATOR') {
    setTargetAssignment(asgn);
    setReassignRoleTarget(role);
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

    // Client-side distinctness check: Invigilator and Frisking teacher cannot be the same person
    const otherFacultyId = reassignRoleTarget === 'INVIGILATOR' ? targetAssignment.frisking_faculty_id : targetAssignment.faculty_id;
    if (otherFacultyId && candidateFacultyId === otherFacultyId) {
      setReassignError(
        `Dual-Role Distinctness Violation: The same faculty member cannot serve as both Invigilator and Frisking Teacher for the same room and session.`
      );
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
        roleTarget: reassignRoleTarget,
      });

      setIsReassignModalOpen(false);
      const targetId = res.isRevision && res.revisionScheduleId ? res.revisionScheduleId : schedule.id;
      await inspectExam(selectedExamId, targetId);

      if (res.isRevision) {
        alert(
          `Revision created successfully as ${res.revisionScheduleId} with authoritative domain revalidation! Base approved version remains immutable.`
        );
      } else {
        alert(`${reassignRoleTarget === 'INVIGILATOR' ? 'Invigilator' : 'Frisking Teacher'} reassigned successfully with full domain revalidation.`);
      }
    } catch (err: any) {
      if (err.conflict) {
        setIsConflictError(true);
        setReassignError(
          `Concurrency Conflict: Schedule counter #${schedule.counter} is stale. Another transaction has modified the schedule. Please refresh.`
        );
      } else {
        setReassignError(err.message || 'Reassignment rejected by domain validator.');
      }
      if (err.violations) {
        setReassignViolations(err.violations);
      }
    }
  }

  // Filter assignments for current view
  const currentAssignments =
    schedule?.assignments?.filter((a: any) => {
      if (selectedDate && a.date !== selectedDate) return false;
      if (selectedSession && a.session !== selectedSession) return false;
      if (searchFilter) {
        const s = searchFilter.toLowerCase();
        const matchRoom = a.room_id.toLowerCase().includes(s) || a.room_name?.toLowerCase().includes(s);
        const matchInvigilator =
          a.faculty_id?.toLowerCase().includes(s) ||
          a.faculty_name?.toLowerCase().includes(s) ||
          a.department?.toLowerCase().includes(s);
        const matchFrisking =
          a.frisking_faculty_id?.toLowerCase().includes(s) ||
          a.frisking_faculty_name?.toLowerCase().includes(s) ||
          a.frisking_department?.toLowerCase().includes(s);
        return matchRoom || matchInvigilator || matchFrisking;
      }
      return true;
    }) || [];

  // Extract unique dates from assignments
  const availableDates: string[] = Array.from(new Set((schedule?.assignments || []).map((a: any) => a.date)));

  // Find session accounting for current date & session
  const currentAccounting = schedule?.validationResult?.sessionAccountings?.find(
    (sa: any) => sa.date === selectedDate && sa.session === selectedSession
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Sparkles size={28} color="var(--primary-forest)" />
            Automatic Allotment Engine
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Mathematical optimization solver, dual-role staffing (Invigilator + Frisking), constraint verification & duty matrix
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedExamId}
            onChange={(e) => inspectExam(e.target.value)}
            className="form-select"
            style={{ width: '280px' }}
          >
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.academicYear})
              </option>
            ))}
          </select>

          <input
            type="number"
            placeholder="Seed (e.g. 42)"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            className="form-input"
            style={{ width: '120px', padding: '6px 10px', fontSize: '0.85rem' }}
            title="Random seed for deterministic tie-breaking"
          />

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              backgroundColor: 'var(--surface-card)',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
            }}
            title="Enforce 2 distinct teachers per active room (Invigilator + Frisking Teacher)"
          >
            <input
              type="checkbox"
              checked={requireDualRole}
              onChange={(e) => handleToggleDualRole(e.target.checked)}
            />
            <span style={{ fontWeight: 600, color: 'var(--primary-forest)' }}>Dual-Role (2 Teachers/Room)</span>
          </label>

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
        <div
          className={failureDiagnostics.isInconclusive ? 'alert alert-warning' : 'alert alert-error'}
          style={{ marginBottom: '24px' }}
        >
          <AlertTriangle
            size={28}
            color={failureDiagnostics.isInconclusive ? 'var(--warning)' : 'var(--error)'}
            style={{ flexShrink: 0, marginTop: '2px' }}
          />
          <div>
            <div className="alert-title">
              Allocation Engine Shortfall / Failure:{' '}
              {failureDiagnostics.provenInfeasible
                ? 'Proven Mathematical Infeasibility'
                : failureDiagnostics.isInconclusive
                ? 'Inconclusive Result (Constraint Exhaustion / Search Budget)'
                : 'Schedule Rule Violation'}
            </div>
            <p style={{ marginTop: '4px', fontSize: '0.875rem' }}>{failureDiagnostics.reason}</p>

            <div style={{ marginTop: '8px', fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
              {failureDiagnostics.provenInfeasible ? (
                <span>
                  <strong>Mathematical Proof:</strong> Staffing demand ({requireDualRole ? 'Rooms × Sessions × 2 roles' : 'Rooms × Sessions × 1 role'}) strictly exceeds available faculty capacity under active sequence rules. A valid schedule cannot exist without an administrative remedy.
                </span>
              ) : failureDiagnostics.isInconclusive ? (
                <span>
                  <strong>Constraint Exhaustion:</strong> Total teacher capacity is theoretically sufficient, but fine-grained constraints (such as Rule H4 room rotation, Rule H3 rest-day rules, or leave exclusions) created a dead-end preventing complete room coverage.
                </span>
              ) : null}
            </div>

            {failureDiagnostics.details && (
              <ul style={{ marginTop: '10px', paddingLeft: '20px', fontSize: '0.85rem' }}>
                {failureDiagnostics.details.map((d: string, idx: number) => (
                  <li key={idx} style={{ marginBottom: '4px' }}>
                    {d}
                  </li>
                ))}
              </ul>
            )}
            {failureDiagnostics.remedies && failureDiagnostics.remedies.length > 0 && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)', marginBottom: '4px' }}>
                  Documented Infeasibility Remedies:
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {failureDiagnostics.remedies.map((rem: string, idx: number) => (
                    <li key={idx} style={{ marginBottom: '2px' }}>
                      {rem}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Capacity & Schedule State Card */}
      <div className="card" style={{ marginBottom: '20px' }}>
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

        {/* Expected vs Registered Capacity Comparison Bar */}
        <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: 'var(--canvas-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong>Timetable Source:</strong>
              {preflight?.diagnosticDetails?.timetableConfirmed ? (
                <Badge variant="success">
                  Confirmed ({preflight.diagnosticDetails.timetableRecordsCount} exams, {preflight.diagnosticDetails.timetableSessionsCount} shifts)
                </Badge>
              ) : (
                <Badge variant="sage">Default Cartesian Mode</Badge>
              )}
              {requireDualRole && (
                <Badge variant="forest">Dual-Role Invigilation (2 Staff/Room)</Badge>
              )}
              {preflight?.isFeasible ? (
                <Badge variant="success">Preflight: Feasible</Badge>
              ) : (
                <Badge variant="error">Preflight: Infeasible (Deficit: {preflight?.deficit})</Badge>
              )}
            </div>

            <div>
              <strong>Active Rooms:</strong>{' '}
              <span className="mono-metric">{preflight?.diagnosticDetails?.registeredRoomsActive ?? preflight?.diagnosticDetails?.roomCount ?? 0}</span>
            </div>

            <div>
              <strong>Eligible Teachers:</strong>{' '}
              <span className="mono-metric" style={{ color: 'var(--primary-forest)' }}>
                <strong>{preflight?.diagnosticDetails?.eligibleFacultyCount ?? preflight?.diagnosticDetails?.facultyCount ?? 0}</strong>
              </span>{' '}
              ({preflight?.diagnosticDetails?.registeredFacultyUnavailable ?? 0} exempt/unavailable)
            </div>

            <div>
              <strong>Staffing Demand:</strong>{' '}
              <span className="mono-metric">
                {preflight?.totalRequiredSlots || 0} duties ({requireDualRole ? '2 per active room' : '1 per active room'})
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
            <div className="metric-label">Staffing Demand (Duties)</div>
            <div className="metric-value" style={{ fontSize: '1.6rem' }}>
              {preflight?.totalRequiredSlots || 0}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {requireDualRole ? 'Rooms × Shifts × 2 Roles' : 'Rooms × Shifts × 1 Role'}
            </div>
          </div>

          <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
            <div className="metric-label">Theoretical Faculty Capacity</div>
            <div className="metric-value" style={{ fontSize: '1.6rem', color: preflight?.isFeasible ? 'var(--success)' : 'var(--error)' }}>
              {preflight?.totalPossibleCapacity || 0}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Eligible Teachers × {preflight?.diagnosticDetails?.defaultMaxDuties ?? 6} max duties
            </div>
          </div>

          <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)' }}>
            <div className="metric-label">Staffing Coverage</div>
            <div className="metric-value" style={{ fontSize: '1.6rem' }}>
              {schedule ? `${schedule.validationResult?.validation?.coveragePercentage || 100}%` : '0%'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {schedule ? `${schedule.assignments?.length} rooms staffed` : 'Awaiting generation'}
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
      </div>

      {/* Roster & Assignment Matrix Section */}
      {schedule && (
        <div>
          {/* Controls Bar */}
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              {/* Date Selector */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
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
                  placeholder="Filter room, invigilator, frisking..."
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
                On Leave: <strong className="mono-metric" style={{ color: 'var(--warning)' }}>{currentAccounting.breakdown.UNAVAILABLE_LEAVE}</strong>
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                At Duty Limit: <strong className="mono-metric">{currentAccounting.breakdown.MAX_CAPACITY_REACHED}</strong>
              </div>
            </div>
          )}

          {/* Room Allocation Matrix Grid - DUAL-ROLE DISPLAY */}
          <div className="matrix-grid">
            {currentAssignments.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                No rooms match the current date, shift, or filter criteria.
              </div>
            ) : (
              currentAssignments.map((a: any) => {
                const hasBothRoles = a.faculty_id && a.frisking_faculty_id;
                const isDistinct = a.faculty_id !== a.frisking_faculty_id;
                return (
                  <div key={a.id} className="matrix-room-card" style={{ border: !isDistinct ? '1px solid var(--error-border)' : undefined }}>
                    <div className="matrix-room-header">
                      <div>
                        <span className="room-id" style={{ fontSize: '1rem', fontWeight: 700 }}>{a.room_id}</span>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {a.building} (Fl. {a.floor}) {a.room_name && a.room_name !== a.room_id ? `• ${a.room_name}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {hasBothRoles && isDistinct ? (
                          <Badge variant="success">Dual-Staffed</Badge>
                        ) : !isDistinct ? (
                          <Badge variant="error">Clash: Same Teacher</Badge>
                        ) : (
                          <Badge variant="forest">{a.status}</Badge>
                        )}
                      </div>
                    </div>

                    {/* Invigilator Slot */}
                    <div
                      className="matrix-assignment"
                      style={{
                        marginBottom: '8px',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--surface-card)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                            <UserCheck size={14} color="var(--primary-forest)" />
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary-forest)', textTransform: 'uppercase' }}>
                              Invigilator
                            </span>
                          </div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                            {a.faculty_name || 'Unassigned'}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            <span className="faculty-id">{a.faculty_id}</span> {a.department ? `• ${a.department}` : ''}
                          </div>
                        </div>

                        {schedule.state !== 'PUBLISHED' && (
                          <button
                            onClick={() => openReassignModal(a, 'INVIGILATOR')}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '4px 6px', fontSize: '0.75rem' }}
                            title="Reassign Invigilator"
                          >
                            <Edit3 size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Frisking Teacher Slot */}
                    <div
                      className="matrix-assignment"
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: a.frisking_faculty_id ? 'var(--canvas-bg)' : 'var(--warning-bg)',
                        border: `1px solid ${a.frisking_faculty_id ? 'var(--border-subtle)' : 'var(--warning-border)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                            <ShieldAlert size={14} color="var(--sage-muted)" />
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--sage-muted)', textTransform: 'uppercase' }}>
                              Frisking Teacher
                            </span>
                          </div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                            {a.frisking_faculty_name || (a.frisking_faculty_id ? a.frisking_faculty_id : 'Pending Assignment')}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {a.frisking_faculty_id ? (
                              <span>
                                <span className="faculty-id">{a.frisking_faculty_id}</span>
                                {a.frisking_department ? ` • ${a.frisking_department}` : ''}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--warning)', fontStyle: 'italic' }}>Required second teacher</span>
                            )}
                          </div>
                        </div>

                        {schedule.state !== 'PUBLISHED' && (
                          <button
                            onClick={() => openReassignModal(a, 'FRISKING')}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '4px 6px', fontSize: '0.75rem' }}
                            title="Reassign Frisking Teacher"
                          >
                            <Edit3 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Manual Reassignment Modal with Dual-Role Selection & Distinctness Enforcement */}
      <Modal
        isOpen={isReassignModalOpen}
        onClose={() => setIsReassignModalOpen(false)}
        title={
          schedule?.state === 'APPROVED' || schedule?.state === 'PUBLISHED' || schedule?.state === 'REVISED'
            ? `Create Immutable Revision / Reassign ${reassignRoleTarget === 'INVIGILATOR' ? 'Invigilator' : 'Frisking Teacher'}`
            : `Manual Reassignment: Room ${targetAssignment?.room_id} (${targetAssignment?.date} - ${targetAssignment?.session})`
        }
      >
        {targetAssignment && (
          <form onSubmit={handleConfirmReassign}>
            {(schedule?.state === 'APPROVED' || schedule?.state === 'PUBLISHED' || schedule?.state === 'REVISED') && (
              <div className="alert alert-warning" style={{ marginBottom: '14px', fontSize: '0.85rem' }}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Immutable Approved Schedule:</strong> Modifying this duty creates a distinct revision linked to base{' '}
                  {schedule.base_schedule_id || schedule.id}. Original assignments remain permanently preserved. A mandatory reason is required.
                </div>
              </div>
            )}

            {/* Target Role Selector Tabs inside Modal */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <button
                type="button"
                onClick={() => setReassignRoleTarget('INVIGILATOR')}
                className={`btn btn-sm ${reassignRoleTarget === 'INVIGILATOR' ? 'btn-primary' : 'btn-secondary'}`}
              >
                Reassign Invigilator
              </button>
              <button
                type="button"
                onClick={() => setReassignRoleTarget('FRISKING')}
                className={`btn btn-sm ${reassignRoleTarget === 'FRISKING' ? 'btn-primary' : 'btn-secondary'}`}
              >
                Reassign Frisking Teacher
              </button>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'var(--surface-muted)', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '0.85rem' }}>
              <div>Room: <strong>{targetAssignment.room_id}</strong> ({targetAssignment.room_name})</div>
              <div>Date & Shift: <strong>{targetAssignment.date}</strong> — <strong>{targetAssignment.session}</strong></div>
              <div style={{ marginTop: '6px', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
                <div>
                  Current Invigilator:{' '}
                  <strong>{targetAssignment.faculty_name}</strong> (<span className="faculty-id">{targetAssignment.faculty_id}</span>)
                </div>
                <div>
                  Current Frisking Teacher:{' '}
                  <strong>{targetAssignment.frisking_faculty_name || targetAssignment.frisking_faculty_id || 'None'}</strong>{' '}
                  {targetAssignment.frisking_faculty_id && <span className="faculty-id">({targetAssignment.frisking_faculty_id})</span>}
                </div>
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
                        <li key={idx}>
                          [{v.rule}] {v.message}
                        </li>
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
              <label className="form-label">
                Select Replacement {reassignRoleTarget === 'INVIGILATOR' ? 'Invigilator' : 'Frisking Teacher'}
              </label>
              <select
                required
                value={candidateFacultyId}
                onChange={(e) => setCandidateFacultyId(e.target.value)}
                className="form-select"
              >
                <option value="">-- Choose Candidate Faculty --</option>
                {allFaculty.map((f) => {
                  const isAlreadyAssignedInRoom =
                    (reassignRoleTarget === 'INVIGILATOR' && f.id === targetAssignment.frisking_faculty_id) ||
                    (reassignRoleTarget === 'FRISKING' && f.id === targetAssignment.faculty_id);

                  return (
                    <option key={f.id} value={f.id} disabled={isAlreadyAssignedInRoom}>
                      {f.id} — {f.name} ({f.department}) {isAlreadyAssignedInRoom ? '⚠️ [Already paired in this room]' : ''}
                    </option>
                  );
                })}
              </select>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Note: The teacher currently serving in the other role for this room cannot be chosen.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Reason for {reassignRoleTarget === 'INVIGILATOR' ? 'Invigilator' : 'Frisking'} Revision (Mandatory) <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Departmental duty clash resolution / Medical substitution"
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
                      <td>
                        <span className="faculty-id">{fd.facultyId}</span>
                      </td>
                      <td>
                        <strong>{fd.facultyName}</strong>
                      </td>
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
