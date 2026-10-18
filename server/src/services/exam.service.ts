import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';
import { ExamDate, ExamSession, Room, Faculty } from '../domain/scheduling/types';

export interface ExaminationRecord {
  id: string;
  name: string;
  academicYear: string;
  startDate: string;
  endDate: string;
  defaultStaffingPerRoom: number;
  sessionsPerDay: number;
  sessionConfig: ExamSession[];
  maxDutiesPerFaculty: number;
  restDays?: number;
  status: 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  dates?: ExamDate[];
  rooms?: Room[];
  faculty?: Faculty[];
}

export class ExamService {
  public static list(): ExaminationRecord[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM examinations ORDER BY created_at DESC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      academicYear: r.academic_year,
      startDate: r.start_date,
      endDate: r.end_date,
      defaultStaffingPerRoom: r.default_staffing_per_room,
      sessionsPerDay: r.sessions_per_day,
      sessionConfig: JSON.parse(r.session_config),
      maxDutiesPerFaculty: r.max_duties_per_faculty,
      restDays: r.rest_days ?? 1,
      status: r.status,
    }));
  }

  public static getById(id: string): ExaminationRecord | null {
    const db = getDatabase();
    const r = db.prepare('SELECT * FROM examinations WHERE id = ?').get(id) as any;
    if (!r) return null;

    const datesRows = db
      .prepare('SELECT * FROM examination_dates WHERE examination_id = ? ORDER BY sequence_order ASC')
      .all(id) as any[];
    const dates: ExamDate[] = datesRows.map((d) => ({
      date: d.date,
      sequenceOrder: d.sequence_order,
      isExamDay: Boolean(d.is_examination_day),
    }));

    const roomsRows = db
      .prepare(`
        SELECT r.*, er.is_active as exam_active, er.required_staffing
        FROM examination_rooms er
        JOIN rooms r ON er.room_id = r.id
        WHERE er.examination_id = ?
        ORDER BY r.id ASC
      `)
      .all(id) as any[];
    const rooms: Room[] = roomsRows.map((rm) => ({
      id: rm.id,
      name: rm.name,
      building: rm.building,
      floor: rm.floor,
      capacity: rm.capacity,
      examDepartment: rm.exam_department ?? null,
      requiredStaffing: rm.required_staffing,
      active: Boolean(rm.exam_active && rm.active),
    }));

    const facultyRows = db
      .prepare(`
        SELECT f.*, ef.is_participating, ef.duty_limit_override
        FROM examination_faculty ef
        JOIN faculty f ON ef.faculty_id = f.id
        WHERE ef.examination_id = ?
        ORDER BY f.id ASC
      `)
      .all(id) as any[];
    const faculty: Faculty[] = facultyRows.map((f) => ({
      id: f.id,
      name: f.name,
      email: f.email,
      department: f.department,
      designation: f.designation,
      active: Boolean(f.is_participating && f.active),
      exempt: Boolean(f.exempt),
      maxDutyOverride: f.duty_limit_override || f.max_duty_override,
    }));

    return {
      id: r.id,
      name: r.name,
      academicYear: r.academic_year,
      startDate: r.start_date,
      endDate: r.end_date,
      defaultStaffingPerRoom: r.default_staffing_per_room,
      sessionsPerDay: r.sessions_per_day,
      sessionConfig: JSON.parse(r.session_config),
      maxDutiesPerFaculty: r.max_duties_per_faculty,
      restDays: r.rest_days ?? 1,
      status: r.status,
      dates,
      rooms,
      faculty,
    };
  }

  public static create(examData: Partial<ExaminationRecord> & { rest_days?: number }, actor = 'System Admin'): ExaminationRecord {
    const db = getDatabase();
    const id = examData.id || `EXAM-${Date.now().toString().slice(-4)}`;
    const now = new Date().toISOString();
    const restDays = examData.restDays !== undefined ? examData.restDays : (examData.rest_days !== undefined ? examData.rest_days : 1);

    const sessionConfig = JSON.stringify(
      examData.sessionConfig || [
        { name: 'Morning', startTime: '09:30', endTime: '12:30' },
        { name: 'Afternoon', startTime: '14:00', endTime: '17:00' },
      ]
    );

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT OR REPLACE INTO examinations (id, name, academic_year, start_date, end_date, default_staffing_per_room, sessions_per_day, session_config, max_duties_per_faculty, rest_days, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        examData.name || 'New Examination',
        examData.academicYear || '2026-2027',
        examData.startDate || new Date().toISOString().slice(0, 10),
        examData.endDate || new Date().toISOString().slice(0, 10),
        examData.defaultStaffingPerRoom || 1,
        examData.sessionsPerDay || 2,
        sessionConfig,
        examData.maxDutiesPerFaculty || 6,
        restDays,
        'DRAFT',
        now,
        now
      );

      // Link active rooms
      db.prepare(`
        INSERT INTO examination_rooms (examination_id, room_id, is_active, required_staffing)
        SELECT ?, id, 1, 1 FROM rooms WHERE active = 1
      `).run(id);

      // Link active faculty
      db.prepare(`
        INSERT INTO examination_faculty (examination_id, faculty_id, is_participating, duty_limit_override)
        SELECT ?, id, 1, NULL FROM faculty WHERE active = 1
      `).run(id);

      // Populate dates if provided
      if (examData.dates && examData.dates.length > 0) {
        const stmtDate = db.prepare(`
          INSERT INTO examination_dates (examination_id, date, sequence_order, is_examination_day)
          VALUES (?, ?, ?, ?)
        `);
        examData.dates.forEach((d, idx) => {
          stmtDate.run(id, d.date, d.sequenceOrder || idx + 1, d.isExamDay !== false ? 1 : 0);
        });
      }
    });

    tx();

    AuditService.log({
      entity: 'examination',
      entityId: id,
      action: 'CREATE',
      actor,
      newValues: examData,
    });

    return ExamService.getById(id)!;
  }

  public static updateDates(examinationId: string, dates: ExamDate[], actor = 'System Admin'): void {
    const db = getDatabase();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM examination_dates WHERE examination_id = ?').run(examinationId);
      const stmt = db.prepare(`
        INSERT INTO examination_dates (examination_id, date, sequence_order, is_examination_day)
        VALUES (?, ?, ?, ?)
      `);
      dates.forEach((d, idx) => {
        stmt.run(examinationId, d.date, d.sequenceOrder || idx + 1, d.isExamDay ? 1 : 0);
      });
    });
    tx();

    AuditService.log({
      entity: 'examination',
      entityId: examinationId,
      action: 'UPDATE_DATES',
      actor,
      newValues: dates,
    });
  }

  public static updateStatus(examinationId: string, status: string, actor = 'System Admin'): void {
    const db = getDatabase();
    const old = ExamService.getById(examinationId);
    db.prepare('UPDATE examinations SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      new Date().toISOString(),
      examinationId
    );

    AuditService.log({
      entity: 'examination',
      entityId: examinationId,
      action: 'UPDATE_STATUS',
      actor,
      oldValues: { status: old?.status },
      newValues: { status },
    });
  }

  public static update(
    examinationId: string,
    data: Partial<ExaminationRecord>,
    actor = 'System Admin'
  ): ExaminationRecord | null {
    const db = getDatabase();
    const old = ExamService.getById(examinationId);
    if (!old) return null;

    const fields: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.academicYear !== undefined) {
      fields.push('academic_year = ?');
      values.push(data.academicYear);
    }
    if (data.startDate !== undefined) {
      fields.push('start_date = ?');
      values.push(data.startDate);
    }
    if (data.endDate !== undefined) {
      fields.push('end_date = ?');
      values.push(data.endDate);
    }
    if (data.defaultStaffingPerRoom !== undefined) {
      fields.push('default_staffing_per_room = ?');
      values.push(data.defaultStaffingPerRoom);
    }
    if (data.maxDutiesPerFaculty !== undefined) {
      fields.push('max_duties_per_faculty = ?');
      values.push(data.maxDutiesPerFaculty);
    }
    if (data.restDays !== undefined) {
      fields.push('rest_days = ?');
      values.push(data.restDays);
    }
    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status);
    }

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(examinationId);

      db.prepare(`UPDATE examinations SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      AuditService.log({
        entity: 'examination',
        entityId: examinationId,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: data,
      });
    }

    return ExamService.getById(examinationId);
  }
}
