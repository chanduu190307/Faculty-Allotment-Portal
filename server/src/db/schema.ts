import Database from 'better-sqlite3';

export const SCHEMA_SQL = `
-- Settings table for dynamic system defaults
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL
);

-- Faculty table
CREATE TABLE IF NOT EXISTS faculty (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL,
  designation TEXT NOT NULL,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  exempt INTEGER NOT NULL DEFAULT 0,
  max_duty_override INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_faculty_active ON faculty(active);
CREATE INDEX IF NOT EXISTS idx_faculty_dept ON faculty(department);

-- Faculty leave table
CREATE TABLE IF NOT EXISTS faculty_leave (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  faculty_id TEXT NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  session_scope TEXT NOT NULL DEFAULT 'FULL_DAY', -- 'MORNING', 'AFTERNOON', 'FULL_DAY'
  reason TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'APPROVED', -- 'PENDING', 'APPROVED', 'REJECTED'
  approved_by TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leave_faculty_date ON faculty_leave(faculty_id, date);

-- Examination Rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  building TEXT NOT NULL,
  floor INTEGER NOT NULL DEFAULT 1,
  capacity INTEGER NOT NULL DEFAULT 30,
  exam_department TEXT DEFAULT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(active);

-- Examinations table
CREATE TABLE IF NOT EXISTS examinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  default_staffing_per_room INTEGER NOT NULL DEFAULT 1,
  sessions_per_day INTEGER NOT NULL DEFAULT 2,
  session_config TEXT NOT NULL, -- JSON array of session objects
  max_duties_per_faculty INTEGER NOT NULL DEFAULT 6,
  rest_days INTEGER NOT NULL DEFAULT 1 CHECK (rest_days >= 0),
  status TEXT NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Examination Dates table
CREATE TABLE IF NOT EXISTS examination_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  examination_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  sequence_order INTEGER NOT NULL,
  is_examination_day INTEGER NOT NULL DEFAULT 1,
  UNIQUE (examination_id, date)
);

CREATE INDEX IF NOT EXISTS idx_exam_dates ON examination_dates(examination_id, sequence_order);

-- Examination Rooms Link table
CREATE TABLE IF NOT EXISTS examination_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  examination_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL DEFAULT 1,
  required_staffing INTEGER NOT NULL DEFAULT 1,
  UNIQUE (examination_id, room_id)
);

-- Examination Faculty Link table
CREATE TABLE IF NOT EXISTS examination_faculty (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  examination_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
  faculty_id TEXT NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  is_participating INTEGER NOT NULL DEFAULT 1,
  duty_limit_override INTEGER DEFAULT NULL,
  UNIQUE (examination_id, faculty_id)
);

-- Schedules table
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  examination_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  revision_number INTEGER NOT NULL DEFAULT 0,
  base_schedule_id TEXT DEFAULT NULL REFERENCES schedules(id),
  state TEXT NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'GENERATED', 'VALIDATED', 'APPROVED', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'REVISED', 'CANCELLED'
  validation_result TEXT, -- JSON structure
  seed INTEGER DEFAULT NULL,
  counter INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT 'System Admin',
  approved_by TEXT,
  approved_at TEXT,
  published_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedules_exam ON schedules(examination_id, version);

-- Assignments table
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  session TEXT NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  faculty_id TEXT NOT NULL REFERENCES faculty(id),
  status TEXT NOT NULL DEFAULT 'SCHEDULED', -- 'SCHEDULED', 'COMPLETED', 'ABSENT', 'CANCELLED', 'SUBSTITUTED'
  marked_at TEXT,
  marked_by TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (schedule_id, date, session, room_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_sched_fac ON assignments(schedule_id, faculty_id);
CREATE INDEX IF NOT EXISTS idx_assignments_sched_date_sess ON assignments(schedule_id, date, session);

-- Substitutions table
CREATE TABLE IF NOT EXISTS substitutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  original_faculty_id TEXT NOT NULL REFERENCES faculty(id),
  substitute_faculty_id TEXT NOT NULL REFERENCES faculty(id),
  reason TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'APPROVED'
);

CREATE INDEX IF NOT EXISTS idx_substitutions_assignment ON substitutions(assignment_id);

-- Daily Reports table (immutable snapshots)
CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY,
  examination_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  report_version INTEGER NOT NULL DEFAULT 1,
  is_provisional INTEGER NOT NULL DEFAULT 0,
  snapshot_data TEXT NOT NULL, -- JSON snapshot of state
  generated_by TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_exam_date ON daily_reports(examination_id, date);

-- Audit Logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  old_values TEXT, -- JSON
  new_values TEXT, -- JSON
  reason TEXT,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);
`;

