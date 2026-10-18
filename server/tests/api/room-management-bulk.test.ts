import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/schema';
import { getDatabase, closeDatabase } from '../../src/db/connection';
import { RoomService } from '../../src/services/room.service';

describe('Phase 4 — College Room Management by Block & Floor (25 Rooms/Floor)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getDatabase(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('provides hierarchy diagnostics reporting expected vs registered rooms for Block A, B, C', () => {
    const diag = RoomService.getRoomHierarchyDiagnostics();

    expect(diag.blocks).toContain('Block A');
    expect(diag.blocks).toContain('Block B');
    expect(diag.blocks).toContain('Block C');
    expect(diag.defaultRoomsPerFloor).toBe(25);
    expect(diag.defaultFloorsPerBlock).toBe(4);
    // 3 blocks * 4 floors * 25 rooms = 300 expected rooms
    expect(diag.totalExpectedRooms).toBe(300);
    expect(diag.totalRegisteredRooms).toBe(0);
  });

  it('previews bulk generation of 25 rooms for Block A Floor 1 with institutional numbering A-101 to A-125', () => {
    const preview = RoomService.bulkGeneratePreview({
      block: 'Block A',
      floor: 1,
      count: 25,
      prefix: 'A',
    });

    expect(preview.block).toBe('Block A');
    expect(preview.floor).toBe(1);
    expect(preview.totalProposed).toBe(25);
    expect(preview.newCount).toBe(25);
    expect(preview.alreadyExistsCount).toBe(0);
    expect(preview.proposedRooms.length).toBe(25);

    // Verify first and last room numbering
    expect(preview.proposedRooms[0].name).toBe('A-101');
    expect(preview.proposedRooms[24].name).toBe('A-125');
  });

  it('commits bulk generated rooms to database and avoids duplicates on repeated execution', () => {
    // Run 1: generate 25 rooms for Block A Floor 1
    const commit1 = RoomService.bulkGenerateCommit({
      block: 'Block A',
      floor: 1,
      count: 25,
      prefix: 'A',
    });

    expect(commit1.success).toBe(true);
    expect(commit1.createdCount).toBe(25);
    expect(commit1.skippedCount).toBe(0);

    const list1 = RoomService.list({ building: 'Block A', floor: 1 });
    expect(list1.total).toBe(25);

    // Run 2: repeat the exact same bulk generation on the same block and floor
    const commit2 = RoomService.bulkGenerateCommit({
      block: 'Block A',
      floor: 1,
      count: 25,
      prefix: 'A',
    });

    expect(commit2.success).toBe(true);
    // Crucial requirement: Do not create duplicate rooms when repeated
    expect(commit2.createdCount).toBe(0);
    expect(commit2.skippedCount).toBe(25);

    const list2 = RoomService.list({ building: 'Block A', floor: 1 });
    expect(list2.total).toBe(25);
  });

  it('supports safe room deactivation without destroying audit logs', () => {
    const room = RoomService.create({
      id: 'RM-B101',
      name: 'B-101',
      building: 'Block B',
      floor: 1,
      capacity: 30,
      active: true,
    });

    expect(room.active).toBe(true);

    const deactivated = RoomService.deactivate('RM-B101');
    expect(deactivated.active).toBe(false);

    const fetched = RoomService.getById('RM-B101');
    expect(fetched?.active).toBe(false);
  });

  it('prevents destructive deletion of rooms referenced by examination assignments', () => {
    const room = RoomService.create({
      id: 'RM-C101',
      name: 'C-101',
      building: 'Block C',
      floor: 1,
      capacity: 30,
      active: true,
    });

    // Simulate an assignment linked to this room
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO examinations (id, name, academic_year, start_date, end_date, session_config, status, created_at, updated_at)
      VALUES ('EXAM-REF-1', 'Midterms', '2026-2027', '2026-11-01', '2026-11-02', '[]', 'UPCOMING', ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO faculty (id, name, email, department, designation, active, created_at, updated_at)
      VALUES ('FAC-REF-1', 'Prof One', 'one@test.edu', 'CSE', 'AP', 1, ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO schedules (id, examination_id, version, revision_number, state, counter, created_at, updated_at)
      VALUES ('SCHED-REF-1', 'EXAM-REF-1', 1, 0, 'APPROVED', 1, ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
      VALUES ('ASGN-REF-1', 'SCHED-REF-1', '2026-11-01', 'Morning', 'RM-C101', 'FAC-REF-1', 'SCHEDULED', ?, ?)
    `).run(now, now);

    // Deletion check must report not deletable
    const check = RoomService.checkDeletable('RM-C101');
    expect(check.canDelete).toBe(false);
    expect(check.assignmentCount).toBeGreaterThan(0);

    expect(() => {
      RoomService.delete('RM-C101');
    }).toThrow(/referenced in \d+ duty assignment/);
  });
});
