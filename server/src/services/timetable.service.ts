import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';
import { ExamService } from './exam.service';
import {
  PdfTimetableParserService,
  PdfTimetableParseResult,
  ExtractedTimetableRow,
} from './pdf-timetable-parser.service';
import { ExamDate, ExamSession } from '../domain/scheduling/types';

export interface TimetableRecord {
  id: string;
  examinationId: string;
  examDate: string;
  session: string;
  subjectCode: string;
  subjectName: string;
  startTime: string;
  endTime: string;
  durationMinutes?: number | null;
  semester?: string | null;
  programGroup?: string | null;
  slot?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommitTimetableResult {
  success: boolean;
  imported: number;
  inserted: number;
  updated: number;
  skipped: number;
  rejected: number;
  distinctDates: string[];
  distinctSessions: string[];
}

export class TimetableService {
  /**
   * Previews timetable PDF import in-memory with ZERO database writes.
   */
  public static async previewTimetablePdf(
    buffer: Buffer,
    filename = 'timetable.pdf',
    examinationId?: string
  ): Promise<PdfTimetableParseResult> {
    const parseResult = await PdfTimetableParserService.parseTimetablePdf(buffer, filename);

    if (examinationId) {
      const db = getDatabase();
      const exam = ExamService.getById(examinationId);
      if (exam) {
        // Check if examination has existing timetable records
        const existingRows = db
          .prepare('SELECT exam_date, session, subject_code FROM examination_timetable WHERE examination_id = ?')
          .all(examinationId) as Array<{ exam_date: string; session: string; subject_code: string }>;

        const existingKeySet = new Set(
          existingRows.map((r) => `${r.exam_date}|${r.session}|${r.subject_code.toUpperCase()}`)
        );

        for (const rec of parseResult.records) {
          const key = `${rec.date}|${rec.session}|${rec.subjectCode.toUpperCase()}`;
          if (existingKeySet.has(key)) {
            rec.action = 'UPDATE';
          }
        }

        // Check for approved schedule warning
        const approvedSched = db
          .prepare("SELECT id, state, version, revision_number FROM schedules WHERE examination_id = ? AND state IN ('APPROVED', 'PUBLISHED') LIMIT 1")
          .get(examinationId) as any;

        if (approvedSched) {
          parseResult.warnings.push(
            `Notice: Examination "${exam.name}" has an active ${approvedSched.state} schedule (${approvedSched.id}). Confirming a new timetable will not modify the approved schedule, but will require creating a schedule revision before generating an updated allotment.`
          );
        }
      }
    }

    return parseResult;
  }