function getExistingColumns(db: Database.Database, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

export function runMigrations(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Run base schema definitions (creates tables on clean database)
    db.exec(SCHEMA_SQL);

    // 2. Additive migrations for existing databases
    // 2a. Faculty table: exempt column
    const facultyCols = getExistingColumns(db, 'faculty');
    if (facultyCols.size > 0 && !facultyCols.has('exempt')) {
      db.exec('ALTER TABLE faculty ADD COLUMN exempt INTEGER NOT NULL DEFAULT 0;');
    }

    // 2b. Rooms table: exam_department column
    const roomCols = getExistingColumns(db, 'rooms');
    if (roomCols.size > 0 && !roomCols.has('exam_department')) {
      db.exec('ALTER TABLE rooms ADD COLUMN exam_department TEXT DEFAULT NULL;');
    }

    // 2c. Examinations table: rest_days column with non-negative constraint
    const examCols = getExistingColumns(db, 'examinations');
    if (examCols.size > 0 && !examCols.has('rest_days')) {
      db.exec('ALTER TABLE examinations ADD COLUMN rest_days INTEGER NOT NULL DEFAULT 1 CHECK (rest_days >= 0);');
    }

    // 2d. Schedules table: seed and counter columns
    const schedCols = getExistingColumns(db, 'schedules');
    if (schedCols.size > 0 && !schedCols.has('seed')) {
      db.exec('ALTER TABLE schedules ADD COLUMN seed INTEGER DEFAULT NULL;');
    }
    if (schedCols.size > 0 && !schedCols.has('counter')) {
      db.exec('ALTER TABLE schedules ADD COLUMN counter INTEGER NOT NULL DEFAULT 1;');
    }

    // 2e. Schedules table: base_schedule_id and revision_number columns
    if (schedCols.size > 0 && !schedCols.has('base_schedule_id')) {
      db.exec('ALTER TABLE schedules ADD COLUMN base_schedule_id TEXT DEFAULT NULL;');
    }
    if (schedCols.size > 0 && !schedCols.has('revision_number')) {
      db.exec('ALTER TABLE schedules ADD COLUMN revision_number INTEGER NOT NULL DEFAULT 0;');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_schedules_base ON schedules(base_schedule_id);');

    // 3. Conflict verification before creating partial unique index
    const asgnCols = getExistingColumns(db, 'assignments');
    if (asgnCols.size > 0) {
      const conflicts = db.prepare(`
        SELECT schedule_id, date, faculty_id, count(*) as count
        FROM assignments
        WHERE status != 'CANCELLED'
        GROUP BY schedule_id, date, faculty_id
        HAVING count(*) > 1
      `).all() as Array<{ schedule_id: string; date: string; faculty_id: string; count: number }>;

      if (conflicts.length > 0) {
        const conflictSummary = conflicts
          .map((c) => `Schedule: ${c.schedule_id}, Date: ${c.date}, Faculty: ${c.faculty_id} (${c.count} records)`)
          .join('\n');
        throw new Error(
          `[Migration Error] Cannot create unique index idx_assignments_unique_daily_teacher due to existing data conflicts:\n${conflictSummary}\n` +
          `Existing database records remain untouched. Please review and resolve conflicts before re-running migration.`
        );
      }

      // 4. Create partial unique index enforcing Hard Rule H2
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_unique_daily_teacher 
        ON assignments(schedule_id, date, faculty_id) 
        WHERE status != 'CANCELLED';
      `);
    }
  });

  tx();
}
