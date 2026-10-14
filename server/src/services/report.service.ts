import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';
import { ExamService } from './exam.service';
import { FacultyService } from './faculty.service';
import { SettingsService } from './settings.service';
import { SchedulingEngine } from '../domain/scheduling/engine';

export interface DailyReportSnapshot {
  reportId: string;
  examinationId: string;
  examinationName: string;
  academicYear: string;
  collegeName: string;
  date: string;
  reportVersion: number;
  isProvisional: boolean;
  generatedAt: string;
  generatedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  sessionTimings: any[];
  roomAssignments: any[];
  summary: {
    totalRooms: number;
    totalAssignments: number;
    completedCount: number;
    absentCount: number;
    substitutedCount: number;
  };
  unassignedFaculty: any[];
  substitutions: any[];
}

export interface FinalReportData {
  examinationId: string;
  examinationName: string;
  academicYear: string;
  collegeName: string;
  startDate: string;
  endDate: string;
  status: string;
  totalExamDates: number;
  totalSessions: number;
  totalActiveRooms: number;
  totalParticipatingFaculty: number;
  totalRequiredSlots: number;
  totalAssignedSlots: number;
  totalCompletedDuties: number;
  totalAbsences: number;
  totalSubstitutions: number;
  workloadStats: any;
  facultySummary: Array<{
    facultyId: string;
    facultyName: string;
    department: string;
    assignedDuties: number;
    completedDuties: number;
    absentDuties: number;
    maxLimit: number;
    remainingCapacity: number;
    status: 'AT_LIMIT' | 'UNDER_LIMIT' | 'UNASSIGNED';
  }>;
  substitutions: any[];
  dateWiseSummary: any[];
}

