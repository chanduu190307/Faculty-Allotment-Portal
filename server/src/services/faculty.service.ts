import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';
import { Faculty, FacultyLeave } from '../domain/scheduling/types';

export interface FacultyFilter {
  department?: string;
  active?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export class FacultyService {
  public static list(filter: FacultyFilter = {}): { data: Faculty[]; total: number } {
    const db = getDatabase();
    let query = 'SELECT * FROM faculty WHERE 1=1';
    const params: any[] = [];

    if (filter.department) {
      query += ' AND department = ?';
      params.push(filter.department);
    }

    if (filter.active !== undefined) {
      query += ' AND active = ?';
      params.push(filter.active ? 1 : 0);
    }

    if (filter.search) {
      query += ' AND (id LIKE ? OR name LIKE ? OR email LIKE ? OR department LIKE ?)';
      const s = `%${filter.search}%`;
      params.push(s, s, s, s);
    }

    const countRow = db.prepare(`SELECT count(*) as count FROM (${query})`).get(...params) as { count: number };
    const total = countRow.count;

    query += ' ORDER BY id ASC';

    if (filter.limit) {
      query += ' LIMIT ? OFFSET ?';
      params.push(filter.limit, filter.offset || 0);
    }

    const rows = db.prepare(query).all(...params) as any[];
    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      department: r.department,
      designation: r.designation,
      phone: r.phone,
      active: Boolean(r.active),
      exempt: Boolean(r.exempt),
      maxDutyOverride: r.max_duty_override,
    }));

    return { data, total };
  }

  public static getById(id: string): (Faculty & { phone?: string }) | null {
    const db = getDatabase();
    const r = db.prepare('SELECT * FROM faculty WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      department: r.department,
      designation: r.designation,
      phone: r.phone,
      active: Boolean(r.active),
      exempt: Boolean(r.exempt),
      maxDutyOverride: r.max_duty_override,
    };
  }

  public static create(facultyData: Partial<Faculty> & { phone?: string }, actor = 'System Admin'): Faculty {
    const db = getDatabase();
    const now = new Date().toISOString();
    const id = facultyData.id || `FAC-${Date.now().toString().slice(-4)}`;

    db.prepare(`
      INSERT INTO faculty (id, name, email, department, designation, phone, active, exempt, max_duty_override, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      facultyData.name,
      facultyData.email,
      facultyData.department,
      facultyData.designation,
      facultyData.phone || null,
      facultyData.active !== false ? 1 : 0,
      facultyData.exempt ? 1 : 0,
      facultyData.maxDutyOverride || null,
      now,
      now
    );

    const created = FacultyService.getById(id)!;
    AuditService.log({
      entity: 'faculty',
      entityId: id,
      action: 'CREATE',
      actor,
      newValues: created,
    });

    return created;
  }

  public static update(id: string, updates: Partial<Faculty> & { phone?: string }, actor = 'System Admin'): Faculty | null {
    const db = getDatabase();
    const old = FacultyService.getById(id);
    if (!old) return null;

    const now = new Date().toISOString();

    // Guard: Prevent deactivating or exempting faculty with active duties in approved schedules
    if (updates.active === false || updates.exempt === true) {
      const activeDuty = db.prepare(`
        SELECT s.id as scheduleId, s.state
        FROM assignments a
        JOIN schedules s ON a.schedule_id = s.id
        WHERE a.faculty_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
        LIMIT 1
      `).get(id) as any;
      if (activeDuty) {
        throw new Error(`Cannot ${updates.active === false ? 'deactivate' : 'exempt'} faculty member: Faculty is assigned to active duties in ${activeDuty.state.toLowerCase()} schedule "${activeDuty.scheduleId}". Reassign duties before updating eligibility.`);
      }
    }

    // Guard: Prevent changing department if assigned to room restricted to that department
    if (updates.department && updates.department.trim().toLowerCase() !== old.department.trim().toLowerCase()) {
      const deptConflict = db.prepare(`
        SELECT s.id as scheduleId, r.id as roomId, r.name as roomName, r.exam_department
        FROM assignments a
        JOIN schedules s ON a.schedule_id = s.id
        JOIN rooms r ON a.room_id = r.id
        WHERE a.faculty_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
          AND LOWER(TRIM(r.exam_department)) = LOWER(TRIM(?))
        LIMIT 1
      `).get(id, updates.department.trim()) as any;
      if (deptConflict) {
        throw new Error(`Cannot change department to "${updates.department}": Faculty is assigned to room ${deptConflict.roomId} (${deptConflict.roomName}) in approved schedule "${deptConflict.scheduleId}" which is restricted to that department.`);
      }
    }

    db.prepare(`
      UPDATE faculty SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        department = COALESCE(?, department),
        designation = COALESCE(?, designation),
        phone = COALESCE(?, phone),
        active = COALESCE(?, active),
        exempt = COALESCE(?, exempt),
        max_duty_override = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updates.name ?? null,
      updates.email ?? null,
      updates.department ?? null,
      updates.designation ?? null,
      updates.phone ?? null,
      updates.active !== undefined ? (updates.active ? 1 : 0) : null,
      updates.exempt !== undefined ? (updates.exempt ? 1 : 0) : null,
      updates.maxDutyOverride !== undefined ? updates.maxDutyOverride : old.maxDutyOverride ?? null,
      now,
      id
    );

    const updated = FacultyService.getById(id)!;
    AuditService.log({
      entity: 'faculty',
      entityId: id,
      action: 'UPDATE',
      actor,
      oldValues: old,
      newValues: updated,
    });

    return updated;
  }

  public static delete(id: string, actor = 'System Admin'): boolean {
    const db = getDatabase();
    const old = FacultyService.getById(id);
    if (!old) return false;

    const hasAssignments = db.prepare('SELECT 1 FROM assignments WHERE faculty_id = ? LIMIT 1').get(id);
    if (hasAssignments) {
      throw new Error(`Cannot delete faculty member "${id}": Referenced in existing examination assignments.`);
    }

    db.prepare('DELETE FROM faculty WHERE id = ?').run(id);

    AuditService.log({
      entity: 'faculty',
      entityId: id,
      action: 'DELETE',
      actor,
      oldValues: old,
    });

    return true;
  }

  // Leave Management
  public static getLeaves(facultyId?: string, date?: string): FacultyLeave[] {
    const db = getDatabase();
    let query = 'SELECT * FROM faculty_leave WHERE 1=1';
    const params: any[] = [];

    if (facultyId) {
      query += ' AND faculty_id = ?';
      params.push(facultyId);
    }
    if (date) {
      query += ' AND date = ?';
      params.push(date);
    }

    query += ' ORDER BY date ASC, id ASC';
    const rows = db.prepare(query).all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      facultyId: r.faculty_id,
      date: r.date,
      sessionScope: r.session_scope,
      reason: r.reason,
      approvalStatus: r.approval_status,
    }));
  }

  public static addLeave(leave: FacultyLeave, actor = 'System Admin'): number {
    const db = getDatabase();
    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO faculty_leave (faculty_id, date, session_scope, reason, approval_status, approved_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      leave.facultyId,
      leave.date,
      leave.sessionScope || 'FULL_DAY',
      leave.reason,
      leave.approvalStatus || 'APPROVED',
      actor,
      now
    );

    AuditService.log({
      entity: 'faculty_leave',
      entityId: String(info.lastInsertRowid),
      action: 'CREATE',
      actor,
      newValues: leave,
    });

    return Number(info.lastInsertRowid);
  }

  public static deleteLeave(leaveId: number, actor = 'System Admin'): boolean {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM faculty_leave WHERE id = ?').run(leaveId);
    if (res.changes > 0) {
      AuditService.log({
        entity: 'faculty_leave',
        entityId: String(leaveId),
        action: 'DELETE',
        actor,
      });
      return true;
    }
    return false;
  }

  // Duty History
  public static getDutyHistory(facultyId: string): {
    totalDuties: number;
    scheduledCount: number;
    completedCount: number;
    absentCount: number;
    cancelledCount: number;
    assignments: any[];
  } {
    const db = getDatabase();
    const assignments = db.prepare(`
      SELECT a.*, r.name as room_name, r.building, s.examination_id, e.name as exam_name
      FROM assignments a
      JOIN schedules s ON a.schedule_id = s.id
      JOIN examinations e ON s.examination_id = e.id
      JOIN rooms r ON a.room_id = r.id
      WHERE a.faculty_id = ?
      ORDER BY a.date DESC, a.session ASC
    `).all(facultyId) as any[];

    let scheduledCount = 0;
    let completedCount = 0;
    let absentCount = 0;
    let cancelledCount = 0;

    for (const a of assignments) {
      if (a.status === 'SCHEDULED') scheduledCount++;
      else if (a.status === 'COMPLETED') completedCount++;
      else if (a.status === 'ABSENT') absentCount++;
      else if (a.status === 'CANCELLED') cancelledCount++;
    }

    // Active duty capacity consumed = scheduled + completed + absent
    const totalDuties = scheduledCount + completedCount + absentCount;

    return {
      totalDuties,
      scheduledCount,
      completedCount,
      absentCount,
      cancelledCount,
      assignments,
    };
  }
}