  /**
   * Commits confirmed timetable records in an atomic SQLite transaction.
   * Revalidates every row server-side before writing.
   * If any fatal error occurs, rolls back completely leaving existing data intact.
   */
  public static commitTimetable(
    examinationId: string,
    records: ExtractedTimetableRow[],
    actor = 'System Admin'
  ): CommitTimetableResult {
    if (!examinationId || !examinationId.trim()) {
      throw new Error('Examination ID is required for timetable confirmation.');
    }

    const exam = ExamService.getById(examinationId);
    if (!exam) {
      throw new Error(`Examination "${examinationId}" not found.`);
    }

    if (!records || !Array.isArray(records) || records.length === 0) {
      throw new Error('No timetable records provided for confirmation.');
    }

    const db = getDatabase();
    const now = new Date().toISOString();

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let rejected = 0;

    const validRecordsToCommit: ExtractedTimetableRow[] = [];
    const seenBatchKeys = new Set<string>();

    // 1. Strict Server-Side Revalidation
    for (let idx = 0; idx < records.length; idx++) {
      const rec = records[idx];
      const rowNum = rec.rowNumber || idx + 1;
      if (rec.action === 'SKIP') {
        skipped++;
        continue;
      }

      // Revalidate Date
      const rawDate = rec.date || (rec as any).examDate || '';
      const dateCheck = PdfTimetableParserService.parseAndNormalizeDate(rawDate);
      if (!dateCheck.normalized) {
        throw new Error(
          `Row ${rowNum}: Invalid examination date "${rawDate}". ${dateCheck.error || ''}`
        );
      }

      // Revalidate Subject Code & Name
      if (!rec.subjectCode || !rec.subjectCode.trim()) {
        throw new Error(`Row ${rowNum}: Subject code is required.`);
      }
      if (!rec.subjectName || !rec.subjectName.trim()) {
        throw new Error(`Row ${rowNum}: Subject name is required.`);
      }

      // Revalidate Times
      const sCheck = PdfTimetableParserService.normalizeTime(rec.startTime);
      const eCheck = PdfTimetableParserService.normalizeTime(rec.endTime);
      if (!sCheck.normalized) {
        throw new Error(`Row ${rowNum}: Invalid start time "${rec.startTime}".`);
      }
      if (!eCheck.normalized) {
        throw new Error(`Row ${rowNum}: Invalid end time "${rec.endTime}".`);
      }
      if (eCheck.normalized <= sCheck.normalized) {
        throw new Error(
          `Row ${rowNum}: End time (${eCheck.normalized}) must be strictly after start time (${sCheck.normalized}).`
        );
      }

      // Revalidate Session
      const sessNorm = PdfTimetableParserService.normalizeSession(rec.session, sCheck.normalized);
      if (!sessNorm.session) {
        throw new Error(`Row ${rowNum}: Missing or invalid examination session.`);
      }

      // Duplicate Check in Batch: respects separate slots or parallel program cohorts
      const key = `${dateCheck.normalized}|${sCheck.normalized}|${eCheck.normalized}|${rec.subjectCode.trim().toUpperCase()}|${rec.slot || ''}|${rec.programGroup || ''}`;
      if (seenBatchKeys.has(key)) {
        throw new Error(
          `Row ${rowNum}: Duplicate entry for subject "${rec.subjectCode}" on ${dateCheck.normalized} (${sCheck.normalized}-${eCheck.normalized}) in confirmation batch.`
        );
      }
      seenBatchKeys.add(key);

      validRecordsToCommit.push({
        ...rec,
        date: dateCheck.normalized,
        session: sessNorm.session,
        startTime: sCheck.normalized,
        endTime: eCheck.normalized,
        durationMinutes: PdfTimetableParserService.calculateDurationMinutes(sCheck.normalized, eCheck.normalized) || undefined,
      });
    }

    if (validRecordsToCommit.length === 0) {
      return {
        success: true,
        imported: 0,
        inserted: 0,
        updated: 0,
        skipped,
        rejected: 0,
        distinctDates: [],
        distinctSessions: [],
      };
    }

    // 2. Atomic Transaction Execution
    const existingTimetable = db
      .prepare('SELECT id, exam_date, session, subject_code, slot FROM examination_timetable WHERE examination_id = ?')
      .all(examinationId) as Array<{ id: string; exam_date: string; session: string; subject_code: string; slot?: string }>;

    const existingKeyMap = new Map<string, string>();
    for (const r of existingTimetable) {
      existingKeyMap.set(`${r.exam_date}|${r.session}|${r.subject_code.toUpperCase()}|${r.slot || ''}`, r.id);
    }

    const insertStmt = db.prepare(`
      INSERT INTO examination_timetable (
        id, examination_id, exam_date, session, subject_code, subject_name,
        start_time, end_time, duration_minutes, semester, program_group, slot, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      // Clear out existing timetable records for complete synchronization
      db.prepare('DELETE FROM examination_timetable WHERE examination_id = ?').run(examinationId);

      for (const rec of validRecordsToCommit) {
        const key = `${rec.date}|${rec.session}|${rec.subjectCode.toUpperCase()}|${rec.slot || ''}`;
        const existingId = existingKeyMap.get(key);
        const recordId = existingId || `TT-${examinationId}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        insertStmt.run(
          recordId,
          examinationId,
          rec.date,
          rec.session,
          rec.subjectCode.toUpperCase(),
          rec.subjectName.trim(),
          rec.startTime,
          rec.endTime,
          rec.durationMinutes || null,
          rec.semester || null,
          rec.programGroup || null,
          rec.slot || null,
          now,
          now
        );

        if (existingId) {
          updated++;
        } else {
          imported++;
        }
      }

      // Extract distinct sorted dates
      const distinctDates = Array.from(new Set(validRecordsToCommit.map((r) => r.date))).sort();

      // Synchronize examination_dates table
      db.prepare('DELETE FROM examination_dates WHERE examination_id = ?').run(examinationId);
      const insertDateStmt = db.prepare(`
        INSERT INTO examination_dates (examination_id, date, sequence_order, is_examination_day)
        VALUES (?, ?, ?, ?)
      `);
      distinctDates.forEach((d, idx) => {
        insertDateStmt.run(examinationId, d, idx + 1, 1);
      });

      // Synchronize unique sessions and canonical timings
      const distinctSessions = Array.from(new Set(validRecordsToCommit.map((r) => r.session))).sort();
      const sessionConfigList: ExamSession[] = [];

      for (const sessName of distinctSessions) {
        const sessRows = validRecordsToCommit.filter((r) => r.session === sessName);
        const sTime = sessRows[0]?.startTime || (sessName === 'Morning' ? '09:30' : '14:00');
        const eTime = sessRows[0]?.endTime || (sessName === 'Morning' ? '12:30' : '17:00');
        sessionConfigList.push({
          name: sessName,
          startTime: sTime,
          endTime: eTime,
        });
      }

      // Synchronize examinations start_date, end_date, session_config, and sessions_per_day
      const startDate = distinctDates[0];
      const endDate = distinctDates[distinctDates.length - 1];

      // Calculate max sessions on any single date
      let maxSessionsPerDay = 1;
      for (const d of distinctDates) {
        const daySessions = new Set(validRecordsToCommit.filter((r) => r.date === d).map((r) => r.session));
        if (daySessions.size > maxSessionsPerDay) {
          maxSessionsPerDay = daySessions.size;
        }
      }

      db.prepare(`
        UPDATE examinations
        SET start_date = ?, end_date = ?, session_config = ?, sessions_per_day = ?, updated_at = ?
        WHERE id = ?
      `).run(
        startDate,
        endDate,
        JSON.stringify(sessionConfigList),
        maxSessionsPerDay,
        now,
        examinationId
      );

      // Audit Logging
      AuditService.log(
        {
          entity: 'examination',
          entityId: examinationId,
          action: 'TIMETABLE_IMPORTED',
          actor,
          newValues: {
            imported,
            updated,
            skipped,
            totalRows: validRecordsToCommit.length,
            distinctDates,
            distinctSessions,
            startDate,
            endDate,
          },
          reason: `Confirmed timetable import of ${validRecordsToCommit.length} examination subjects (${imported} added, ${updated} updated, ${skipped} skipped).`,
        },
        db
      );
    });