export class ReportService {
  /**
   * Generates or retrieves an immutable historical daily report snapshot.
   */
  public static generateDailyReport(
    examinationId: string,
    date: string,
    isProvisional = false,
    actor = 'Exam Controller'
  ): DailyReportSnapshot {
    const db = getDatabase();
    const exam = ExamService.getById(examinationId);
    if (!exam) throw new Error(`Examination ${examinationId} not found`);

    const collegeName = SettingsService.getInstitutionName();

    // Check if an approved finalized snapshot already exists
    const existing = db
      .prepare(`
        SELECT * FROM daily_reports
        WHERE examination_id = ? AND date = ? AND is_provisional = 0
        ORDER BY report_version DESC LIMIT 1
      `)
      .get(examinationId, date) as any;

    if (existing && !isProvisional) {
      return JSON.parse(existing.snapshot_data);
    }

    // Otherwise compute snapshot from current state
    const latestSched = db
      .prepare('SELECT id FROM schedules WHERE examination_id = ? ORDER BY version DESC LIMIT 1')
      .get(examinationId) as { id: string } | undefined;

    if (!latestSched) {
      throw new Error('No schedule found for this examination.');
    }

    const assignments = db
      .prepare(`
        SELECT a.*, f.name as faculty_name, f.department, f.designation, r.name as room_name, r.building
        FROM assignments a
        JOIN faculty f ON a.faculty_id = f.id
        JOIN rooms r ON a.room_id = r.id
        WHERE a.schedule_id = ? AND a.date = ?
        ORDER BY a.session ASC, a.room_id ASC
      `)
      .all(latestSched.id, date) as any[];

    const substitutions = db
      .prepare(`
        SELECT s.*, orig.name as original_faculty_name, sub.name as substitute_faculty_name, a.room_id, a.session
        FROM substitutions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN faculty orig ON s.original_faculty_id = orig.id
        JOIN faculty sub ON s.substitute_faculty_id = sub.id
        WHERE a.schedule_id = ? AND a.date = ?
      `)
      .all(latestSched.id, date) as any[];

    let completedCount = 0;
    let absentCount = 0;
    let substitutedCount = 0;

    for (const a of assignments) {
      if (a.status === 'COMPLETED') completedCount++;
      else if (a.status === 'ABSENT') absentCount++;
      else if (a.status === 'SUBSTITUTED') substitutedCount++;
    }

    // Faculty accounting for this date
    const assignedFacIds = new Set(assignments.map((a) => a.faculty_id));
    const unassignedFaculty = (exam.faculty || [])
      .filter((f) => !assignedFacIds.has(f.id))
      .map((f) => {
        const hist = FacultyService.getDutyHistory(f.id);
        return {
          facultyId: f.id,
          name: f.name,
          department: f.department,
          cumulativeDuties: hist.totalDuties,
          remainingCapacity: Math.max(0, (f.maxDutyOverride ?? exam.maxDutiesPerFaculty) - hist.totalDuties),
          reason: 'Not required or resting between shifts',
        };
      });

    const now = new Date().toISOString();
    const reportVersion = (existing?.report_version || 0) + 1;
    const reportId = `RPT-${examinationId}-${date.replace(/-/g, '')}-V${reportVersion}`;

    const snapshot: DailyReportSnapshot = {
      reportId,
      examinationId,
      examinationName: exam.name,
      academicYear: exam.academicYear,
      collegeName,
      date,
      reportVersion,
      isProvisional,
      generatedAt: now,
      generatedBy: actor,
      approvedBy: isProvisional ? undefined : actor,
      approvedAt: isProvisional ? undefined : now,
      sessionTimings: exam.sessionConfig,
      roomAssignments: assignments,
      summary: {
        totalRooms: new Set(assignments.map((a) => a.room_id)).size,
        totalAssignments: assignments.length,
        completedCount,
        absentCount,
        substitutedCount,
      },
      unassignedFaculty,
      substitutions,
    };

    // Save snapshot in DB
    db.prepare(`
      INSERT INTO daily_reports (id, examination_id, date, report_version, is_provisional, snapshot_data, generated_by, generated_at, approved_by, approved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reportId,
      examinationId,
      date,
      reportVersion,
      isProvisional ? 1 : 0,
      JSON.stringify(snapshot),
      actor,
      now,
      isProvisional ? null : actor,
      isProvisional ? null : now
    );

    AuditService.log({
      entity: 'daily_report',
      entityId: reportId,
      action: isProvisional ? 'GENERATE_PROVISIONAL' : 'FINALIZE_DAILY_REPORT',
      actor,
      newValues: { date, reportVersion },
    });

    return snapshot;
  }

  /**
   * Generates a consolidated final examination report.
   */
  public static generateFinalReport(examinationId: string): FinalReportData {
    const db = getDatabase();
    const exam = ExamService.getById(examinationId);
    if (!exam) throw new Error(`Examination ${examinationId} not found`);

    const collegeName = SettingsService.getInstitutionName();

    const latestSched = db
      .prepare('SELECT id, validation_result FROM schedules WHERE examination_id = ? ORDER BY version DESC LIMIT 1')
      .get(examinationId) as { id: string; validation_result: string } | undefined;

    if (!latestSched) {
      throw new Error('No schedule found for this examination.');
    }

    const assignments = db
      .prepare(`
        SELECT a.*, f.name as faculty_name, f.department, r.name as room_name
        FROM assignments a
        JOIN faculty f ON a.faculty_id = f.id
        JOIN rooms r ON a.room_id = r.id
        WHERE a.schedule_id = ?
        ORDER BY a.date ASC, a.session ASC
      `)
      .all(latestSched.id) as any[];

    const substitutions = db
      .prepare(`
        SELECT s.*, orig.name as original_faculty_name, sub.name as substitute_faculty_name, a.date, a.session, a.room_id
        FROM substitutions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN faculty orig ON s.original_faculty_id = orig.id
        JOIN faculty sub ON s.substitute_faculty_id = sub.id
        WHERE a.schedule_id = ?
      `)
      .all(latestSched.id) as any[];

    let totalCompletedDuties = 0;
    let totalAbsences = 0;
    let totalSubstitutions = substitutions.length;

    // facultyId -> { assigned, completed, absent }
    const facultyDutyMap = new Map<string, { assigned: number; completed: number; absent: number }>();
    for (const f of exam.faculty || []) {
      facultyDutyMap.set(f.id, { assigned: 0, completed: 0, absent: 0 });
    }

    for (const a of assignments) {
      if (!facultyDutyMap.has(a.faculty_id)) {
        facultyDutyMap.set(a.faculty_id, { assigned: 0, completed: 0, absent: 0 });
      }
      const record = facultyDutyMap.get(a.faculty_id)!;
      record.assigned++;
      if (a.status === 'COMPLETED') {
        record.completed++;
        totalCompletedDuties++;
      } else if (a.status === 'ABSENT') {
        record.absent++;
        totalAbsences++;
      }
    }

    const facultySummary = (exam.faculty || []).map((f) => {
      const stats = facultyDutyMap.get(f.id) || { assigned: 0, completed: 0, absent: 0 };
      const maxLimit = f.maxDutyOverride ?? exam.maxDutiesPerFaculty;
      const remainingCapacity = Math.max(0, maxLimit - stats.assigned);
      let status: 'AT_LIMIT' | 'UNDER_LIMIT' | 'UNASSIGNED' = 'UNDER_LIMIT';
      if (stats.assigned >= maxLimit) status = 'AT_LIMIT';
      else if (stats.assigned === 0) status = 'UNASSIGNED';

      return {
        facultyId: f.id,
        facultyName: f.name,
        department: f.department,
        assignedDuties: stats.assigned,
        completedDuties: stats.completed,
        absentDuties: stats.absent,
        maxLimit,
        remainingCapacity,
        status,
      };
    });

    // Date-wise summary
    const dateGroups = new Map<string, any[]>();
    for (const a of assignments) {
      if (!dateGroups.has(a.date)) dateGroups.set(a.date, []);
      dateGroups.get(a.date)!.push(a);
    }

    const dateWiseSummary = Array.from(dateGroups.entries()).map(([date, asgns]) => ({
      date,
      totalRoomsCovered: new Set(asgns.map((a) => a.room_id)).size,
      totalAssigned: asgns.length,
      completed: asgns.filter((a) => a.status === 'COMPLETED').length,
      absent: asgns.filter((a) => a.status === 'ABSENT').length,
      substituted: asgns.filter((a) => a.status === 'SUBSTITUTED').length,
    }));

    // Workload stats
    const countsMap = new Map<string, number>();
    for (const [id, stats] of facultyDutyMap.entries()) {
      countsMap.set(id, stats.assigned);
    }
    const workloadStats = SchedulingEngine.computeWorkloadStats(exam.faculty || [], countsMap);

    return {
      examinationId: exam.id,
      examinationName: exam.name,
      academicYear: exam.academicYear,
      collegeName,
      startDate: exam.startDate,
      endDate: exam.endDate,
      status: exam.status,
      totalExamDates: (exam.dates || []).filter((d) => d.isExamDay).length,
      totalSessions: exam.sessionConfig.length,
      totalActiveRooms: (exam.rooms || []).filter((r) => r.active !== false).length,
      totalParticipatingFaculty: (exam.faculty || []).filter((f) => f.active).length,
      totalRequiredSlots:
        (exam.dates || []).filter((d) => d.isExamDay).length *
        exam.sessionConfig.length *
        (exam.rooms || []).filter((r) => r.active !== false).length,
      totalAssignedSlots: assignments.length,
      totalCompletedDuties,
      totalAbsences,
      totalSubstitutions,
      workloadStats,
      facultySummary,
      substitutions,
      dateWiseSummary,
    };
  }

  public static listHistoricalDailyReports(examinationId: string): any[] {
    const db = getDatabase();
    return db
      .prepare(`
        SELECT id, examination_id, date, report_version, is_provisional, generated_by, generated_at, approved_by, approved_at
        FROM daily_reports
        WHERE examination_id = ?
        ORDER BY date DESC, report_version DESC
      `)
      .all(examinationId);
  }

  public static getHistoricalReports(examinationId: string): any[] {
    const db = getDatabase();
    return db
      .prepare(`
        SELECT *
        FROM daily_reports
        WHERE examination_id = ?
        ORDER BY date DESC, report_version DESC
      `)
      .all(examinationId);
  }

  public static getRoomSheetsData(
    scheduleId: string,
    filter: { date?: string; session?: string; roomId?: string } = {}
  ): RoomSheetData[] {
    const db = getDatabase();
    let sched = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;
    if (!sched) {
      sched = db
        .prepare(`
          SELECT * FROM schedules
          WHERE examination_id = ? AND state IN ('APPROVED', 'PUBLISHED', 'REVISED', 'COMPLETED')
          ORDER BY version DESC, revision_number DESC
          LIMIT 1
        `)
        .get(scheduleId) as any;
    }
    if (!sched) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    const exam = db.prepare('SELECT * FROM examinations WHERE id = ?').get(sched.examination_id) as any;
    if (!exam) {
      throw new Error(`Examination ${sched.examination_id} not found`);
    }

    const sessionTimingsMap: Record<string, string> = {};
    try {
      const parsedConfig = JSON.parse(exam.session_config || '[]');
      if (Array.isArray(parsedConfig)) {
        for (const s of parsedConfig) {
          if (s.name) {
            sessionTimingsMap[s.name] = `${s.startTime || ''} - ${s.endTime || ''}`.trim();
          }
        }
      }
    } catch (e) {}

    let query = `
      SELECT
        a.id as assignment_id,
        a.date,
        a.session,
        a.status,
        r.id as room_id,
        r.name as room_name,
        r.building,
        r.floor,
        f.id as faculty_id,
        f.name as faculty_name,
        f.department,
        f.designation
      FROM assignments a
      JOIN rooms r ON a.room_id = r.id
      JOIN faculty f ON a.faculty_id = f.id
      WHERE a.schedule_id = ? AND a.status != 'CANCELLED'
    `;
    const params: any[] = [scheduleId];

    if (filter.date) {
      query += ' AND a.date = ?';
      params.push(filter.date);
    }
    if (filter.session) {
      query += ' AND a.session = ?';
      params.push(filter.session);
    }
    if (filter.roomId) {
      query += ' AND a.room_id = ?';
      params.push(filter.roomId);
    }

    query += ' ORDER BY a.date ASC, a.session ASC, r.id ASC';

    const rows = db.prepare(query).all(...params) as any[];

    return rows.map((r) => ({
      examinationId: exam.id,
      examinationName: exam.name,
      academicYear: exam.academic_year || exam.academicYear || '',
      date: r.date,
      session: r.session,
      sessionTime:
        sessionTimingsMap[r.session] && sessionTimingsMap[r.session] !== '-'
          ? sessionTimingsMap[r.session]
          : r.session === 'MORNING'
          ? '10:00 AM - 01:00 PM'
          : '02:00 PM - 05:00 PM',
      roomId: r.room_id,
      roomName: r.room_name,
      building: r.building,
      floor: r.floor,
      facultyId: r.faculty_id,
      facultyName: r.faculty_name,
      department: r.department,
      designation: r.designation,
      status: r.status,
      timeInField: '',
      signatureField: '',
    }));
  }
}

export interface RoomSheetData {
  examinationId: string;
  examinationName: string;
  academicYear: string;
  date: string;
  session: string;
  sessionTime?: string;
  roomId: string;
  roomName: string;
  building: string;
  floor: number;
  facultyId: string;
  facultyName: string;
  department: string;
  designation: string;
  status: string;
  timeInField: string;
  signatureField: string;
}
