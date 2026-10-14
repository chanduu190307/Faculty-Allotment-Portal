import { describe, it, expect } from 'vitest';
import { SchedulingEngine } from '../../src/domain/scheduling/engine';
import {
  checkCapacityFeasibility,
  calculateMaxWorkingDays,
  getOrderedExamDates,
  areExamDatesConsecutive,
} from '../../src/domain/scheduling/capacity';
import {
  validateSchedule,
  validateManualReassignment,
} from '../../src/domain/scheduling/validator';
import {
  ExamDate,
  ExamSession,
  Faculty,
  FacultyLeave,
  Room,
  Assignment,
} from '../../src/domain/scheduling/types';
import { getDatabase } from '../../src/db/connection';
import { runMigrations } from '../../src/db/schema';
import { seedDatabase } from '../../src/db/seed';
import { ExamService } from '../../src/services/exam.service';
import { ScheduleService } from '../../src/services/schedule.service';

describe('Phase 2: Scheduling Engine & Rule Correction Test Suite', () => {
  function generateTestFaculty(count: number, overrides: Partial<Faculty> = {}): Faculty[] {
    return Array.from({ length: count }, (_, i) => {
      const id = `FAC-${(i + 1).toString().padStart(3, '0')}`;
      return {
        id,
        name: `Faculty ${id}`,
        email: `faculty${i + 1}@college.edu`,
        department: i % 2 === 0 ? 'Computer Science' : 'Mechanical Engineering',
        designation: 'Assistant Professor',
        active: true,
        exempt: false,
        ...overrides,
      };
    });
  }

  function generateTestRooms(count: number, staffing = 1, overrides: Partial<Room> = {}): Room[] {
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
        ...overrides,
      };
    });
  }

  const standardSessions: ExamSession[] = [
    { name: 'Morning', startTime: '09:30', endTime: '12:30' },
    { name: 'Afternoon', startTime: '14:00', endTime: '17:00' },
  ];

  // =========================================================================
  // 1. RULE H3: Consecutive Examination Dates & Rest Days
  // =========================================================================
  describe('Rule H3 — Consecutive Examination Dates & Rest Days', () => {
    const alternatingDates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-17', sequenceOrder: 2, isExamDay: true }, // Calendar gap = 48 hours, but sequential exam dates
    ];

    it('considers alternating calendar dates as consecutive examination dates when rest_days = 1', () => {
      const ordered = getOrderedExamDates(alternatingDates);
      expect(ordered.map((d) => d.date)).toEqual(['2026-10-15', '2026-10-17']);

      const map = new Map<string, number>([
        ['2026-10-15', 0],
        ['2026-10-17', 1],
      ]);

      // With rest_days = 1, index 0 and 1 have diff 1 <= 1 -> CONSECUTIVE
      expect(areExamDatesConsecutive('2026-10-15', '2026-10-17', map, 1)).toBe(true);

      // Max working days for 2 dates under rest_days = 1 is Math.ceil(2 / 2) = 1
      expect(calculateMaxWorkingDays(ordered, 1)).toBe(1);
    });

    it('proves capacity infeasible when 10 rooms need staffing over 2 alternating dates with rest_days = 1 and only 10 teachers', () => {
      const rooms = generateTestRooms(10);
      const faculty = generateTestFaculty(10); // 10 teachers can only provide 10 duties total (1 day each)

      // 10 rooms * 1 session * 2 dates = 20 duties needed
      const preflight = checkCapacityFeasibility(
        alternatingDates,
        [{ name: 'Morning', startTime: '09:30', endTime: '12:30' }],
        rooms,
        faculty,
        [],
        6,
        1
      );

      expect(preflight.isFeasible).toBe(false);
      expect(preflight.totalRequiredSlots).toBe(20);
      expect(preflight.totalPossibleCapacity).toBe(10); // 10 faculty * 1 day max
      expect(preflight.deficit).toBe(10);
      expect(preflight.remedies.length).toBeGreaterThanOrEqual(3);
    });

    it('permits working both dates when rest_days = 0 (consecutive rule disabled)', () => {
      const ordered = getOrderedExamDates(alternatingDates);
      const map = new Map<string, number>([
        ['2026-10-15', 0],
        ['2026-10-17', 1],
      ]);

      // With rest_days = 0, consecutive rule is disabled
      expect(areExamDatesConsecutive('2026-10-15', '2026-10-17', map, 0)).toBe(false);
      expect(calculateMaxWorkingDays(ordered, 0)).toBe(2);

      const rooms = generateTestRooms(10);
      const faculty = generateTestFaculty(10);

      // With rest_days = 0, the 10 teachers can work both days (20 duties capacity)
      const preflight = checkCapacityFeasibility(
        alternatingDates,
        [{ name: 'Morning', startTime: '09:30', endTime: '12:30' }],
        rooms,
        faculty,
        [],
        6,
        0
      );

      expect(preflight.isFeasible).toBe(true);
      expect(preflight.deficit).toBe(0);

      // Solve with engine
      const result = SchedulingEngine.generateSchedule({
        examinationId: 'EXAM-REST-0',
        dates: alternatingDates,
        sessions: [{ name: 'Morning', startTime: '09:30', endTime: '12:30' }],
        rooms,
        faculty,
        leaves: [],
        defaultMaxDuties: 6,
        restDays: 0,
      });

      expect(result.success).toBe(true);
      expect(result.assignments.length).toBe(20);

      // Validate schedule with restDays: 0
      const validation = validateSchedule(result.assignments, {
        faculty,
        rooms,
        dates: alternatingDates,
        sessions: [{ name: 'Morning', startTime: '09:30', endTime: '12:30' }],
        defaultMaxDuties: 6,
        restDays: 0,
      });
      expect(validation.isValid).toBe(true);
      expect(validation.violations).toEqual([]);
    });
  });

  // =========================================================================
  // 2. RULE H4: Room Rotation Across Intervening Dates
  // =========================================================================
  describe('Rule H4 — Room Rotation Independent of Calendar Gaps', () => {
    const threeDates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-17', sequenceOrder: 2, isExamDay: true },
      { date: '2026-10-20', sequenceOrder: 3, isExamDay: true },
    ];

    it('rejects assigning teacher to Room 101 on Day 3 if their immediately preceding duty was Room 101 on Day 1 (absent Day 2)', () => {
      const faculty = generateTestFaculty(5);
      const rooms = generateTestRooms(3);
      const targetTeacher = faculty[0];
      const room101 = rooms[0];

      // Existing assignments:
      // Day 1 (Oct 15): Teacher 0 in Room 0
      // Day 2 (Oct 17): Teacher 0 has NO assignment (absent/off)
      // Day 3 (Oct 20): Proposed to assign Teacher 0 in Room 0 again
      const existingAssignments: Assignment[] = [
        {
          id: 'ASGN-1',
          date: '2026-10-15',
          session: 'Morning',
          roomId: room101.id,
          facultyId: targetTeacher.id,
          status: 'SCHEDULED',
        },
      ];

      // Propose candidate assignment for Day 3 in Room 101
      const proposedSlot: Assignment = {
        id: 'ASGN-3',
        date: '2026-10-20',
        session: 'Morning',
        roomId: room101.id,
        facultyId: targetTeacher.id,
        status: 'SCHEDULED',
      };

      const reassignResult = validateManualReassignment(
        proposedSlot,
        existingAssignments,
        {
          faculty,
          rooms,
          dates: threeDates,
          sessions: standardSessions,
          defaultMaxDuties: 6,
          restDays: 1,
        }
      );

      expect(reassignResult.valid).toBe(false);
      const h4Violation = reassignResult.violations.find((v) => v.rule === 'RULE_D');
      expect(h4Violation).toBeDefined();
      expect(h4Violation?.message).toContain('without room rotation');
    });

    it('allows assigning teacher to Room 102 on Day 3 if prior room was Room 101 on Day 1', () => {
      const faculty = generateTestFaculty(5);
      const rooms = generateTestRooms(3);
      const targetTeacher = faculty[0];
      const room101 = rooms[0];
      const room102 = rooms[1];

      const existingAssignments: Assignment[] = [
        {
          id: 'ASGN-1',
          date: '2026-10-15',
          session: 'Morning',
          roomId: room101.id,
          facultyId: targetTeacher.id,
          status: 'SCHEDULED',
        },
      ];

      const proposedSlot: Assignment = {
        id: 'ASGN-3',
        date: '2026-10-20',
        session: 'Morning',
        roomId: room102.id,
        facultyId: targetTeacher.id,
        status: 'SCHEDULED',
      };

      const reassignResult = validateManualReassignment(
        proposedSlot,
        existingAssignments,
        {
          faculty,
          rooms,
          dates: threeDates,
          sessions: standardSessions,
          defaultMaxDuties: 6,
          restDays: 1,
        }
      );

      expect(reassignResult.valid).toBe(true);
      expect(reassignResult.violations).toEqual([]);
    });
  });

  // =========================================================================
  // 3. RULE H6: Complete Faculty Eligibility Checks
  // =========================================================================
  describe('Rule H6 — Faculty Eligibility (Inactive, Leave, Exempt, Own-Department)', () => {
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
    ];
    const sessions: ExamSession[] = [
      { name: 'Morning', startTime: '09:30', endTime: '12:30' },
    ];

    it('excludes inactive teacher from candidate pool and validator rejects reassignment', () => {
      const faculty = generateTestFaculty(2);
      faculty[1].active = false; // Inactive
      const rooms = generateTestRooms(1);

      const proposedSlot: Assignment = {
        id: 'ASGN-1',
        date: '2026-10-15',
        session: 'Morning',
        roomId: rooms[0].id,
        facultyId: faculty[1].id,
        status: 'SCHEDULED',
      };

      const result = validateManualReassignment(
        proposedSlot,
        [],
        {
          faculty,
          rooms,
          dates,
          sessions,
          defaultMaxDuties: 6,
          restDays: 1,
        }
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'ELIGIBILITY' && v.message.toLowerCase().includes('inactive'))).toBe(true);
    });

    it('excludes teacher marked exempt from candidate pool and validator rejects reassignment', () => {
      const faculty = generateTestFaculty(2);
      faculty[1].exempt = true; // Exempt
      const rooms = generateTestRooms(1);

      const proposedSlot: Assignment = {
        id: 'ASGN-1',
        date: '2026-10-15',
        session: 'Morning',
        roomId: rooms[0].id,
        facultyId: faculty[1].id,
        status: 'SCHEDULED',
      };

      const result = validateManualReassignment(
        proposedSlot,
        [],
        {
          faculty,
          rooms,
          dates,
          sessions,
          defaultMaxDuties: 6,
          restDays: 1,
        }
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'ELIGIBILITY' && v.message.toLowerCase().includes('exempt'))).toBe(true);
    });

    it('excludes teacher whose department matches room examDepartment (own-department rule)', () => {
      const faculty = generateTestFaculty(2);
      faculty[0].department = 'Computer Science';
      faculty[1].department = 'Mechanical Engineering';

      const rooms = generateTestRooms(1, 1, { examDepartment: 'Computer Science' });

      // Teacher 0 is from Computer Science, so they must not invigilate Room 0
      const proposedCS: Assignment = {
        id: 'ASGN-1',
        date: '2026-10-15',
        session: 'Morning',
        roomId: rooms[0].id,
        facultyId: faculty[0].id,
        status: 'SCHEDULED',
      };

      const resultCS = validateManualReassignment(
        proposedCS,
        [],
        {
          faculty,
          rooms,
          dates,
          sessions,
          defaultMaxDuties: 6,
          restDays: 1,
        }
      );
      expect(resultCS.valid).toBe(false);
      expect(resultCS.violations.some((v) => v.rule === 'ELIGIBILITY' && v.message.includes('matching examination department'))).toBe(true);

      // Teacher 1 is from Mechanical Engineering, so they are eligible
      const proposedMech: Assignment = {
        id: 'ASGN-2',
        date: '2026-10-15',
        session: 'Morning',
        roomId: rooms[0].id,
        facultyId: faculty[1].id,
        status: 'SCHEDULED',
      };

      const resultMech = validateManualReassignment(
        proposedMech,
        [],
        {
          faculty,
          rooms,
          dates,
          sessions,
          defaultMaxDuties: 6,
          restDays: 1,
        }
      );
      expect(resultMech.valid).toBe(true);
    });

    it('allows assignment when room examDepartment is unconfigured (null or undefined)', () => {
      const faculty = generateTestFaculty(2);
      const rooms = generateTestRooms(1, 1, { examDepartment: undefined });

      const proposedSlot: Assignment = {
        id: 'ASGN-1',
        date: '2026-10-15',
        session: 'Morning',
        roomId: rooms[0].id,
        facultyId: faculty[0].id,
        status: 'SCHEDULED',
      };

      const result = validateManualReassignment(
        proposedSlot,
        [],
        {
          faculty,
          rooms,
          dates,
          sessions,
          defaultMaxDuties: 6,
          restDays: 1,
        }
      );
      expect(result.valid).toBe(true);
    });

    it('excludes teacher on approved leave for date and session', () => {
      const faculty = generateTestFaculty(2);
      const rooms = generateTestRooms(1);
      const leaves: FacultyLeave[] = [
        {
          facultyId: faculty[0].id,
          date: '2026-10-15',
          sessionScope: 'MORNING',
          reason: 'Medical Leave',
          approvalStatus: 'APPROVED',
        },
      ];

      const proposedSlot: Assignment = {
        id: 'ASGN-1',
        date: '2026-10-15',
        session: 'Morning',
        roomId: rooms[0].id,
        facultyId: faculty[0].id,
        status: 'SCHEDULED',
      };

      const result = validateManualReassignment(
        proposedSlot,
        [],
        {
          faculty,
          rooms,
          dates,
          sessions,
          defaultMaxDuties: 6,
          restDays: 1,
          leaves,
        }
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'ELIGIBILITY' && v.message.toLowerCase().includes('approved leave'))).toBe(true);
    });
  });

  // =========================================================================
  // 4. MANUAL REASSIGNMENT REJECTION FOR HARD-RULE VIOLATIONS
  // =========================================================================
  describe('Manual Reassignment Rejection for H1–H7 Violations', () => {
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 2, isExamDay: true },
    ];
    const sessions = standardSessions;

    it('rejects reassignment if teacher already has a duty in another session on the same date (H2)', () => {
      const faculty = generateTestFaculty(2);
      const rooms = generateTestRooms(2);

      const existing: Assignment[] = [
        {
          id: 'ASGN-1',
          date: '2026-10-15',
          session: 'Morning',
          roomId: rooms[0].id,
          facultyId: faculty[0].id,
          status: 'SCHEDULED',
        },
      ];

      // Propose assigning faculty[0] to Afternoon session on the same day
      const proposed: Assignment = {
        id: 'ASGN-2',
        date: '2026-10-15',
        session: 'Afternoon',
        roomId: rooms[1].id,
        facultyId: faculty[0].id,
        status: 'SCHEDULED',
      };

      const result = validateManualReassignment(
        proposed,
        existing,
        {
          faculty,
          rooms,
          dates,
          sessions,
          defaultMaxDuties: 6,
          restDays: 1,
        }
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'RULE_B')).toBe(true);
    });

    it('rejects reassignment if teacher exceeds max duty cap (H5)', () => {
      const faculty = generateTestFaculty(2);
      const rooms = generateTestRooms(2);
      const maxDuties = 1;

      const existing: Assignment[] = [
        {
          id: 'ASGN-1',
          date: '2026-10-15',
          session: 'Morning',
          roomId: rooms[0].id,
          facultyId: faculty[0].id,
          status: 'SCHEDULED',
        },
      ];

      // Propose assigning faculty[0] to another date when maxDuties = 1
      const proposed: Assignment = {
        id: 'ASGN-2',
        date: '2026-10-16',
        session: 'Morning',
        roomId: rooms[1].id,
        facultyId: faculty[0].id,
        status: 'SCHEDULED',
      };

      const result = validateManualReassignment(
        proposed,
        existing,
        {
          faculty,
          rooms,
          dates,
          sessions,
          defaultMaxDuties: maxDuties,
          restDays: 0, // rest_days 0 so H3 doesn't block
        }
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'RULE_F')).toBe(true);
    });

    it('rejects reassignment if teacher worked an adjacent examination date under rest_days = 1 (H3)', () => {
      const faculty = generateTestFaculty(2);
      const rooms = generateTestRooms(2);

      const existing: Assignment[] = [
        {
          id: 'ASGN-1',
          date: '2026-10-15',
          session: 'Morning',
          roomId: rooms[0].id,
          facultyId: faculty[0].id,
          status: 'SCHEDULED',
        },
      ];

      // Propose assigning faculty[0] on adjacent day Oct 16
      const proposed: Assignment = {
        id: 'ASGN-2',
        date: '2026-10-16',
        session: 'Morning',
        roomId: rooms[1].id,
        facultyId: faculty[0].id,
        status: 'SCHEDULED',
      };

      const result = validateManualReassignment(
        proposed,
        existing,
        {
          faculty,
          rooms,
          dates,
          sessions,
          defaultMaxDuties: 6,
          restDays: 1, // rest_days = 1
        }
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'RULE_C')).toBe(true);
    });
  });

  // =========================================================================
  // 5. DETERMINISTIC SEEDED TIE-BREAKING
  // =========================================================================
  describe('Deterministic Seeded Tie-Breaking', () => {
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-18', sequenceOrder: 2, isExamDay: true },
    ];
    const sessions: ExamSession[] = [
      { name: 'Morning', startTime: '09:30', endTime: '12:30' },
    ];

    it('produces identical assignments when run twice with the exact same seed', () => {
      const rooms = generateTestRooms(5);
      const faculty = generateTestFaculty(20); // Abundant faculty with ties
      const seed = 424242;

      const result1 = SchedulingEngine.generateSchedule({
        examinationId: 'EXAM-SEED-1',
        dates,
        sessions,
        rooms,
        faculty,
        leaves: [],
        defaultMaxDuties: 6,
        restDays: 1,
        seed,
      });

      const result2 = SchedulingEngine.generateSchedule({
        examinationId: 'EXAM-SEED-2',
        dates,
        sessions,
        rooms,
        faculty,
        leaves: [],
        defaultMaxDuties: 6,
        restDays: 1,
        seed,
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.assignments.length).toBe(result2.assignments.length);

      // Sort and compare slot-for-slot
      const sortFn = (a: Assignment, b: Assignment) =>
        `${a.date}-${a.session}-${a.roomId}`.localeCompare(`${b.date}-${b.session}-${b.roomId}`);

      const sorted1 = [...result1.assignments].sort(sortFn);
      const sorted2 = [...result2.assignments].sort(sortFn);

      for (let i = 0; i < sorted1.length; i++) {
        expect(sorted1[i].roomId).toBe(sorted2[i].roomId);
        expect(sorted1[i].facultyId).toBe(sorted2[i].facultyId);
        expect(sorted1[i].date).toBe(sorted2[i].date);
        expect(sorted1[i].session).toBe(sorted2[i].session);
      }
    });

    it('alters tie outcomes when different seeds are supplied while preserving fairness and hard constraints', () => {
      const rooms = generateTestRooms(5);
      const faculty = generateTestFaculty(20);

      const resultA = SchedulingEngine.generateSchedule({
        examinationId: 'EXAM-SEED-A',
        dates,
        sessions,
        rooms,
        faculty,
        leaves: [],
        defaultMaxDuties: 6,
        restDays: 1,
        seed: 11111,
      });

      const resultB = SchedulingEngine.generateSchedule({
        examinationId: 'EXAM-SEED-B',
        dates,
        sessions,
        rooms,
        faculty,
        leaves: [],
        defaultMaxDuties: 6,
        restDays: 1,
        seed: 99999,
      });

      expect(resultA.success).toBe(true);
      expect(resultB.success).toBe(true);

      // Validate both schedules are 100% compliant with H1-H7
      const valA = validateSchedule(resultA.assignments, {
        faculty,
        rooms,
        dates,
        sessions,
        defaultMaxDuties: 6,
        restDays: 1,
      });
      const valB = validateSchedule(resultB.assignments, {
        faculty,
        rooms,
        dates,
        sessions,
        defaultMaxDuties: 6,
        restDays: 1,
      });
      expect(valA.isValid).toBe(true);
      expect(valB.isValid).toBe(true);

      // Compare allocations: different seeds must produce at least one difference in faculty assignment
      const sortFn = (a: Assignment, b: Assignment) =>
        `${a.date}-${a.session}-${a.roomId}`.localeCompare(`${b.date}-${b.session}-${b.roomId}`);
      const sortedA = [...resultA.assignments].sort(sortFn);
      const sortedB = [...resultB.assignments].sort(sortFn);

      let differences = 0;
      for (let i = 0; i < sortedA.length; i++) {
        if (sortedA[i].facultyId !== sortedB[i].facultyId) {
          differences++;
        }
      }
      expect(differences).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 6. ACCEPTANCE SCENARIO: 150 TEACHERS, 40 ROOMS, 2 SESSIONS, 2 CONSECUTIVE DATES
  // =========================================================================
  describe('Stage 1 Section 3 Acceptance Scenario: 150 Teachers, 40 Rooms, 2 Sessions, 2 Consecutive Dates', () => {
    const dates: ExamDate[] = [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 2, isExamDay: true },
    ];
    const sessions = standardSessions; // 2 sessions per day

    it('proves exactly 10 shortfall for 150 teachers and 40 rooms over 2 consecutive dates', () => {
      // 40 rooms * 2 sessions * 2 dates = 160 required teacher assignments.
      // 150 eligible teachers.
      // Under rest_days = 1 (consecutive exam dates), max working days = Math.ceil(2 / 2) = 1.
      // Under H2 (max 1 duty/day), each teacher can work at most 1 day = 1 duty.
      // Total available capacity = 150 teachers * 1 duty = 150 duties.
      // Shortfall = 160 - 150 = 10.
      const rooms = generateTestRooms(40);
      const faculty = generateTestFaculty(150);

      const preflight = checkCapacityFeasibility(
        dates,
        sessions,
        rooms,
        faculty,
        [],
        6,
        1
      );

      expect(preflight.isFeasible).toBe(false);
      expect(preflight.totalRequiredSlots).toBe(160);
      expect(preflight.totalPossibleCapacity).toBe(150);
      expect(preflight.deficit).toBe(10);
      expect(preflight.remedies[0]).toContain('at least 10 additional');
      expect(preflight.pairShortfalls?.[0]?.shortfall).toBe(10);
    });

    it('refuses to generate schedule and saves 0 records when pre-flight proves infeasible', () => {
      // In-memory DB test with ScheduleService
      const db = getDatabase(':memory:');
      runMigrations(db);
      seedDatabase(db, { roomCount: 40, facultyCount: 150, maxDuties: 6 });

      // Create the 40-room, 2-consecutive-date exam
      const exam = ExamService.create({
        id: 'EXAM-SHORTFALL-10',
        name: 'Shortfall 10 Acceptance Test Exam',
        startDate: '2026-10-15',
        endDate: '2026-10-16',
        maxDutiesPerFaculty: 6,
        restDays: 1,
        dates: [
          { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
          { date: '2026-10-16', sequenceOrder: 2, isExamDay: true },
        ],
      });

      const genResult = ScheduleService.generate(exam.id, 'Test Officer');
      expect(genResult.success).toBe(false);
      expect(genResult.failureDiagnostics?.provenInfeasible).toBe(true);
      expect(genResult.failureDiagnostics?.reason).toContain('Mathematical infeasibility detected');
      expect(genResult.failureDiagnostics?.details?.some((d: string) => d.includes('shortfall of 10'))).toBe(true);

      // Verify no schedule was inserted into database
      const schedules = db.prepare('SELECT * FROM schedules WHERE examination_id = ?').all(exam.id);
      expect(schedules.length).toBe(0);

      // Verify no assignments were inserted
      const assignments = db.prepare('SELECT * FROM assignments').all();
      expect(assignments.length).toBe(0);
    });
  });

  // =========================================================================
  // 7. HARD CONSTRAINTS H1, H5, H7 INTEGRITY
  // =========================================================================
  describe('Preservation of Hard Constraints H1, H5, H7', () => {
    it('never violates duty cap (H5) or creates duplicate room slots (H1/H7)', () => {
      const dates: ExamDate[] = [
        { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
        { date: '2026-10-18', sequenceOrder: 2, isExamDay: true },
      ];
      const sessions = standardSessions;
      const rooms = generateTestRooms(5);
      const faculty = generateTestFaculty(25);
      const maxDuties = 2;

      const result = SchedulingEngine.generateSchedule({
        examinationId: 'EXAM-CAPS-CHECK',
        dates,
        sessions,
        rooms,
        faculty,
        leaves: [],
        defaultMaxDuties: maxDuties,
        restDays: 1,
        seed: 777,
      });

      expect(result.success).toBe(true);

      // Check H5: max duties
      const dutyCounts: Record<string, number> = {};
      for (const asgn of result.assignments) {
        dutyCounts[asgn.facultyId] = (dutyCounts[asgn.facultyId] || 0) + 1;
        expect(dutyCounts[asgn.facultyId]).toBeLessThanOrEqual(maxDuties);
      }

      // Check H1/H7: unique slot per room, date, session
      const slotKeys = new Set<string>();
      for (const asgn of result.assignments) {
        const key = `${asgn.date}|${asgn.session}|${asgn.roomId}`;
        expect(slotKeys.has(key)).toBe(false);
        slotKeys.add(key);
      }

      // Total slots must equal 5 rooms * 2 sessions * 2 dates = 20
      expect(result.assignments.length).toBe(20);
    });
  });
});
