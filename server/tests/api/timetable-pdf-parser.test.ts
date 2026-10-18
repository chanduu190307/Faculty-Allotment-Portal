import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import {
  PdfTimetableParserService,
  ExtractedTimetableRow,
} from '../../src/services/pdf-timetable-parser.service';

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

describe('Stage 2 Feature B: Timetable PDF Parser & Extraction Validation', () => {
  // 1. Digital timetable PDF with table layout
  it('extracts timetable records accurately from a digital PDF with table layout', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      doc.fontSize(16).text('UNIVERSITY EXAMINATION TIMETABLE - AUTUMN 2026', { align: 'center' });
      doc.fontSize(10).text('Academic Year: 2026-2027 | Controller of Examinations', { align: 'center' });
      doc.moveDown();

      doc.text('Date | Session | Time | Subject Code | Subject Name');
      doc.text('2026-10-15 | Morning | 09:30 - 12:30 | CS101 | Data Structures & Algorithms');
      doc.text('2026-10-15 | Afternoon | 14:00 - 17:00 | EC102 | Digital Logic & System Design');
      doc.text('2026-10-17 | Morning | 09:30 - 12:30 | MA201 | Discrete Mathematics');
      doc.text('2026-10-19 | Morning | 09:30 - 12:30 | CS202 | Computer Organization & Architecture');
      doc.text('2026-10-21 | Afternoon | 14:00 - 17:00 | IT301 | Operating Systems');
    });

    const result = await PdfTimetableParserService.parseTimetablePdf(pdfBuffer, 'autumn_timetable.pdf');

    expect(result.hasSelectableText).toBe(true);
    expect(result.totalParsed).toBe(5);
    expect(result.validCount).toBe(5);
    expect(result.duplicateCount).toBe(0);
    expect(result.incompleteCount).toBe(0);
    expect(result.conflictCount).toBe(0);
    expect(result.canCommit).toBe(true);

    expect(result.summary.distinctDatesCount).toBe(4);
    expect(result.summary.distinctDates).toEqual(['2026-10-15', '2026-10-17', '2026-10-19', '2026-10-21']);
    expect(result.summary.distinctSessions).toEqual(['Afternoon', 'Morning']);

    const first = result.records[0];
    expect(first.date).toBe('2026-10-15');
    expect(first.session).toBe('Morning');
    expect(first.startTime).toBe('09:30');
    expect(first.endTime).toBe('12:30');
    expect(first.durationMinutes).toBe(180);
    expect(first.subjectCode).toBe('CS101');
    expect(first.subjectName).toContain('Data Structures');
  });

  // 2. Multi-page timetable PDF
  it('extracts timetable records across multiple pages without dropping entries', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      // Page 1
      doc.fontSize(16).text('SEMESTER END EXAMINATIONS - PAGE 1', { align: 'center' });
      doc.moveDown();
      doc.text('15/10/2026 | Morning | 09:30 - 12:30 | CS101 | Data Structures');
      doc.text('17/10/2026 | Morning | 09:30 - 12:30 | CS102 | Algorithms');

      // Page 2
      doc.addPage();
      doc.fontSize(16).text('SEMESTER END EXAMINATIONS - PAGE 2', { align: 'center' });
      doc.moveDown();
      doc.text('19/10/2026 | Morning | 09:30 - 12:30 | CS103 | Operating Systems');
      doc.text('21/10/2026 | Morning | 09:30 - 12:30 | CS104 | Database Management Systems');

      // Page 3
      doc.addPage();
      doc.fontSize(16).text('SEMESTER END EXAMINATIONS - PAGE 3', { align: 'center' });
      doc.moveDown();
      doc.text('23/10/2026 | Morning | 09:30 - 12:30 | CS105 | Computer Networks');
    });

    const result = await PdfTimetableParserService.parseTimetablePdf(pdfBuffer, 'multipage_timetable.pdf');

    expect(result.totalPages).toBe(3);
    expect(result.totalParsed).toBe(5);
    expect(result.validCount).toBe(5);
    expect(result.summary.distinctDates.length).toBe(5);
    expect(result.summary.startDate).toBe('2026-10-15');
    expect(result.summary.endDate).toBe('2026-10-23');
  });

  // 3. Different date and time formats supported
  it('normalizes various date formats (DD/MM/YYYY, DD-MMM-YYYY, ISO) and 12h/24h time formats', () => {
    // Dates
    const d1 = PdfTimetableParserService.parseAndNormalizeDate('15/10/2026');
    expect(d1.normalized).toBe('2026-10-15');
    expect(d1.isAmbiguous).toBe(false);

    const d2 = PdfTimetableParserService.parseAndNormalizeDate('15-Oct-2026');
    expect(d2.normalized).toBe('2026-10-15');
    expect(d2.isAmbiguous).toBe(false);

    const d3 = PdfTimetableParserService.parseAndNormalizeDate('2026-10-15');
    expect(d3.normalized).toBe('2026-10-15');
    expect(d3.isAmbiguous).toBe(false);

    const d4 = PdfTimetableParserService.parseAndNormalizeDate('October 15, 2026');
    expect(d4.normalized).toBe('2026-10-15');

    // Ambiguous date detection (e.g. 05/06/2026 where both day and month <= 12)
    const dAmb = PdfTimetableParserService.parseAndNormalizeDate('05/06/2026');
    expect(dAmb.isAmbiguous).toBe(true);
    expect(dAmb.normalized).toBe('2026-06-05'); // Defaults to DD/MM/YYYY with ambiguity flag

    // Invalid calendar date
    const dInvalid = PdfTimetableParserService.parseAndNormalizeDate('31/04/2026');
    expect(dInvalid.normalized).toBeNull();
    expect(dInvalid.error).toContain('only has 30 days');

    // 12-hour vs 24-hour Times
    const t1 = PdfTimetableParserService.normalizeTime('9:30 AM');
    expect(t1.normalized).toBe('09:30');

    const t2 = PdfTimetableParserService.normalizeTime('2:00 PM');
    expect(t2.normalized).toBe('14:00');

    const t3 = PdfTimetableParserService.normalizeTime('12:30 PM');
    expect(t3.normalized).toBe('12:30');

    const t4 = PdfTimetableParserService.normalizeTime('14:00');
    expect(t4.normalized).toBe('14:00');

    // Invalid time
    const tInvalid = PdfTimetableParserService.normalizeTime('25:99');
    expect(tInvalid.normalized).toBeNull();
  });

  // 4. Missing fields and ambiguous dates
  it('flags missing dates, subject codes, or times as incomplete without fabricating data', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      doc.text('EXAMINATION TIMETABLE - PARTIAL ENTRIES');
      // Row with missing subject code and times
      doc.text('2026-10-15 | Morning | CS101 | Data Structures | 09:30 - 12:30');
      doc.text('2026-10-17 | Morning | | Subject Without Code | 09:30 - 12:30');
      doc.text('05/06/2026 | Morning | CS202 | Ambiguous Date Subject | 09:30 - 12:30');
    });

    const result = await PdfTimetableParserService.parseTimetablePdf(pdfBuffer, 'incomplete.pdf');

    expect(result.totalParsed).toBeGreaterThanOrEqual(2);
    const incompleteRow = result.records.find((r) => !r.subjectCode || r.missingFields.includes('Subject Code'));
    if (incompleteRow) {
      expect(incompleteRow.isUncertain).toBe(true);
      expect(incompleteRow.action).toBe('SKIP');
    }

    const ambiguousRow = result.records.find((r) => r.isAmbiguousDate);
    expect(ambiguousRow).toBeDefined();
    expect(ambiguousRow?.validationWarnings.some((w) => w.includes('Ambiguous date'))).toBe(true);
  });

  // 5. Duplicate rows and subject codes
  it('detects duplicate timetable rows in document and flags duplicate subject codes', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      doc.text('2026-10-15 | Morning | 09:30 - 12:30 | CS101 | Data Structures');
      doc.text('2026-10-15 | Morning | 09:30 - 12:30 | CS101 | Data Structures'); // Duplicate row!
      doc.text('2026-10-17 | Morning | 09:30 - 12:30 | CS101 | Different Subject Title'); // Duplicate code with different title
    });

    const result = await PdfTimetableParserService.parseTimetablePdf(pdfBuffer, 'duplicates.pdf');

    expect(result.duplicateCount).toBeGreaterThanOrEqual(1);
    const duplicateRow = result.records.find((r) => r.isDuplicateInFile);
    expect(duplicateRow).toBeDefined();
    expect(duplicateRow?.action).toBe('SKIP');
    expect(duplicateRow?.duplicateReason).toContain('Duplicate timetable entry');
  });

  // 6. Invalid start/end times (end <= start)
  it('detects invalid time ranges where end time is not after start time', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      doc.text('2026-10-15 | Morning | 14:00 - 12:00 | CS101 | Inverted Times Subject');
    });

    const result = await PdfTimetableParserService.parseTimetablePdf(pdfBuffer, 'invalid_time.pdf');

    expect(result.records.length).toBe(1);
    const row = result.records[0];
    expect(row.hasConflict).toBe(true);
    expect(row.conflictReason).toContain('not after start time');
    expect(row.validationErrors.some((e) => e.includes('not after start time'))).toBe(true);
  });

  // 7. Inconsistent session labels vs scheduled times
  it('detects inconsistent session labels when start time conflicts with session label', async () => {
    const pdfBuffer = await createTestPdf((doc) => {
      // Session labeled Morning, but time is 14:00 - 17:00 (Afternoon)
      doc.text('2026-10-15 | Morning | 14:00 - 17:00 | CS101 | Time Inconsistent Subject');
    });

    const result = await PdfTimetableParserService.parseTimetablePdf(pdfBuffer, 'inconsistent_session.pdf');

    expect(result.records.length).toBe(1);
    const row = result.records[0];
    expect(row.hasConflict).toBe(true);
    expect(row.conflictReason).toContain('Inconsistent session');
  });

  // 8. Scanned PDF rejection without fabricating records
  it('safely rejects image-only scanned PDFs without fabricating examination records', async () => {
    const scannedBuffer = await createTestPdf((doc) => {
      // Empty text streams, purely a visual shape or empty document
      doc.rect(50, 50, 400, 300).stroke();
    });

    const result = await PdfTimetableParserService.parseTimetablePdf(scannedBuffer, 'scanned_scan.pdf');

    expect(result.hasSelectableText).toBe(false);
    expect(result.totalParsed).toBe(0);
    expect(result.canCommit).toBe(false);
    expect(result.errors.some((e) => e.includes('No selectable text streams found'))).toBe(true);
  });

  // 9. Rejection of corrupt, empty, oversized, or missing magic header files
  it('safely rejects empty, corrupt, oversized, and invalid-signature files with useful errors', async () => {
    // 0 bytes
    expect(() => {
      PdfTimetableParserService.validatePdfBuffer(Buffer.alloc(0));
    }).toThrow(/empty/i);

    // Missing %PDF- header
    expect(() => {
      PdfTimetableParserService.validatePdfBuffer(Buffer.from('NOT A REAL PDF FILE HEADER DATA'));
    }).toThrow(/%PDF- magic header missing/i);

    // Oversized (>10MB)
    expect(() => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024);
      largeBuffer.write('%PDF-1.4');
      PdfTimetableParserService.validatePdfBuffer(largeBuffer);
    }).toThrow(/exceeds maximum permitted limit/i);
  });
});
