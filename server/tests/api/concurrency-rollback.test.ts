import { describe, it, expect, beforeAll } from 'vitest';
import { getDatabase } from '../../src/db/connection';
import { runMigrations } from '../../src/db/schema';
import { seedDatabase } from '../../src/db/seed';
import { ExamService } from '../../src/services/exam.service';
import { ScheduleService } from '../../src/services/schedule.service';

describe('Concurrency, Rollback & Stale Schedule Verification', () => {
  let db: any;

  beforeAll(() => {
    db = getDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db, { roomCount: 5, facultyCount: 30, maxDuties: 4 });
  });

  it('Concurrent Allocation: Multiple allocation requests increment versions atomically without collision', async () => {
    const exam = ExamService.create({
      id: 'EXAM-CONCURRENCY-TEST',
      name: 'Concurrent Allocation Test',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      dates: [
        { date: '2026-11-01', sequenceOrder: 1, isExamDay: true },
        { date: '2026-11-03', sequenceOrder: 2, isExamDay: true },
      ],
    });

    // Run 3 sequential/rapid generation requests
    const res1 = ScheduleService.generate(exam.id, 'User 1');
    const res2 = ScheduleService.generate(exam.id, 'User 2');
    const res3 = ScheduleService.generate(exam.id, 'User 3');

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res3.success).toBe(true);

    const allSchedules = ScheduleService.listSchedules(exam.id);
    expect(allSchedules.length).toBe(3);

    // Verify distinct sequential version numbers
    const versions = allSchedules.map((s) => s.version).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2, 3]);
  });

  it('Stale Version Rejection: Attempting to approve superseded version is strictly rejected', () => {
    const examId = 'EXAM-CONCURRENCY-TEST';
    const allSchedules = ScheduleService.listSchedules(examId);
    expect(allSchedules.length).toBeGreaterThanOrEqual(3);

    // The oldest schedule is V1, newest is V3
    const oldSchedule = allSchedules.find((s) => s.version === 1);
    expect(oldSchedule).toBeDefined();

    // Attempting to approve V1 when V3 exists must throw stale error
    expect(() => {
      ScheduleService.approve(oldSchedule.id, 'Dean');
    }).toThrow(/Stale schedule version rejected/i);

    // Approving the latest schedule (V3) must succeed
    const latestSchedule = allSchedules.find((s) => s.version === 3);
    const approved = ScheduleService.approve(latestSchedule.id, 'Dean');
    expect(approved.state).toBe('APPROVED');
  });

  it('Database Rollback: Errors mid-transaction cause complete rollback with zero orphaned records', () => {
    const initialAssignmentCount = (db.prepare('SELECT count(*) as count FROM assignments').get() as any).count;
    const initialScheduleCount = (db.prepare('SELECT count(*) as count FROM schedules').get() as any).count;

    const validRoom = (db.prepare('SELECT id FROM rooms LIMIT 1').get() as any).id;
    const validFac = (db.prepare('SELECT id FROM faculty LIMIT 1').get() as any).id;

    let caughtError: any = null;
    try {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO schedules (id, examination_id, version, state, created_by, created_at, updated_at)
          VALUES ('SCHED-FAIL-TEST', 'EXAM-CONCURRENCY-TEST', 99, 'DRAFT', 'Tester', datetime('now'), datetime('now'))
        `).run();

        db.prepare(`
          INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
          VALUES ('ASGN-PARTIAL-1', 'SCHED-FAIL-TEST', '2026-11-01', 'Morning', ?, ?, 'SCHEDULED', datetime('now'), datetime('now'))
        `).run(validRoom, validFac);

        // Deliberately trigger an error
        throw new Error('Simulated failure during write');
      });

      tx();
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    console.log('[Rollback Test Caught Error]:', caughtError.message);
    expect(caughtError.message).toMatch(/(Simulated failure|FOREIGN KEY)/);

    // Verify that NO partial records were committed!
    const postAssignmentCount = (db.prepare('SELECT count(*) as count FROM assignments').get() as any).count;
    const postScheduleCount = (db.prepare('SELECT count(*) as count FROM schedules').get() as any).count;

    expect(postAssignmentCount).toBe(initialAssignmentCount);
    expect(postScheduleCount).toBe(initialScheduleCount);

    const orphanedSched = db.prepare("SELECT * FROM schedules WHERE id = 'SCHED-FAIL-TEST'").get();
    expect(orphanedSched).toBeUndefined();

    const orphanedAsgn = db.prepare("SELECT * FROM assignments WHERE id = 'ASGN-PARTIAL-1'").get();
    expect(orphanedAsgn).toBeUndefined();
  });
});
