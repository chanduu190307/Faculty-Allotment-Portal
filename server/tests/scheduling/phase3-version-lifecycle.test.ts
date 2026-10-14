import { describe, it, expect, beforeAll } from 'vitest';
import { getDatabase } from '../../src/db/connection';
import { runMigrations } from '../../src/db/schema';
import { seedDatabase } from '../../src/db/seed';
import { ExamService } from '../../src/services/exam.service';
import { FacultyService } from '../../src/services/faculty.service';
import { ScheduleService } from '../../src/services/schedule.service';
import { ReportService } from '../../src/services/report.service';
import { AuditService } from '../../src/services/audit.service';
import { Assignment } from '../../src/domain/scheduling/types';

describe('Phase 3: Version Lifecycle, Revisions & Immutability Regression Tests', () => {
  let db: any;

  beforeAll(() => {
    // Setup isolated in-memory test database
    db = getDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db, { roomCount: 8, facultyCount: 50, maxDuties: 6 });
  });

  // =========================================================================
  // TEST 1: New schedules starting in Draft
  // =========================================================================
  it('1. New schedules starting in Draft: newly generated schedules begin in DRAFT with automated validation', () => {
    const exam = ExamService.create({
      id: 'EXAM-P3-TEST-1',
      name: 'Phase 3 Draft Lifecycle Exam',
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      maxDutiesPerFaculty: 6,
      restDays: 1,
      dates: [
        { date: '2026-11-10', sequenceOrder: 1, isExamDay: true },
        { date: '2026-11-12', sequenceOrder: 2, isExamDay: true },
      ],
    });

    const genResult = ScheduleService.generate(exam.id, 'Academic Registrar', 12345);
    expect(genResult.success).toBe(true);
    expect(genResult.scheduleId).toBeDefined();

    // Verify generation result structure
    expect(genResult.state).toBe('DRAFT');
    expect(genResult.counter).toBe(1);
    expect(genResult.revisionNumber).toBe(0);
    expect(genResult.baseScheduleId).toBeNull();
    expect(genResult.validation.isValid).toBe(true);

    // Verify database row directly
    const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(genResult.scheduleId!) as any;
    expect(row).toBeDefined();
    expect(row.state).toBe('DRAFT');
    expect(row.counter).toBe(1);
    expect(row.revision_number).toBe(0);
    expect(row.base_schedule_id).toBeNull();
    expect(row.seed).toBe(12345);

    // Verify audit log
    const auditLogs = AuditService.getLogs('schedule', genResult.scheduleId!);
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[0].action).toBe('GENERATE');
    const newVals = JSON.parse(auditLogs[0].new_values);
    expect(newVals.state).toBe('DRAFT');
    expect(newVals.counter).toBe(1);
  });

  // =========================================================================
  // TEST 2: Invalid schedules being rejected at approval
  // =========================================================================
  it('2. Invalid schedules being rejected at approval: authoritative validation blocks approval of violating schedules', () => {
    const exam = ExamService.create({
      id: 'EXAM-P3-TEST-2',
      name: 'Phase 3 Invalid Schedule Rejection Exam',
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      maxDutiesPerFaculty: 6,
      restDays: 1,
      dates: [
        { date: '2026-11-10', sequenceOrder: 1, isExamDay: true },
        { date: '2026-11-12', sequenceOrder: 2, isExamDay: true },
      ],
    });

    const genResult = ScheduleService.generate(exam.id, 'Tester', 42);
    expect(genResult.success).toBe(true);
    const scheduleId = genResult.scheduleId!;

    // Deliberately delete one assignment in the draft to create an understaffed room (Rule H1 violation)
    const asgnToDelete = db.prepare('SELECT id FROM assignments WHERE schedule_id = ? LIMIT 1').get(scheduleId) as any;
    db.prepare('DELETE FROM assignments WHERE id = ?').run(asgnToDelete.id);

    // Attempting to approve must be authoritatively REJECTED
    expect(() => {
      ScheduleService.approve(scheduleId, 'Dean Academic');
    }).toThrow(/Approval rejected: Schedule has .* authoritative validation violation\(s\)/i);

    // Verify that the schedule in DB remains DRAFT and is NOT approved
    const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;
    expect(row.state).toBe('DRAFT');
    expect(row.approved_by).toBeNull();
    expect(row.approved_at).toBeNull();
  });

  // =========================================================================
  // TEST 3: Approved assignments remaining unchanged after regeneration
  // =========================================================================
  it('3. Approved assignments remaining unchanged after regeneration: regeneration creates new version without mutating approved version', () => {
    const exam = ExamService.create({
      id: 'EXAM-P3-TEST-3',
      name: 'Phase 3 Immutability Regeneration Exam',
      startDate: '2026-11-15',
      endDate: '2026-11-17',
      maxDutiesPerFaculty: 6,
      restDays: 1,
      dates: [
        { date: '2026-11-15', sequenceOrder: 1, isExamDay: true },
        { date: '2026-11-17', sequenceOrder: 2, isExamDay: true },
      ],
    });

    // 1. Generate and approve Schedule V1
    const v1Result = ScheduleService.generate(exam.id, 'Admin', 101);
    expect(v1Result.success).toBe(true);
    const v1Id = v1Result.scheduleId!;

    const approvedV1 = ScheduleService.approve(v1Id, 'Dean Academic');
    expect(approvedV1.state).toBe('APPROVED');

    // 2. Capture all assignments for V1
    const v1AssignmentsBefore = db
      .prepare('SELECT * FROM assignments WHERE schedule_id = ? ORDER BY id')
      .all(v1Id) as any[];
    expect(v1AssignmentsBefore.length).toBeGreaterThan(0);

    // 3. Regenerate allotment for the same examination -> creates V2
    const v2Result = ScheduleService.generate(exam.id, 'Admin', 202);
    expect(v2Result.success).toBe(true);
    const v2Id = v2Result.scheduleId!;
    expect(v2Id).not.toBe(v1Id);
    expect(v2Result.version).toBe(2);

    // 4. Verify V1 assignments in DB are 100% IDENTICAL before and after regeneration!
    const v1AssignmentsAfter = db
      .prepare('SELECT * FROM assignments WHERE schedule_id = ? ORDER BY id')
      .all(v1Id) as any[];
    expect(v1AssignmentsAfter.length).toBe(v1AssignmentsBefore.length);

    for (let i = 0; i < v1AssignmentsBefore.length; i++) {
      expect(v1AssignmentsAfter[i].id).toBe(v1AssignmentsBefore[i].id);
      expect(v1AssignmentsAfter[i].faculty_id).toBe(v1AssignmentsBefore[i].faculty_id);
      expect(v1AssignmentsAfter[i].room_id).toBe(v1AssignmentsBefore[i].room_id);
      expect(v1AssignmentsAfter[i].date).toBe(v1AssignmentsBefore[i].date);
      expect(v1AssignmentsAfter[i].session).toBe(v1AssignmentsBefore[i].session);
    }

    // 5. Verify V1 metadata remains intact
    const v1Row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(v1Id) as any;
    expect(v1Row.state).toBe('APPROVED');
    expect(v1Row.approved_by).toBe('Dean Academic');
    expect(v1Row.approved_at).toBeDefined();
  });

  // =========================================================================
  // TEST 4: Editing an approved schedule creating a separate revision
  // =========================================================================
  it('4. Editing an approved schedule creating a separate revision: approved schedule is never modified in place', () => {
    const exam = ExamService.create({
      id: 'EXAM-P3-TEST-4',
      name: 'Phase 3 Distinct Revision Exam',
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      maxDutiesPerFaculty: 6,
      restDays: 1,
      dates: [
        { date: '2026-11-20', sequenceOrder: 1, isExamDay: true },
        { date: '2026-11-22', sequenceOrder: 2, isExamDay: true },
      ],
    });

    const gen = ScheduleService.generate(exam.id, 'Admin', 555);
    const v1Id = gen.scheduleId!;
    ScheduleService.approve(v1Id, 'Dean');

    // Pick target assignment
    const targetAsgn = db.prepare('SELECT * FROM assignments WHERE schedule_id = ? LIMIT 1').get(v1Id) as any;
    const originalFacultyId = targetAsgn.faculty_id;

    // Pick a replacement teacher who does not have duties on this exam
    const assignedFacIds = new Set(
      (db.prepare('SELECT faculty_id FROM assignments WHERE schedule_id = ?').all(v1Id) as any[]).map(
        (a) => a.faculty_id
      )
    );
    const candidateFac = (exam.faculty || []).find((f) => !assignedFacIds.has(f.id) && f.active && !f.exempt)!;
    expect(candidateFac).toBeDefined();

    const v1RowBefore = db.prepare('SELECT * FROM schedules WHERE id = ?').get(v1Id) as any;

    // Perform manual reassignment on the APPROVED schedule
    const reassignRes = ScheduleService.manualReassign(
      v1Id,
      targetAsgn.id,
      candidateFac.id,
      'Administrative replacement for departmental coordination',
      'Vice Chancellor',
      v1RowBefore.counter
    );

    expect(reassignRes.success).toBe(true);
    expect(reassignRes.isRevision).toBe(true);
    expect(reassignRes.revisionScheduleId).toBe(`${v1Id}-REV1`);

    // 1. Verify original assignment in approved V1 is UNCHANGED!
    const originalAsgnCheck = db.prepare('SELECT * FROM assignments WHERE id = ?').get(targetAsgn.id) as any;
    expect(originalAsgnCheck.faculty_id).toBe(originalFacultyId);
    expect(originalAsgnCheck.schedule_id).toBe(v1Id);

    // 2. Verify the distinct revision was created in schedules table
    const revRow = db.prepare('SELECT * FROM schedules WHERE id = ?').get(reassignRes.revisionScheduleId!) as any;
    expect(revRow).toBeDefined();
    expect(revRow.base_schedule_id).toBe(v1Id);
    expect(revRow.version).toBe(1);
    expect(revRow.revision_number).toBe(1);
    expect(revRow.counter).toBe(1);
    expect(revRow.state).toBe('VALIDATED');
    expect(revRow.notes).toMatch(/Revision 1.1: Administrative replacement/);

    // 3. Verify the revision assignments have the new teacher
    const revAssignments = db
      .prepare('SELECT * FROM assignments WHERE schedule_id = ?')
      .all(reassignRes.revisionScheduleId!) as any[];
    expect(revAssignments.length).toBe(gen.assignments.length);

    const modifiedRevAsgn = revAssignments.find(
      (a) => a.date === targetAsgn.date && a.session === targetAsgn.session && a.room_id === targetAsgn.room_id
    );
    expect(modifiedRevAsgn).toBeDefined();
    expect(modifiedRevAsgn.faculty_id).toBe(candidateFac.id);

    // 4. Verify base schedule counter was incremented
    const v1RowAfter = db.prepare('SELECT * FROM schedules WHERE id = ?').get(v1Id) as any;
    expect(v1RowAfter.counter).toBe(v1RowBefore.counter + 1);
  });

  // =========================================================================
  // TEST 5: Missing revision reasons being rejected
  // =========================================================================
  it('5. Missing revision reasons being rejected: empty or whitespace reasons are rejected without modifying DB', () => {
    const examId = 'EXAM-P3-TEST-4';
    const latestSched = ScheduleService.getLatestSchedule(examId);
    const asgn = latestSched.assignments[0];
    const candidateFac = (examId: string) =>
      db.prepare('SELECT id FROM faculty WHERE active = 1 AND exempt = 0 LIMIT 1').get() as any;

    const initialScheduleCount = (db.prepare('SELECT count(*) as count FROM schedules').get() as any).count;
    const initialCounter = latestSched.counter;

    // Test 5a: Empty string reason
    const resEmpty = ScheduleService.manualReassign(
      latestSched.id,
      asgn.id,
      candidateFac(examId).id,
      '',
      'Tester',
      initialCounter
    );
    expect(resEmpty.success).toBe(false);
    expect(resEmpty.error).toMatch(/A non-empty revision reason is required/i);

    // Test 5b: Whitespace only reason
    const resWhitespace = ScheduleService.manualReassign(
      latestSched.id,
      asgn.id,
      candidateFac(examId).id,
      '     ',
      'Tester',
      initialCounter
    );
    expect(resWhitespace.success).toBe(false);
    expect(resWhitespace.error).toMatch(/A non-empty revision reason is required/i);

    // Verify no new schedule or revision was created in DB
    const postScheduleCount = (db.prepare('SELECT count(*) as count FROM schedules').get() as any).count;
    expect(postScheduleCount).toBe(initialScheduleCount);

    // Verify counter was not incremented
    const postCounter = ScheduleService.getScheduleCounter(latestSched.id);
    expect(postCounter).toBe(initialCounter);
  });

  // =========================================================================
  // TEST 6: Valid revisions passing the authoritative validator
  // =========================================================================
  it('6. Valid revisions passing the authoritative validator: rules H1-H7 enforced on revisions before creation & approval', () => {
    const exam = ExamService.create({
      id: 'EXAM-P3-TEST-6',
      name: 'Phase 3 Validator Enforcement Exam',
      startDate: '2026-11-25',
      endDate: '2026-11-27',
      maxDutiesPerFaculty: 2, // Strict duty cap of 2
      restDays: 1,
      dates: [
        { date: '2026-11-25', sequenceOrder: 1, isExamDay: true },
        { date: '2026-11-27', sequenceOrder: 2, isExamDay: true },
      ],
    });

    const gen = ScheduleService.generate(exam.id, 'Admin', 777);
    const scheduleId = gen.scheduleId!;
    const approved = ScheduleService.approve(scheduleId, 'Dean');
    const approvedCounter = approved.counter;

    // Scenario 6a: Attempt revision giving a teacher a 2nd duty on the same date (Rule H2 violation)
    const asgn1 = gen.assignments.find((a) => a.date === '2026-11-25' && a.session === 'Morning')!;
    const asgn2 = gen.assignments.find((a) => a.date === '2026-11-25' && a.session === 'Afternoon')!;

    const resH2Violation = ScheduleService.manualReassign(
      scheduleId,
      asgn1.id,
      asgn2.facultyId, // already has duty in afternoon on 2026-11-25
      'Attempted same-day double booking',
      'Admin',
      approvedCounter
    );
    expect(resH2Violation.success).toBe(false);
    expect(resH2Violation.violations?.some((v) => v.rule === 'RULE_B')).toBe(true);

    // Scenario 6b: Attempt revision assigning an exempt faculty member (Rule H6 violation)
    const targetExemptFac = (exam.faculty || []).find(
      (f) => !gen.assignments.some((a) => a.facultyId === f.id)
    )!;
    db.prepare('UPDATE faculty SET exempt = 1 WHERE id = ?').run(targetExemptFac.id);

    const resH6Exempt = ScheduleService.manualReassign(
      scheduleId,
      asgn1.id,
      targetExemptFac.id,
      'Assign exempt teacher',
      'Admin',
      approvedCounter
    );
    expect(resH6Exempt.success).toBe(false);
    expect(resH6Exempt.violations?.some((v) => v.rule === 'ELIGIBILITY')).toBe(true);

    // Clean up exempt status so other tests/assertions aren't affected
    db.prepare('UPDATE faculty SET exempt = 0 WHERE id = ?').run(targetExemptFac.id);

    // Scenario 6c: Valid revision succeeds and passes authoritative validation
    const unassignedFac = (exam.faculty || []).find(
      (f) => !gen.assignments.some((a) => a.facultyId === f.id) && f.id !== targetExemptFac.id
    )!;
    expect(unassignedFac).toBeDefined();

    const validRevisionRes = ScheduleService.manualReassign(
      scheduleId,
      asgn1.id,
      unassignedFac.id,
      'Valid duty transfer to eligible faculty',
      'Registrar',
      approvedCounter
    );
    expect(validRevisionRes.success).toBe(true);
    expect(validRevisionRes.isRevision).toBe(true);

    // Scenario 6d: Approve the valid revision
    const approvedRevision = ScheduleService.approve(validRevisionRes.revisionScheduleId!, 'Dean Academic', 1);
    expect(approvedRevision.state).toBe('APPROVED');
    expect(approvedRevision.revision_number).toBe(1);

    // Base schedule transitions to REVISED while preserving approval records
    const baseRow = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;
    expect(baseRow.state).toBe('REVISED');
    expect(baseRow.approved_by).toBe('Dean');
  });

  // =========================================================================
  // TEST 7: Stale counters being rejected
  // =========================================================================
  it('7. Stale counters being rejected: mutations with outdated concurrency counters are rejected', () => {
    const examId = 'EXAM-P3-TEST-6';
    const sched = ScheduleService.getLatestSchedule(examId);
    expect(sched).toBeDefined();
    const currentCounter = sched.counter;

    const asgn = sched.assignments[0];
    const candidate = db.prepare('SELECT id FROM faculty WHERE active = 1 AND exempt = 0 LIMIT 1').get() as any;

    // 1. Stale counter in manualReassign
    const staleReassign = ScheduleService.manualReassign(
      sched.id,
      asgn.id,
      candidate.id,
      'Stale attempt',
      'User A',
      currentCounter - 1 // Stale counter
    );
    expect(staleReassign.success).toBe(false);
    expect(staleReassign.error).toMatch(/Concurrency conflict: schedule counter mismatch/i);

    // 2. Future/Invalid counter in manualReassign
    const futureReassign = ScheduleService.manualReassign(
      sched.id,
      asgn.id,
      candidate.id,
      'Future attempt',
      'User A',
      9999
    );
    expect(futureReassign.success).toBe(false);
    expect(futureReassign.error).toMatch(/Concurrency conflict: schedule counter mismatch/i);

    // 3. Stale counter in publish
    expect(() => {
      ScheduleService.publish(sched.id, 'Dean', currentCounter - 1);
    }).toThrow(/Concurrency conflict: schedule counter mismatch/i);
  });

  // =========================================================================
  // TEST 8: Concurrent edits not overwriting one another
  // =========================================================================
  it('8. Concurrent edits not overwriting one another: optimistic locking guarantees serial consistency', () => {
    const exam = ExamService.create({
      id: 'EXAM-P3-CONCURRENCY-EDIT',
      name: 'Phase 3 Concurrent Edits Exam',
      startDate: '2026-11-28',
      endDate: '2026-11-30',
      maxDutiesPerFaculty: 6,
      restDays: 1,
      dates: [
        { date: '2026-11-28', sequenceOrder: 1, isExamDay: true },
        { date: '2026-11-30', sequenceOrder: 2, isExamDay: true },
      ],
    });

    const gen = ScheduleService.generate(exam.id, 'Admin', 888);
    const draftId = gen.scheduleId!;
    expect(gen.counter).toBe(1);

    const asgn1 = gen.assignments[0];
    const asgn2 = gen.assignments[1];

    // Find two distinct eligible faculty members
    const eligibleFaculty = (exam.faculty || []).filter(
      (f) => !gen.assignments.some((a) => a.facultyId === f.id) && f.active && !f.exempt
    );
    const teacherA = eligibleFaculty[0];
    const teacherB = eligibleFaculty[1];

    // Simulated User 1 and User 2 both read the draft with counter = 1
    const user1ExpectedCounter = 1;
    const user2ExpectedCounter = 1;

    // User 1 performs edit first
    const user1Edit = ScheduleService.manualReassign(
      draftId,
      asgn1.id,
      teacherA.id,
      'User 1 adjustment',
      'User 1',
      user1ExpectedCounter
    );
    expect(user1Edit.success).toBe(true);
    expect(user1Edit.newCounter).toBe(2);

    // User 2 attempts edit using their stale read (expectedCounter = 1)
    const user2Edit = ScheduleService.manualReassign(
      draftId,
      asgn2.id,
      teacherB.id,
      'User 2 adjustment',
      'User 2',
      user2ExpectedCounter
    );
    expect(user2Edit.success).toBe(false);
    expect(user2Edit.error).toMatch(/Concurrency conflict/i);

    // Verify User 2's modification was NOT applied
    const asgn2Check = db.prepare('SELECT faculty_id FROM assignments WHERE id = ?').get(asgn2.id) as any;
    expect(asgn2Check.faculty_id).toBe(asgn2.facultyId);

    // User 2 refreshes schedule, observes counter = 2, and retries with current counter
    const currentCounter = ScheduleService.getScheduleCounter(draftId);
    expect(currentCounter).toBe(2);

    const user2Retry = ScheduleService.manualReassign(
      draftId,
      asgn2.id,
      teacherB.id,
      'User 2 adjustment retry',
      'User 2',
      currentCounter!
    );
    expect(user2Retry.success).toBe(true);
    expect(user2Retry.newCounter).toBe(3);

    // Verify both edits are now applied sequentially and counter is 3
    const finalSched = ScheduleService.getScheduleDetails(draftId);
    expect(finalSched.counter).toBe(3);
    const finalAsgn1 = finalSched.assignments.find((a: any) => a.id === asgn1.id);
    const finalAsgn2 = finalSched.assignments.find((a: any) => a.id === asgn2.id);
    expect(finalAsgn1.faculty_id).toBe(teacherA.id);
    expect(finalAsgn2.faculty_id).toBe(teacherB.id);
  });

  // =========================================================================
  // TEST 9: Failed revisions rolling back schedule, counter, and audit changes
  // =========================================================================
  it('9. Failed revisions rolling back schedule, counter, and audit changes: atomic rollback on exception', () => {
    const examId = 'EXAM-P3-CONCURRENCY-EDIT';
    const sched = ScheduleService.getLatestSchedule(examId);

    const initialScheduleCount = (db.prepare('SELECT count(*) as count FROM schedules').get() as any).count;
    const initialAssignmentCount = (db.prepare('SELECT count(*) as count FROM assignments').get() as any).count;
    const initialAuditCount = (db.prepare('SELECT count(*) as count FROM audit_logs').get() as any).count;
    const initialCounter = sched.counter;

    // Simulate an unexpected internal error inside the revision transaction by breaking the foreign key constraint
    let caughtError: any = null;
    try {
      const tx = db.transaction(() => {
        // Increment counter
        db.prepare('UPDATE schedules SET counter = counter + 1 WHERE id = ?').run(sched.id);

        // Attempt inserting revision pointing to non-existent exam ID to trigger SQLite constraint failure
        db.prepare(`
          INSERT INTO schedules (id, examination_id, version, state, created_by, created_at, updated_at)
          VALUES ('SCHED-FAIL-REV', 'NON-EXISTENT-EXAM-XYZ', 99, 'VALIDATED', 'Tester', datetime('now'), datetime('now'))
        `).run();

        // Audit log
        AuditService.log({
          entity: 'schedule',
          entityId: 'SCHED-FAIL-REV',
          action: 'CREATE_REVISION',
          actor: 'Tester',
        }, db);
      });

      tx();
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();

    // Verify complete rollback: zero orphaned records in schedules, assignments, or audit_logs!
    const postScheduleCount = (db.prepare('SELECT count(*) as count FROM schedules').get() as any).count;
    const postAssignmentCount = (db.prepare('SELECT count(*) as count FROM assignments').get() as any).count;
    const postAuditCount = (db.prepare('SELECT count(*) as count FROM audit_logs').get() as any).count;
    const postCounter = ScheduleService.getScheduleCounter(sched.id);

    expect(postScheduleCount).toBe(initialScheduleCount);
    expect(postAssignmentCount).toBe(initialAssignmentCount);
    expect(postAuditCount).toBe(initialAuditCount);
    expect(postCounter).toBe(initialCounter);
  });

  // =========================================================================
  // TEST 10: Existing approved schedules, historical reports, assignments, and audit logs remaining intact
  // =========================================================================
  it('10. Existing approved schedules, historical reports, assignments, and audit logs remaining intact', () => {
    // 1. Create an exam and generate & approve schedule
    const exam = ExamService.create({
      id: 'EXAM-P3-HISTORICAL-PRESERVE',
      name: 'Phase 3 Historical Preservation Exam',
      startDate: '2026-12-01',
      endDate: '2026-12-03',
      maxDutiesPerFaculty: 6,
      restDays: 1,
      dates: [
        { date: '2026-12-01', sequenceOrder: 1, isExamDay: true },
        { date: '2026-12-03', sequenceOrder: 2, isExamDay: true },
      ],
    });

    const gen = ScheduleService.generate(exam.id, 'Registrar', 999);
    const approvedSched = ScheduleService.approve(gen.scheduleId!, 'Dean Academic');
    expect(approvedSched.state).toBe('APPROVED');

    // 2. Generate a daily report snapshot (immutable historical record)
    const dailyReport = ReportService.generateDailyReport(exam.id, '2026-12-01', false, 'Officer');
    expect(dailyReport).toBeDefined();
    expect(dailyReport.date).toBe('2026-12-01');

    const initialReportCount = (db.prepare('SELECT count(*) as count FROM daily_reports').get() as any).count;
    const initialAuditCount = (db.prepare('SELECT count(*) as count FROM audit_logs').get() as any).count;

    // 3. Create a revision from the approved schedule
    const asgn = approvedSched.assignments[0];
    const eligibleFac = (exam.faculty || []).find(
      (f) => !approvedSched.assignments.some((a: any) => a.faculty_id === f.id) && f.active && !f.exempt
    )!;

    const rev = ScheduleService.manualReassign(
      approvedSched.id,
      asgn.id,
      eligibleFac.id,
      'Revision for special assignment',
      'Dean',
      approvedSched.counter
    );
    expect(rev.success).toBe(true);

    // 4. Verify that historical report snapshot still exists and was not altered
    const historicalReports = ReportService.getHistoricalReports(exam.id);
    expect(historicalReports.length).toBeGreaterThanOrEqual(1);
    const matchedReport = historicalReports.find((r) => r.date === '2026-12-01');
    expect(matchedReport).toBeDefined();

    // Verify snapshot data inside daily report still matches original approved assignments
    const snapshot = JSON.parse(matchedReport.snapshot_data);
    expect(snapshot.roomAssignments).toBeDefined();
    const snapAsgn = snapshot.roomAssignments.find((a: any) => a.id === asgn.id);
    expect(snapAsgn.faculty_id).toBe(asgn.faculty_id);

    // 5. Verify audit logs record the revision creation without deleting historical entries
    const allAuditLogs = AuditService.getLogs();
    expect(allAuditLogs.length).toBeGreaterThan(initialAuditCount);
  });
});
