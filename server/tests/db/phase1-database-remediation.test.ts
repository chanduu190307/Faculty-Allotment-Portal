import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/schema';
import { getDatabase, closeDatabase } from '../../src/db/connection';
import { FacultyService } from '../../src/services/faculty.service';
import { RoomService } from '../../src/services/room.service';
import { ExamService } from '../../src/services/exam.service';
import { ScheduleService } from '../../src/services/schedule.service';

describe('Phase 1: Safe Database Remediation Tests', () => {
  describe('1. Clean Database Initialization', () => {
    it('initializes a fresh database with all Phase 1 columns and constraints', () => {
      const db = new Database(':memory:');
      runMigrations(db);

      // Verify PRAGMA table_info columns
      const facultyCols = db.prepare("PRAGMA table_info(faculty)").all() as any[];
      const exemptCol = facultyCols.find((c) => c.name === 'exempt');
      expect(exemptCol).toBeDefined();
      expect(exemptCol.type).toBe('INTEGER');
      expect(exemptCol.notnull).toBe(1);
      expect(exemptCol.dflt_value).toBe('0');

      const roomCols = db.prepare("PRAGMA table_info(rooms)").all() as any[];
      const examDeptCol = roomCols.find((c) => c.name === 'exam_department');
      expect(examDeptCol).toBeDefined();
      expect(examDeptCol.type).toBe('TEXT');
      expect(examDeptCol.notnull).toBe(0);

      const examCols = db.prepare("PRAGMA table_info(examinations)").all() as any[];
      const restDaysCol = examCols.find((c) => c.name === 'rest_days');
      expect(restDaysCol).toBeDefined();
      expect(restDaysCol.type).toBe('INTEGER');
      expect(restDaysCol.notnull).toBe(1);
      expect(restDaysCol.dflt_value).toBe('1');

      const schedCols = db.prepare("PRAGMA table_info(schedules)").all() as any[];
      const seedCol = schedCols.find((c) => c.name === 'seed');
      expect(seedCol).toBeDefined();
      expect(seedCol.type).toBe('INTEGER');
      expect(seedCol.notnull).toBe(0);

      const counterCol = schedCols.find((c) => c.name === 'counter');
      expect(counterCol).toBeDefined();
      expect(counterCol.type).toBe('INTEGER');
      expect(counterCol.notnull).toBe(1);
      expect(counterCol.dflt_value).toBe('1');

      // Verify partial unique index
      const indexes = db.prepare("PRAGMA index_list(assignments)").all() as any[];
      const h2Index = indexes.find((i) => i.name === 'idx_assignments_unique_daily_teacher');
      expect(h2Index).toBeDefined();
      expect(h2Index.unique).toBe(1);

      db.close();
    });
  });

  describe('2. Legacy Database Upgrade & Data Preservation', () => {
    it('seamlessly upgrades legacy database preserving 100% of rows and relationships', () => {
      const db = new Database(':memory:');

      // Create pre-migration legacy schema without the 5 Phase 1 columns
      db.exec(`
        CREATE TABLE faculty (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          department TEXT NOT NULL,
          designation TEXT NOT NULL,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          max_duty_override INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE rooms (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          building TEXT NOT NULL,
          floor INTEGER NOT NULL,
          capacity INTEGER,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE examinations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          academic_year TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          default_staffing_per_room INTEGER NOT NULL DEFAULT 1,
          sessions_per_day INTEGER NOT NULL DEFAULT 2,
          session_config TEXT NOT NULL,
          max_duties_per_faculty INTEGER NOT NULL DEFAULT 6,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE schedules (
          id TEXT PRIMARY KEY,
          examination_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          state TEXT NOT NULL DEFAULT 'VALIDATED',
          validation_result TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          approved_by TEXT,
          approved_at TEXT,
          published_at TEXT,
          archived_at TEXT,
          UNIQUE (examination_id, version)
        );

        CREATE TABLE assignments (
          id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          session TEXT NOT NULL,
          room_id TEXT NOT NULL REFERENCES rooms(id),
          faculty_id TEXT NOT NULL REFERENCES faculty(id),
          status TEXT NOT NULL DEFAULT 'SCHEDULED',
          marked_at TEXT,
          marked_by TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (schedule_id, date, session, room_id)
        );
      `);

      const now = new Date().toISOString();

      // Seed pre-existing records
      db.prepare(`
        INSERT INTO faculty (id, name, email, department, designation, created_at, updated_at)
        VALUES ('FAC-001', 'Dr. Legacy Prof', 'legacy@uni.edu', 'Computer Science', 'Professor', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT INTO rooms (id, name, building, floor, capacity, created_at, updated_at)
        VALUES ('ROOM-101', 'Hall A', 'Science Block', 1, 60, ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT INTO examinations (id, name, academic_year, start_date, end_date, session_config, created_at, updated_at)
        VALUES ('EXAM-001', 'Midterms 2026', '2026-2027', '2026-11-01', '2026-11-05', '[]', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT INTO schedules (id, examination_id, version, state, created_by, created_at, updated_at)
        VALUES ('SCHED-001-V1', 'EXAM-001', 1, 'APPROVED', 'Admin', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
        VALUES ('ASGN-001', 'SCHED-001-V1', '2026-11-01', 'Morning', 'ROOM-101', 'FAC-001', 'SCHEDULED', ?, ?)
      `).run(now, now);

      // Run additive migration
      runMigrations(db);

      // Check record integrity and defaults
      const faculty = db.prepare('SELECT * FROM faculty WHERE id = ?').get('FAC-001') as any;
      expect(faculty.name).toBe('Dr. Legacy Prof');
      expect(faculty.exempt).toBe(0);

      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get('ROOM-101') as any;
      expect(room.name).toBe('Hall A');
      expect(room.exam_department).toBeNull();

      const exam = db.prepare('SELECT * FROM examinations WHERE id = ?').get('EXAM-001') as any;
      expect(exam.name).toBe('Midterms 2026');
      expect(exam.rest_days).toBe(1);

      const sched = db.prepare('SELECT * FROM schedules WHERE id = ?').get('SCHED-001-V1') as any;
      expect(sched.version).toBe(1);
      expect(sched.state).toBe('APPROVED');
      expect(sched.seed).toBeNull();
      expect(sched.counter).toBe(1);

      const asgn = db.prepare('SELECT * FROM assignments WHERE id = ?').get('ASGN-001') as any;
      expect(asgn.faculty_id).toBe('FAC-001');
      expect(asgn.status).toBe('SCHEDULED');

      db.close();
    });
  });

  describe('3. Idempotency Verification', () => {
    it('executing runMigrations multiple times sequentially is safe and produces no errors', () => {
      const db = new Database(':memory:');
      expect(() => {
        runMigrations(db);
        runMigrations(db);
        runMigrations(db);
      }).not.toThrow();

      db.close();
    });
  });

  describe('4. Hard Rule H2 Database Constraint Enforcement (Raw SQL Tests)', () => {
    let db: Database.Database;
    const now = new Date().toISOString();

    beforeEach(() => {
      db = new Database(':memory:');
      runMigrations(db);

      // Setup fixtures
      db.prepare(`
        INSERT INTO examinations (id, name, academic_year, start_date, end_date, session_config, created_at, updated_at)
        VALUES ('EX-H2', 'H2 Exam', '2026', '2026-11-01', '2026-11-03', '[]', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT INTO schedules (id, examination_id, version, created_by, created_at, updated_at)
        VALUES ('SCHED-H2-V1', 'EX-H2', 1, 'Admin', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT INTO schedules (id, examination_id, version, created_by, created_at, updated_at)
        VALUES ('SCHED-H2-V2', 'EX-H2', 2, 'Admin', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT INTO faculty (id, name, email, department, designation, created_at, updated_at)
        VALUES ('FAC-T1', 'Teacher 1', 't1@test.edu', 'Math', 'Lecturer', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT INTO rooms (id, name, building, floor, created_at, updated_at)
        VALUES ('R1', 'Room 1', 'B1', 1, ?, ?), ('R2', 'Room 2', 'B1', 1, ?, ?)
      `).run(now, now, now, now);
    });

    it('rejects duplicate non-cancelled teacher assignments on same date in same schedule at the SQLite engine level', () => {
      // First assignment: Morning session in Room 1
      db.prepare(`
        INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
        VALUES ('A1', 'SCHED-H2-V1', '2026-11-01', 'Morning', 'R1', 'FAC-T1', 'SCHEDULED', ?, ?)
      `).run(now, now);

      // Second assignment: Afternoon session in Room 2 (same teacher, same date, same schedule)
      expect(() => {
        db.prepare(`
          INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
          VALUES ('A2', 'SCHED-H2-V1', '2026-11-01', 'Afternoon', 'R2', 'FAC-T1', 'SCHEDULED', ?, ?)
        `).run(now, now);
      }).toThrow(/UNIQUE constraint failed: assignments\.schedule_id, assignments\.date, assignments\.faculty_id/);
    });

    it('allows a replacement assignment if prior assignment on same date is CANCELLED', () => {
      // First assignment: marked CANCELLED
      db.prepare(`
        INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
        VALUES ('A1', 'SCHED-H2-V1', '2026-11-01', 'Morning', 'R1', 'FAC-T1', 'CANCELLED', ?, ?)
      `).run(now, now);

      // Second assignment: active SCHEDULED duty on same date for same teacher
      expect(() => {
        db.prepare(`
          INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
          VALUES ('A2', 'SCHED-H2-V1', '2026-11-01', 'Afternoon', 'R2', 'FAC-T1', 'SCHEDULED', ?, ?)
        `).run(now, now);
      }).not.toThrow();

      const count = db.prepare(`
        SELECT count(*) as c FROM assignments WHERE schedule_id = 'SCHED-H2-V1' AND faculty_id = 'FAC-T1'
      `).get() as { c: number };
      expect(count.c).toBe(2);
    });

    it('allows same teacher to be assigned on different examination dates within same schedule', () => {
      db.prepare(`
        INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
        VALUES ('A1', 'SCHED-H2-V1', '2026-11-01', 'Morning', 'R1', 'FAC-T1', 'SCHEDULED', ?, ?)
      `).run(now, now);

      expect(() => {
        db.prepare(`
          INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
          VALUES ('A2', 'SCHED-H2-V1', '2026-11-03', 'Morning', 'R1', 'FAC-T1', 'SCHEDULED', ?, ?)
        `).run(now, now);
      }).not.toThrow();
    });

    it('allows same teacher to be assigned on the same date across different schedule versions', () => {
      // Version 1 assignment
      db.prepare(`
        INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
        VALUES ('A1', 'SCHED-H2-V1', '2026-11-01', 'Morning', 'R1', 'FAC-T1', 'SCHEDULED', ?, ?)
      `).run(now, now);

      // Version 2 assignment on same date
      expect(() => {
        db.prepare(`
          INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
          VALUES ('A2', 'SCHED-H2-V2', '2026-11-01', 'Morning', 'R2', 'FAC-T1', 'SCHEDULED', ?, ?)
        `).run(now, now);
      }).not.toThrow();
    });
  });

  describe('5. Constraints & Defaults Validation', () => {
    let db: Database.Database;
    const now = new Date().toISOString();

    beforeEach(() => {
      db = new Database(':memory:');
      runMigrations(db);
    });

    it('enforces rest_days >= 0 CHECK constraint at the SQLite engine level', () => {
      // Valid rest_days = 0 (same-day or consecutive allowed if configured)
      expect(() => {
        db.prepare(`
          INSERT INTO examinations (id, name, academic_year, start_date, end_date, session_config, rest_days, created_at, updated_at)
          VALUES ('EX-VAL-0', 'Exam 0', '2026', '2026-11-01', '2026-11-02', '[]', 0, ?, ?)
        `).run(now, now);
      }).not.toThrow();

      // Negative rest_days = -1 must be rejected by SQLite
      expect(() => {
        db.prepare(`
          INSERT INTO examinations (id, name, academic_year, start_date, end_date, session_config, rest_days, created_at, updated_at)
          VALUES ('EX-VAL-NEG', 'Exam Neg', '2026', '2026-11-01', '2026-11-02', '[]', -1, ?, ?)
        `).run(now, now);
      }).toThrow(/CHECK constraint failed/);
    });

    it('persists and retrieves faculty exempt flag', () => {
      db.prepare(`
        INSERT INTO faculty (id, name, email, department, designation, exempt, created_at, updated_at)
        VALUES ('F-EX', 'Exempt Prof', 'ex@uni.edu', 'Physics', 'Dean', 1, ?, ?)
      `).run(now, now);

      const f = db.prepare('SELECT * FROM faculty WHERE id = ?').get('F-EX') as any;
      expect(f.exempt).toBe(1);
    });

    it('persists and retrieves room exam_department', () => {
      db.prepare(`
        INSERT INTO rooms (id, name, building, floor, exam_department, created_at, updated_at)
        VALUES ('R-DEP', 'Lab 1', 'Bio Building', 2, 'Biotechnology', ?, ?)
      `).run(now, now);

      const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get('R-DEP') as any;
      expect(r.exam_department).toBe('Biotechnology');
    });

    it('persists and retrieves schedule seed', () => {
      db.prepare(`
        INSERT INTO examinations (id, name, academic_year, start_date, end_date, session_config, created_at, updated_at)
        VALUES ('EX-SEED', 'Exam Seed', '2026', '2026-11-01', '2026-11-02', '[]', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT INTO schedules (id, examination_id, version, seed, counter, created_by, created_at, updated_at)
        VALUES ('SCHED-SEED-1', 'EX-SEED', 1, 4242, 1, 'Admin', ?, ?)
      `).run(now, now);

      const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get('SCHED-SEED-1') as any;
      expect(s.seed).toBe(4242);
      expect(s.counter).toBe(1);
    });
  });

  describe('6. Optimistic Concurrency Counter Behavior', () => {
    let db: Database.Database;
    const now = new Date().toISOString();

    beforeEach(() => {
      closeDatabase();
      db = getDatabase(':memory:');
      runMigrations(db);

      db.prepare(`
        INSERT INTO examinations (id, name, academic_year, start_date, end_date, session_config, created_at, updated_at)
        VALUES ('EX-OCC', 'Exam OCC', '2026', '2026-11-01', '2026-11-02', '[]', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT INTO schedules (id, examination_id, version, seed, counter, created_by, created_at, updated_at)
        VALUES ('SCHED-OCC-1', 'EX-OCC', 1, NULL, 1, 'Admin', ?, ?)
      `).run(now, now);
    });

    it('reads the initial schedule counter and increments atomically', () => {
      const counter = ScheduleService.getScheduleCounter('SCHED-OCC-1');
      expect(counter).toBe(1);

      const res1 = ScheduleService.incrementScheduleCounter('SCHED-OCC-1', 1);
      expect(res1.success).toBe(true);
      expect(res1.newCounter).toBe(2);

      const updated = ScheduleService.getScheduleCounter('SCHED-OCC-1');
      expect(updated).toBe(2);
    });

    it('detects and rejects conflicting concurrent updates using stale counter', () => {
      // User A reads counter 1, User B reads counter 1
      const initialCounter = ScheduleService.getScheduleCounter('SCHED-OCC-1')!;

      // User A completes update first
      const resA = ScheduleService.incrementScheduleCounter('SCHED-OCC-1', initialCounter);
      expect(resA.success).toBe(true);
      expect(resA.newCounter).toBe(2);

      // User B tries to update using stale counter 1 -> rejected
      const resB = ScheduleService.incrementScheduleCounter('SCHED-OCC-1', initialCounter);
      expect(resB.success).toBe(false);
      expect(resB.error).toContain('Concurrency conflict');

      // Verify counter remains at 2
      expect(ScheduleService.getScheduleCounter('SCHED-OCC-1')).toBe(2);
    });

    afterEach(() => {
      closeDatabase();
    });
  });

  describe('7. Safety Conflict Verification Guard', () => {
    it('halts migration and produces descriptive conflict summary if duplicate active assignments exist', () => {
      const db = new Database(':memory:');

      // Create legacy table without unique index
      db.exec(`
        CREATE TABLE assignments (
          id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL,
          date TEXT NOT NULL,
          session TEXT NOT NULL,
          room_id TEXT NOT NULL,
          faculty_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'SCHEDULED',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      const now = new Date().toISOString();
      // Insert duplicate active assignments for same teacher on same date in same schedule
      db.prepare(`
        INSERT INTO assignments (id, schedule_id, date, session, room_id, faculty_id, status, created_at, updated_at)
        VALUES 
          ('A1', 'SCHED-CONFLICT', '2026-11-01', 'Morning', 'R1', 'FAC-CONFLICT', 'SCHEDULED', ?, ?),
          ('A2', 'SCHED-CONFLICT', '2026-11-01', 'Afternoon', 'R2', 'FAC-CONFLICT', 'SCHEDULED', ?, ?)
      `).run(now, now, now, now);

      // Migration must throw with detailed conflict report
      expect(() => {
        runMigrations(db);
      }).toThrow(/Cannot create unique index idx_assignments_unique_daily_teacher due to existing data conflicts/);

      // Verify original conflicting records were preserved and NOT deleted or mutated
      const count = db.prepare('SELECT count(*) as c FROM assignments').get() as { c: number };
      expect(count.c).toBe(2);

      db.close();
    });
  });
});