    tx();

    const distinctDates = Array.from(new Set(validRecordsToCommit.map((r) => r.date))).sort();
    const distinctSessions = Array.from(new Set(validRecordsToCommit.map((r) => r.session))).sort();

    return {
      success: true,
      imported,
      inserted: imported,
      updated,
      skipped,
      rejected,
      distinctDates,
      distinctSessions,
    };
  }

  /**
   * Retrieves confirmed timetable records for an examination.
   */
  public static getTimetable(examinationId: string): TimetableRecord[] {
    const db = getDatabase();
    const rows = db
      .prepare(`
        SELECT * FROM examination_timetable
        WHERE examination_id = ?
        ORDER BY exam_date ASC, session ASC, subject_code ASC
      `)
      .all(examinationId) as any[];

    return rows.map((r) => ({
      id: r.id,
      examinationId: r.examination_id,
      examDate: r.exam_date,
      session: r.session,
      subjectCode: r.subject_code,
      subjectName: r.subject_name,
      startTime: r.start_time,
      endTime: r.end_time,
      durationMinutes: r.duration_minutes,
      semester: r.semester || null,
      programGroup: r.program_group || null,
      slot: r.slot || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Clears confirmed timetable for an examination (if not locked by approved schedule).
   */
  public static deleteTimetable(examinationId: string, actor = 'System Admin'): void {
    const db = getDatabase();

    const approvedSched = db
      .prepare("SELECT id FROM schedules WHERE examination_id = ? AND state IN ('APPROVED', 'PUBLISHED') LIMIT 1")
      .get(examinationId) as any;

    if (approvedSched) {
      throw new Error(
        `Cannot delete timetable: Examination has an active approved schedule (${approvedSched.id}). Revoke or archive the schedule first.`
      );
    }

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM examination_timetable WHERE examination_id = ?').run(examinationId);

      AuditService.log(
        {
          entity: 'examination',
          entityId: examinationId,
          action: 'TIMETABLE_DELETED',
          actor,
          reason: 'Cleared examination timetable records.',
        },
        db
      );
    });

    tx();
  }
}
