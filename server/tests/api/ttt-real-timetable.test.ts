import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PdfTimetableParserService } from '../../src/services/pdf-timetable-parser.service';

describe('Priority A: Real Timetable PDF (ttt.pdf) Multi-Page & Multi-Cohort Analysis', () => {
  const fixturePath = path.resolve(__dirname, '../fixtures/ttt.pdf');

  it('verifies that ttt.pdf fixture exists and has valid PDF signature', () => {
    expect(fs.existsSync(fixturePath)).toBe(true);
    const buffer = fs.readFileSync(fixturePath);
    expect(buffer.length).toBeGreaterThan(100000);
    expect(() => PdfTimetableParserService.validatePdfBuffer(buffer)).not.toThrow();
  });

  it('correctly parses all 3 pages with distinct layout semantics and zero lost/fabricated records', async () => {
    const buffer = fs.readFileSync(fixturePath);
    const result = await PdfTimetableParserService.parseTimetablePdf(buffer, 'ttt.pdf');

    // Basic document validation
    expect(result.hasSelectableText).toBe(true);
    expect(result.totalPages).toBe(3);
    expect(result.totalParsed).toBe(80);
    expect(result.validCount).toBe(80);
    expect(result.incompleteCount).toBe(0);
    expect(result.conflictCount).toBe(0);
    expect(result.duplicateCount).toBe(0);

    // Summary assertions
    expect(result.summary.distinctSemestersCount).toBe(3);
    expect(result.summary.distinctSemesters).toContain('I-Semester');
    expect(result.summary.distinctSemesters).toContain('III-Semester');
    expect(result.summary.distinctSemesters).toContain('V-Semester');

    // Page 1: First-Semester assertions (Morning regular + 4 Online Slots)
    const p1Records = result.records.filter((r) => r.pageNumber === 1);
    expect(p1Records.length).toBe(20);

    const regularP1 = p1Records.filter((r) => r.slot?.startsWith('Regular'));
    expect(regularP1.length).toBe(12);
    expect(regularP1[0].date).toBe('2026-10-22');
    expect(regularP1[0].startTime).toBe('10:00');
    expect(regularP1[0].endTime).toBe('11:30');
    expect(regularP1[0].subjectCode).toContain('26BEPHY101');
    expect(regularP1[0].subjectName).toContain('Mathematics');

    const slotP1 = p1Records.filter((r) => r.slot?.startsWith('Slot'));
    expect(slotP1.length).toBe(8);
    // Verify slot timing boundaries on Page 1
    const slot1 = slotP1.find((r) => r.slot?.includes('Slot 1'));
    expect(slot1).toBeDefined();
    expect(slot1?.startTime).toBe('10:45');
    expect(slot1?.endTime).toBe('11:30');

    const slot4 = slotP1.find((r) => r.slot?.includes('Slot 4'));
    expect(slot4).toBeDefined();
    expect(slot4?.startTime).toBe('13:00');
    expect(slot4?.endTime).toBe('13:45');

    // Page 2: Third-Semester assertions (Parallel cohorts: CSE/AIML/AIDS/CSE-DS vs ECE/EEE)
    const p2Records = result.records.filter((r) => r.pageNumber === 2);
    expect(p2Records.length).toBe(26);

    const p2Cse = p2Records.filter((r) => r.programGroup?.includes('CSE'));
    const p2Ece = p2Records.filter((r) => r.programGroup?.includes('ECE'));
    expect(p2Cse.length).toBe(11);
    expect(p2Ece.length).toBe(15);

    // Verify afternoon timings on Page 2 (2:00 – 3:30 -> 14:00 - 15:30)
    const p2Afternoon = p2Records.filter((r) => r.session === 'Afternoon');
    expect(p2Afternoon.length).toBeGreaterThan(0);
    expect(p2Afternoon[0].startTime).toBe('14:00');
    expect(p2Afternoon[0].endTime).toBe('15:30');

    // Page 3: Fifth-Semester assertions (Parallel cohorts)
    const p3Records = result.records.filter((r) => r.pageNumber === 3);
    expect(p3Records.length).toBe(34);

    const p3Cse = p3Records.filter((r) => r.programGroup?.includes('CSE'));
    const p3Ece = p3Records.filter((r) => r.programGroup?.includes('ECE'));
    expect(p3Cse.length).toBe(20);
    expect(p3Ece.length).toBe(14);

    // Check specific course codes and multi-code cells
    const multiCodeRow = result.records.find((r) => r.subjectCode.includes('/'));
    expect(multiCodeRow).toBeDefined();

    // Verify all records have valid dates in YYYY-MM-DD format
    for (const r of result.records) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(r.endTime).toMatch(/^\d{2}:\d{2}$/);
      expect(r.durationMinutes).toBeGreaterThan(0);
      expect(r.subjectCode.length).toBeGreaterThan(0);
      expect(r.subjectName.length).toBeGreaterThan(0);
      expect(r.hasConflict).toBe(false);
      expect(r.isDuplicateInFile).toBe(false);
    }
  });
});
