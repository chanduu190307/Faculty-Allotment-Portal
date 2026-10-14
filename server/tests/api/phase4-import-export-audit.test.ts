import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { getDatabase } from '../../src/db/connection';
import { runMigrations } from '../../src/db/schema';
import { seedDatabase } from '../../src/db/seed';
import { ExamService } from '../../src/services/exam.service';
import { ScheduleService } from '../../src/services/schedule.service';
import { ImportService } from '../../src/services/import.service';
import { FacultyService } from '../../src/services/faculty.service';
import { RoomService } from '../../src/services/room.service';
import { ExportService } from '../../src/services/export.service';
import { ReportService } from '../../src/services/report.service';
import { AuditService } from '../../src/services/audit.service';

describe('Phase 4 Acceptance Suite: Import, Exact Excel Template, Room Sheets, Audit Logs', () => {
  let db: any;
  let testScheduleId: string;
  let examId = 'EXAM-PHASE4-TEST';

  beforeAll(() => {
    // Isolated in-memory database
    db = getDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db, { roomCount: 8, facultyCount: 50, maxDuties: 6 });

    // Create a feasible examination
    const exam = ExamService.create({
      id: examId,
      name: 'Phase 4 Validation Examination',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
      maxDutiesPerFaculty: 6,
      dates: [
        { date: '2026-10-20', sequenceOrder: 1, isExamDay: true },
        { date: '2026-10-22', sequenceOrder: 2, isExamDay: true },
      ],
    });

    // Generate schedule
    const genResult = ScheduleService.generate(exam.id, 'Phase 4 Test Admin');
    expect(genResult.success).toBe(true);
    testScheduleId = genResult.scheduleId!;

    // Approve schedule
    ScheduleService.approve(testScheduleId, 'Dean Academic');
  });

  // =========================================================================
  // FEATURE A: CSV & EXCEL IMPORT
  // =========================================================================
  describe('Feature A: CSV and Excel Import', () => {
    it('successfully parses and previews valid faculty CSV', async () => {
      const csvContent = [
        'id,name,email,department,designation,phone,active',
        'FAC-NEW-1,Dr. Alan Turing,alan.turing@nitc.ac.in,Computer Science,Professor,9876543210,true',
        'FAC-NEW-2,Dr. Ada Lovelace,ada.lovelace@nitc.ac.in,Mathematics,Associate Professor,9876543211,true',
      ].join('\n');

      const buffer = Buffer.from(csvContent, 'utf-8');
      const preview = await ImportService.previewFacultyImport(buffer, 'csv');

      expect(preview.totalRows).toBe(2);
      expect(preview.validRows).toBe(2);
      expect(preview.errorRows).toBe(0);
      expect(preview.canCommit).toBe(true);
      expect(preview.rows[0].data.name).toBe('Dr. Alan Turing');
      expect(preview.rows[0].data.department).toBe('Computer Science');
    });

    it('successfully parses and previews valid faculty Excel (.xlsx)', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Faculty');
      ws.addRow(['Faculty ID', 'Name', 'Email', 'Department', 'Designation', 'Active']);
      ws.addRow(['FAC-XLSX-1', 'Dr. Grace Hopper', 'grace.hopper@nitc.ac.in', 'Computer Science', 'Professor', 'Yes']);
      ws.addRow(['FAC-XLSX-2', 'Dr. Claude Shannon', 'claude.shannon@nitc.ac.in', 'Electronics', 'Professor', 'Yes']);

      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      const preview = await ImportService.previewFacultyImport(buffer, 'xlsx');

      expect(preview.totalRows).toBe(2);
      expect(preview.validRows).toBe(2);
      expect(preview.errorRows).toBe(0);
      expect(preview.canCommit).toBe(true);
      expect(preview.rows[0].data.id).toBe('FAC-XLSX-1');
    });

    it('detects missing required fields (name, email, department)', async () => {
      const csvContent = [
        'id,name,email,department,designation',
        'FAC-ERR-1,,invalid-email,,Assistant Professor', // missing name, invalid email, missing dept
      ].join('\n');

      const buffer = Buffer.from(csvContent, 'utf-8');
      const preview = await ImportService.previewFacultyImport(buffer, 'csv');

      expect(preview.validRows).toBe(0);
      expect(preview.errorRows).toBe(1);
      expect(preview.canCommit).toBe(false);

      const errors = preview.rows[0].errors;
      const errorFields = errors.map((e) => e.field);
      expect(errorFields).toContain('name');
      expect(errorFields).toContain('email');
      expect(errorFields).toContain('department');
    });

    it('detects duplicate IDs and duplicate emails within the imported file', async () => {
      const csvContent = [
        'id,name,email,department,designation',
        'FAC-DUP-1,First Faculty,faculty1@nitc.ac.in,Civil Engineering,Professor',
        'FAC-DUP-1,Second Faculty,faculty2@nitc.ac.in,Mechanical Engineering,Professor', // Duplicate ID
        'FAC-DUP-2,Third Faculty,faculty1@nitc.ac.in,Electrical Engineering,Professor', // Duplicate Email
      ].join('\n');

      const buffer = Buffer.from(csvContent, 'utf-8');
      const preview = await ImportService.previewFacultyImport(buffer, 'csv');

      expect(preview.canCommit).toBe(false);
      expect(preview.rows[1].errors.some((e) => e.field === 'id')).toBe(true);
      expect(preview.rows[2].errors.some((e) => e.field === 'email')).toBe(true);
    });

    it('handles conflicts with existing database records safely (updates vs rejection)', async () => {
      // Pick an existing seeded faculty member
      const existing = db.prepare('SELECT id, name, email FROM faculty LIMIT 1').get() as any;
      expect(existing).toBeDefined();

      const csvContent = [
        'id,name,email,department,designation',
        `${existing.id},Updated Name,${existing.email},Updated Department,Senior Professor`,
      ].join('\n');

      const buffer = Buffer.from(csvContent, 'utf-8');

      // 1. Without allowUpdateExisting -> Flags conflict as ERROR
      const previewNoUpdate = await ImportService.previewFacultyImport(buffer, 'csv', {
        allowUpdateExisting: false,
      });
      expect(previewNoUpdate.canCommit).toBe(false);
      expect(previewNoUpdate.rows[0].errors.some((e) => e.field === 'id')).toBe(true);

      // 2. With allowUpdateExisting -> Flags conflict as WARNING and allows commit
      const previewWithUpdate = await ImportService.previewFacultyImport(buffer, 'csv', {
        allowUpdateExisting: true,
      });
      expect(previewWithUpdate.canCommit).toBe(true);
      expect(previewWithUpdate.rows[0].warnings.some((e) => e.field === 'id')).toBe(true);
    });

    it('commits valid faculty atomically with transaction and audit log', async () => {
      const csvContent = [
        'id,name,email,department,designation,phone,active',
        'FAC-COMMIT-1,Dr. Katherine Johnson,katherine.johnson@nitc.ac.in,Mathematics,Professor,9876543220,true',
        'FAC-COMMIT-2,Dr. Margaret Hamilton,margaret.hamilton@nitc.ac.in,Computer Science,Professor,9876543221,true',
      ].join('\n');

      const buffer = Buffer.from(csvContent, 'utf-8');
      const preview = await ImportService.previewFacultyImport(buffer, 'csv');
      expect(preview.canCommit).toBe(true);

      const result = ImportService.commitFacultyImport(preview.rows, 'Phase 4 Admin');
      expect(result.imported).toBe(2);

      // Verify inserted into database
      const check1 = db.prepare('SELECT * FROM faculty WHERE id = ?').get('FAC-COMMIT-1') as any;
      expect(check1).toBeDefined();
      expect(check1.name).toBe('Dr. Katherine Johnson');

      // Verify audit log
      const auditLog = db.prepare("SELECT * FROM audit_logs WHERE action = 'FACULTY_IMPORTED' ORDER BY id DESC LIMIT 1").get() as any;
      expect(auditLog).toBeDefined();
      expect(auditLog.actor).toBe('Phase 4 Admin');
      expect(auditLog.entity.toLowerCase()).toBe('faculty');
    });

    it('rolls back atomically if an invalid row is attempted to commit', () => {
      const invalidRows: any = [
        {
          rowNumber: 1,
          data: { id: 'FAC-FAIL-1', name: 'Valid Faculty', email: 'v@nitc.ac.in', department: 'CS' },
          isValid: true,
          errors: [],
          warnings: [],
        },
        {
          rowNumber: 2,
          data: { id: 'FAC-FAIL-2', name: '', email: 'invalid', department: '' },
          isValid: false,
          errors: [{ field: 'name', message: 'Name is required' }],
          warnings: [],
        },
      ];

      expect(() => ImportService.commitFacultyImport(invalidRows, 'Test Admin')).toThrow(/Cannot commit import: Row 2 contains errors/);

      // Verify row 1 was NOT inserted
      const check = db.prepare('SELECT * FROM faculty WHERE id = ?').get('FAC-FAIL-1');
      expect(check).toBeUndefined();
    });

    it('successfully parses, previews, and commits room CSV and Excel', async () => {
      const csvContent = [
        'id,name,building,floor,capacity,active',
        'ROOM-P4-101,LHC-101,Lecture Hall Complex,1,60,true',
        'ROOM-P4-102,LHC-102,Lecture Hall Complex,1,60,true',
      ].join('\n');

      const buffer = Buffer.from(csvContent, 'utf-8');
      const preview = await ImportService.previewRoomImport(buffer, 'csv');
      expect(preview.canCommit).toBe(true);
      expect(preview.validRows).toBe(2);

      const result = ImportService.commitRoomImport(preview.rows, 'Phase 4 Admin');
      expect(result.imported).toBe(2);

      const check = db.prepare('SELECT * FROM rooms WHERE id = ?').get('ROOM-P4-101') as any;
      expect(check).toBeDefined();
      expect(check.capacity).toBe(60);

      const auditLog = db.prepare("SELECT * FROM audit_logs WHERE action = 'ROOMS_IMPORTED' ORDER BY id DESC LIMIT 1").get() as any;
      expect(auditLog).toBeDefined();
    });
  });

  // =========================================================================
  // FEATURE B: EXACT POST-ALLOTMENT EXCEL TEMPLATE EXPORT
  // =========================================================================
  describe('Feature B: Exact Post-Allotment Excel Template Export', () => {
    it('refuses to export Excel allotment for unapproved/draft schedules', async () => {
      // Create a draft schedule
      const draftResult = ScheduleService.generate(examId, 'Draft Admin');
      const draftId = draftResult.scheduleId!;

      await expect(
        ExportService.generatePostAllotmentExcel(draftId, {
          date: '2026-10-20',
          session: 'FN',
        })
      ).rejects.toThrow(/non-approved schedule/i);
    });

    it('generates Excel workbook preserving exact 6 columns, headers, and reference styling', async () => {
      const buffer = await ExportService.generatePostAllotmentExcel(testScheduleId, {
        date: '2026-10-20',
      });

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(10000);

      // Inspect generated workbook with ExcelJS
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);

      const sheet = wb.worksheets[0];
      expect(sheet).toBeDefined();

      // 1. Verify Heading row 2 (Cell 4 has School title, columns 1-3 merged with logo)
      const row2CellD = sheet.getRow(2).getCell(4);
      const row2Text = String(row2CellD.value?.toString() || '');
      expect(row2Text).toContain('School of Engineering & Technology');

      // 2. Verify Reporting Cell Row 3
      const row3CellA = sheet.getRow(3).getCell(1);
      const row3Text = String(row3CellA.value?.toString() || '');
      expect(row3Text).toContain('Reporting Cell_ A-307');

      // 2. Verify Table Header Row 4 has exact 6 columns in exact order
      const row4 = sheet.getRow(4);
      expect(String(row4.getCell(1).value).trim()).toBe('Sl. No');
      expect(String(row4.getCell(2).value).trim()).toBe('Name of the Faculty');
      expect(String(row4.getCell(3).value).trim()).toBe('Department');
      expect(String(row4.getCell(4).value).trim()).toBe('Room No');
      expect(String(row4.getCell(5).value).trim()).toBe('Reporting Time');
      expect(String(row4.getCell(6).value).trim()).toBe('Signature');

      // 3. Verify populated data rows
      // Allotment for 8 rooms = 8 assignments
      const row5 = sheet.getRow(5);
      expect(row5.getCell(1).value).toBe(1);
      expect(row5.getCell(2).value).toBeTruthy(); // faculty name
      expect(row5.getCell(3).value).toBeTruthy(); // department
      expect(row5.getCell(4).value).toBeTruthy(); // room no
      expect(row5.getCell(5).value).toBeNull(); // Blank for manual entry
      expect(row5.getCell(6).value).toBeNull(); // Blank for physical signature

      // 4. Verify Spacer row and Note row directly follow the data rows
      const expectedDataCount = 8;
      const spacerRowIdx = 5 + expectedDataCount; // Row 13
      const noteRowIdx = spacerRowIdx + 1; // Row 14

      const spacerRow = sheet.getRow(spacerRowIdx);
      expect(spacerRow.height).toBe(9);

      const noteRow = sheet.getRow(noteRowIdx);
      expect(noteRow.height).toBe(24.75);
      const noteCell1 = noteRow.getCell(1);
      const noteCell2 = noteRow.getCell(2);

      // Verify Note text
      const noteTextVal = typeof noteCell1.value === 'object' ? JSON.stringify(noteCell1.value) : String(noteCell1.value);
      expect(noteTextVal).toContain('Note:');
      expect(String(noteCell2.value)).toContain('All the invigilators report to your Control room');
    });

    it('preserves exact structure for large allotments (> 72 rows)', async () => {
      // Add 75 rooms to test large allotment
      for (let i = 1; i <= 75; i++) {
        db.prepare(`
          INSERT OR IGNORE INTO rooms (id, name, building, floor, capacity, active, created_at, updated_at)
          VALUES (?, ?, 'Main', 1, 40, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(`ROOM-LG-${i}`, `Hall-${i}`);
      }

      // Add faculty to handle 83 rooms * 2 sessions = 166 duties
      for (let i = 1; i <= 180; i++) {
        db.prepare(`
          INSERT OR IGNORE INTO faculty (id, name, email, department, designation, active, exempt, created_at, updated_at)
          VALUES (?, ?, ?, 'Computer Science', 'Professor', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(`FAC-LG-${i}`, `Prof. Large ${i}`, `prof.large${i}@nitc.ac.in`);
      }

      // Create exam linking all newly added active rooms and faculty
      const largeExam = ExamService.create({
        id: 'EXAM-LARGE-P4',
        name: 'Large Allotment Exam',
        startDate: '2026-11-01',
        endDate: '2026-11-01',
        maxDutiesPerFaculty: 6,
        dates: [
          { date: '2026-11-01', sequenceOrder: 1, isExamDay: true },
        ],
      });

      // Generate and approve schedule
      const largeGen = ScheduleService.generate(largeExam.id, 'Admin');
      if (!largeGen.success) {
        console.error('largeGen failure:', largeGen.failureDiagnostics);
      }
      expect(largeGen.success).toBe(true);
      const largeSchedId = largeGen.scheduleId!;
      ScheduleService.approve(largeSchedId, 'Dean Academic');

      // Export (defaults to first slot session, Morning)
      const buffer = await ExportService.generatePostAllotmentExcel(largeSchedId, {
        date: '2026-11-01',
      });

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.worksheets[0];

      // Total assignments on 2026-11-01 for Morning session
      const firstSlot = db.prepare("SELECT session FROM assignments WHERE schedule_id = ? AND date = '2026-11-01' LIMIT 1").get(largeSchedId) as any;
      const count = db.prepare("SELECT count(*) as c FROM assignments WHERE schedule_id = ? AND date = '2026-11-01' AND session = ?").get(largeSchedId, firstSlot.session) as any;
      const N = count.c;
      expect(N).toBeGreaterThanOrEqual(75);

      // Verify Sl. No ends at N
      const lastDataRow = sheet.getRow(4 + N);
      expect(lastDataRow.getCell(1).value).toBe(N);

      // Spacer row at 5 + N
      const spacerRow = sheet.getRow(5 + N);
      expect(spacerRow.height).toBe(9);

      // Note row at 6 + N
      const noteRow = sheet.getRow(6 + N);
      expect(noteRow.height).toBe(24.75);
    });
  });

  // =========================================================================
  // FEATURE C: PRINT-READY ROOM SHEETS
  // =========================================================================
  describe('Feature C: Print-Ready Room Sheets', () => {
    it('retrieves structured room sheet data for approved schedule', () => {
      const roomSheets = ReportService.getRoomSheetsData(testScheduleId, { date: '2026-10-20', session: 'Morning' });

      expect(roomSheets.length).toBe(8); // 8 rooms
      const first = roomSheets[0];
      expect(first.examinationName).toBe('Phase 4 Validation Examination');
      expect(first.date).toBe('2026-10-20');
      expect(first.session).toBe('Morning');
      expect(first.roomId).toBeTruthy();
      expect(first.roomName).toBeTruthy();
      expect(first.facultyId).toBeTruthy();
      expect(first.facultyName).toBeTruthy();
      expect(first.department).toBeTruthy();
      expect(first.signatureField).toBe(''); // handwriting space
      expect(first.timeInField).toBe(''); // handwriting space
    });

    it('generates a valid, professional PDF for print-ready room sheets', async () => {
      const roomSheets = ReportService.getRoomSheetsData(testScheduleId, { date: '2026-10-20', session: 'Morning' });
      const pdfBuffer = await ExportService.generateRoomSheetsPDF(roomSheets);

      expect(pdfBuffer).toBeDefined();
      expect(pdfBuffer.length).toBeGreaterThan(1000);

      // PDF Magic bytes check: Starts with '%PDF-'
      const magic = pdfBuffer.slice(0, 5).toString('ascii');
      expect(magic).toBe('%PDF-');
    });
  });

  // =========================================================================
  // FEATURE D: DEDICATED AUDIT LOG INTERFACE & FILTERING
  // =========================================================================
  describe('Feature D: Dedicated Audit Log Interface & Filtering', () => {
    beforeAll(() => {
      // Insert test audit entries including one with sensitive keys
      AuditService.log({
        entity: 'FACULTY',
        entityId: 'FAC-SENS-1',
        action: 'FACULTY_TEST_ACTION',
        actor: 'Security Officer',
        oldValues: { name: 'Old Name', password: 'plain_secret_password', api_key: 'secret_12345' },
        newValues: { name: 'New Name', password: 'new_secret_password', token: 'bearer_token_abc' },
        reason: 'Testing sensitive redaction in audit log',
      });
    });

    it('filters audit logs by entity and action with pagination', () => {
      const result = AuditService.getLogsFiltered({
        entity: 'FACULTY',
        action: 'FACULTY_TEST_ACTION',
        limit: 10,
        offset: 0,
      });

      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.data[0].entity).toBe('FACULTY');
      expect(result.data[0].action).toBe('FACULTY_TEST_ACTION');
    });

    it('filters audit logs by actor and search text', () => {
      const result = AuditService.getLogsFiltered({
        actor: 'Security Officer',
        search: 'redaction',
      });

      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.data[0].actor).toBe('Security Officer');
      expect(result.data[0].reason).toContain('Testing sensitive redaction');
    });

    it('sanitizes and redacts sensitive tokens, passwords, and API keys', () => {
      const result = AuditService.getLogsFiltered({
        action: 'FACULTY_TEST_ACTION',
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      const entry = result.data.find((e) => e.entityId === 'FAC-SENS-1');
      expect(entry).toBeDefined();

      // Verify passwords and tokens are replaced with ***REDACTED***
      expect(entry.oldValues.password).toBe('***REDACTED***');
      expect(entry.oldValues.api_key).toBe('***REDACTED***');
      expect(entry.newValues.password).toBe('***REDACTED***');
      expect(entry.newValues.token).toBe('***REDACTED***');

      // Verify non-sensitive fields are preserved
      expect(entry.oldValues.name).toBe('Old Name');
      expect(entry.newValues.name).toBe('New Name');
    });
  });

  // =========================================================================
  // FEATURE E: APPROVED SCHEDULE PROTECTION DURING IMPORT UPDATES
  // =========================================================================
  describe('Feature E: Approved Schedule Invalidation Protection', () => {
    it('blocks preview and commit from deactivating or exempting faculty assigned to approved schedules', async () => {
      // Find an active assignment in the approved test schedule
      const sched = ScheduleService.getScheduleDetails(testScheduleId);
      expect(sched).toBeDefined();
      expect(sched.assignments.length).toBeGreaterThan(0);
      const assignedFacultyId = sched.assignments[0].faculty_id;
      const assignedFaculty = FacultyService.getById(assignedFacultyId)!;
      expect(assignedFaculty).toBeDefined();

      // Prepare import payload trying to deactivate assigned faculty
      const csvContent = [
        'id,name,email,department,designation,active,exempt',
        `${assignedFaculty.id},${assignedFaculty.name},${assignedFaculty.email},${assignedFaculty.department},${assignedFaculty.designation},false,false`,
      ].join('\n');

      const buffer = Buffer.from(csvContent, 'utf-8');
      const preview = await ImportService.previewFacultyImport(buffer, 'csv', { allowUpdateExisting: true });

      // Must be rejected with error in preview
      expect(preview.canCommit).toBe(false);
      expect(preview.errorRows).toBe(1);
      expect(preview.rows[0].errors[0].message).toContain('assigned to active duties in approved schedule');

      // Attempting commit must throw an error
      expect(() => {
        ImportService.commitFacultyImport(preview.rows, 'Malicious Admin', true);
      }).toThrow(/active duties in approved schedule/);

      // Verify the faculty in database remains active
      const refreshed = FacultyService.getById(assignedFacultyId)!;
      expect(refreshed.active).toBe(true);
      expect(refreshed.exempt).toBe(false);
    });

    it('blocks preview and commit from deactivating a room assigned to approved schedules', async () => {
      const sched = ScheduleService.getScheduleDetails(testScheduleId);
      expect(sched).toBeDefined();
      expect(sched.assignments.length).toBeGreaterThan(0);
      const assignedRoomId = sched.assignments[0].room_id;
      const assignedRoom = RoomService.getById(assignedRoomId)!;
      expect(assignedRoom).toBeDefined();

      const csvContent = [
        'id,name,building,floor,capacity,active',
        `${assignedRoom.id},${assignedRoom.name},${assignedRoom.building},${assignedRoom.floor},${assignedRoom.capacity},false`,
      ].join('\n');

      const buffer = Buffer.from(csvContent, 'utf-8');
      const preview = await ImportService.previewRoomImport(buffer, 'csv', { allowUpdateExisting: true });

      expect(preview.canCommit).toBe(false);
      expect(preview.errorRows).toBe(1);
      expect(preview.rows[0].errors[0].message).toContain('Room has active duties in approved schedule');

      expect(() => {
        ImportService.commitRoomImport(preview.rows, 'Malicious Admin', true);
      }).toThrow(/active duties in approved schedule/);

      const refreshed = RoomService.getById(assignedRoomId)!;
      expect(refreshed.active).toBe(true);
    });
  });
});
