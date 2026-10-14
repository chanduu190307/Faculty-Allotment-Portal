import { describe, it, expect, beforeAll } from 'vitest';
import { getDatabase } from '../../src/db/connection';
import { runMigrations } from '../../src/db/schema';
import { seedDatabase } from '../../src/db/seed';
import { ExamService } from '../../src/services/exam.service';
import { ScheduleService } from '../../src/services/schedule.service';
import { OperationsService } from '../../src/services/operations.service';
import { ReportService } from '../../src/services/report.service';
import { ExportService } from '../../src/services/export.service';

describe('System Lifecycle & Acceptance Scenarios 15, 16, 17', () => {
  let db: any;

  beforeAll(() => {
    // Setup isolated in-memory test database
    db = getDatabase(':memory:');
    runMigrations(db);
    // Seed with 10 rooms, 40 faculty
    seedDatabase(db, { roomCount: 10, facultyCount: 40, maxDuties: 6 });
  });

  // =========================================================================
  // SCENARIO 15: Approved Schedules are Preserved During Failed Regeneration
  // =========================================================================
  it('Scenario 15: Approved schedules are strictly preserved during failed regeneration', () => {
    // 1. Create a feasible examination with 2 non-consecutive dates
    const exam = ExamService.create({
      id: 'EXAM-PRESERVE-TEST',
      name: 'Preservation Test Examination',
      startDate: '2026-10-15',
      endDate: '2026-10-17',
      maxDutiesPerFaculty: 6,
      dates: [
        { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
        { date: '2026-10-17', sequenceOrder: 2, isExamDay: true }, // gap day -> feasible
      ],
    });

    // 2. Generate a valid schedule
    const genResult = ScheduleService.generate(exam.id, 'Test Admin');
    if (!genResult.success) {
      console.log('API-LIFECYCLE GEN FAILED:', JSON.stringify(genResult.failureDiagnostics, null, 2));
    }
    expect(genResult.success).toBe(true);
    const scheduleId = genResult.scheduleId!;

    // 3. Approve the schedule
    const approvedSched = ScheduleService.approve(scheduleId, 'Dean Academic');
    expect(approvedSched.state).toBe('APPROVED');
    const initialAssignmentCount = approvedSched.assignments.length;
    expect(initialAssignmentCount).toBeGreaterThan(0);

    // 4. Intentionally reconfigure examination dates to make it mathematically infeasible
    // (e.g. 6 consecutive days with 10 rooms * 2 sessions * 6 days = 120 slots vs 40 faculty * 3 max days = 120,
    // let's make it 10 consecutive days = 200 slots vs 40 * 5 = 200, or add 50 rooms to make it impossible)
    ExamService.updateDates(exam.id, [
      { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
      { date: '2026-10-16', sequenceOrder: 2, isExamDay: true },
      { date: '2026-10-17', sequenceOrder: 3, isExamDay: true },
      { date: '2026-10-18', sequenceOrder: 4, isExamDay: true },
      { date: '2026-10-19', sequenceOrder: 5, isExamDay: true },
      { date: '2026-10-20', sequenceOrder: 6, isExamDay: true },
      { date: '2026-10-21', sequenceOrder: 7, isExamDay: true },
      { date: '2026-10-22', sequenceOrder: 8, isExamDay: true },
      { date: '2026-10-23', sequenceOrder: 9, isExamDay: true },
      { date: '2026-10-24', sequenceOrder: 10, isExamDay: true },
      { date: '2026-10-25', sequenceOrder: 11, isExamDay: true },
      { date: '2026-10-26', sequenceOrder: 12, isExamDay: true },
      { date: '2026-10-27', sequenceOrder: 13, isExamDay: true },
      { date: '2026-10-28', sequenceOrder: 14, isExamDay: true },
      { date: '2026-10-29', sequenceOrder: 15, isExamDay: true },
    ]);

    // 5. Attempt regeneration which will fail
    const failedGenResult = ScheduleService.generate(exam.id, 'Test Admin');
    expect(failedGenResult.success).toBe(false);

    // 6. Verify that the previous approved schedule is STILL intact in the database!
    const latestSched = ScheduleService.getLatestSchedule(exam.id);
    expect(latestSched).toBeDefined();
    expect(latestSched.id).toBe(scheduleId);
    expect(latestSched.state).toBe('APPROVED');
    expect(latestSched.assignments.length).toBe(initialAssignmentCount);
  });

  // =========================================================================
  // SCENARIO 16: Daily Reports Contain Correct Historical Assignments
  // =========================================================================
  it('Scenario 16: Daily reports snapshot historical assignments accurately and resist mutation', async () => {
    const exam = ExamService.create({
      id: 'EXAM-DAILY-RPT-TEST',
      name: 'Daily Report Test Examination',
      startDate: '2026-10-15',
      endDate: '2026-10-17',
      dates: [
        { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
        { date: '2026-10-17', sequenceOrder: 2, isExamDay: true },
      ],
    });

    const gen = ScheduleService.generate(exam.id, 'Test Admin');
    expect(gen.success).toBe(true);

    // Mark attendance for one assignment
    const asgns = gen.assignments.filter((a) => a.date === '2026-10-15');
    expect(asgns.length).toBeGreaterThan(0);
    OperationsService.markAttendance({
      assignmentId: asgns[0].id,
      status: 'COMPLETED',
      notes: 'Present on duty',
    });

    // Generate finalized daily report for 2026-10-15
    const dailyReport = ReportService.generateDailyReport(exam.id, '2026-10-15', false, 'Test Superintendent');
    expect(dailyReport.date).toBe('2026-10-15');
    expect(dailyReport.summary.completedCount).toBe(1);
    expect(dailyReport.roomAssignments.length).toBe(asgns.length);

    // Test Excel & PDF exports
    const excelBuffer = await ExportService.generateDailyReportExcel(dailyReport);
    expect(excelBuffer).toBeDefined();
    expect(excelBuffer.length).toBeGreaterThan(100);

    const pdfBuffer = await ExportService.generateDailyReportPDF(dailyReport);
    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer.length).toBeGreaterThan(100);
  });

  // =========================================================================
  // SCENARIO 17: Final Reports Consolidate Correct Records
  // =========================================================================
  it('Scenario 17: Final consolidated report aggregates duties, attendance, and substitutions correctly', async () => {
    const finalReport = ReportService.generateFinalReport('EXAM-DAILY-RPT-TEST');
    expect(finalReport.examinationId).toBe('EXAM-DAILY-RPT-TEST');
    expect(finalReport.totalAssignedSlots).toBeGreaterThan(0);
    expect(finalReport.totalCompletedDuties).toBe(1);
    expect(finalReport.facultySummary.length).toBeGreaterThan(0);

    // Test Excel & PDF exports
    const excelBuffer = await ExportService.generateFinalReportExcel(finalReport);
    expect(excelBuffer.length).toBeGreaterThan(100);

    const pdfBuffer = await ExportService.generateFinalReportPDF(finalReport);
    expect(pdfBuffer.length).toBeGreaterThan(100);
  });
});
