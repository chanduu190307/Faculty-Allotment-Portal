import { describe, it, expect, beforeEach } from 'vitest';
import PDFDocument from 'pdfkit';
import { getDatabase } from '../../src/db/connection';
import { runMigrations } from '../../src/db/schema';
import { seedDatabase } from '../../src/db/seed';
import { TimetableService } from '../../src/services/timetable.service';
import { ExamService } from '../../src/services/exam.service';
import { ScheduleService } from '../../src/services/schedule.service';
import { ExtractedTimetableRow } from '../../src/services/pdf-timetable-parser.service';

function createTestPdf(builder: (doc: InstanceType<typeof PDFDocument>) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      builder(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

describe('Stage 2 Feature C: Timetable Review, Validation & Transactional Lifecycle', () => {
  let db: any;
  let testExamId: string;

  beforeEach(() => {
    db = getDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db, { roomCount: 5, facultyCount: 20, maxDuties: 6 });

    // Create a base draft examination
    const exam = ExamService.create({
      id: 'EXAM-TT-TEST',
      name: 'Autumn Semester 2026',
      academicYear: '2026-2027',
      startDate: '2026-10-15',
      endDate: '2026-10-25',
      maxDutiesPerFaculty: 6,
      restDays: 1,
    });
    testExamId = exam.id;
  });

  // 1. Preview causes NO persistent changes (zero writes)
  it('previewing a timetable PDF causes zero persistent changes to database', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      doc.text('2026-10-15 | Morning | 09:30 - 12:30 | CS101 | Data Structures');
      doc.text('2026-10-17 | Morning | 09:30 - 12:30 | CS102 | Algorithms');
    });

    const preview = await TimetableService.previewTimetablePdf(pdfBuffer, 'preview.pdf', testExamId);
    expect(preview.records.length).toBe(2);

    // Verify database remains untouched
    const count = db.prepare('SELECT COUNT(*) as count FROM examination_timetable WHERE examination_id = ?').get(testExamId) as { count: number };
    expect(count.count).toBe(0);

    const auditCount = db.prepare("SELECT COUNT(*) as count FROM audit_logs WHERE action = 'TIMETABLE_IMPORTED'").get() as { count: number };
    expect(auditCount.count).toBe(0);
  });

  // 2. User corrections are validated server-side
  it('validates user-corrected records server-side and rejects invalid dates, times, or missing fields', () => {
    const invalidRecords: ExtractedTimetableRow[] = [
      {
        rowNumber: 1,
        date: '2026-02-30', // Invalid leap year / February date!
        subjectCode: 'CS101',
        subjectName: 'Data Structures',
        session: 'Morning',
        startTime: '09:30',
        endTime: '12:30',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
    ];

    expect(() => {
      TimetableService.commitTimetable(testExamId, invalidRecords, 'Admin');
    }).toThrow(/Invalid examination date/i);

    // Verify inverted times rejection
    const invertedTimeRecords: ExtractedTimetableRow[] = [
      {
        rowNumber: 1,
        date: '2026-10-15',
        subjectCode: 'CS101',
        subjectName: 'Data Structures',
        session: 'Morning',
        startTime: '14:00',
        endTime: '12:00', // End time before start time!
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
    ];

    expect(() => {
      TimetableService.commitTimetable(testExamId, invertedTimeRecords, 'Admin');
    }).toThrow(/must be strictly after start time/i);
  });

  // 3. Confirmed imports use atomic transactions & update examination calendar
  it('commits validated timetable records transactionally and synchronizes examination dates', () => {
    const records: ExtractedTimetableRow[] = [
      {
        rowNumber: 1,
        date: '2026-10-15',
        subjectCode: 'CS101',
        subjectName: 'Data Structures',
        session: 'Morning',
        startTime: '09:30',
        endTime: '12:30',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
      {
        rowNumber: 2,
        date: '2026-10-15',
        subjectCode: 'EC102',
        subjectName: 'Digital Circuits',
        session: 'Afternoon',
        startTime: '14:00',
        endTime: '17:00',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
      {
        rowNumber: 3,
        date: '2026-10-17',
        subjectCode: 'MA201',
        subjectName: 'Discrete Mathematics',
        session: 'Morning',
        startTime: '09:30',
        endTime: '12:30',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
    ];

    const result = TimetableService.commitTimetable(testExamId, records, 'Officer');

    expect(result.imported).toBe(3);
    expect(result.distinctDates).toEqual(['2026-10-15', '2026-10-17']);
    expect(result.distinctSessions).toEqual(['Afternoon', 'Morning']);

    // Check database records in examination_timetable
    const savedTimetable = TimetableService.getTimetable(testExamId);
    expect(savedTimetable.length).toBe(3);

    // Check synchronized examination dates in examination_dates
    const dates = db
      .prepare('SELECT date, sequence_order, is_examination_day FROM examination_dates WHERE examination_id = ? ORDER BY sequence_order ASC')
      .all(testExamId) as any[];

    expect(dates.length).toBe(2);
    expect(dates[0].date).toBe('2026-10-15');
    expect(dates[0].sequence_order).toBe(1);
    expect(dates[1].date).toBe('2026-10-17');
    expect(dates[1].sequence_order).toBe(2);

    // Check examination start_date, end_date, session_config
    const updatedExam = ExamService.getById(testExamId)!;
    expect(updatedExam.startDate).toBe('2026-10-15');
    expect(updatedExam.endDate).toBe('2026-10-17');
    expect(updatedExam.sessionsPerDay).toBe(2);
    expect(updatedExam.sessionConfig.map((s) => s.name)).toEqual(['Afternoon', 'Morning']);

    // Check audit log
    const audit = db
      .prepare("SELECT * FROM audit_logs WHERE entity = 'examination' AND action = 'TIMETABLE_IMPORTED' AND entity_id = ?")
      .get(testExamId) as any;
    expect(audit).toBeDefined();
    expect(audit.actor).toBe('Officer');
  });

  // 4. Fatal error mid-commit safely rolls back all changes
  it('rolls back entire transaction on fatal error leaving database completely intact', () => {
    // Insert 1 initial record
    const initialRecords: ExtractedTimetableRow[] = [
      {
        rowNumber: 1,
        date: '2026-10-15',
        subjectCode: 'INITIAL1',
        subjectName: 'Initial Subject',
        session: 'Morning',
        startTime: '09:30',
        endTime: '12:30',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
    ];
    TimetableService.commitTimetable(testExamId, initialRecords, 'Admin');

    const beforeRows = TimetableService.getTimetable(testExamId);
    expect(beforeRows.length).toBe(1);

    // Now attempt a commit where row 2 is fatally invalid (missing subject code)
    const badBatch: ExtractedTimetableRow[] = [
      {
        rowNumber: 1,
        date: '2026-10-20',
        subjectCode: 'NEW1',
        subjectName: 'New Subject 1',
        session: 'Morning',
        startTime: '09:30',
        endTime: '12:30',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
      {
        rowNumber: 2,
        date: '2026-10-20',
        subjectCode: '', // FATAL ERROR: missing required subject code
        subjectName: 'New Subject 2',
        session: 'Morning',
        startTime: '09:30',
        endTime: '12:30',
        confidence: 'LOW',
        isUncertain: true,
        uncertainFields: [],
        missingFields: ['Subject Code'],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
    ];

    expect(() => {
      TimetableService.commitTimetable(testExamId, badBatch, 'Admin');
    }).toThrow(/Subject code is required/i);

    // Verify database remains untouched (initial record is still present, no partial writes)
    const afterRows = TimetableService.getTimetable(testExamId);
    expect(afterRows.length).toBe(1);
    expect(afterRows[0].subjectCode).toBe('INITIAL1');
  });

  // 5. Re-importing updates cleanly without creating unintended duplicates
  it('re-importing an updated timetable cleanly replaces previous records without duplicates', () => {
    const v1Records: ExtractedTimetableRow[] = [
      {
        rowNumber: 1,
        date: '2026-10-15',
        subjectCode: 'CS101',
        subjectName: 'Data Structures V1',
        session: 'Morning',
        startTime: '09:30',
        endTime: '12:30',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
    ];
    TimetableService.commitTimetable(testExamId, v1Records, 'Admin');

    const v2Records: ExtractedTimetableRow[] = [
      {
        rowNumber: 1,
        date: '2026-10-15',
        subjectCode: 'CS101',
        subjectName: 'Data Structures Revised V2',
        session: 'Morning',
        startTime: '09:30',
        endTime: '12:30',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'UPDATE',
        validationErrors: [],
        validationWarnings: [],
      },
      {
        rowNumber: 2,
        date: '2026-10-17',
        subjectCode: 'CS102',
        subjectName: 'Algorithms',
        session: 'Morning',
        startTime: '09:30',
        endTime: '12:30',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
    ];

    const result2 = TimetableService.commitTimetable(testExamId, v2Records, 'Admin');
    expect(result2.imported + result2.updated).toBe(2);

    const saved = TimetableService.getTimetable(testExamId);
    expect(saved.length).toBe(2);
    const cs101 = saved.find((s) => s.subjectCode === 'CS101');
    expect(cs101?.subjectName).toBe('Data Structures Revised V2');
  });

  // 6. Schedule lifecycle protection: approved schedules are NOT modified by import
  it('preserves approved schedules when a timetable is imported or updated', () => {
    // 1. Establish dates and active rooms for a feasible schedule
    const exam = ExamService.create({
      id: 'EXAM-APPROVED-GUARD',
      name: 'Approved Guard Exam',
      startDate: '2026-10-15',
      endDate: '2026-10-17',
      maxDutiesPerFaculty: 6,
      dates: [
        { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
        { date: '2026-10-17', sequenceOrder: 2, isExamDay: true },
      ],
    });

    // 2. Generate and approve schedule
    const gen = ScheduleService.generate(exam.id, 'Admin');
    expect(gen.success).toBe(true);
    const approved = ScheduleService.approve(gen.scheduleId!, 'Dean');
    expect(approved.state).toBe('APPROVED');

    const originalAssignmentsCount = db
      .prepare('SELECT COUNT(*) as count FROM assignments WHERE schedule_id = ?')
      .get(approved.id) as { count: number };
    expect(originalAssignmentsCount.count).toBeGreaterThan(0);

    // 3. Import a new timetable for this examination
    const newTimetable: ExtractedTimetableRow[] = [
      {
        rowNumber: 1,
        date: '2026-10-20',
        subjectCode: 'NEW101',
        subjectName: 'Advanced Computing',
        session: 'Morning',
        startTime: '09:30',
        endTime: '12:30',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        hasConflict: false,
        action: 'ADD',
        validationErrors: [],
        validationWarnings: [],
      },
    ];

    TimetableService.commitTimetable(exam.id, newTimetable, 'Admin');

    // 4. Verify approved schedule remains completely intact and in APPROVED state
    const afterSched = ScheduleService.getScheduleDetails(approved.id);
    expect(afterSched.state).toBe('APPROVED');
    expect(afterSched.assignments.length).toBe(originalAssignmentsCount.count);
  });
});
