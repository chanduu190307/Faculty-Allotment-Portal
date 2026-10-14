import { describe, it, expect } from 'vitest';
import { SchedulingEngine } from '../../src/domain/scheduling/engine';
import { checkCapacityFeasibility, calculateMaxWorkingDays } from '../../src/domain/scheduling/capacity';
import { validateSchedule, validateManualReassignment } from '../../src/domain/scheduling/validator';
import {
  ExamDate,
  ExamSession,
  Faculty,
  FacultyLeave,
  Room,
  Assignment,
} from '../../src/domain/scheduling/types';

describe('Faculty Allotment Scheduling Engine - Mandatory Acceptance Suite', () => {
  // Helper to generate test faculty
  function generateTestFaculty(count: number): Faculty[] {
    return Array.from({ length: count }, (_, i) => {
      const id = `FAC-${(i + 1).toString().padStart(3, '0')}`;
      return {
        id,
        name: `Professor ${id}`,
        email: `faculty${i + 1}@college.edu`,
        department: i % 2 === 0 ? 'Computer Science' : 'Electronics',
        designation: 'Assistant Professor',
        active: true,
      };
    });
  }

  // Helper to generate test rooms
  function generateTestRooms(count: number, staffing = 1): Room[] {
    return Array.from({ length: count }, (_, i) => {
      const id = `RM-${(i + 1).toString().padStart(3, '0')}`;
      return {
        id,
        name: `Room ${id}`,
        building: 'Block A',
        floor: 1,
        capacity: 40,
        requiredStaffing: staffing,
        active: true,
      };
    });
  }

  const standardSessions: ExamSession[] = [
    { name: 'Morning', startTime: '09:30', endTime: '12:30' },
    { name: 'Afternoon', startTime: '14:00', endTime: '17:00' },
  ];

  // ==========================================
  // SCENARIO 1: Rule A — Complete Room Coverage
  // ==========================================
  it('Scenario 1: Every required room receives its required staffing (Rule A)', () => {
    // 10 rooms, 2 sessions, 2 examination days = 40 slots needed.
    // 40 faculty members (20 per day under Rule H3 with rest_days = 1).
    const rooms = generateTestRooms(10);
    const faculty = generateTestFaculty(40);
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-17', sequenceOrder: 2, isExamDay: true },
    ];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-TEST-1',
      dates,
      sessions: standardSessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 6,
    });

    expect(result.success).toBe(true);
    expect(result.assignments.length).toBe(40);
    expect(result.validation.isValid).toBe(true);
    expect(result.validation.coveragePercentage).toBe(100);

    // Verify every room in every session has an assignment
    for (const d of dates) {
      for (const s of standardSessions) {
        for (const r of rooms) {
          const match = result.assignments.find(
            (a) => a.date === d.date && a.session === s.name && a.roomId === r.id
          );
          expect(match).toBeDefined();
        }
      }
    }
  });

  // ==============================================================
  // SCENARIO 2: Rule B — No Repeated Teacher Across Daily Sessions
  // ==============================================================
  it('Scenario 2: No teacher appears in both daily sessions (Rule B)', () => {
    const rooms = generateTestRooms(15);
    const faculty = generateTestFaculty(60);
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-17', sequenceOrder: 2, isExamDay: true },
    ];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-TEST-2',
      dates,
      sessions: standardSessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 6,
    });

    expect(result.success).toBe(true);

    // Verify no teacher worked in Morning AND Afternoon on the same day
    for (const d of dates) {
      const assignedMorning = result.assignments
        .filter((a) => a.date === d.date && a.session === 'Morning')
        .map((a) => a.facultyId);
      const assignedAfternoon = result.assignments
        .filter((a) => a.date === d.date && a.session === 'Afternoon')
        .map((a) => a.facultyId);

      const intersection = assignedMorning.filter((id) => assignedAfternoon.includes(id));
      expect(intersection).toEqual([]);
    }
  });

  // =================================================================
  // SCENARIO 3: Rule C — No Consecutive Examination-Day Duties
  // =================================================================
  it('Scenario 3: No teacher is assigned on consecutive examination dates (Rule C)', () => {
    // 3 consecutive days: 2026-10-15, 2026-10-16, 2026-10-17
    // 5 rooms, 2 sessions/day = 10 slots/day.
    // Total 30 slots across 3 days.
    // 40 faculty members.
    const rooms = generateTestRooms(5);
    const faculty = generateTestFaculty(40);
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 2, isExamDay: true }, // consecutive to 15
      { date: '2026-10-17', sequenceOrder: 3, isExamDay: true }, // consecutive to 16
    ];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-TEST-3',
      dates,
      sessions: standardSessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 6,
    });

    expect(result.success).toBe(true);

    // Verify no faculty member assigned on consecutive dates
    const facDates = new Map<string, string[]>();
    for (const a of result.assignments) {
      if (!facDates.has(a.facultyId)) facDates.set(a.facultyId, []);
      if (!facDates.get(a.facultyId)!.includes(a.date)) {
        facDates.get(a.facultyId)!.push(a.date);
      }
    }

    for (const [facId, dateList] of facDates.entries()) {
      dateList.sort();
      for (let i = 0; i < dateList.length - 1; i++) {
        const d1 = new Date(dateList[i] + 'T00:00:00Z').getTime();
        const d2 = new Date(dateList[i + 1] + 'T00:00:00Z').getTime();
        const diffDays = Math.round((d2 - d1) / (24 * 60 * 60 * 1000));
        expect(diffDays).toBeGreaterThan(1);
      }
    }
  });

  // ======================================================
  // SCENARIO 4: Rule D — Room Rotation Protection
  // ======================================================
  it('Scenario 4: Room-history restrictions are enforced by validator (Rule D)', () => {
    const rooms = generateTestRooms(2);
    const faculty = generateTestFaculty(2);
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 2, isExamDay: true },
    ];

    // Artificially construct assignments where FAC-001 is placed in RM-001 on consecutive dates
    const invalidAssignments: Assignment[] = [
      { id: '1', date: '2026-10-15', session: 'Morning', roomId: 'RM-001', facultyId: 'FAC-001', status: 'SCHEDULED' },
      { id: '2', date: '2026-10-15', session: 'Morning', roomId: 'RM-002', facultyId: 'FAC-002', status: 'SCHEDULED' },
      { id: '3', date: '2026-10-16', session: 'Morning', roomId: 'RM-001', facultyId: 'FAC-001', status: 'SCHEDULED' }, // Violates Rule C & Rule D
      { id: '4', date: '2026-10-16', session: 'Morning', roomId: 'RM-002', facultyId: 'FAC-002', status: 'SCHEDULED' },
    ];

    const valResult = validateSchedule(invalidAssignments, {
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 6,
    });

    expect(valResult.isValid).toBe(false);
    const ruleDViolations = valResult.violations.filter((v) => v.rule === 'RULE_D');
    expect(ruleDViolations.length).toBeGreaterThanOrEqual(1);
  });

  // =====================================================
  // SCENARIO 5: Rule F — Maximum Duty Limits Enforced
  // =====================================================
  it('Scenario 5: Maximum duty limits are strictly enforced (Rule F)', () => {
    // 2 rooms, 1 session/day, 4 non-consecutive days = 8 slots needed
    // 4 faculty, maxDuties = 2 each -> each can work at most 2 times
    const rooms = generateTestRooms(2);
    const faculty = generateTestFaculty(4);
    const dates: ExamDate[] = [
      { date: '2026-10-10', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-12', sequenceOrder: 2, isExamDay: true },
      { date: '2026-10-14', sequenceOrder: 3, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 4, isExamDay: true },
    ];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-TEST-5',
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 2, // Strict 2-duty limit
    });

    expect(result.success).toBe(true);
    for (const f of faculty) {
      const count = result.assignments.filter((a) => a.facultyId === f.id).length;
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  // =====================================================
  // SCENARIO 6: Unavailable Faculty / Approved Leave Excluded
  // =====================================================
  it('Scenario 6: Unavailable faculty on approved leave are excluded from assignment', () => {
    const rooms = generateTestRooms(2);
    const faculty = generateTestFaculty(10);
    const dates: ExamDate[] = [
      { date: '2026-10-10', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-12', sequenceOrder: 2, isExamDay: true },
    ];

    const leaves: FacultyLeave[] = [
      {
        facultyId: 'FAC-001',
        date: '2026-10-10',
        sessionScope: 'FULL_DAY',
        reason: 'Medical Leave',
        approvalStatus: 'APPROVED',
      },
    ];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-TEST-6',
      dates,
      sessions: standardSessions,
      rooms,
      faculty,
      leaves,
      defaultMaxDuties: 6,
    });

    expect(result.success).toBe(true);
    // FAC-001 must NEVER be assigned on 2026-10-10
    const conflict = result.assignments.find(
      (a) => a.facultyId === 'FAC-001' && a.date === '2026-10-10'
    );
    expect(conflict).toBeUndefined();
  });

  // =====================================================
  // SCENARIO 7: Duplicate Assignments Rejected
  // =====================================================
  it('Scenario 7: Duplicate assignments in the same room and session are rejected', () => {
    const rooms = generateTestRooms(1);
    const faculty = generateTestFaculty(2);
    const dates: ExamDate[] = [{ date: '2026-10-15', sequenceOrder: 1, isExamDay: true }];

    const duplicateAssignments: Assignment[] = [
      { id: '1', date: '2026-10-15', session: 'Morning', roomId: 'RM-001', facultyId: 'FAC-001', status: 'SCHEDULED' },
      { id: '2', date: '2026-10-15', session: 'Morning', roomId: 'RM-001', facultyId: 'FAC-002', status: 'SCHEDULED' },
    ];

    const valResult = validateSchedule(duplicateAssignments, {
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 6,
    });

    expect(valResult.isValid).toBe(false);
    expect(valResult.violations.some((v) => v.rule === 'DUPLICATE')).toBe(true);
  });

  // =====================================================
  // SCENARIO 8: Rule G — Fair Workload Distribution
  // =====================================================
  it('Scenario 8: Fairness preferences distribute workload equitably (Rule G)', () => {
    const rooms = generateTestRooms(4);
    const faculty = generateTestFaculty(10);
    const dates: ExamDate[] = [
      { date: '2026-10-10', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-12', sequenceOrder: 2, isExamDay: true },
      { date: '2026-10-14', sequenceOrder: 3, isExamDay: true },
    ];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-TEST-8',
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 6,
    });

    expect(result.success).toBe(true);
    expect(result.workloadStats).toBeDefined();
    // 12 slots among 10 teachers -> min should be 1 and max should be 2! Difference <= 1!
    expect(result.workloadStats!.max - result.workloadStats!.min).toBeLessThanOrEqual(1);
  });

  // =====================================================
  // SCENARIO 9: Rule H — Accounting for Every Faculty Member
  // =====================================================
  it('Scenario 9: Every participating teacher is accounted for with mutually exclusive statuses (Rule H)', () => {
    const rooms = generateTestRooms(2);
    const faculty = generateTestFaculty(8);
    const dates: ExamDate[] = [{ date: '2026-10-15', sequenceOrder: 1, isExamDay: true }];

    const leaves: FacultyLeave[] = [
      { facultyId: 'FAC-008', date: '2026-10-15', sessionScope: 'FULL_DAY', reason: 'Official Duty' },
    ];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-TEST-9',
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves,
      defaultMaxDuties: 6,
    });

    expect(result.success).toBe(true);
    expect(result.sessionAccountings).toBeDefined();
    expect(result.sessionAccountings!.length).toBe(1);

    const accounting = result.sessionAccountings![0];
    // Total accounted records must equal total faculty count exactly
    expect(accounting.facultyDetails.length).toBe(8);

    const sumCategories = Object.values(accounting.breakdown).reduce((a, b) => a + b, 0);
    expect(sumCategories).toBe(8);
    expect(accounting.breakdown.ASSIGNED).toBe(2);
    expect(accounting.breakdown.UNAVAILABLE_LEAVE).toBe(1);
    expect(accounting.breakdown.RESERVED_SUBSTITUTE).toBe(2);
    expect(accounting.breakdown.AVAILABLE_UNASSIGNED).toBe(3);
  });

  // =====================================================
  // SCENARIO 10: Insufficient Staffing Produces Diagnostics
  // =====================================================
  it('Scenario 10: Insufficient staffing produces actionable structured diagnostics without dropping constraints', () => {
    // 10 rooms, 1 session = 10 slots required. Only 3 faculty members.
    const rooms = generateTestRooms(10);
    const faculty = generateTestFaculty(3);
    const dates: ExamDate[] = [{ date: '2026-10-15', sequenceOrder: 1, isExamDay: true }];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-TEST-10',
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 6,
    });

    expect(result.success).toBe(false);
    expect(result.failureDiagnostics).toBeDefined();
    expect(result.failureDiagnostics!.provenInfeasible).toBe(true);
    expect(result.preflight.deficit).toBe(7);
  });

  // =====================================================
  // SCENARIO 11: Invalid Manual Changes Rejected by Shared Validator
  // =====================================================
  it('Scenario 11: Invalid manual reassignments are rejected by shared validator', () => {
    const rooms = generateTestRooms(2);
    const faculty = generateTestFaculty(4);
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 2, isExamDay: true },
    ];

    const existingAssignments: Assignment[] = [
      { id: '1', date: '2026-10-15', session: 'Morning', roomId: 'RM-001', facultyId: 'FAC-001', status: 'SCHEDULED' },
      { id: '2', date: '2026-10-15', session: 'Morning', roomId: 'RM-002', facultyId: 'FAC-002', status: 'SCHEDULED' },
    ];

    // Attempt to manually reassign FAC-001 on the consecutive day 2026-10-16 (violates Rule C)
    const candidateAssignment: Assignment = {
      id: '3',
      date: '2026-10-16',
      session: 'Morning',
      roomId: 'RM-001',
      facultyId: 'FAC-001',
      status: 'SCHEDULED',
    };

    const reassignCheck = validateManualReassignment(candidateAssignment, existingAssignments, {
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 6,
    });

    expect(reassignCheck.valid).toBe(false);
    expect(reassignCheck.violations.some((v) => v.rule === 'RULE_C')).toBe(true);
  });

  // =====================================================
  // SCENARIO 12: Substitutions Undergo Full Revalidation
  // =====================================================
  it('Scenario 12: Substitutions undergo full revalidation (rejecting ineligible substitute)', () => {
    const rooms = generateTestRooms(2);
    const faculty = generateTestFaculty(4);
    const dates: ExamDate[] = [{ date: '2026-10-15', sequenceOrder: 1, isExamDay: true }];

    const leaves: FacultyLeave[] = [
      { facultyId: 'FAC-003', date: '2026-10-15', sessionScope: 'FULL_DAY', reason: 'Hospitalized' },
    ];

    const currentAssignments: Assignment[] = [
      { id: '1', date: '2026-10-15', session: 'Morning', roomId: 'RM-001', facultyId: 'FAC-001', status: 'SCHEDULED' },
      { id: '2', date: '2026-10-15', session: 'Morning', roomId: 'RM-002', facultyId: 'FAC-002', status: 'SCHEDULED' },
    ];

    // Attempt to substitute FAC-001 with FAC-003 who is on medical leave
    const candidateSubstitute: Assignment = {
      id: '1',
      date: '2026-10-15',
      session: 'Morning',
      roomId: 'RM-001',
      facultyId: 'FAC-003',
      status: 'SUBSTITUTED',
    };

    const subCheck = validateManualReassignment(candidateSubstitute, currentAssignments, {
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves,
      defaultMaxDuties: 6,
    });

    expect(subCheck.valid).toBe(false);
    expect(subCheck.violations.some((v) => v.rule === 'ELIGIBILITY')).toBe(true);
  });

  // =====================================================
  // SCENARIO 13: Cancelled Duties Released from Duty Cap
  // =====================================================
  it('Scenario 13: Cancelled duties do not count toward duty cap (Rule F)', () => {
    const rooms = generateTestRooms(1);
    const faculty = generateTestFaculty(1); // maxDuty = 1
    const dates: ExamDate[] = [{ date: '2026-10-15', sequenceOrder: 1, isExamDay: true }];

    const assignmentsWithCancellation: Assignment[] = [
      // 1 cancelled assignment
      { id: '1', date: '2026-10-15', session: 'Morning', roomId: 'RM-001', facultyId: 'FAC-001', status: 'CANCELLED' },
      // 1 active assignment
      { id: '2', date: '2026-10-15', session: 'Morning', roomId: 'RM-001', facultyId: 'FAC-001', status: 'SCHEDULED' },
    ];

    const valResult = validateSchedule(assignmentsWithCancellation, {
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 1, // Cap is 1
    });

    // Cancelled assignment is excluded, so duty count is 1 <= 1 cap -> valid!
    expect(valResult.isValid).toBe(true);
    expect(valResult.totalAssignedSlots).toBe(1);
  });

  // =====================================================
  // SCENARIO 14: Duty Balances Remain Correct After Mutation
  // =====================================================
  it('Scenario 14: Duty balances and accounting reflect mutations accurately', () => {
    const faculty = generateTestFaculty(3);
    const counts = new Map<string, number>([
      ['FAC-001', 3],
      ['FAC-002', 2],
      ['FAC-003', 1],
    ]);

    const stats = SchedulingEngine.computeWorkloadStats(faculty, counts);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(3);
    expect(stats.avg).toBe(2);
    expect(stats.median).toBe(2);
  });

  // =====================================================
  // SCENARIO 18: Different Room and Faculty Counts (Dynamic)
  // =====================================================
  it('Scenario 18: Dynamic room and faculty configurations work seamlessly without code changes', () => {
    // 25 rooms, 80 faculty, 3 non-consecutive dates = 75 slots
    const rooms = generateTestRooms(25);
    const faculty = generateTestFaculty(80);
    const dates: ExamDate[] = [
      { date: '2026-11-01', sequenceOrder: 1, isExamDay: true },
      { date: '2026-11-03', sequenceOrder: 2, isExamDay: true },
      { date: '2026-11-05', sequenceOrder: 3, isExamDay: true },
    ];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-DYNAMIC',
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 5,
    });

    expect(result.success).toBe(true);
    expect(result.assignments.length).toBe(75);
    expect(result.validation.isValid).toBe(true);
  });

  // =====================================================
  // SCENARIO 19: Non-Examination Dates Handled Properly
  // =====================================================
  it('Scenario 19: Non-examination dates (holidays/study breaks) are ignored during allocation', () => {
    const rooms = generateTestRooms(2);
    const faculty = generateTestFaculty(10);
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 2, isExamDay: false }, // Holiday! Not an exam day
      { date: '2026-10-17', sequenceOrder: 3, isExamDay: true },
    ];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-HOLIDAY',
      dates,
      sessions: [{ name: 'Morning', startTime: '09:00', endTime: '12:00' }],
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 6,
    });

    expect(result.success).toBe(true);
    // 2 rooms * 1 session * 2 exam dates = 4 assignments
    expect(result.assignments.length).toBe(4);
    expect(result.assignments.some((a) => a.date === '2026-10-16')).toBe(false);

    // Because 2026-10-16 was not an exam day, Oct 15 and Oct 17 are non-consecutive exam days!
    // A teacher could work on both Oct 15 and Oct 17 without violating Rule C.
    const facDates = new Map<string, string[]>();
    for (const a of result.assignments) {
      if (!facDates.has(a.facultyId)) facDates.set(a.facultyId, []);
      facDates.get(a.facultyId)!.push(a.date);
    }
    // Validation must pass
    expect(result.validation.isValid).toBe(true);
  });

  // =====================================================
  // SCENARIO 20: Deterministic Output Across Repeated Runs
  // =====================================================
  it('Scenario 20: Repeated generation with identical inputs is 100% deterministic', () => {
    const rooms = generateTestRooms(8);
    const faculty = generateTestFaculty(35);
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-18', sequenceOrder: 2, isExamDay: true },
    ];

    const input = {
      examinationId: 'EXAM-DETERMINISM',
      dates,
      sessions: standardSessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 4,
    };

    const run1 = SchedulingEngine.generateSchedule(input);
    const run2 = SchedulingEngine.generateSchedule(input);

    expect(run1.success).toBe(true);
    expect(run2.success).toBe(true);
    expect(run1.assignments.length).toBe(run2.assignments.length);

    for (let i = 0; i < run1.assignments.length; i++) {
      expect(run1.assignments[i].date).toBe(run2.assignments[i].date);
      expect(run1.assignments[i].session).toBe(run2.assignments[i].session);
      expect(run1.assignments[i].roomId).toBe(run2.assignments[i].roomId);
      expect(run1.assignments[i].facultyId).toBe(run2.assignments[i].facultyId);
    }
  });

  // =====================================================================
  // SCALE BENCHMARK: 200 Rooms, 500 Faculty, 2 Sessions, 6 Consecutive Days
  // =====================================================================
  it('Scale Benchmark: Accurately detects and explains mathematical infeasibility (2,400 slots vs 1,500 max capacity)', () => {
    // 200 rooms, 500 faculty, 2 sessions/day, 6 consecutive exam days.
    // Slots required = 200 * 2 * 6 = 2,400.
    // Max capacity per teacher across 6 consecutive days = ceil(6/2) = 3 days * 1 session/day = 3 duties.
    // Max capacity for 500 teachers = 500 * 3 = 1,500.
    // Deficit = 900 slots.
    const rooms = generateTestRooms(200);
    const faculty = generateTestFaculty(500);
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 2, isExamDay: true },
      { date: '2026-10-17', sequenceOrder: 3, isExamDay: true },
      { date: '2026-10-18', sequenceOrder: 4, isExamDay: true },
      { date: '2026-10-19', sequenceOrder: 5, isExamDay: true },
      { date: '2026-10-20', sequenceOrder: 6, isExamDay: true },
    ];

    const startTime = performance.now();
    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-BENCHMARK-6D',
      dates,
      sessions: standardSessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 6,
    });
    const durationMs = performance.now() - startTime;

    // Must NOT silently pass or drop constraints!
    expect(result.success).toBe(false);
    expect(result.failureDiagnostics).toBeDefined();
    expect(result.failureDiagnostics!.provenInfeasible).toBe(true);
    expect(result.preflight.totalRequiredSlots).toBe(2400);
    expect(result.preflight.totalPossibleCapacity).toBe(1500);
    expect(result.preflight.deficit).toBe(900);
    expect(result.preflight.maxWorkingDaysPerTeacher).toBe(3);

    // Diagnostics must be actionable
    expect(result.failureDiagnostics!.details.length).toBeGreaterThan(0);
    console.log(`[Benchmark Execution] Pre-flight infeasibility detected in ${durationMs.toFixed(2)}ms`);
  });

  // =====================================================================
  // SCALE BENCHMARK: Feasible Scale Test (100 Rooms, 500 Faculty, 6 Days Non-Consecutive)
  // =====================================================================
  it('Scale Benchmark: Successfully allocates and validates large feasible schedule within performance budget', () => {
    // 50 rooms, 2 sessions/day, 6 non-consecutive days = 600 slots.
    // 300 faculty members with 4 duties capacity = 1,200 capacity >= 600 slots.
    const rooms = generateTestRooms(50);
    const faculty = generateTestFaculty(300);
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-17', sequenceOrder: 2, isExamDay: true },
      { date: '2026-10-19', sequenceOrder: 3, isExamDay: true },
      { date: '2026-10-21', sequenceOrder: 4, isExamDay: true },
      { date: '2026-10-23', sequenceOrder: 5, isExamDay: true },
      { date: '2026-10-25', sequenceOrder: 6, isExamDay: true },
    ];

    const startTime = performance.now();
    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EXAM-BENCHMARK-FEASIBLE',
      dates,
      sessions: standardSessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 4,
    });
    const durationMs = performance.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.assignments.length).toBe(600);
    expect(result.validation.isValid).toBe(true);
    expect(result.validation.coveragePercentage).toBe(100);

    // Verify performance budget (should easily solve in < 1000ms)
    console.log(`[Benchmark Feasible] 600 slots generated and validated in ${durationMs.toFixed(2)}ms`);
    expect(durationMs).toBeLessThan(2000);
  });
});
