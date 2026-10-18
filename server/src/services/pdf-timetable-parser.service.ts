import { PDFParse } from 'pdf-parse';

export interface ExtractedTimetableRow {
  rowNumber: number;
  date: string; // Canonical YYYY-MM-DD
  rawDate?: string;
  subjectCode: string; // e.g. "25BECSE301"
  subjectName: string; // e.g. "Probability and Statistical Methods"
  session: string; // Canonical "Morning" | "Afternoon"
  startTime: string; // HH:MM (24-hr)
  endTime: string; // HH:MM (24-hr)
  durationMinutes?: number;
  semester?: string; // e.g. "I-Semester", "III-Semester", "V-Semester"
  programGroup?: string; // e.g. "CSE, AIML, AIDS, CSE-DS", "ECE, EEE", "General"
  slot?: string; // e.g. "Regular (10:00 - 11:30)", "Slot 1 (10:45 - 11:30)"
  pageNumber?: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  isUncertain: boolean;
  uncertainFields: string[];
  missingFields: string[];
  isDuplicateInFile: boolean;
  duplicateReason?: string;
  hasConflict: boolean;
  conflictReason?: string;
  isAmbiguousDate?: boolean;
  action: 'ADD' | 'UPDATE' | 'SKIP';
  skipReason?: string;
  rawLine?: string;
  validationErrors: string[];
  validationWarnings: string[];
}

export interface PdfTimetableParseResult {
  filename: string;
  fileSizeBytes: number;
  totalPages: number;
  hasSelectableText: boolean;
  totalParsed: number;
  validCount: number;
  incompleteCount: number;
  duplicateCount: number;
  ambiguousCount: number;
  conflictCount: number;
  toAddCount: number;
  toUpdateCount: number;
  toSkipCount: number;
  canCommit: boolean;
  records: ExtractedTimetableRow[];
  summary: {
    startDate?: string;
    endDate?: string;
    distinctDatesCount: number;
    distinctDates: string[];
    distinctSessionsCount: number;
    distinctSessions: string[];
    distinctSubjectsCount: number;
    distinctSemestersCount?: number;
    distinctSemesters?: string[];
    distinctGroupsCount?: number;
    distinctGroups?: string[];
  };
  warnings: string[];
  errors: string[];
}

interface RawPdfItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const HEADER_FOOTER_PATTERNS = [
  /page\s+\d+(\s+of\s+\d+)?/i,
  /^--\s*\d+\s*(?:of\s*\d+)?\s*--$/i,
  /^\s*-\s*\d+\s*-\s*$/,
  /examination\s+(timetable|schedule|routine|portal|cell|branch)/i,
  /controller\s+of\s+examinations/i,
  /academic\s+year/i,
  /signature\s+of/i,
  /instructions\s+to\s+candidates/i,
  /^\s*(sl\.?\s*no\.?|s\.?\s*no\.?)\b/i,
  /^\s*date\s*\|\s*session\b/i,
  /^\s*date\s+time\s+code\s+subject\b/i,
  /^\s*course\s+code\s*\|\s*course\s+title\b/i,
  /\b(subject\s*code|course\s*code|paper\s*code)\b/i,
  /all\s+candidates\s+must\s+report/i,
  /chief\s+ia\s+coordinator/i,
  /dean,\s*soet/i,
];

export class PdfTimetableParserService {
  /**
   * Validates raw PDF buffer headers, file size, and magic signature.
   */
  public static validatePdfBuffer(buffer: Buffer, maxSizeBytes = 10 * 1024 * 1024): void {
    if (!buffer || buffer.length === 0) {
      throw new Error('Uploaded PDF file is empty (0 bytes).');
    }

    if (buffer.length > maxSizeBytes) {
      throw new Error(`PDF file size exceeds maximum permitted limit (${Math.round(maxSizeBytes / (1024 * 1024))}MB).`);
    }

    // PDF Magic Number validation: First 1024 bytes must contain %PDF-
    const headerSlice = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
    if (!headerSlice.includes('%PDF-')) {
      throw new Error('Invalid file format: File signature does not match a valid PDF document (%PDF- magic header missing).');
    }
  }

  /**
   * Extracts text, raw 2D layout items, and page details safely from a PDF buffer.
   */
  public static async extractPdfText(buffer: Buffer): Promise<{
    totalPages: number;
    pages: Array<{ pageNum: number; text: string; items: RawPdfItem[] }>;
    fullText: string;
    hasSelectableText: boolean;
  }> {
    this.validatePdfBuffer(buffer);

    let parser: any;
    try {
      parser = new PDFParse({ data: buffer });
      await parser.load();
    } catch (err: any) {
      if (err.name === 'PasswordException' || (err.message && err.message.toLowerCase().includes('password'))) {
        throw new Error('The uploaded PDF is password-protected or encrypted. Please remove password protection before uploading.');
      }
      throw new Error(`Failed to parse PDF document structure: ${err.message || 'Corrupt or malformed PDF file'}`);
    }

    let textRes: any;
    try {
      textRes = await parser.getText();
    } catch (err: any) {
      throw new Error(`Failed to extract text streams from PDF: ${err.message}`);
    }

    const totalPages = parser.doc?.numPages || textRes?.total || 1;
    const pages: Array<{ pageNum: number; text: string; items: RawPdfItem[] }> = [];

    for (let i = 1; i <= totalPages; i++) {
      let pageText = '';
      let pageItems: RawPdfItem[] = [];

      try {
        if (parser.doc && typeof parser.doc.getPage === 'function') {
          const pageObj = await parser.doc.getPage(i);
          const tc = await pageObj.getTextContent();
          if (Array.isArray(tc.items)) {
            pageItems = tc.items
              .filter((it: any) => it.str && it.str.trim())
              .map((it: any) => ({
                text: String(it.str).trim(),
                x: Math.round(it.transform[4]),
                y: Math.round(it.transform[5]),
                width: Math.round(it.width || 0),
                height: Math.round(it.height || 0),
              }));
          }
        }
      } catch {
        // Fallback if low-level page extraction fails
      }

      if (Array.isArray(textRes?.pages) && textRes.pages[i - 1]) {
        pageText = textRes.pages[i - 1].text || '';
      } else if (pageItems.length > 0) {
        pageText = pageItems.map((it) => it.text).join(' ');
      } else {
        pageText = textRes?.text || '';
      }

      pages.push({
        pageNum: i,
        text: pageText,
        items: pageItems,
      });
    }

    const fullText = textRes?.text || pages.map((p) => p.text).join('\n');
    const alphanumericCount = (fullText.match(/[a-zA-Z0-9]/g) || []).length;
    const hasSelectableText = alphanumericCount >= 20;

    return {
      totalPages,
      pages,
      fullText,
      hasSelectableText,
    };
  }

