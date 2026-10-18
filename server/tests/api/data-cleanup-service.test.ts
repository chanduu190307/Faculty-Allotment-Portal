import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/schema';
import { getDatabase, closeDatabase } from '../../src/db/connection';
import { CleanupService } from '../../src/services/cleanup.service';

describe('Phase 1 & 3 — Data Cleanup Safety & Safe Reset Service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getDatabase(':memory:');
    runMigrations(db);

    const now = new Date().toISOString();

    // Insert legitimate faculty
    db.prepare(`
      INSERT INTO faculty (id, name, email, department, designation, active, created_at, updated_at)
      VALUES ('FAC-INST-001', 'Dr. Ramesh Kumar', 'ramesh@custom-domain.org', 'CSE', 'Professor', 1, '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')
    `).run();

    // Insert unwanted demo seed faculty (pattern: FAC-XXX with @institution.edu domain)
    db.prepare(`
      INSERT INTO faculty (id, name, email, department, designation, active, created_at, updated_at)
      VALUES ('FAC-001', 'Alice Demo Teacher', 'demo.alice@institution.edu', 'TEST_DEPT', 'Instructor', 1, '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z')
    `).run();

    // Insert legitimate room
    db.prepare(`
      INSERT INTO rooms (id, name, building, floor, capacity, active, created_at, updated_at)
      VALUES ('RM-A101', 'A-101', 'Block A', 1, 30, 1, '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')
    `).run();

    // Insert unwanted demo room (pattern: RM-DEMO-* or standard seed pattern)
    db.prepare(`
      INSERT INTO rooms (id, name, building, floor, capacity, active, created_at, updated_at)
      VALUES ('RM-DEMO-99', 'Demo Room 99', 'Block Demo', 1, 10, 1, '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z')
    `).run();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('generates a deletion preview identifying unwanted demo records with provenance reasons', () => {
    const preview = CleanupService.getDeletionPreview();

    expect(preview.facultyDemoSeed).toBeGreaterThanOrEqual(1);
    expect(preview.facultySafeToDelete).toBeGreaterThanOrEqual(1);

    const demoFac = preview.candidates.find((c) => c.id === 'FAC-001');
    expect(demoFac).toBeDefined();
    expect(demoFac?.safeToDelete).toBe(true);
    expect(demoFac?.classification).toBe('DEMO_SEED');

    // Legitimate records must be classified as USER_CREATED or UNCERTAIN and preserved
    const realFac = preview.candidates.find((c) => c.id === 'FAC-INST-001');
    expect(realFac).toBeDefined();
    expect(realFac?.classification).toBe('USER_CREATED');
    expect(realFac?.safeToDelete).toBe(false);
  });

  it('protects demo records with active schedule assignments from destructive deletion', () => {
    const now = new Date().toISOString();

    // Link demo faculty to an assignment
    db.prepare(`
      INSERT INTO examinations (id, name, academic_year, start_date, end_date, session_config, status, created_at, updated_at)
      VALUES ('EXAM-01', 'Finals', '2026-2027', '2026-11-01', '2026-11-02', '[]', 'UPCOMING', ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO schedules (id, examination_id, version, revision_number, state, counter, created_at, updated_at)
      VALUES ('SCHED-01', 'EXAM-01', 1, 0, 'APPROVED', 1, ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
      VALUES ('ASGN-01', 'SCHED-01', '2026-11-01', 'Morning', 'RM-A101', 'FAC-001', 'SCHEDULED', ?, ?)
    `).run(now, now);

    const preview = CleanupService.getDeletionPreview();
    const demoFac = preview.candidates.find((c) => c.id === 'FAC-001');
    expect(demoFac).toBeDefined();
    expect(demoFac?.safeToDelete).toBe(false);
    expect(demoFac?.assignmentCount).toBe(1);
    expect(demoFac?.approvedAssignmentCount).toBe(1);
  });

  it('atomically removes only confirmed safe unwanted records and logs an audit entry', () => {
    const result = CleanupService.executeSafeCleanup('Security Admin');

    expect(result.success).toBe(true);
    expect(result.facultyDeletedCount).toBeGreaterThanOrEqual(1);

    // Verify demo faculty is removed
    const demoFac = db.prepare('SELECT id FROM faculty WHERE id = ?').get('FAC-001');
    expect(demoFac).toBeUndefined();

    // Legitimate records must remain completely intact
    const realFac = db.prepare('SELECT id FROM faculty WHERE id = ?').get('FAC-INST-001');
    expect(realFac).toBeDefined();

    const realRoom = db.prepare('SELECT id FROM rooms WHERE id = ?').get('RM-A101');
    expect(realRoom).toBeDefined();

    // Audit log entry was created
    const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'DELETE_DEMO_CLEANUP'").get() as any;
    expect(audit).toBeDefined();
    expect(audit.actor).toBe('Security Admin');
  });

  it('institutional reset strictly requires confirmation code and logs backup', () => {
    // Missing or invalid code fails
    expect(() => {
      CleanupService.resetDatabaseToCleanInstitutional('WRONG_CODE', 'Admin');
    }).toThrow(/Invalid confirmation token/);

    // Valid code resets database
    const resetResult = CleanupService.resetDatabaseToCleanInstitutional('RESET_DATABASE_CONFIRMED', 'Admin');
    expect(resetResult.success).toBe(true);
    expect(resetResult.backupPath).toBeDefined();

    const facultyCount = (db.prepare('SELECT count(*) as count FROM faculty').get() as any).count;
    expect(facultyCount).toBe(0);

    const auditCount = (db.prepare('SELECT count(*) as count FROM audit_logs').get() as any).count;
    expect(auditCount).toBeGreaterThan(0);
  });
});
