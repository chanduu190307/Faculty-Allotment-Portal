import Database from 'better-sqlite3';

export interface SeedOptions {
  roomCount?: number;
  facultyCount?: number;
  maxDuties?: number;
}

export function seedDatabase(db: Database.Database, options: SeedOptions = {}): void {
  const roomCount = options.roomCount ?? 200;
  const facultyCount = options.facultyCount ?? 500;
  const maxDuties = options.maxDuties ?? 6;

  const now = new Date().toISOString();

  const insertSetting = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, description, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  const insertRoom = db.prepare(`
    INSERT OR REPLACE INTO rooms (id, name, building, floor, capacity, exam_department, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFaculty = db.prepare(`
    INSERT OR REPLACE INTO faculty (id, name, email, department, designation, phone, active, exempt, max_duty_override, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertExam = db.prepare(`
    INSERT OR REPLACE INTO examinations (id, name, academic_year, start_date, end_date, default_staffing_per_room, sessions_per_day, session_config, max_duties_per_faculty, rest_days, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertExamDate = db.prepare(`
    INSERT OR REPLACE INTO examination_dates (examination_id, date, sequence_order, is_examination_day)
    VALUES (?, ?, ?, ?)
  `);

  const insertExamRoom = db.prepare(`
    INSERT OR REPLACE INTO examination_rooms (examination_id, room_id, is_active, required_staffing)
    VALUES (?, ?, ?, ?)
  `);

  const insertExamFaculty = db.prepare(`
    INSERT OR REPLACE INTO examination_faculty (examination_id, faculty_id, is_participating, duty_limit_override)
    VALUES (?, ?, ?, ?)
  `);

  const insertLeave = db.prepare(`
    INSERT OR IGNORE INTO faculty_leave (faculty_id, date, session_scope, reason, approval_status, approved_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    // 1. Settings
    insertSetting.run('default_room_count', roomCount.toString(), 'Configured number of active examination rooms', now);
    insertSetting.run('default_faculty_count', facultyCount.toString(), 'Configured number of registered faculty', now);
    insertSetting.run('default_max_duties', maxDuties.toString(), 'Default maximum duties per teacher', now);
    insertSetting.run('sessions_per_day', '2', 'Standard daily examination sessions', now);
    insertSetting.run('college_name', 'Institution Name', 'Institutional Title', now);
    insertSetting.run('institution_name', 'Institution Name', 'Configurable Institution Name', now);

    // 2. Rooms
    const blocks = ['Block A', 'Block B', 'Block C', 'Block D'];
    for (let i = 1; i <= roomCount; i++) {
      const blockIdx = (i - 1) % blocks.length;
      const floor = Math.floor(((i - 1) / blocks.length) / 10) + 1;
      const roomId = `RM-${i.toString().padStart(3, '0')}`;
      const roomName = `Room ${roomId}`;
      insertRoom.run(roomId, roomName, blocks[blockIdx], floor, 30 + (i % 3) * 10, null, 1, now, now);
    }

    // 3. Faculty
    const departments = [
      'Computer Science & Engineering',
      'Information Technology',
      'Electronics & Communication',
      'Mechanical Engineering',
      'Civil Engineering',
      'Mathematics',
      'Physics',
      'Humanities & Management'
    ];
    const designations = ['Assistant Professor', 'Associate Professor', 'Professor', 'Senior Lecturer'];

    for (let i = 1; i <= facultyCount; i++) {
      const facId = `FAC-${i.toString().padStart(3, '0')}`;
      const name = `Faculty Member ${i.toString().padStart(3, '0')}`;
      const email = `faculty.${i.toString().padStart(3, '0')}@institution.edu`;
      const dept = departments[(i - 1) % departments.length];
      const desig = designations[(i - 1) % designations.length];
      insertFaculty.run(facId, name, email, dept, desig, null, 1, 0, null, now, now);
    }

    // 4. Default Benchmark Examination (2026-10-15 to 2026-10-21, 6 consecutive exam days)
    const examId = 'EXAM-2026-MID';
    const sessionConfig = JSON.stringify([
      { name: 'Morning', start_time: '09:30', end_time: '12:30' },
      { name: 'Afternoon', start_time: '14:00', end_time: '17:00' }
    ]);

    insertExam.run(
      examId,
      'End-Semester Examination Autumn 2026',
      '2026-2027',
      '2026-10-15',
      '2026-10-21',
      1,
      2,
      sessionConfig,
      maxDuties,
      1,
      'DRAFT',
      now,
      now
    );

    // 6 Exam dates
    const examDates = [
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20'
    ];

    examDates.forEach((date, idx) => {
      insertExamDate.run(examId, date, idx + 1, 1);
    });

    // Link rooms to exam
    for (let i = 1; i <= roomCount; i++) {
      const roomId = `RM-${i.toString().padStart(3, '0')}`;
      insertExamRoom.run(examId, roomId, 1, 1);
    }

    // Link faculty to exam
    for (let i = 1; i <= facultyCount; i++) {
      const facId = `FAC-${i.toString().padStart(3, '0')}`;
      insertExamFaculty.run(examId, facId, 1, null);
    }

    // Add a few sample approved leaves to demonstrate Rule H & leave exclusion
    insertLeave.run('FAC-005', '2026-10-15', 'FULL_DAY', 'Medical Leave', 'APPROVED', 'Dean Academic', now);
    insertLeave.run('FAC-008', '2026-10-16', 'MORNING', 'Conference Presentation', 'APPROVED', 'HOD', now);
    insertLeave.run('FAC-012', '2026-10-17', 'FULL_DAY', 'Personal Emergency', 'APPROVED', 'Dean Academic', now);
  });

  transaction();
}