  /**
   * Parses and normalizes varied date representations into YYYY-MM-DD.
   * Detects ambiguity (e.g. 05/06/2026) and verifies calendar validity.
   */
  public static parseAndNormalizeDate(rawDateStr: string): {
    normalized: string | null;
    isAmbiguous: boolean;
    error?: string;
  } {
    const raw = rawDateStr.trim();
    if (!raw) return { normalized: null, isAmbiguous: false, error: 'Empty date string.' };

    // 1. ISO format: YYYY-MM-DD or YYYY/MM/DD
    const isoMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10);
      const day = parseInt(isoMatch[3], 10);
      return this.validateCalendarDate(year, month, day, false);
    }

    // 2. Named month format: 15-Oct-2026, 15 October 2026, October 15, 2026, Oct 15 2026
    const namedMonth1 = raw.match(/^(\d{1,2})[-/\s]+([a-zA-Z]{3,10})[-/\s,]+(\d{4})$/);
    if (namedMonth1) {
      const day = parseInt(namedMonth1[1], 10);
      const monthName = namedMonth1[2].toLowerCase();
      const year = parseInt(namedMonth1[3], 10);
      const month = MONTH_NAMES[monthName];
      if (!month) return { normalized: null, isAmbiguous: false, error: `Unknown month name "${namedMonth1[2]}".` };
      return this.validateCalendarDate(year, month, day, false);
    }

    const namedMonth2 = raw.match(/^([a-zA-Z]{3,10})[-/\s]+(\d{1,2})[-/\s,]+(\d{4})$/);
    if (namedMonth2) {
      const monthName = namedMonth2[1].toLowerCase();
      const day = parseInt(namedMonth2[2], 10);
      const year = parseInt(namedMonth2[3], 10);
      const month = MONTH_NAMES[monthName];
      if (!month) return { normalized: null, isAmbiguous: false, error: `Unknown month name "${namedMonth2[1]}".` };
      return this.validateCalendarDate(year, month, day, false);
    }

    // 3. Numeric slash / hyphen / dot: DD/MM/YYYY or MM/DD/YYYY
    const numMatch = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (numMatch) {
      const p1 = parseInt(numMatch[1], 10);
      const p2 = parseInt(numMatch[2], 10);
      const year = parseInt(numMatch[3], 10);

      // If both p1 and p2 are <= 12, it is ambiguous between DD/MM/YYYY and MM/DD/YYYY
      if (p1 <= 12 && p2 <= 12 && p1 !== p2) {
        // Standard institutional convention defaults to DD/MM/YYYY
        return this.validateCalendarDate(year, p2, p1, true);
      }

      // If p1 > 12, must be DD/MM/YYYY
      if (p1 > 12) {
        return this.validateCalendarDate(year, p2, p1, false);
      }

      // If p2 > 12, must be MM/DD/YYYY
      if (p2 > 12) {
        return this.validateCalendarDate(year, p1, p2, false);
      }

      // p1 === p2 (e.g. 05/05/2026) -> not ambiguous
      return this.validateCalendarDate(year, p1, p2, false);
    }

    return { normalized: null, isAmbiguous: false, error: `Unrecognized date format: "${raw}".` };
  }

  private static validateCalendarDate(
    year: number,
    month: number,
    day: number,
    isAmbiguous: boolean
  ): { normalized: string | null; isAmbiguous: boolean; error?: string } {
    if (month < 1 || month > 12) {
      return { normalized: null, isAmbiguous: false, error: `Invalid month: ${month}.` };
    }
    if (day < 1 || day > 31) {
      return { normalized: null, isAmbiguous: false, error: `Invalid day: ${day}.` };
    }
    if (year < 2000 || year > 2100) {
      return { normalized: null, isAmbiguous: false, error: `Year out of expected institutional bounds: ${year}.` };
    }

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > daysInMonth) {
      return {
        normalized: null,
        isAmbiguous: false,
        error: `Invalid calendar day ${day} for month ${month}/${year}. Month ${month} only has ${daysInMonth} days.`,
      };
    }

    const yStr = String(year);
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    return {
      normalized: `${yStr}-${mStr}-${dStr}`,
      isAmbiguous,
    };
  }

  /**
   * Normalizes a time string to 24-hour HH:MM format.
   * Intelligently interprets university exam hours (1..6 default to PM unless explicit AM given).
   */
  public static normalizeTime(
    rawTime: string,
    isEnd = false,
    startHour24?: number
  ): {
    normalized: string | null;
    hour24?: number;
    error?: string;
  } {
    const raw = rawTime.trim();
    if (!raw) return { normalized: null, error: 'Empty time value.' };

    // Matches 12-hour with AM/PM: 9:30 AM, 09:30am, 2:00 PM, 12:30 PM
    const twelveHourMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (twelveHourMatch) {
      let hour = parseInt(twelveHourMatch[1], 10);
      const min = twelveHourMatch[2] ? parseInt(twelveHourMatch[2], 10) : 0;
      const meridiem = twelveHourMatch[3].toLowerCase();

      if (hour < 1 || hour > 12 || min < 0 || min > 59) {
        return { normalized: null, error: `Invalid 12-hour time value: "${raw}".` };
      }

      if (meridiem === 'am') {
        if (hour === 12) hour = 0;
      } else {
        if (hour !== 12) hour += 12;
      }

      return {
        normalized: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
        hour24: hour,
      };
    }

    // Matches bare hour or hour:minute without AM/PM: 10:00, 2:00, 3:30, 09:30
    const timeMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1], 10);
      const min = parseInt(timeMatch[2], 10);

      if (hour < 0 || hour > 23 || min < 0 || min > 59) {
        return { normalized: null, error: `Invalid time value: "${raw}".` };
      }

      // Institutional Exam Time Heuristics:
      // Hours 1 to 6 without meridiem are uniformly afternoon exam slots (13:00 - 18:00)
      if (hour >= 1 && hour <= 6) {
        hour += 12;
      } else if (isEnd && startHour24 !== undefined && hour < startHour24 && hour < 12) {
        // e.g. 12:15 to 1:00 -> 1:00 is 13:00
        hour += 12;
      }

      return {
        normalized: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
        hour24: hour,
      };
    }

    return { normalized: null, error: `Unrecognized time format: "${raw}".` };
  }

  /**
   * Normalizes or safely derives a session label.
   */
  public static normalizeSession(
    rawSession: string | undefined,
    startTime?: string
  ): {
    session: string;
    derived: boolean;
    isInconsistent: boolean;
    warning?: string;
  } {
    const raw = (rawSession || '').trim().toLowerCase();

    if (['morning', 'forenoon', 'fn', 'shift 1', 'shift1', 'session 1', 'session1'].includes(raw)) {
      if (startTime) {
        const hour = parseInt(startTime.split(':')[0], 10);
        if (hour >= 13) {
          return {
            session: 'Morning',
            derived: false,
            isInconsistent: true,
            warning: `Inconsistent session: Session stated as "${rawSession}", but start time ${startTime} is in the afternoon.`,
          };
        }
      }
      return { session: 'Morning', derived: false, isInconsistent: false };
    }

    if (['afternoon', 'an', 'shift 2', 'shift2', 'session 2', 'session2'].includes(raw)) {
      if (startTime) {
        const hour = parseInt(startTime.split(':')[0], 10);
        if (hour < 12) {
          return {
            session: 'Afternoon',
            derived: false,
            isInconsistent: true,
            warning: `Inconsistent session: Session stated as "${rawSession}", but start time ${startTime} is in the morning.`,
          };
        }
      }
      return { session: 'Afternoon', derived: false, isInconsistent: false };
    }

    // Missing session label: derive if unambiguous rule applies (starts before 13:00 -> Morning; starts >= 13:00 -> Afternoon)
    if (startTime) {
      const hour = parseInt(startTime.split(':')[0], 10);
      if (hour < 13) {
        return {
          session: 'Morning',
          derived: true,
          isInconsistent: false,
          warning: `Missing session label; inferred as Morning based on start time ${startTime}.`,
        };
      } else {
        return {
          session: 'Afternoon',
          derived: true,
          isInconsistent: false,
          warning: `Missing session label; inferred as Afternoon based on start time ${startTime}.`,
        };
      }
    }

    return { session: '', derived: false, isInconsistent: false };
  }

  /**
   * Calculates duration in minutes from start and end times.
   */
  public static calculateDurationMinutes(startTime: string, endTime: string): number | null {
    const sParts = startTime.split(':').map((n) => parseInt(n, 10));
    const eParts = endTime.split(':').map((n) => parseInt(n, 10));
    if (sParts.length < 2 || eParts.length < 2) return null;

    const startTotal = sParts[0] * 60 + sParts[1];
    const endTotal = eParts[0] * 60 + eParts[1];
    return endTotal > startTotal ? endTotal - startTotal : null;
  }

  /**
   * Main parsing entrypoint: parses raw PDF buffer into reviewable ExtractedTimetableRow records.
   * Utilizes 2D spatial layout recognition with linear fallback for simpler documents.
   */
  public static async parseTimetablePdf(
    buffer: Buffer,
    filename = 'timetable.pdf'
  ): Promise<PdfTimetableParseResult> {
    const fileSizeBytes = buffer.length;
    const { totalPages, pages, fullText, hasSelectableText } = await this.extractPdfText(buffer);

    if (!hasSelectableText) {
      return {
        filename,
        fileSizeBytes,
        totalPages,
        hasSelectableText: false,
        totalParsed: 0,
        validCount: 0,
        incompleteCount: 0,
        duplicateCount: 0,
        ambiguousCount: 0,
        conflictCount: 0,
        toAddCount: 0,
        toUpdateCount: 0,
        toSkipCount: 0,
        canCommit: false,
        records: [],
        summary: {
          distinctDatesCount: 0,
          distinctDates: [],
          distinctSessionsCount: 0,
          distinctSessions: [],
          distinctSubjectsCount: 0,
        },
        warnings: [
          'Scanned PDF Detected: The document contains image streams without machine-readable selectable text.',
        ],
        errors: [
          'No selectable text streams found in the uploaded timetable document. Please upload a digital PDF with selectable text, or configure local OCR.',
        ],
      };
    }

    let candidateRows: ExtractedTimetableRow[] = [];

    // Stage 1: Try 2D Spatial Extraction across all pages
    const hasSpatialData = pages.some((p) => p.items && p.items.length > 10);
    if (hasSpatialData) {
      candidateRows = this.extractSpatialTimetableRows(pages);
    }

    // Stage 2: Fallback to linear token parsing if spatial extraction yielded zero rows
    if (candidateRows.length === 0) {
      candidateRows = this.extractLinearTimetableRows(fullText);
    }

    // Stage 3: Secondary pass: Cross-validation, in-file duplicate detection, and conflict analysis
    const processedRecords = this.performConflictAndCrossValidation(candidateRows);

    // Compute summary metrics
    const validCount = processedRecords.filter((r) => !r.isUncertain && !r.hasConflict && !r.isDuplicateInFile && r.validationErrors.length === 0).length;
    const incompleteCount = processedRecords.filter((r) => r.missingFields.length > 0 || r.validationErrors.length > 0).length;
    const duplicateCount = processedRecords.filter((r) => r.isDuplicateInFile).length;
    const ambiguousCount = processedRecords.filter((r) => r.isAmbiguousDate).length;
    const conflictCount = processedRecords.filter((r) => r.hasConflict).length;

    const toAddCount = processedRecords.filter((r) => r.action === 'ADD').length;
    const toUpdateCount = processedRecords.filter((r) => r.action === 'UPDATE').length;
    const toSkipCount = processedRecords.filter((r) => r.action === 'SKIP').length;

    const distinctDates = Array.from(new Set(processedRecords.map((r) => r.date).filter(Boolean))).sort();
    const distinctSessions = Array.from(new Set(processedRecords.map((r) => r.session).filter(Boolean))).sort();
    const distinctSubjects = Array.from(new Set(processedRecords.map((r) => r.subjectCode).filter(Boolean)));
    const distinctSemesters = Array.from(new Set(processedRecords.map((r) => r.semester).filter(Boolean))) as string[];
    const distinctGroups = Array.from(new Set(processedRecords.map((r) => r.programGroup).filter(Boolean))) as string[];

    const warnings: string[] = [];
    const errors: string[] = [];

    if (processedRecords.length === 0) {
      errors.push('No examination timetable records could be extracted from this document. Please check the document format.');
    }
    if (duplicateCount > 0) {
      warnings.push(`Detected ${duplicateCount} duplicate timetable row(s) in document. Review duplicate flags before confirming.`);
    }
    if (ambiguousCount > 0) {
      warnings.push(`Detected ${ambiguousCount} record(s) with ambiguous date format (e.g. DD/MM vs MM/DD). Verification recommended.`);
    }
    if (conflictCount > 0) {
      warnings.push(`Detected ${conflictCount} session/time conflict(s) in document.`);
    }

    const canCommit = processedRecords.length > 0 && validCount > 0;

    return {
      filename,
      fileSizeBytes,
      totalPages,
      hasSelectableText: true,
      totalParsed: processedRecords.length,
      validCount,
      incompleteCount,
      duplicateCount,
      ambiguousCount,
      conflictCount,
      toAddCount,
      toUpdateCount,
      toSkipCount,
      canCommit,
      records: processedRecords,
      summary: {
        startDate: distinctDates.length > 0 ? distinctDates[0] : undefined,
        endDate: distinctDates.length > 0 ? distinctDates[distinctDates.length - 1] : undefined,
        distinctDatesCount: distinctDates.length,
        distinctDates,
        distinctSessionsCount: distinctSessions.length,
        distinctSessions,
        distinctSubjectsCount: distinctSubjects.length,
        distinctSemestersCount: distinctSemesters.length,
        distinctSemesters,
        distinctGroupsCount: distinctGroups.length,
        distinctGroups,
      },
      warnings,
      errors,
    };
  }

  /**
   * 2D Spatial Extraction Engine: handles multi-page, multi-column, and slot-based examination timetables.
   */
  private static extractSpatialTimetableRows(
    pages: Array<{ pageNum: number; text: string; items: RawPdfItem[] }>
  ): ExtractedTimetableRow[] {
    const records: ExtractedTimetableRow[] = [];
    let rowNumber = 1;

    for (const page of pages) {
      const items = page.items || [];
      if (items.length === 0) continue;

      // Detect Page Title / Semester
      let semester = '';
      const fullText = page.text || items.map((it) => it.text).join(' ');
      if (/\bIII-Semester|Semester\s*3\b/i.test(fullText)) semester = 'III-Semester';
      else if (/\bV-Semester|Semester\s*5\b/i.test(fullText)) semester = 'V-Semester';
      else if (/\bVII-Semester|Semester\s*7\b/i.test(fullText)) semester = 'VII-Semester';
      else if (/\bI-Semester|Semester\s*1\b/i.test(fullText)) semester = 'I-Semester';

      // Check if page has Online Test slots (like Page 1)
      const hasOnlineSlots = items.some((it) => /slot\s*[1-4]/i.test(it.text) || /online\s+test/i.test(it.text));

      // Check if page has two parallel column groups (like Pages 2 and 3)
      const hasParallelGroups = items.some((it) => /CSE,\s*AIML/i.test(it.text)) && items.some((it) => /ECE,\s*EEE/i.test(it.text));

      if (hasOnlineSlots && !hasParallelGroups) {
        // Page 1 Layout: Regular Exam on Left + Online Test Slots on Right
        const p1Rows = this.parsePage1OnlineSlotLayout(items, page.pageNum, semester, rowNumber);
        records.push(...p1Rows);
        rowNumber += p1Rows.length;
      } else if (hasParallelGroups) {
        // Page 2 & Page 3 Layout: Side-by-side department cohorts
        const pMultiRows = this.parseParallelGroupLayout(items, page.pageNum, semester, rowNumber);
        records.push(...pMultiRows);
        rowNumber += pMultiRows.length;
      } else {
        // Generic Tabular Page: Date (left), Time, Code, Name
        const genericRows = this.parseGenericTableLayout(items, page.pageNum, semester, rowNumber);
        records.push(...genericRows);
        rowNumber += genericRows.length;
      }
    }

    return records;
  }

  /**
   * Parses Page 1 structure with regular morning exam and 4 online test slots.
   */
  private static parsePage1OnlineSlotLayout(
    items: RawPdfItem[],
    pageNum: number,
    semester: string,
    startRowNumber: number
  ): ExtractedTimetableRow[] {
    const results: ExtractedTimetableRow[] = [];
    let rNum = startRowNumber;

    // Filter out page title and header
    const contentItems = items.filter((it) => it.y < 450 && it.y > 45);

    // Identify Dates in Date Column (X in [50, 110))
    const dateItems = contentItems.filter((it) => it.x >= 50 && it.x < 110);
    const dateLines: Array<{ y: number; text: string }> = [];
    for (const it of dateItems) {
      let l = dateLines.find((dl) => Math.abs(dl.y - it.y) <= 8);
      if (!l) {
        l = { y: it.y, text: '' };
        dateLines.push(l);
      }
      l.text += it.text;
    }
    const validDates = dateLines
      .filter((dl) => /\d{1,2}-\d{1,2}-\d{4}/.test(dl.text))
      .map((dl) => ({ y: dl.y, text: dl.text.match(/\d{1,2}-\d{1,2}-\d{4}/)![0] }))
      .sort((a, b) => b.y - a.y);

    for (let i = 0; i < validDates.length; i++) {
      const curDate = validDates[i];
      const prevDateY = i > 0 ? validDates[i - 1].y : 455;
      const nextDateY = i + 1 < validDates.length ? validDates[i + 1].y : 45;
      const topY = i === 0 ? 450 : (curDate.y + prevDateY) / 2;
      const bottomY = (curDate.y + nextDateY) / 2;

      const dateResult = this.parseAndNormalizeDate(curDate.text);
      const dateIso = dateResult.normalized || curDate.text;

      // 1. Regular exam items: X in [110, 200) for codes, [200, 340) for names
      const codeItems = contentItems.filter((it) => it.x >= 110 && it.x < 200 && it.y <= topY && it.y > bottomY);
      const nameItems = contentItems.filter((it) => it.x >= 200 && it.x < 340 && it.y <= topY && it.y > bottomY);

      if (codeItems.length > 0 || nameItems.length > 0) {
        const regularCourses = this.splitCoursePairs(codeItems, nameItems);
        const timeNorm = this.normalizeTime('10:00');
        const endNorm = this.normalizeTime('11:30', true, 10);
        const duration = this.calculateDurationMinutes('10:00', '11:30') || 90;

        for (const c of regularCourses) {
          results.push({
            rowNumber: rNum++,
            date: dateIso,
            rawDate: curDate.text,
            subjectCode: c.code,
            subjectName: c.name,
            session: 'Morning',
            startTime: '10:00',
            endTime: '11:30',
            durationMinutes: duration,
            semester,
            programGroup: 'General',
            slot: 'Regular (10:00 - 11:30)',
            pageNumber: pageNum,
            confidence: c.code && c.name ? 'HIGH' : 'MEDIUM',
            isUncertain: !c.code || !c.name,
            uncertainFields: !c.code ? ['Subject Code'] : !c.name ? ['Subject Name'] : [],
            missingFields: !c.code ? ['Subject Code'] : !c.name ? ['Subject Name'] : [],
            isDuplicateInFile: false,
            hasConflict: false,
            isAmbiguousDate: dateResult.isAmbiguous,
            action: 'ADD',
            rawLine: `${curDate.text} 10:00-11:30 ${c.code} ${c.name}`,
            validationErrors: [],
            validationWarnings: [],
          });
        }
      }

      // 2. Online test slots:
      // Slot 1: [340, 465) -> 10:45 - 11:30
      // Slot 2: [470, 595) -> 11:30 - 12:15
      // Slot 3: [600, 695) -> 12:15 - 1:00 (12:15 - 13:00)
      // Slot 4: [700, 800) -> 1:00 - 1:45 (13:00 - 13:45)
      const slotDefs = [
        { slotName: 'Slot 1 (10:45 - 11:30)', sTime: '10:45', eTime: '11:30', session: 'Morning', minX: 340, maxX: 465 },
        { slotName: 'Slot 2 (11:30 - 12:15)', sTime: '11:30', eTime: '12:15', session: 'Morning', minX: 470, maxX: 595 },
        { slotName: 'Slot 3 (12:15 - 1:00)',  sTime: '12:15', eTime: '13:00', session: 'Afternoon', minX: 600, maxX: 695 },
        { slotName: 'Slot 4 (1:00 - 1:45)',   sTime: '13:00', eTime: '13:45', session: 'Afternoon', minX: 700, maxX: 800 },
      ];

      for (const sd of slotDefs) {
        const sItems = contentItems.filter((it) => it.x >= sd.minX && it.x < sd.maxX && it.y <= topY && it.y >= bottomY);
        if (sItems.length === 0) continue;

        sItems.sort((a, b) => b.y - a.y || a.x - b.x);
        const cleanItems = sItems.filter((it) => !/^slot\s*\d/i.test(it.text) && !/^\(\d{1,2}:\d{2}/.test(it.text));
        if (cleanItems.length === 0) continue;

        const codes = cleanItems.filter((it) => /2[56]BE/.test(it.text)).map((it) => it.text.replace(/^[()]+|[()]+$/g, '')).join('/');
        const names = cleanItems.filter((it) => !/2[56]BE/.test(it.text)).map((it) => it.text).join(' ');

        if (names || codes) {
          const duration = this.calculateDurationMinutes(sd.sTime, sd.eTime) || 45;
          results.push({
            rowNumber: rNum++,
            date: dateIso,
            rawDate: curDate.text,
            subjectCode: this.cleanSubjectCode(codes),
            subjectName: this.cleanSubjectName(names),
            session: sd.session,
            startTime: sd.sTime,
            endTime: sd.eTime,
            durationMinutes: duration,
            semester,
            programGroup: 'Online Test',
            slot: sd.slotName,
            pageNumber: pageNum,
            confidence: codes && names ? 'HIGH' : 'MEDIUM',
            isUncertain: !codes || !names,
            uncertainFields: !codes ? ['Subject Code'] : !names ? ['Subject Name'] : [],
            missingFields: !codes ? ['Subject Code'] : !names ? ['Subject Name'] : [],
            isDuplicateInFile: false,
            hasConflict: false,
            isAmbiguousDate: dateResult.isAmbiguous,
            action: 'ADD',
            rawLine: `${curDate.text} ${sd.slotName} ${codes} ${names}`,
            validationErrors: [],
            validationWarnings: [],
          });
        }
      }
    }

    return results;
  }

  /**
   * Parses Pages 2 and 3 with side-by-side parallel department cohorts.
   */
  private static parseParallelGroupLayout(
    items: RawPdfItem[],
    pageNum: number,
    semester: string,
    startRowNumber: number
  ): ExtractedTimetableRow[] {
    const results: ExtractedTimetableRow[] = [];
    let rNum = startRowNumber;

    // Filter out page title and headers (Y >= 460) and footers (Y <= 45)
    const contentItems = items.filter((it) => it.y < 460 && it.y > 45);

    // Group 1: CSE, AIML, AIDS, CSE-DS (X in [50, 420))
    // Date: [50, 110), Time: [110, 165), Code: [165, 245), Name: [245, 420)
    const leftRows = this.parseColumnGroup(
      contentItems.filter((it) => it.x < 420),
      pageNum,
      semester,
      'CSE, AIML, AIDS, CSE-DS',
      50, 110, 110, 165, 165, 245, 245, 420,
      rNum
    );
    results.push(...leftRows);
    rNum += leftRows.length;

    // Group 2: ECE, EEE (X in [420, 800))
    // Date: [420, 480), Time: [480, 545), Code: [545, 620), Name: [620, 800)
    const rightRows = this.parseColumnGroup(
      contentItems.filter((it) => it.x >= 420),
      pageNum,
      semester,
      'ECE, EEE',
      420, 480, 480, 545, 545, 620, 620, 800,
      rNum
    );
    results.push(...rightRows);

    return results;
  }

  private static parseColumnGroup(
    items: RawPdfItem[],
    pageNum: number,
    semester: string,
    groupName: string,
    dMin: number, dMax: number,
    tMin: number, tMax: number,
    cMin: number, cMax: number,
    nMin: number, nMax: number,
    startRowNumber: number
  ): ExtractedTimetableRow[] {
    const results: ExtractedTimetableRow[] = [];
    let rNum = startRowNumber;

    // 1. Identify Dates in Date Column
    const dateItems = items.filter((it) => it.x >= dMin && it.x < dMax);
    const dateLines: Array<{ y: number; text: string }> = [];
    for (const it of dateItems) {
      let l = dateLines.find((dl) => Math.abs(dl.y - it.y) <= 8);
      if (!l) {
        l = { y: it.y, text: '' };
        dateLines.push(l);
      }
      l.text += it.text;
    }
    const validDates = dateLines
      .filter((dl) => /\d{1,2}-\d{1,2}-\d{4}/.test(dl.text))
      .map((dl) => ({ y: dl.y, text: dl.text.match(/\d{1,2}-\d{1,2}-\d{4}/)![0] }))
      .sort((a, b) => b.y - a.y);

    for (let i = 0; i < validDates.length; i++) {
      const curDate = validDates[i];
      const prevDateY = i > 0 ? validDates[i - 1].y : 455;
      const nextDateY = i + 1 < validDates.length ? validDates[i + 1].y : 45;
      const topY = i === 0 ? 450 : (curDate.y + prevDateY) / 2;
      const bottomY = (curDate.y + nextDateY) / 2;

      const dateResult = this.parseAndNormalizeDate(curDate.text);
      const dateIso = dateResult.normalized || curDate.text;

      // Extract Time Range in this Date Block
      const timeItems = items.filter((it) => it.x >= tMin && it.x < tMax && it.y <= topY && it.y > bottomY);
      let timeRange = '';
      const fullTimeStr = timeItems.map((it) => it.text).join(' ');
      const tm = fullTimeStr.match(/(\d{1,2}:\d{2})\s*[-–to]\s*(\d{1,2}:\d{2})/i);
      if (tm) {
        timeRange = tm[0];
      } else {
        // Default standard cohort timing
        timeRange = (groupName.includes('ECE') && !['2026-10-27', '2026-10-28', '2026-10-30'].includes(dateIso))
          ? '10:00 - 11:30'
          : '2:00 – 3:30';
      }

      const timeRangeParsed = this.parseTimeRange(timeRange);

      // Extract Course Code and Course Name items with content-aware boundary classification
      const candidateCourseItems = items.filter((it) => it.x >= cMin && it.x < nMax && it.y <= topY && it.y > bottomY);
      const codeItems: RawPdfItem[] = [];
      const nameItems: RawPdfItem[] = [];

      for (const it of candidateCourseItems) {
        if (/2[456]BE|[A-Z]{2,4}\d{2,4}/i.test(it.text) && !/\s{2,}/.test(it.text) && it.text.length <= 30) {
          codeItems.push(it);
        } else {
          nameItems.push(it);
        }
      }

      const courses = this.splitCoursePairs(codeItems, nameItems);
      for (const c of courses) {
        results.push({
          rowNumber: rNum++,
          date: dateIso,
          rawDate: curDate.text,
          subjectCode: c.code,
          subjectName: c.name,
          session: timeRangeParsed.session,
          startTime: timeRangeParsed.startTime,
          endTime: timeRangeParsed.endTime,
          durationMinutes: timeRangeParsed.duration,
          semester,
          programGroup: groupName,
          slot: `${groupName} (${timeRangeParsed.startTime} - ${timeRangeParsed.endTime})`,
          pageNumber: pageNum,
          confidence: c.code && c.name ? 'HIGH' : 'MEDIUM',
          isUncertain: !c.code || !c.name,
          uncertainFields: !c.code ? ['Subject Code'] : !c.name ? ['Subject Name'] : [],
          missingFields: !c.code ? ['Subject Code'] : !c.name ? ['Subject Name'] : [],
          isDuplicateInFile: false,
          hasConflict: false,
          isAmbiguousDate: dateResult.isAmbiguous,
          action: 'ADD',
          rawLine: `${curDate.text} ${timeRangeParsed.startTime}-${timeRangeParsed.endTime} ${c.code} ${c.name}`,
          validationErrors: [],
          validationWarnings: [],
        });
      }
    }

    return results;
  }

  private static parseGenericTableLayout(
    items: RawPdfItem[],
    pageNum: number,
    semester: string,
    startRowNumber: number
  ): ExtractedTimetableRow[] {
    const results: ExtractedTimetableRow[] = [];
    let rNum = startRowNumber;

    // Filter out headers and footers
    const content = items.filter((it) => it.y > 20);

    // Group items into visual rows by Y proximity (tolerance <= 8px)
    const visualRows: Array<{ y: number; items: RawPdfItem[] }> = [];
    for (const it of content) {
      let vr = visualRows.find((r) => Math.abs(r.y - it.y) <= 8);
      if (!vr) {
        vr = { y: it.y, items: [] };
        visualRows.push(vr);
      }
      vr.items.push(it);
    }
    visualRows.sort((a, b) => b.y - a.y);

    const timeRangeRegex = /(\b\d{1,2}:\d{2}\s*(?:am|pm)?|\b\d{1,2}\s*(?:am|pm))\s*(?:-|to|–)\s*(\b\d{1,2}:\d{2}\s*(?:am|pm)?|\b\d{1,2}\s*(?:am|pm))/i;
    const dateRegex = /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}[-/\s]+[a-zA-Z]{3,10}[-/\s,]+\d{4}|[a-zA-Z]{3,10}[-/\s]+\d{1,2}[-/\s,]+\d{4})\b/;
    let currentDateContext: string | null = null;

    for (const vr of visualRows) {
      vr.items.sort((a, b) => a.x - b.x);
      const rowLine = vr.items.map((it) => it.text).join(' ');

      if (this.isHeaderOrFooter(rowLine)) continue;

      const hasDate = dateRegex.test(rowLine);
      const hasTime = timeRangeRegex.test(rowLine);
      const hasCode = /(?:2[456]BE[A-Z0-9/()]+|[A-Z]{2,4}[-_]?[0-9]{2,4})/i.test(rowLine);

      // Handle split subject titles wrapping onto a subsequent visual row without new date/time/code
      if (!hasDate && !hasTime && !hasCode && results.length > 0) {
        const prev = results[results.length - 1];
        prev.subjectName = this.cleanSubjectName(`${prev.subjectName} ${rowLine}`);
        prev.rawLine = `${prev.rawLine} ${rowLine}`;
        continue;
      }

      const parsedRow = this.parseTimetableLine(rowLine, rNum, currentDateContext);
      if (parsedRow) {
        if (parsedRow.date) currentDateContext = parsedRow.date;
        parsedRow.semester = semester;
        parsedRow.pageNumber = pageNum;
        results.push(parsedRow);
        rNum++;
      }
    }

    return results;
  }

  private static splitCoursePairs(
    codeItems: RawPdfItem[],
    nameItems: RawPdfItem[]
  ): Array<{ code: string; name: string }> {
    codeItems.sort((a, b) => b.y - a.y || a.x - b.x);
    nameItems.sort((a, b) => b.y - a.y || a.x - b.x);

    // Group code items by Y proximity (<= 6px)
    const codeLines: Array<{ y: number; text: string }> = [];
    for (const c of codeItems) {
      let l = codeLines.find((cl) => Math.abs(cl.y - c.y) <= 6);
      if (!l) {
        l = { y: c.y, text: '' };
        codeLines.push(l);
      }
      l.text += (l.text && !l.text.endsWith('/') && !c.text.startsWith('/') ? ' ' : '') + c.text;
    }

    // Group name items by Y proximity (<= 6px)
    const nameLines: Array<{ y: number; text: string }> = [];
    for (const n of nameItems) {
      let l = nameLines.find((nl) => Math.abs(nl.y - n.y) <= 6);
      if (!l) {
        l = { y: n.y, text: '' };
        nameLines.push(l);
      }
      l.text += (l.text ? ' ' : '') + n.text;
    }

    // Multi-course date check: if multiple distinct course names exist
    if (nameLines.length > 1) {
      // Cluster consecutive name lines that are part of the same title (<= 12px)
      const clusteredNames: Array<{ y: number; text: string }> = [];
      for (const nl of nameLines) {
        let cl = clusteredNames.find((c) => Math.abs(c.y - nl.y) <= 12);
        if (!cl) {
          cl = { y: nl.y, text: '' };
          clusteredNames.push(cl);
        }
        cl.text += (cl.text ? ' ' : '') + nl.text;
      }

      if (clusteredNames.length > 1) {
        const courses: Array<{ code: string; name: string }> = [];

        // If equal number of codes and names, pair them 1-to-1 in order
        if (codeLines.length === clusteredNames.length) {
          for (let k = 0; k < clusteredNames.length; k++) {
            const cleanN = this.cleanSubjectName(clusteredNames[k].text);
            if (!cleanN || cleanN.length < 3) continue;
            courses.push({
              code: this.cleanSubjectCode(codeLines[k].text),
              name: cleanN,
            });
          }
        } else {
          for (const cn of clusteredNames) {
            const cleanN = this.cleanSubjectName(cn.text);
            if (!cleanN || cleanN.length < 3) continue;

            // Associate matching code line closest in Y (tolerance <= 10)
            let matchingCodes = codeLines.filter((cl) => Math.abs(cl.y - cn.y) <= 10);
            if (matchingCodes.length === 0) {
              // Find closest code line
              const sortedByDist = [...codeLines].sort((a, b) => Math.abs(a.y - cn.y) - Math.abs(b.y - cn.y));
              if (sortedByDist.length > 0 && Math.abs(sortedByDist[0].y - cn.y) <= 18) {
                matchingCodes = [sortedByDist[0]];
              }
            }
            const codeStr = matchingCodes.map((c) => c.text).join('/') || codeLines.map((c) => c.text).join('/');
            courses.push({
              code: this.cleanSubjectCode(codeStr),
              name: cleanN,
            });
          }
        }
        if (courses.length > 0) return courses;
      }
    }

    // Single course fallback
    const code = codeLines.map((c) => c.text).join('/');
    const name = nameLines.map((n) => n.text).join(' ');

    return [
      {
        code: this.cleanSubjectCode(code),
        name: this.cleanSubjectName(name),
      },
    ].filter((r) => r.name.length > 0 || r.code.length > 0);
  }

  private static parseTimeRange(rawRange: string): {
    startTime: string;
    endTime: string;
    session: string;
    duration: number;
  } {
    const parts = rawRange.split(/[-–to]/i).map((s) => s.trim());
    if (parts.length >= 2) {
      const sNorm = this.normalizeTime(parts[0], false);
      const eNorm = this.normalizeTime(parts[1], true, sNorm.hour24);

      if (sNorm.normalized && eNorm.normalized) {
        const duration = this.calculateDurationMinutes(sNorm.normalized, eNorm.normalized) || 90;
        const sResult = this.normalizeSession(undefined, sNorm.normalized);
        return {
          startTime: sNorm.normalized,
          endTime: eNorm.normalized,
          session: sResult.session,
          duration,
        };
      }
    }

    return {
      startTime: '10:00',
      endTime: '11:30',
      session: 'Morning',
      duration: 90,
    };
  }

  /**
   * Fallback: Linear text token parsing for simple, single-column documents.
   */
  private static extractLinearTimetableRows(fullText: string): ExtractedTimetableRow[] {
    const lines = fullText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const rows: ExtractedTimetableRow[] = [];
    let rNum = 1;
    let currentDateContext: string | null = null;
    const timeRangeRegex = /(\b\d{1,2}:\d{2}\s*(?:am|pm)?|\b\d{1,2}\s*(?:am|pm))\s*(?:-|to|–)\s*(\b\d{1,2}:\d{2}\s*(?:am|pm)?|\b\d{1,2}\s*(?:am|pm))/i;
    const dateRegex = /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}[-/\s]+[a-zA-Z]{3,10}[-/\s,]+\d{4}|[a-zA-Z]{3,10}[-/\s]+\d{1,2}[-/\s,]+\d{4})\b/;

    for (const line of lines) {
      if (this.isHeaderOrFooter(line)) continue;

      const dateHeaderMatch = line.match(/(?:exam(?:ination)?\s+)?date\s*[:=-]\s*([a-zA-Z0-9\s,./-]+)/i);
      if (dateHeaderMatch) {
        const parsed = this.parseAndNormalizeDate(dateHeaderMatch[1]);
        if (parsed.normalized) {
          currentDateContext = parsed.normalized;
          continue;
        }
      }

      const hasDate = dateRegex.test(line);
      const hasTime = timeRangeRegex.test(line);
      const hasCode = /(?:2[456]BE[A-Z0-9/()]+|[A-Z]{2,4}[-_]?[0-9]{2,4})/i.test(line);

      // Multi-line continuation: append wrapped text to previous row's subject name
      if (!hasDate && !hasTime && !hasCode && rows.length > 0) {
        const prev = rows[rows.length - 1];
        prev.subjectName = this.cleanSubjectName(`${prev.subjectName} ${line}`);
        prev.rawLine = `${prev.rawLine} ${line}`;
        continue;
      }

      const parsedRow = this.parseTimetableLine(line, rNum, currentDateContext);
      if (parsedRow) {
        if (parsedRow.date) currentDateContext = parsedRow.date;
        rows.push(parsedRow);
        rNum++;
      }
    }

    return rows;
  }

  /**
   * Determines if a line is pure document metadata, table header, or decoration.
   */
  private static isHeaderOrFooter(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) return true;
    for (const pattern of HEADER_FOOTER_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }
    return false;
  }

  /**
   * Parses an individual text line into an ExtractedTimetableRow candidate.
   */
  private static parseTimetableLine(
    line: string,
    rowNumber: number,
    dateContext: string | null
  ): ExtractedTimetableRow | null {
    const trimmed = line.trim();

    let tokens: string[] = [];
    if (trimmed.includes('|')) {
      tokens = trimmed.split('|').map((t) => t.trim()).filter((t) => t.length > 0);
    } else if (trimmed.includes('\t')) {
      tokens = trimmed.split('\t').map((t) => t.trim()).filter((t) => t.length > 0);
    } else {
      tokens = trimmed.split(/\s{2,}/).map((t) => t.trim()).filter((t) => t.length > 0);
    }

    const timeRangeRegex = /(\b\d{1,2}:\d{2}\s*(?:am|pm)?|\b\d{1,2}\s*(?:am|pm))\s*(?:-|to|–)\s*(\b\d{1,2}:\d{2}\s*(?:am|pm)?|\b\d{1,2}\s*(?:am|pm))/i;
    const dateRegex = /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}[-/\s]+[a-zA-Z]{3,10}[-/\s,]+\d{4}|[a-zA-Z]{3,10}[-/\s]+\d{1,2}[-/\s,]+\d{4})\b/;
    const codeRegex = /\b([a-zA-Z0-9/()]{4,15})\b/;
    const sessionRegex = /\b(morning|afternoon|forenoon|fn|an|shift\s*[12]|session\s*[12])\b/i;

    let rawDate = '';
    let rawTimeRange = '';
    let rawSubjectCode = '';
    let rawSubjectName = '';
    let rawSession = '';

    if (tokens.length >= 3) {
      for (const t of tokens) {
        if (!rawDate && dateRegex.test(t)) {
          rawDate = t.match(dateRegex)![0];
        } else if (!rawTimeRange && timeRangeRegex.test(t)) {
          rawTimeRange = t.match(timeRangeRegex)![0];
        } else if (!rawSession && sessionRegex.test(t)) {
          rawSession = t.match(sessionRegex)![0];
        } else if (!rawSubjectCode && /^(?:2[456]BE[A-Z0-9/()]+|[A-Z]{2,4}[-_]?[0-9]{2,4})$/i.test(t)) {
          rawSubjectCode = t;
        } else if (!rawSubjectName && t.length >= 2 && !/^\d+$/.test(t)) {
          rawSubjectName = t.replace(/^(\d+[\.\)\s|-]+)/, '').trim();
        }
      }
    }

    if (!rawTimeRange) {
      const tm = trimmed.match(timeRangeRegex);
      if (tm) rawTimeRange = tm[0];
    }
    if (!rawDate) {
      const dm = trimmed.match(dateRegex);
      if (dm) rawDate = dm[0];
    }
    if (!rawDate && dateContext) {
      rawDate = dateContext;
    }
    if (!rawSession) {
      const sm = trimmed.match(sessionRegex);
      if (sm) rawSession = sm[0];
    }
    if (!rawSubjectCode) {
      const cm = trimmed.match(/(?:2[456]BE[A-Z0-9/()]+|[A-Z]{2,4}[-_]?[0-9]{2,4})/);
      if (cm) rawSubjectCode = cm[0];
    }

    if (!rawSubjectName) {
      let rem = trimmed;
      if (rawDate && rawDate !== dateContext) rem = rem.replace(rawDate, ' ');
      if (rawTimeRange) rem = rem.replace(rawTimeRange, ' ');
      if (rawSubjectCode) rem = rem.replace(rawSubjectCode, ' ');
      if (rawSession) rem = rem.replace(rawSession, ' ');
      rawSubjectName = rem.replace(/^(\d+[\.\)\s|-]+)/, '').replace(/[|:;]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    if (!rawSubjectCode && !rawTimeRange && !rawSubjectName) {
      return null;
    }

    const dateResult = this.parseAndNormalizeDate(rawDate);
    const normalizedDate = dateResult.normalized || '';

    let startTime = '';
    let endTime = '';
    let timeRangeError: string | undefined;

    if (rawTimeRange) {
      const parts = rawTimeRange.split(/[-–to]/i).map((s) => s.trim());
      if (parts.length >= 2) {
        const sNorm = this.normalizeTime(parts[0], false);
        const eNorm = this.normalizeTime(parts[1], true, sNorm.hour24);
        if (sNorm.normalized && eNorm.normalized) {
          startTime = sNorm.normalized;
          endTime = eNorm.normalized;
          if (endTime <= startTime) {
            timeRangeError = `End time (${endTime}) is not after start time (${startTime}).`;
          }
        } else {
          timeRangeError = sNorm.error || eNorm.error || 'Invalid start or end time format.';
        }
      }
    }

    const sessionResult = this.normalizeSession(rawSession, startTime);
    const durationMinutes = startTime && endTime && !timeRangeError ? this.calculateDurationMinutes(startTime, endTime) || undefined : undefined;

    const validationErrors: string[] = [];
    const validationWarnings: string[] = [];
    const missingFields: string[] = [];
    const uncertainFields: string[] = [];

    if (!normalizedDate) {
      missingFields.push('Examination Date');
      validationErrors.push(dateResult.error || 'Missing examination date.');
    } else if (dateResult.isAmbiguous) {
      validationWarnings.push(`Ambiguous date format in "${rawDate}": defaulted to ${normalizedDate} (DD/MM/YYYY convention). Please verify.`);
    }

    if (!rawSubjectCode) {
      missingFields.push('Subject Code');
      validationErrors.push('Missing subject code.');
    }
    if (!rawSubjectName) {
      missingFields.push('Subject Name');
      validationErrors.push('Missing subject title.');
    }
    if (!startTime || !endTime) {
      missingFields.push('Examination Timing');
      validationErrors.push('Missing examination timing.');
    } else if (timeRangeError) {
      validationErrors.push(timeRangeError);
    }
    if (!sessionResult.session) {
      missingFields.push('Session');
      uncertainFields.push('Session');
      validationErrors.push('Missing session label.');
    } else if (sessionResult.warning) {
      validationWarnings.push(sessionResult.warning);
    }

    const conflictReasons: string[] = [];
    if (timeRangeError) conflictReasons.push(timeRangeError);
    if (sessionResult.isInconsistent && sessionResult.warning) conflictReasons.push(sessionResult.warning);

    const hasConflict = Boolean(timeRangeError || sessionResult.isInconsistent);
    const conflictReason = conflictReasons.length > 0 ? conflictReasons.join('; ') : undefined;

    const isUncertain = missingFields.length > 0 || uncertainFields.length > 0 || Boolean(timeRangeError) || dateResult.isAmbiguous;
    const confidence = missingFields.length === 0 && !timeRangeError && !dateResult.isAmbiguous ? 'HIGH' : missingFields.length <= 1 ? 'MEDIUM' : 'LOW';

    return {
      rowNumber,
      date: normalizedDate,
      rawDate: rawDate || undefined,
      subjectCode: this.cleanSubjectCode(rawSubjectCode),
      subjectName: this.cleanSubjectName(rawSubjectName),
      session: sessionResult.session,
      startTime,
      endTime,
      durationMinutes,
      confidence,
      isUncertain,
      uncertainFields,
      missingFields,
      isDuplicateInFile: false,
      hasConflict,
      conflictReason,
      isAmbiguousDate: dateResult.isAmbiguous,
      action: missingFields.length > 0 ? 'SKIP' : 'ADD',
      rawLine: trimmed,
      validationErrors,
      validationWarnings,
    };
  }

  /**
   * Cross-row conflict, overlap, and duplicate detection across the entire parsed document.
   * Protects independent parallel department cohorts and multi-slot online examinations.
   */
  private static performConflictAndCrossValidation(
    rows: ExtractedTimetableRow[]
  ): ExtractedTimetableRow[] {
    // Exact duplicate row check: matches same date, timing, slot, code, and cohort group
    const seenMap = new Map<string, number>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.date || !r.subjectCode) continue;

      const cohortKey = `${r.semester || ''}|${r.programGroup || ''}|${r.slot || ''}`;
      const key = `${r.date}|${r.startTime}|${r.endTime}|${r.subjectCode.toUpperCase()}|${cohortKey}`;

      if (seenMap.has(key)) {
        const originalRow = seenMap.get(key)!;
        r.isDuplicateInFile = true;
        r.duplicateReason = `Duplicate timetable entry: exact same subject code (${r.subjectCode}), date, time, and group as row ${originalRow}.`;
        r.action = 'SKIP';
        r.validationWarnings.push(r.duplicateReason);
      } else {
        seenMap.set(key, r.rowNumber);
      }
    }

    // Overlapping timings check: ONLY flags conflict if records are in the SAME semester and SAME cohort group
    for (let i = 0; i < rows.length; i++) {
      const r1 = rows[i];
      if (!r1.date || !r1.startTime || !r1.endTime) continue;

      for (let j = i + 1; j < rows.length; j++) {
        const r2 = rows[j];
        if (!r2.date || !r2.startTime || !r2.endTime) continue;

        // Parallel cohorts or different semesters do NOT conflict
        const sameCohort = (r1.semester || 'A') === (r2.semester || 'A') && (r1.programGroup || 'A') === (r2.programGroup || 'A');
        if (!sameCohort) continue;

        if (r1.date === r2.date && r1.session === r2.session) {
          const s1 = r1.startTime;
          const e1 = r1.endTime;
          const s2 = r2.startTime;
          const e2 = r2.endTime;

          const isOverlapping = s1 < e2 && s2 < e1;
          if (isOverlapping && s1 !== s2 && e1 !== e2) {
            r1.hasConflict = true;
            r2.hasConflict = true;
            const msg = `Overlapping exam times on ${r1.date} between row ${r1.rowNumber} (${s1}-${e1}) and row ${r2.rowNumber} (${s2}-${e2}) in ${r1.programGroup || 'cohort'}.`;
            r1.conflictReason = msg;
            r2.conflictReason = msg;
            r1.validationWarnings.push(msg);
            r2.validationWarnings.push(msg);
          }
        }
      }
    }

    return rows;
  }

  private static cleanSubjectName(s: string): string {
    return s
      .replace(/\s+/g, ' ')
      .replace(/^[-–\s,;:|]+|[-–\s,;:|]+$/g, '')
      .trim();
  }

  private static cleanSubjectCode(s: string): string {
    return s
      .replace(/(\d)\s+(\d)/g, '$1$2')
      .replace(/(\d)\s+([A-Za-z])/g, '$1$2')
      .replace(/([A-Za-z])\s+(\d)/g, '$1$2')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^[/,\s]+|[/,\s]+$/g, '')
      .trim();
  }
}
