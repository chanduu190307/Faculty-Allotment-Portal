import { describe, it, expect, beforeEach } from 'vitest';
import PDFDocument from 'pdfkit';
import { getDatabase } from '../../src/db/connection';
import { runMigrations } from '../../src/db/schema';
import { seedDatabase } from '../../src/db/seed';
import { ImportService } from '../../src/services/import.service';
import { PdfFacultyParserService, ExtractedFacultyRow } from '../../src/services/pdf-faculty-parser.service';
import { ExamService } from '../../src/services/exam.service';
import { ScheduleService } from '../../src/services/schedule.service';

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

describe('Feature B: Faculty PDF Upload, Extraction, Preview & Safe Import', () => {
  let db: any;

  beforeEach(() => {
    db = getDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db, { roomCount: 10, facultyCount: 20, maxDuties: 6 });
  });

  // =========================================================================
  // 1. Valid Digital PDF Parsing & Multi-Page Extraction
  // =========================================================================
  it('extracts faculty records accurately from a multi-page digital PDF', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      // Header & Title
      doc.fontSize(16).text('FACULTY ALLOTMENT PORTAL - DEPARTMENT DIRECTORY', { align: 'center' });
      doc.fontSize(10).text('Academic Year: 2026-2027 | Controller of Examinations', { align: 'center' });
      doc.moveDown();

      // Page 1 Records
      doc.text('1. FAC-101 | Dr. Alan Turing | Computer Science & Engineering | Professor | turing@institution.edu | 9876543210');
      doc.text('2. FAC-102 | Dr. Grace Hopper | Information Technology | Associate Professor | hopper@institution.edu | 9876543211');
      doc.text('3. FAC-103 | Prof. Ada Lovelace | Mathematics | Professor | lovelace@institution.edu | 9876543212');

      // Page 2
      doc.addPage();
      doc.fontSize(16).text('FACULTY DIRECTORY - CONTINUED (PAGE 2)', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text('4. FAC-104 | Dr. Claude Shannon | Electronics & Communication | Professor | shannon@institution.edu | 9876543213');
      doc.text('5. FAC-105 | Dr. Katherine Johnson | Mathematics | Associate Professor | johnson@institution.edu | 9876543214');

      // Footer
      doc.moveDown(2);
      doc.text('Signature of Dean / Controller of Examinations: _____________________');
      doc.text('Page 2 of 2', { align: 'right' });
    });

    const preview = await ImportService.previewFacultyPdfImport(pdfBuffer, 'multi_page_faculty.pdf');

    expect(preview.totalPages).toBe(2);
    expect(preview.hasSelectableText).toBe(true);
    expect(preview.totalParsed).toBe(5);
    expect(preview.uniqueCount).toBe(5);
    expect(preview.duplicateCount).toBe(0);
    expect(preview.missingRequiredCount).toBe(0);
    expect(preview.canCommit).toBe(true);

    const names = preview.records.map((r) => r.name);
    expect(names).toContain('Dr. Alan Turing');
    expect(names).toContain('Dr. Grace Hopper');
    expect(names).toContain('Prof. Ada Lovelace');
    expect(names).toContain('Dr. Claude Shannon');
    expect(names).toContain('Dr. Katherine Johnson');

    const turing = preview.records.find((r) => r.id === 'FAC-101');
    expect(turing).toBeDefined();
    expect(turing?.department).toBe('Computer Science & Engineering');
    expect(turing?.designation).toBe('Professor');
    expect(turing?.email).toBe('turing@institution.edu');
    expect(turing?.action).toBe('ADD');
  });

  // =========================================================================
  // 2. Labeled Key-Value Block Layouts
  // =========================================================================
  it('extracts faculty records formatted as labeled key-value blocks', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      doc.fontSize(14).text('Department of Mathematics Faculty Roster');
      doc.moveDown();

      doc.fontSize(10).text('Name: Dr. Carl Friedrich Gauss');
      doc.text('ID: FAC-201');
      doc.text('Department: Mathematics');
      doc.text('Designation: Professor');
      doc.text('Email: gauss@institution.edu');
      doc.text('Phone: 9876500001');
      doc.moveDown();

      doc.text('Name: Dr. Emmy Noether');
      doc.text('ID: FAC-202');
      doc.text('Department: Mathematics');
      doc.text('Designation: Associate Professor');
      doc.text('Email: noether@institution.edu');
      doc.text('Phone: 9876500002');
    });

    const preview = await ImportService.previewFacultyPdfImport(pdfBuffer, 'labeled_blocks.pdf');

    expect(preview.totalParsed).toBe(2);
    expect(preview.uniqueCount).toBe(2);
    expect(preview.records[0].name).toBe('Dr. Carl Friedrich Gauss');
    expect(preview.records[0].id).toBe('FAC-201');
    expect(preview.records[0].email).toBe('gauss@institution.edu');
    expect(preview.records[0].department).toBe('Mathematics');
    expect(preview.records[1].name).toBe('Dr. Emmy Noether');
    expect(preview.records[1].id).toBe('FAC-202');
    expect(preview.records[1].email).toBe('noether@institution.edu');
  });

  // =========================================================================
  // 3. Repeated Names & Duplicate Identities Detection
  // =========================================================================
  it('detects duplicate IDs and duplicate emails within the file and marks them to skip', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      doc.text('1. FAC-301 | Dr. John von Neumann | Computer Science | Professor | jvn@institution.edu');
      // Duplicate ID
      doc.text('2. FAC-301 | Dr. Johnny Neumann | Computer Science | Professor | johnny@institution.edu');
      // Duplicate Email
      doc.text('3. FAC-302 | Prof. John von Neumann | Mathematics | Professor | jvn@institution.edu');
      // Unique Record
      doc.text('4. FAC-303 | Dr. Kurt Godel | Mathematics | Professor | godel@institution.edu');
    });

    const preview = await ImportService.previewFacultyPdfImport(pdfBuffer, 'duplicates.pdf');

    expect(preview.totalParsed).toBe(4);
    expect(preview.duplicateCount).toBe(2);
    expect(preview.uniqueCount).toBe(2);

    const dupIdRow = preview.records.find((r) => r.rowNumber === 2);
    expect(dupIdRow?.isDuplicateInFile).toBe(true);
    expect(dupIdRow?.action).toBe('SKIP');
    expect(dupIdRow?.skipReason).toMatch(/Duplicate Faculty ID/i);

    const dupEmailRow = preview.records.find((r) => r.rowNumber === 3);
    expect(dupEmailRow?.isDuplicateInFile).toBe(true);
    expect(dupEmailRow?.action).toBe('SKIP');
    expect(dupEmailRow?.skipReason).toMatch(/Duplicate Email/i);

    const uniqueRow = preview.records.find((r) => r.rowNumber === 4);
    expect(uniqueRow?.isDuplicateInFile).toBe(false);
    expect(uniqueRow?.action).toBe('ADD');
  });

  // =========================================================================
  // 4. Missing or Malformed Faculty Fields & Uncertainty Marking
  // =========================================================================
  it('marks incomplete or ambiguous records as uncertain with explicit missing fields', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      // Missing ID and email
      doc.text('1. Dr. Anonymous Teacher | Physics | Assistant Professor');
      // Record with invalid/missing dept
      doc.text('2. FAC-402 | Dr. Marie Curie | curie@institution.edu');
    });

    const preview = await ImportService.previewFacultyPdfImport(pdfBuffer, 'uncertain.pdf');

    expect(preview.totalParsed).toBe(2);
    expect(preview.uncertainCount).toBeGreaterThanOrEqual(1);

    const anon = preview.records[0];
    expect(anon.name).toBe('Dr. Anonymous Teacher');
    expect(anon.isUncertain).toBe(true);
    expect(anon.missingFields).toContain('id');
    expect(anon.missingFields).toContain('email');

    const curie = preview.records[1];
    expect(curie.name).toBe('Dr. Marie Curie');
    expect(curie.id).toBe('FAC-402');
    expect(curie.email).toBe('curie@institution.edu');
  });

  // =========================================================================
  // 5. Scanned PDF when OCR is Unavailable (Never Fabricate Data!)
  // =========================================================================
  it('safely rejects scanned image-only PDFs with clear error and never fabricates teacher records', async () => {
    // Generate a PDF with NO selectable text (empty page representing an image scan)
    const scannedPdfBuffer = await createTestPdf((doc) => {
      // Just draws shapes/rectangles without text
      doc.rect(50, 50, 400, 600).stroke();
    });

    await expect(
      ImportService.previewFacultyPdfImport(scannedPdfBuffer, 'scanned_scan.pdf')
    ).rejects.toThrow(/Scanned or image-only PDF detected.*no local OCR engine/i);

    // Verify zero records were written or fabricated
    const facultyCount = (db.prepare('SELECT COUNT(*) as count FROM faculty').get() as any).count;
    expect(facultyCount).toBe(20);
  });

  // =========================================================================
  // 6. Security & Format Validation: Empty, Corrupt, Oversized, Invalid Signature
  // =========================================================================
  it('rejects empty, corrupt, oversized, and invalid-signature files with useful errors', async () => {
    // Empty buffer
    await expect(
      ImportService.previewFacultyPdfImport(Buffer.alloc(0), 'empty.pdf')
    ).rejects.toThrow(/empty/i);

    // Non-PDF file signature
    const textBuffer = Buffer.from('This is a plain text file, not a PDF.');
    await expect(
      ImportService.previewFacultyPdfImport(textBuffer, 'not_a_pdf.pdf')
    ).rejects.toThrow(/magic header missing/i);

    // Oversized buffer (> 10MB)
    const fakeOversized = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024)]);
    expect(() => {
      PdfFacultyParserService.validatePdfBuffer(fakeOversized, 10 * 1024 * 1024);
    }).toThrow(/exceeds maximum permitted limit/i);

    // Corrupt PDF structure
    const corruptBuffer = Buffer.from('%PDF-1.4\nCorrupt trailer and broken catalog structure');
    await expect(
      ImportService.previewFacultyPdfImport(corruptBuffer, 'corrupt.pdf')
    ).rejects.toThrow(/structure/i);
  });

  // =========================================================================
  // 7. Preview & Cancel Perform ZERO Database Writes
  // =========================================================================
  it('previewing or cancelling a PDF upload performs zero database writes', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      doc.text('FAC-999 | Dr. Test Zero Write | Computer Science | Professor | zerowrite@institution.edu');
    });

    const initialFacultyCount = (db.prepare('SELECT COUNT(*) as count FROM faculty').get() as any).count;
    const initialAuditCount = (db.prepare('SELECT COUNT(*) as count FROM audit_logs').get() as any).count;

    // Run preview
    const preview = await ImportService.previewFacultyPdfImport(pdfBuffer, 'zero_writes.pdf');
    expect(preview.totalParsed).toBe(1);

    // Verify database is completely untouched
    const currentFacultyCount = (db.prepare('SELECT COUNT(*) as count FROM faculty').get() as any).count;
    const currentAuditCount = (db.prepare('SELECT COUNT(*) as count FROM audit_logs').get() as any).count;

    expect(currentFacultyCount).toBe(initialFacultyCount);
    expect(currentAuditCount).toBe(initialAuditCount);

    const phantomRecord = db.prepare("SELECT * FROM faculty WHERE id = 'FAC-999'").get();
    expect(phantomRecord).toBeUndefined();
  });

  // =========================================================================
  // 8. Explicit User Confirmation and Transactional Atomic Commit
  // =========================================================================
  it('imports validated records upon explicit confirmation in an atomic transaction', async () => {
    const newRecords: ExtractedFacultyRow[] = [
      {
        rowNumber: 1,
        id: 'FAC-501',
        name: 'Dr. Katherine Blodgett',
        email: 'blodgett@institution.edu',
        department: 'Physics',
        designation: 'Professor',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        action: 'ADD',
      },
      {
        rowNumber: 2,
        id: 'FAC-502',
        name: 'Dr. Chien-Shiung Wu',
        email: 'wu@institution.edu',
        department: 'Physics',
        designation: 'Professor',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        action: 'ADD',
      },
      {
        rowNumber: 3,
        id: 'FAC-503',
        name: 'Dr. Skip Me',
        email: 'skip@institution.edu',
        department: 'Physics',
        designation: 'Lecturer',
        confidence: 'LOW',
        isUncertain: true,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: true,
        action: 'SKIP',
        skipReason: 'Duplicate entry skipped by user',
      },
    ];

    const result = ImportService.commitFacultyPdfImport(newRecords, 'Dean Academic', false);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);

    // Verify records exist in database
    const f1 = db.prepare('SELECT * FROM faculty WHERE id = ?').get('FAC-501') as any;
    expect(f1).toBeDefined();
    expect(f1.name).toBe('Dr. Katherine Blodgett');
    expect(f1.department).toBe('Physics');

    const f2 = db.prepare('SELECT * FROM faculty WHERE id = ?').get('FAC-502') as any;
    expect(f2).toBeDefined();
    expect(f2.name).toBe('Dr. Chien-Shiung Wu');

    const skippedRecord = db.prepare('SELECT * FROM faculty WHERE id = ?').get('FAC-503') as any;
    expect(skippedRecord).toBeUndefined();
  });

  // =========================================================================
  // 9. Transaction Rollback on Failure & Integrity Preservation
  // =========================================================================
  it('rolls back entire transaction on fatal error, leaving database intact', () => {
    const recordsWithCollision: ExtractedFacultyRow[] = [
      {
        rowNumber: 1,
        id: 'FAC-601',
        name: 'Dr. Valid New Teacher',
        email: 'validnew@institution.edu',
        department: 'Mathematics',
        designation: 'Professor',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        action: 'ADD',
      },
      {
        rowNumber: 2,
        id: 'FAC-602',
        name: 'Dr. Collision Teacher',
        // Existing email from seed
        email: 'faculty.001@institution.edu',
        department: 'Mathematics',
        designation: 'Professor',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        action: 'ADD',
      },
    ];

    expect(() => {
      ImportService.commitFacultyPdfImport(recordsWithCollision, 'Admin', false);
    }).toThrow(/Email collision/i);

    // Verify FAC-601 was NOT committed due to transaction rollback
    const f1 = db.prepare("SELECT * FROM faculty WHERE id = 'FAC-601'").get();
    expect(f1).toBeUndefined();
  });

  // =========================================================================
  // 10. Existing Faculty & Approved Schedule Invalidation Guard
  // =========================================================================
  it('blocks updating department of faculty member assigned in approved schedule', () => {
    // Only keep 2 active rooms so the exam is feasible with 20 faculty
    db.prepare("UPDATE rooms SET active = 0 WHERE id NOT IN ('RM-001', 'RM-002')").run();

    // 1. Create and approve a schedule where faculty is assigned
    const exam = ExamService.create({
      id: 'EXAM-GUARD-TEST',
      name: 'Guard Examination',
      startDate: '2026-10-15',
      endDate: '2026-10-17',
      maxDutiesPerFaculty: 6,
      dates: [
        { date: '2026-10-15', sequenceOrder: 1, isExamDay: true },
        { date: '2026-10-17', sequenceOrder: 2, isExamDay: true },
      ],
    });

    const gen = ScheduleService.generate(exam.id, 'Admin');
    expect(gen.success).toBe(true);
    const approved = ScheduleService.approve(gen.scheduleId!, 'Dean');
    expect(approved.state).toBe('APPROVED');

    // Find a faculty member assigned in the approved schedule
    const assignment = db.prepare(`
      SELECT a.faculty_id, f.department as currentDept, r.id as roomId, r.exam_department as roomDept
      FROM assignments a
      JOIN faculty f ON a.faculty_id = f.id
      JOIN rooms r ON a.room_id = r.id
      WHERE a.schedule_id = ?
      LIMIT 1
    `).get(approved.id) as any;

    expect(assignment).toBeDefined();

    // Set the room's department to a target department that differs from currentDept
    const targetDept = assignment.currentDept === 'Computer Science & Engineering' ? 'Information Technology' : 'Computer Science & Engineering';
    db.prepare('UPDATE rooms SET exam_department = ? WHERE id = ?').run(
      targetDept,
      assignment.roomId
    );

    // Attempt to commit an imported update moving this assigned faculty to targetDept
    // (which violates Rule H6: teacher assigned to room matching their own department)
    const updateRecords: ExtractedFacultyRow[] = [
      {
        rowNumber: 1,
        id: assignment.faculty_id,
        name: 'Assigned Teacher',
        email: 'teacher.assigned@institution.edu',
        department: targetDept, // Conflicts with assigned room's exam_department
        designation: 'Professor',
        confidence: 'HIGH',
        isUncertain: false,
        uncertainFields: [],
        missingFields: [],
        isDuplicateInFile: false,
        action: 'UPDATE',
      },
    ];

    expect(() => {
      ImportService.commitFacultyPdfImport(updateRecords, 'Admin', true);
    }).toThrow(/conflicts with room.*approved schedule/i);
  });

  // =========================================================================
  // 11. Multi-Sheet Excel (.xlsx) Import with Varied Headers & Formula Defense
  // =========================================================================
  it('imports faculty across multiple worksheets with varied headers and protects against formula injection', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();

    // Sheet 1: CSE Department
    const sheet1 = wb.addWorksheet('CSE Faculty');
    sheet1.addRow(['Emp ID', 'Teacher Name', 'Official Email', 'Dept', 'Designation']);
    sheet1.addRow(['FAC-X101', 'Dr. Donald Knuth', 'knuth@institution.edu', 'Computer Science', 'Professor']);
    sheet1.addRow(['FAC-X102', 'Dr. Leslie Lamport', 'lamport@institution.edu', 'Computer Science', 'Professor']);

    // Sheet 2: Mathematics Department with formula
    const sheet2 = wb.addWorksheet('Math Faculty');
    sheet2.addRow(['Faculty No', 'Full Name', 'Mail', 'Branch', 'Title']);
    // Row with formula value and formula prefix
    const r2 = sheet2.addRow(['FAC-X201', 'Dr. Terence Tao', 'tao@institution.edu', 'Mathematics', 'Professor']);
    // Also test formula injection string
    sheet2.addRow(['FAC-X202', '=Dr. Hypatia of Alexandria', 'hypatia@institution.edu', 'Mathematics', 'Associate Professor']);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const preview = await ImportService.previewFacultyImport(buffer, 'xlsx');
    expect(preview.canCommit).toBe(true);
    expect(preview.totalRows).toBe(4);
    expect(preview.validRows).toBe(4);

    const names = preview.rows.map((r) => r.data.name);
    expect(names).toContain('Dr. Donald Knuth');
    expect(names).toContain('Dr. Leslie Lamport');
    expect(names).toContain('Dr. Terence Tao');
    // Verify formula '=' was stripped
    expect(names).toContain('Dr. Hypatia of Alexandria');
  });

  // =========================================================================
  // 12. Legacy .xls (Binary OLE) Rejection
  // =========================================================================
  it('clearly rejects unsupported legacy .xls binary format with actionable advice', async () => {
    // Construct fake OLE CFB header: D0 CF 11 E0 A1 B1 1A E1
    const legacyXlsBuffer = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00
    ]);

    await expect(
      ImportService.previewFacultyImport(legacyXlsBuffer, 'xlsx')
    ).rejects.toThrow(/Legacy Excel format \(\.xls binary\) is not supported/i);
  });
});

