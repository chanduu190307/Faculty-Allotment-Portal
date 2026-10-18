import { PDFParse } from 'pdf-parse';

export interface ExtractedFacultyRow {
  rowNumber: number;
  id: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  phone?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  isUncertain: boolean;
  uncertainFields: string[];
  missingFields: string[];
  isDuplicateInFile: boolean;
  duplicateReason?: string;
  existingMatch?: {
    id: string;
    name: string;
    department: string;
    email: string;
  };
  action: 'ADD' | 'UPDATE' | 'SKIP';
  skipReason?: string;
  rawLine?: string;
}

export interface PdfFacultyParseResult {
  filename: string;
  fileSizeBytes: number;
  totalPages: number;
  hasSelectableText: boolean;
  totalParsed: number;
  uniqueCount: number;
  duplicateCount: number;
  missingRequiredCount: number;
  uncertainCount: number;
  existingMatchCount: number;
  toAddCount: number;
  toUpdateCount: number;
  toSkipCount: number;
  canCommit: boolean;
  records: ExtractedFacultyRow[];
  warnings: string[];
  errors: string[];
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_REGEX = /(?:\+91[\s-]?)?[6-9]\d{9}|\b\d{3}[-\s]\d{3}[-\s]\d{4}\b/;

const KNOWN_DESIGNATIONS = [
  'Assistant Professor',
  'Associate Professor',
  'Professor',
  'Senior Lecturer',
  'Lecturer',
  'Head of Department',
  'HOD',
  'Dean',
  'Director',
  'Adjunct Faculty',
  'Visiting Faculty',
  'Teaching Assistant',
  'Instructor',
];

const KNOWN_DEPARTMENTS = [
  'Computer Science & Engineering',
  'Computer Science',
  'Information Technology',
  'Electronics & Communication Engineering',
  'Electronics & Communication',
  'Electrical & Electronics Engineering',
  'Mechanical Engineering',
  'Civil Engineering',
  'Artificial Intelligence & Data Science',
  'Mathematics',
  'Physics',
  'Chemistry',
  'Humanities & Management',
  'Business Administration',
  'Management Studies',
];

const HEADER_FOOTER_PATTERNS = [
  /page\s+\d+(\s+of\s+\d+)?/i,
  /^\s*-\s*\d+\s*-\s*$/,
  /faculty\s+allotment/i,
  /examination\s+(cell|committee|branch|portal)/i,
  /invigilation\s+(schedule|duty|list|roster)/i,
  /academic\s+year/i,
  /reporting\s+time/i,
  /controller\s+of\s+examinations/i,
  /signature\s+of\s+(dean|principal|hod)/i,
  /instructions\s+to\s+(invigilators|faculty)/i,
  /^\s*(sl\.?\s*no\.?|s\.?\s*no\.?)\b/i,
  /\b(date|time|shift|session)\s*:\s*/i,
  /^\s*total\s+(faculty|teachers|records|pages)\s*:/i,
];

function isHeaderOrFooterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 3) return true;
  for (const pattern of HEADER_FOOTER_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function cleanName(raw: string): string {
  return raw
    .replace(/^(\d+[\.\)\s|-]+)/, '') // remove leading serial number
    .replace(/[,\t|;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDept(raw: string): string {
  const cleaned = raw.trim();
  for (const known of KNOWN_DEPARTMENTS) {
    if (cleaned.toLowerCase() === known.toLowerCase()) return known;
    if (cleaned.toLowerCase().includes(known.toLowerCase())) return known;
  }
  return cleaned;
}

function normalizeDesig(raw: string): string {
  const cleaned = raw.trim();
  for (const known of KNOWN_DESIGNATIONS) {
    if (cleaned.toLowerCase() === known.toLowerCase()) return known;
    if (cleaned.toLowerCase().includes(known.toLowerCase())) return known;
  }
  return cleaned;
}

export class PdfFacultyParserService {
  /**
   * Validates raw PDF buffer headers, file size, and encryption.
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
   * Extracts text and page details safely from a PDF buffer.
   */
  public static async extractPdfText(buffer: Buffer): Promise<{
    totalPages: number;
    pages: Array<{ pageNum: number; text: string }>;
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
    const pages: Array<{ pageNum: number; text: string }> = [];

    if (Array.isArray(textRes?.pages) && textRes.pages.length > 0) {
      for (let i = 0; i < textRes.pages.length; i++) {
        const p = textRes.pages[i];
        pages.push({
          pageNum: p.num ?? (i + 1),
          text: p.text || '',
        });
      }
    } else {
      pages.push({
        pageNum: 1,
        text: textRes?.text || '',
      });
    }

    const fullText = textRes?.text || pages.map((p) => p.text).join('\n');

    // Check selectable text: count alphanumeric characters
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
   * Parses individual line or tokens into an ExtractedFacultyRow candidate.
   */
  private static parseFacultyLine(line: string, rowIdx: number): Partial<ExtractedFacultyRow> | null {
    const trimmed = line.trim();
    if (!trimmed || isHeaderOrFooterLine(trimmed)) {
      return null;
    }

    let text = trimmed;

    // 1. Extract Email if present
    let email: string | undefined;
    const emailMatch = text.match(EMAIL_REGEX);
    if (emailMatch) {
      email = emailMatch[0].toLowerCase();
      text = text.replace(emailMatch[0], ' ');
    }

    // 2. Extract Phone if present
    let phone: string | undefined;
    const phoneMatch = text.match(PHONE_REGEX);
    if (phoneMatch) {
      phone = phoneMatch[0].replace(/\s+/g, '');
      text = text.replace(phoneMatch[0], ' ');
    }

    // 3. Extract Faculty / Employee ID
    let id: string | undefined;
    // Look for ID patterns like FAC-001, EMP123, CS101, F001, or 4-6 digit employee numbers
    const idPattern = /\b(FAC[-_]?[0-9]{1,5}|EMP[-_]?[0-9]{1,5}|[A-Z]{2,4}[-_]?[0-9]{2,5}|[0-9]{4,6})\b/i;
    const idMatch = text.match(idPattern);
    if (idMatch) {
      id = idMatch[1].toUpperCase();
      text = text.replace(idMatch[0], ' ');
    }

    // 4. Identify Designation if present
    let designation: string | undefined;
    for (const des of KNOWN_DESIGNATIONS) {
      const regex = new RegExp(`\\b${des.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (regex.test(text)) {
        designation = des;
        text = text.replace(regex, ' ');
        break;
      }
    }

    // 5. Identify Department if present
    let department: string | undefined;
    for (const dept of KNOWN_DEPARTMENTS) {
      const regex = new RegExp(`\\b${dept.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (regex.test(text)) {
        department = dept;
        text = text.replace(regex, ' ');
        break;
      }
    }

    // Check for delimiter splitting if department or designation not found
    const delimiters = ['\t', '|', ';', ','];
    let tokens = [text];
    for (const delim of delimiters) {
      if (text.includes(delim)) {
        tokens = text.split(delim).map((t) => t.trim()).filter(Boolean);
        break;
      }
    }

    // If still a single token, try splitting on 2+ consecutive spaces
    if (tokens.length === 1 && /\s{2,}/.test(text)) {
      tokens = text.split(/\s{2,}/).map((t) => t.trim()).filter(Boolean);
    }

    let nameCandidate = cleanName(text);

    if (tokens.length >= 2) {
      // If tokens exist, first token with 2+ words or Dr./Prof. is likely name
      for (let i = 0; i < tokens.length; i++) {
        const tok = cleanName(tokens[i]);
        if (!nameCandidate || (tok.length > 3 && (/^(dr|prof|mr|ms|mrs)\b/i.test(tok) || tok.split(' ').length >= 2))) {
          nameCandidate = tok;
          tokens.splice(i, 1);
          break;
        }
      }

      // Remaining tokens may be department or designation
      if (!department && tokens.length > 0) {
        department = normalizeDept(tokens[0]);
      }
      if (!designation && tokens.length > 1) {
        designation = normalizeDesig(tokens[1]);
      }
    }

    // Clean up name candidate
    nameCandidate = cleanName(nameCandidate);
    // Remove known noise from name
    nameCandidate = nameCandidate
      .replace(/\b(male|female|regular|permanent|contract|full-time)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // If name is too short or is empty or looks like a heading/number, discard line
    if (!nameCandidate || nameCandidate.length < 2 || /^\d+$/.test(nameCandidate)) {
      return null;
    }

    // Heuristic: If name candidate looks like instructions or numbers, discard
    if (/^(rules|instructions|examination|schedule|semester|subject|total|note)\b/i.test(nameCandidate)) {
      return null;
    }

    return {
      rowNumber: rowIdx,
      id: id || '',
      name: nameCandidate,
      email: email || '',
      department: department || '',
      designation: designation || '',
      phone,
      rawLine: trimmed,
    };
  }

  /**
   * Parses labeled key-value blocks (e.g. Name: ..., ID: ...)
   */
  private static parseLabeledBlocks(fullText: string): ExtractedFacultyRow[] {
    const records: ExtractedFacultyRow[] = [];
    const blocks = fullText.split(/(?=Name\s*:|Faculty Name\s*:)/i);

    let rowIdx = 1;
    for (const block of blocks) {
      if (!/Name\s*:/i.test(block)) continue;

      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      let name = '';
      let id = '';
      let email = '';
      let dept = '';
      let desig = '';
      let phone = '';

      for (const line of lines) {
        if (/^(name|faculty\s*name)\s*:\s*(.+)$/i.test(line)) {
          name = cleanName(line.replace(/^(name|faculty\s*name)\s*:\s*/i, ''));
        } else if (/^(id|faculty\s*id|emp\s*id|code)\s*:\s*(.+)$/i.test(line)) {
          id = line.replace(/^(id|faculty\s*id|emp\s*id|code)\s*:\s*/i, '').trim().toUpperCase();
        } else if (/^(email|mail|email\s*id)\s*:\s*(.+)$/i.test(line)) {
          const m = line.match(EMAIL_REGEX);
          if (m) email = m[0].toLowerCase();
        } else if (/^(dept|department|branch)\s*:\s*(.+)$/i.test(line)) {
          dept = normalizeDept(line.replace(/^(dept|department|branch)\s*:\s*/i, ''));
        } else if (/^(desig|designation|role|title)\s*:\s*(.+)$/i.test(line)) {
          desig = normalizeDesig(line.replace(/^(desig|designation|role|title)\s*:\s*/i, ''));
        } else if (/^(phone|mobile|contact)\s*:\s*(.+)$/i.test(line)) {
          const m = line.match(PHONE_REGEX);
          if (m) phone = m[0];
        }
      }

      if (name) {
        const uncertainFields: string[] = [];
        const missingFields: string[] = [];

        if (!id) missingFields.push('id');
        if (!email) missingFields.push('email');
        if (!dept) missingFields.push('department');
        if (!desig) missingFields.push('designation');

        records.push({
          rowNumber: rowIdx++,
          id,
          name,
          email,
          department: dept,
          designation: desig,
          phone: phone || undefined,
          confidence: missingFields.length === 0 ? 'HIGH' : missingFields.length <= 2 ? 'MEDIUM' : 'LOW',
          isUncertain: missingFields.length > 0,
          uncertainFields,
          missingFields,
          isDuplicateInFile: false,
          action: 'ADD',
          rawLine: block.slice(0, 100),
        });
      }
    }

    return records;
  }

  /**
   * Main entrypoint: Extracts, parses, validates, and marks faculty records from a PDF buffer.
   */
  public static async parseFacultyPdf(
    buffer: Buffer,
    filename = 'faculty_list.pdf',
    existingFacultyList: Array<{ id: string; email: string; name: string; department: string }> = [],
    options: { allowUpdateExisting?: boolean } = {}
  ): Promise<PdfFacultyParseResult> {
    const fileSizeBytes = buffer?.length || 0;
    const warnings: string[] = [];
    const errors: string[] = [];

    // 1. Extract text
    const extracted = await this.extractPdfText(buffer);

    // 2. Scanned PDF detection
    if (!extracted.hasSelectableText) {
      throw new Error(
        'Scanned or image-only PDF detected. The document contains no selectable text, and no local OCR engine (such as Tesseract) is configured. Manual transcription or a digital PDF/spreadsheet is required.'
      );
    }

    // 3. Try labeled blocks first
    let candidates: ExtractedFacultyRow[] = this.parseLabeledBlocks(extracted.fullText);

    // 4. If no labeled blocks, parse line-by-line across all pages
    if (candidates.length === 0) {
      let globalRowIdx = 1;
      for (const page of extracted.pages) {
        const lines = page.text.split('\n');
        for (const line of lines) {
          const parsed = this.parseFacultyLine(line, globalRowIdx);
          if (parsed && parsed.name) {
            const uncertainFields: string[] = [];
            const missingFields: string[] = [];

            if (!parsed.id) missingFields.push('id');
            if (!parsed.email) missingFields.push('email');
            if (!parsed.department) missingFields.push('department');
            if (!parsed.designation) missingFields.push('designation');

            // Check if name has suspicious characters
            if (/\d/.test(parsed.name)) {
              uncertainFields.push('name (contains digits)');
            }
            if (parsed.name.length < 3) {
              uncertainFields.push('name (unusually short)');
            }

            const isUncertain = missingFields.length > 0 || uncertainFields.length > 0;
            const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
              missingFields.length === 0 && uncertainFields.length === 0
                ? 'HIGH'
                : missingFields.length <= 1
                ? 'MEDIUM'
                : 'LOW';

            candidates.push({
              rowNumber: globalRowIdx++,
              id: parsed.id || '',
              name: parsed.name,
              email: parsed.email || '',
              department: parsed.department || '',
              designation: parsed.designation || '',
              phone: parsed.phone,
              confidence,
              isUncertain,
              uncertainFields,
              missingFields,
              isDuplicateInFile: false,
              action: 'ADD',
              rawLine: parsed.rawLine,
            });
          }
        }
      }
    }

    if (candidates.length === 0) {
      throw new Error(
        'No faculty records could be extracted from the PDF. Ensure the PDF contains digital text with recognizable faculty names, IDs, departments, or emails.'
      );
    }

    // 5. In-file duplicate detection (by ID, email, or normalized name)
    const seenIds = new Map<string, number>();
    const seenEmails = new Map<string, number>();
    const seenNames = new Map<string, number>();

    for (const rec of candidates) {
      if (rec.id) {
        const idLower = rec.id.toLowerCase();
        if (seenIds.has(idLower)) {
          rec.isDuplicateInFile = true;
          rec.duplicateReason = `Duplicate Faculty ID "${rec.id}" in file (first seen on row ${seenIds.get(idLower)})`;
          rec.action = 'SKIP';
          rec.skipReason = rec.duplicateReason;
        } else {
          seenIds.set(idLower, rec.rowNumber);
        }
      }

      if (rec.email) {
        const emailLower = rec.email.toLowerCase();
        if (seenEmails.has(emailLower)) {
          rec.isDuplicateInFile = true;
          rec.duplicateReason = `Duplicate Email "${rec.email}" in file (first seen on row ${seenEmails.get(emailLower)})`;
          rec.action = 'SKIP';
          rec.skipReason = rec.duplicateReason;
        } else {
          seenEmails.set(emailLower, rec.rowNumber);
        }
      }

      // Exact name duplicate flag if neither id nor email distinguished them
      if (!rec.id && !rec.email && rec.name) {
        const nameLower = rec.name.toLowerCase();
        if (seenNames.has(nameLower)) {
          rec.isDuplicateInFile = true;
          rec.duplicateReason = `Duplicate faculty name "${rec.name}" in file without distinct ID or email (first seen on row ${seenNames.get(nameLower)})`;
          rec.action = 'SKIP';
          rec.skipReason = rec.duplicateReason;
        } else {
          seenNames.set(nameLower, rec.rowNumber);
        }
      }
    }

    // 6. Match against existing database records
    const dbIdMap = new Map(existingFacultyList.map((f) => [f.id.toLowerCase(), f]));
    const dbEmailMap = new Map(existingFacultyList.map((f) => [f.email.toLowerCase(), f]));
    const dbNameMap = new Map(existingFacultyList.map((f) => [f.name.toLowerCase(), f]));

    for (const rec of candidates) {
      if (rec.isDuplicateInFile) continue;

      let match = rec.id ? dbIdMap.get(rec.id.toLowerCase()) : undefined;
      if (!match && rec.email) {
        match = dbEmailMap.get(rec.email.toLowerCase());
      }
      if (!match && rec.name) {
        match = dbNameMap.get(rec.name.toLowerCase());
      }

      if (match) {
        rec.existingMatch = match;
        if (options.allowUpdateExisting) {
          rec.action = 'UPDATE';
        } else {
          rec.action = 'SKIP';
          rec.skipReason = `Record matches existing database faculty "${match.id}" (${match.name}). Enable update mode to overwrite.`;
        }
      } else {
        // New record
        if (rec.missingFields.includes('id') || rec.missingFields.includes('email') || rec.missingFields.includes('name')) {
          rec.action = 'SKIP';
          rec.skipReason = `Missing required fields (${rec.missingFields.join(', ')}). Manual review/correction required.`;
        } else {
          rec.action = 'ADD';
        }
      }
    }

    // 7. Calculate aggregate counts
    const totalParsed = candidates.length;
    const duplicateCount = candidates.filter((r) => r.isDuplicateInFile).length;
    const uniqueCount = totalParsed - duplicateCount;
    const missingRequiredCount = candidates.filter(
      (r) => r.missingFields.includes('id') || r.missingFields.includes('name') || r.missingFields.includes('email')
    ).length;
    const uncertainCount = candidates.filter((r) => r.isUncertain).length;
    const existingMatchCount = candidates.filter((r) => !!r.existingMatch).length;
    const toAddCount = candidates.filter((r) => r.action === 'ADD').length;
    const toUpdateCount = candidates.filter((r) => r.action === 'UPDATE').length;
    const toSkipCount = candidates.filter((r) => r.action === 'SKIP').length;

    const canCommit = toAddCount > 0 || toUpdateCount > 0;

    if (uncertainCount > 0) {
      warnings.push(`${uncertainCount} records contain uncertain or incomplete fields. Review values in the preview table before confirming import.`);
    }
    if (duplicateCount > 0) {
      warnings.push(`${duplicateCount} in-file duplicate records detected and marked to skip.`);
    }
    if (existingMatchCount > 0 && !options.allowUpdateExisting) {
      warnings.push(`${existingMatchCount} records match existing faculty in the database and will be skipped (enable update mode to update existing).`);
    }

    return {
      filename,
      fileSizeBytes,
      totalPages: extracted.totalPages,
      hasSelectableText: extracted.hasSelectableText,
      totalParsed,
      uniqueCount,
      duplicateCount,
      missingRequiredCount,
      uncertainCount,
      existingMatchCount,
      toAddCount,
      toUpdateCount,
      toSkipCount,
      canCommit,
      records: candidates,
      warnings,
      errors,
    };
  }
}
