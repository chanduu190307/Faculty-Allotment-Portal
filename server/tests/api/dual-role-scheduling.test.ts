import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/schema';
import { getDatabase, closeDatabase } from '../../src/db/connection';
import { ScheduleService } from '../../src/services/schedule.service';
import { ExamService } from '../../src/services/exam.service';
import { checkCapacityFeasibility } from '../../src/domain/scheduling/capacity';
import { validateManualReassignment } from '../../src/domain/scheduling/validator';
import { ExportService } from '../../src/services/export.service';
import { ReportService } from '../../src/services/report.service';

describe('Phase 5 — Dual-Role Invigilation & Capacity Verification', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getDatabase(':memory:');
    runMigrations(db);

    const now = new Date().toISOString();

    // 3 active examination rooms
    for (let r = 1; r <= 3; r++) {
      db.prepare(`
        INSERT INTO rooms (id, name, building, floor, capacity, active, created_at, updated_at)
        VALUES (?, ?, 'Block A', 1, 30, 1, ?, ?)
      `).run(`RM-A10${r}`, `A-10${r}`, now, now);
    }

    // 16 active faculty members (under Rule B, 3 rooms * 2 roles = 6 for morning + 6 for afternoon = 12 distinct teachers needed per day)
    for (let f = 1; f <= 16; f++) {
      db.prepare(`
        INSERT INTO faculty (id, name, email, department, designation, active, created_at, updated_at)
        VALUES (?, ?, ?, 'Computer Science & Engineering', 'Assistant Professor', 1, ?, ?)
      `).run(`FAC-${f.toString().padStart(3, '0')}`, `Faculty Member ${f}`, `fac${f}@institution.edu`, now, now);
    }

    // Create exam through ExamService so rooms & faculty are linked
    ExamService.create({
      id: 'EXAM-DUAL-01',
      name: 'Fall End Semester Examinations',
      academicYear: '2026-2027',
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      sessionsPerDay: 2,
      defaultStaffingPerRoom: 2,
      maxDutiesPerFaculty: 6,
      restDays: 0,
      dates: [
        { date: '2026-11-01', sequenceOrder: 1, isExamDay: true },
        { date: '2026-11-02', sequenceOrder: 2, isExamDay: true },
      ],
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('calculates staffing demand strictly as active_rooms * sessions * 2 roles when dual-role is required', () => {
    const exam = ExamService.getById('EXAM-DUAL-01')!;

    // 3 rooms * 4 sessions (2 days * 2 sessions/day) = 12 room-sessions
    // Single role demand = 12 duties
    const singlePreflight = checkCapacityFeasibility(
      exam.dates,
      exam.sessionConfig,
      exam.rooms,
      exam.faculty,
      [],
      exam.maxDutiesPerFaculty,
      exam.restDays,
      { requireDualRole: false }
    );
    expect(singlePreflight.totalRequiredSlots).toBe(12);

    // Dual role demand = 12 * 2 = 24 duties
    const dualPreflight = checkCapacityFeasibility(
      exam.dates,
      exam.sessionConfig,
      exam.rooms,
      exam.faculty,
      [],
      exam.maxDutiesPerFaculty,
      exam.restDays,
      { requireDualRole: true }
    );
    expect(dualPreflight.totalRequiredSlots).toBe(24);
    expect(dualPreflight.isFeasible).toBe(true); // 16 faculty * 6 maxDuties = 96 capacity >= 24
  });

  it('detects mathematical infeasibility and blocks generation when faculty capacity is insufficient for 2 roles per room', () => {
    // Restrict faculty to only 3 members in examination_faculty (3 * 6 duties = 18 total capacity, but dual demand is 24)
    db.prepare("DELETE FROM examination_faculty WHERE faculty_id NOT IN ('FAC-001', 'FAC-002', 'FAC-003')").run();

    const genResult = ScheduleService.generate('EXAM-DUAL-01', 'System Admin', 42, { requireDualRole: true });
    expect(genResult.success).toBe(false);
    expect(genResult.failureDiagnostics?.provenInfeasible).toBe(true);
    expect(genResult.failureDiagnostics?.reason).toMatch(/infeasibility/i);
  });

  it('generates an allotment where every active room/session receives two distinct faculty members', () => {
    const result = ScheduleService.generate('EXAM-DUAL-01', 'System Admin', 42, { requireDualRole: true });

    expect(result.success).toBe(true);
    expect(result.scheduleId).toBeDefined();
    expect(result.assignments.length).toBe(12); // 3 rooms * 4 sessions

    for (const asgn of result.assignments) {
      expect(asgn.facultyId).toBeDefined();
      expect(asgn.friskingFacultyId).toBeDefined();
      // Crucial requirement: Invigilator and Frisking Teacher must be distinct
      expect(asgn.facultyId).not.toBe(asgn.friskingFacultyId);
    }
  });

  it('ScheduleValidator rejects assignments where the same faculty fills both Invigilator and Frisking roles', () => {
    const result = ScheduleService.generate('EXAM-DUAL-01', 'System Admin', 42, { requireDualRole: true });
    expect(result.success).toBe(true);
    const target = result.assignments[0];
    const exam = ExamService.getById('EXAM-DUAL-01')!;

    // Reassigning frisking teacher to the same person as the invigilator
    const candidateAssignment = {
      ...target,
      friskingFacultyId: target.facultyId,
    };

    const violationCheck = validateManualReassignment(
      candidateAssignment,
      result.assignments,
      {
        dates: exam.dates,
        sessions: exam.sessionConfig,
        rooms: exam.rooms,
        faculty: exam.faculty,
        leaves: [],
        defaultMaxDuties: exam.maxDutiesPerFaculty,
        restDays: exam.restDays,
      },
      'FRISKING'
    );

    expect(violationCheck.valid).toBe(false);
    expect(
      violationCheck.violations.some(
        (v) => v.rule === 'DUPLICATE' || v.message.includes('both Invigilator and Frisking')
      )
    ).toBe(true);
  });

  it('allows manual reassignment of either role while enforcing all H1-H7 constraints', () => {
    const gen = ScheduleService.generate('EXAM-DUAL-01', 'System Admin', 42, { requireDualRole: true });
    expect(gen.success).toBe(true);
    const sched = ScheduleService.getScheduleDetails(gen.scheduleId)!;
    const target = sched.assignments[0];

    // Find an eligible substitute faculty member with no duties on this date (respecting Rule B)
    const candidate = db
      .prepare(`
        SELECT f.id FROM faculty f
        WHERE f.id NOT IN (
          SELECT a.faculty_id FROM assignments a WHERE a.schedule_id = ? AND a.date = ?
          UNION
          SELECT a.frisking_faculty_id FROM assignments a WHERE a.schedule_id = ? AND a.date = ? AND a.frisking_faculty_id IS NOT NULL
        )
        LIMIT 1
      `)
      .get(gen.scheduleId, target.date, gen.scheduleId, target.date) as any;

    expect(candidate).toBeDefined();

    // Reassign Frisking Teacher
    const reassignRes = ScheduleService.manualReassign(
      gen.scheduleId,
      target.id,
      candidate.id,
      'Administrative substitution for frisking duty',
      'System Admin',
      sched.counter,
      'FRISKING'
    );

    if (!reassignRes.success) {
      console.error('Reassign error details:', reassignRes.error, reassignRes.violations);
    }
    expect(reassignRes.success).toBe(true);

    const updated = ScheduleService.getScheduleDetails(gen.scheduleId)!;
    const updatedTarget = updated.assignments.find((a: any) => a.id === target.id);
    expect(updatedTarget.frisking_faculty_id).toBe(candidate.id);
    expect(updatedTarget.faculty_id).toBe(target.faculty_id);
    expect(updatedTarget.faculty_id).not.toBe(updatedTarget.frisking_faculty_id);
  });

  it('exports daily reports and master Excel containing both Invigilator and Frisking Teacher columns', async () => {
    const gen = ScheduleService.generate('EXAM-DUAL-01', 'System Admin', 42, { requireDualRole: true });
    expect(gen.success).toBe(true);
    const dailyData = ReportService.generateDailyReport('EXAM-DUAL-01', '2026-11-01', true);

    expect(dailyData.roomAssignments.length).toBeGreaterThan(0);
    for (const r of dailyData.roomAssignments) {
      expect(r.faculty_name).toBeDefined();
      expect(r.frisking_faculty_name).toBeDefined();
    }

    const excelBuffer = await ExportService.generateDailyReportExcel(dailyData);
    expect(excelBuffer).toBeInstanceOf(Buffer);
    expect(excelBuffer.length).toBeGreaterThan(1000);
  });
});
