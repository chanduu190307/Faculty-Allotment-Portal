import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase } from '../../src/db/connection';
import { runMigrations } from '../../src/db/schema';
import { seedDatabase } from '../../src/db/seed';
import { SchedulingEngine } from '../../src/domain/scheduling/engine';
import { checkCapacityFeasibility } from '../../src/domain/scheduling/capacity';
import { validateSchedule, validateManualReassignment } from '../../src/domain/scheduling/validator';
import { ScheduleService } from '../../src/services/schedule.service';
import { TimetableService } from '../../src/services/timetable.service';
import { ExamService } from '../../src/services/exam.service';
import { FacultyService } from '../../src/services/faculty.service';
import { RoomService } from '../../src/services/room.service';
import {
  ExamDate,
  ExamSession,
  Faculty,
  Room,
  Assignment,
} from '../../src/domain/scheduling/types';

describe('Timetable Scheduling Integration Suite (Stage 2 Feature D)', () => {
  let db: any;

  beforeEach(() => {
    db = getDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db);
  });

  const testSessions: ExamSession[] = [
    { name: 'Morning', startTime: '09:30', endTime: '12:30' },
    { name: 'Afternoon', startTime: '14:00', endTime: '17:00' },
  ];

  function createFaculty(count: number, prefix = 'FAC'): Faculty[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${(i + 1).toString().padStart(3, '0')}`,
      name: `Faculty Member ${i + 1}`,
      email: `faculty${i + 1}@university.edu`,
      department: i % 2 === 0 ? 'Computer Science' : 'Information Technology',
      designation: 'Assistant Professor',
      active: true,
      exempt: false,
    }));
  }

  function createRooms(count: number, prefix = 'RM'): Room[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${(i + 1).toString().padStart(3, '0')}`,
      name: `Room ${i + 1}`,
      building: 'Main Block',
      floor: 1,
      capacity: 40,
      requiredStaffing: 1,
      active: true,
    }));
  }

  // =========================================================================
  // 1. Capacity calculations use confirmed timetable data
  // =========================================================================
  it('calculates required slots from confirmed timetable sessions rather than default Cartesian product', () => {
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 2, isExamDay: true },
    ];
    const rooms = createRooms(5); // 5 rooms
    const faculty = createFaculty(20);

    // Default: 2 dates x 2 sessions x 5 rooms = 20 slots
    const defaultPreflight = checkCapacityFeasibility(
      dates,
      testSessions,
      rooms,
      faculty,
      [],
      4,
      0
    );
    expect(defaultPreflight.totalRequiredSlots).toBe(20);

    // Timetable confirmed: Only Morning on 2026-10-15, and only Afternoon on 2026-10-16 (1 session per day)
    const timetableSessions = [
      { date: '2026-10-15', session: 'Morning' },
      { date: '2026-10-16', session: 'Afternoon' },
    ];

    const timetablePreflight = checkCapacityFeasibility(
      dates,
      testSessions,
      rooms,
      faculty,
      [],
      4,
      0,
      { timetableSessions, timetableRecordsCount: 2 }
    );

    // 1 session on day 1 x 5 rooms + 1 session on day 2 x 5 rooms = 10 slots
    expect(timetablePreflight.totalRequiredSlots).toBe(10);
    expect(timetablePreflight.diagnosticDetails?.timetableConfirmed).toBe(true);
    expect(timetablePreflight.diagnosticDetails?.timetableSessionsCount).toBe(2);
  });

  // =========================================================================
  // 2. Expected counts are not mistaken for actual eligible resources
  // =========================================================================
  it('evaluates feasibility against actual registered eligible faculty, not configured expected faculty count', () => {
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
    ];
    const rooms = createRooms(10); // requires 10 slots
    // Only 4 registered eligible faculty, 1 exempt
    const faculty: Faculty[] = [
      { id: 'F1', name: 'Dr. One', email: 'f1@u.edu', department: 'CS', active: true, exempt: false },
      { id: 'F2', name: 'Dr. Two', email: 'f2@u.edu', department: 'CS', active: true, exempt: false },
      { id: 'F3', name: 'Dr. Three', email: 'f3@u.edu', department: 'CS', active: true, exempt: false },
      { id: 'F4', name: 'Dr. Four', email: 'f4@u.edu', department: 'CS', active: true, exempt: false },
      { id: 'F5', name: 'Dr. Five (Exempt)', email: 'f5@u.edu', department: 'CS', active: true, exempt: true },
    ];

    const preflight = checkCapacityFeasibility(
      dates,
      [{ name: 'Morning', startTime: '09:30', endTime: '12:30' }],
      rooms,
      faculty,
      [],
      4,
      0,
      {
        expectedFacultyCount: 50, // Setting says 50 expected
        expectedRoomCount: 10,
        timetableSessions: [{ date: '2026-10-15', session: 'Morning' }],
        timetableRecordsCount: 1,
      }
    );

    // Should FAIL feasibility because only 4 eligible faculty are present, not 50!
    expect(preflight.isFeasible).toBe(false);
    expect(preflight.deficit).toBe(6); // 10 required - 4 eligible = 6
    expect(preflight.diagnosticDetails?.expectedFacultyCount).toBe(50);
    expect(preflight.diagnosticDetails?.eligibleFacultyCount).toBe(4);
    expect(preflight.diagnosticDetails?.registeredFacultyExempt).toBe(1);
    expect(preflight.warnings).toBeDefined();
    expect(preflight.warnings?.some((w) => w.includes('Faculty Count Mismatch'))).toBe(true);
  });

  // =========================================================================
  // 3. No schedule generation occurs automatically during timetable import
  // =========================================================================
  it('does not create any draft, approved, or published schedule when timetable is imported', () => {
    const exam = ExamService.create({
      name: 'Autumn Midterms 2026',
      academicYear: '2026-2027',
      session: 'Midterm',
      startDate: '2026-10-15',
      endDate: '2026-10-16',
      sessionConfig: testSessions,
      maxDutiesPerFaculty: 4,
      restDays: 1,
    });

    const db = getDatabase();
    const schedulesBefore = db.prepare('SELECT COUNT(*) as count FROM schedules WHERE examination_id = ?').get(exam.id) as { count: number };
    expect(schedulesBefore.count).toBe(0);

    // Import confirmed timetable
    const result = TimetableService.commitTimetable(
      exam.id,
      [
        {
          examDate: '2026-10-15',
          subjectCode: 'CS101',
          subjectName: 'Algorithms',
          session: 'Morning',
          startTime: '09:30',
          endTime: '12:30',
        },
      ],
      'Test Admin'
    );

    expect(result.success).toBe(true);
    expect(result.inserted).toBe(1);

    // Verify schedules table is still completely empty
    const schedulesAfter = db.prepare('SELECT COUNT(*) as count FROM schedules WHERE examination_id = ?').get(exam.id) as { count: number };
    expect(schedulesAfter.count).toBe(0);

    const assignmentsAfter = db.prepare('SELECT COUNT(*) as count FROM assignments').get() as { count: number };
    expect(assignmentsAfter.count).toBe(0);
  });

  // =========================================================================
  // 4. Approved schedules are not modified by timetable operations
  // =========================================================================
  it('protects approved schedules from being overwritten or modified by timetable import', () => {
    const exam = ExamService.create({
      name: 'Spring Finals 2026',
      academicYear: '2026-2027',
      session: 'Final',
      startDate: '2026-10-15',
      endDate: '2026-10-15',
      sessionConfig: [{ name: 'Morning', startTime: '09:30', endTime: '12:30' }],
      maxDutiesPerFaculty: 2,
      restDays: 0,
    });

    // Generate schedule (using seeded faculty & rooms)
    const genResult = ScheduleService.generate(exam.id, 'Test Admin', 12345);
    expect(genResult.success).toBe(true);

    // Validate and Approve
    ScheduleService.validateDraft(genResult.scheduleId, 'Test Admin');
    const approveResult = ScheduleService.approve(genResult.scheduleId, 'Test Admin');
    expect(approveResult.state).toBe('APPROVED');

    const db = getDatabase();
    const approvedBefore = db.prepare('SELECT * FROM schedules WHERE id = ?').get(genResult.scheduleId) as any;
    expect(approvedBefore.state).toBe('APPROVED');

    // Now import a new timetable
    const importResult = TimetableService.commitTimetable(
      exam.id,
      [
        {
          examDate: '2026-10-15',
          subjectCode: 'CS202',
          subjectName: 'Computer Architecture',
          session: 'Morning',
          startTime: '09:30',
          endTime: '12:30',
        },
      ],
      'Test Admin'
    );
    expect(importResult.success).toBe(true);

    // Verify approved schedule state, version, and assignments remain exactly unchanged
    const approvedAfter = db.prepare('SELECT * FROM schedules WHERE id = ?').get(genResult.scheduleId) as any;
    expect(approvedAfter.state).toBe('APPROVED');
    expect(approvedAfter.version).toBe(approvedBefore.version);
    expect(approvedAfter.updated_at).toBe(approvedBefore.updated_at);
  });

  // =========================================================================
  // 5. Infeasibility vs. Inconclusive solver termination
  // =========================================================================
  it('distinguishes proven mathematical infeasibility from solver timeout or constraint dead-end', () => {
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
    ];
    const sessions: ExamSession[] = [{ name: 'Morning', startTime: '09:30', endTime: '12:30' }];
    const rooms = createRooms(5); // 5 slots needed
    const faculty = createFaculty(2); // Only 2 faculty available -> mathematically impossible!

    const mathInfeasible = SchedulingEngine.generateSchedule({
      examinationId: 'EX-TEST',
      dates,
      sessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 2,
      restDays: 0,
      timetableSessions: [{ date: '2026-10-15', session: 'Morning' }],
    });

    expect(mathInfeasible.success).toBe(false);
    expect(mathInfeasible.isInconclusive).toBe(false); // Mathematical infeasibility is proven!
    expect(mathInfeasible.failureDiagnostics?.reasons?.[0] || mathInfeasible.failureDiagnostics?.details?.[0]).toContain('Mathematical Infeasibility Proven');
  });

  it('correctly reports isInconclusive: true when capacity is mathematically feasible but constraint dead-end is reached', () => {
    // Capacity preflight evaluates aggregate counts and rest-day arithmetic, which is feasible.
    // However, fine-grained constraints (such as Rule H4 room rotation + leave) create a dead-end
    // where no candidate can legally be assigned to the room.
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
    ];
    const sessions: ExamSession[] = [
      { name: 'Morning', startTime: '09:30', endTime: '12:30' },
    ];
    const rooms = createRooms(1);
    const faculty = createFaculty(3);

    // FAC-003 is on leave on exam date
    const leaves = [
      { facultyId: 'FAC-003', date: '2026-10-15', reason: 'Personal', sessionScope: 'FULL_DAY' },
    ];

    // FAC-001 and FAC-002 both served in RM-001 in their immediately preceding duty,
    // so Rule H4 (room rotation) forbids them from serving in RM-001 on this duty.
    const pastRoomHistory = {
      'FAC-001': { '2026-10-14': 'RM-001' },
      'FAC-002': { '2026-10-14': 'RM-001' },
    };

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EX-INCONC',
      dates,
      sessions,
      rooms,
      faculty,
      leaves,
      defaultMaxDuties: 2,
      restDays: 0,
      pastRoomHistory,
      timetableSessions: [
        { date: '2026-10-15', session: 'Morning' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.isInconclusive).toBe(true);
    expect(result.failureDiagnostics?.isInconclusive).toBe(true);
    expect(result.failureDiagnostics?.provenInfeasible).toBe(false);
    expect(result.failureDiagnostics?.reason).toContain('Constraint exhaustion');
  });

  // =========================================================================
  // 6. Safe schedule generation respects confirmed timetable and H1–H7
  // =========================================================================
  it('generates a full schedule allocating slots strictly for confirmed timetable sessions', () => {
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 2, isExamDay: true },
      { date: '2026-10-17', sequenceOrder: 3, isExamDay: true },
    ];
    // Examination has both Morning and Afternoon defined
    const rooms = createRooms(3);
    const faculty = createFaculty(15);

    // Timetable specifies:
    // 2026-10-15: Morning only
    // 2026-10-16: Afternoon only
    // 2026-10-17: Morning only
    const timetableSessions = [
      { date: '2026-10-15', session: 'Morning' },
      { date: '2026-10-16', session: 'Afternoon' },
      { date: '2026-10-17', session: 'Morning' },
    ];

    const result = SchedulingEngine.generateSchedule({
      examinationId: 'EX-TIMETABLE-FULL',
      dates,
      sessions: testSessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 3,
      restDays: 0,
      seed: 42,
      timetableSessions,
    });

    expect(result.success).toBe(true);
    // 3 rooms x 3 active sessions = 9 assignments
    expect(result.assignments.length).toBe(9);

    // Verify all assignments on 2026-10-15 are Morning
    const d1Asgns = result.assignments.filter((a) => a.date === '2026-10-15');
    expect(d1Asgns.length).toBe(3);
    expect(d1Asgns.every((a) => a.session === 'Morning')).toBe(true);

    // Verify all assignments on 2026-10-16 are Afternoon
    const d2Asgns = result.assignments.filter((a) => a.date === '2026-10-16');
    expect(d2Asgns.length).toBe(3);
    expect(d2Asgns.every((a) => a.session === 'Afternoon')).toBe(true);

    // Verify all assignments on 2026-10-17 are Morning
    const d3Asgns = result.assignments.filter((a) => a.date === '2026-10-17');
    expect(d3Asgns.length).toBe(3);
    expect(d3Asgns.every((a) => a.session === 'Morning')).toBe(true);

    // Validate using authoritative validator
    const validation = validateSchedule(result.assignments, {
      dates,
      sessions: testSessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 3,
      restDays: 0,
      timetableSessions,
    });

    expect(validation.isValid).toBe(true);
    expect(validation.violations.length).toBe(0);
    expect(validation.coveragePercentage).toBe(100);
  });

  // =========================================================================
  // 7. Manual changes and substitutions use authoritative validator
  // =========================================================================
  it('enforces authoritative validation on manual substitutions with timetable context', () => {
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
    ];
    const rooms = createRooms(2);
    const faculty = createFaculty(5);

    const existingAssignments: Assignment[] = [
      {
        id: 'A1',
        scheduleId: 'S1',
        date: '2026-10-15',
        session: 'Morning',
        roomId: 'RM-001',
        facultyId: 'FAC-001',
        status: 'SCHEDULED',
      },
      {
        id: 'A2',
        scheduleId: 'S1',
        date: '2026-10-15',
        session: 'Morning',
        roomId: 'RM-002',
        facultyId: 'FAC-002',
        status: 'SCHEDULED',
      },
    ];

    // Attempting to reassign RM-002 to FAC-001 (who is already assigned to RM-001 in Morning)
    const invalidCandidate: Assignment = {
      id: 'A2',
      scheduleId: 'S1',
      date: '2026-10-15',
      session: 'Morning',
      roomId: 'RM-002',
      facultyId: 'FAC-001', // Duplicate assignment in same session
      status: 'SCHEDULED',
    };

    const reassignCheck = validateManualReassignment(invalidCandidate, existingAssignments, {
      dates,
      sessions: testSessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 2,
      restDays: 0,
      timetableSessions: [{ date: '2026-10-15', session: 'Morning' }],
    });

    expect(reassignCheck.valid).toBe(false);
    expect(reassignCheck.violations.length).toBeGreaterThan(0);
    expect(reassignCheck.violations.some((v) => v.rule === 'RULE_B')).toBe(true);

    // Valid substitution with unassigned FAC-003
    const validCandidate: Assignment = {
      id: 'A2',
      scheduleId: 'S1',
      date: '2026-10-15',
      session: 'Morning',
      roomId: 'RM-002',
      facultyId: 'FAC-003',
      status: 'SCHEDULED',
    };

    const validCheck = validateManualReassignment(validCandidate, existingAssignments, {
      dates,
      sessions: testSessions,
      rooms,
      faculty,
      leaves: [],
      defaultMaxDuties: 2,
      restDays: 0,
      timetableSessions: [{ date: '2026-10-15', session: 'Morning' }],
    });

    expect(validCheck.valid).toBe(true);
    expect(validCheck.violations.length).toBe(0);
  });
});
