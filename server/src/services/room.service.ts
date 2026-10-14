import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';
import { Room } from '../domain/scheduling/types';

export interface RoomFilter {
  building?: string;
  floor?: number;
  active?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export class RoomService {
  public static list(filter: RoomFilter = {}): { data: Room[]; total: number } {
    const db = getDatabase();
    let query = 'SELECT * FROM rooms WHERE 1=1';
    const params: any[] = [];

    if (filter.building) {
      query += ' AND building = ?';
      params.push(filter.building);
    }

    if (filter.floor !== undefined) {
      query += ' AND floor = ?';
      params.push(filter.floor);
    }

    if (filter.active !== undefined) {
      query += ' AND active = ?';
      params.push(filter.active ? 1 : 0);
    }

    if (filter.search) {
      query += ' AND (id LIKE ? OR name LIKE ? OR building LIKE ?)';
      const s = `%${filter.search}%`;
      params.push(s, s, s);
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
      building: r.building,
      floor: r.floor,
      capacity: r.capacity,
      examDepartment: r.exam_department ?? null,
      active: Boolean(r.active),
    }));

    return { data, total };
  }

  public static getById(id: string): Room | null {
    const db = getDatabase();
    const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      building: r.building,
      floor: r.floor,
      capacity: r.capacity,
      examDepartment: r.exam_department ?? null,
      active: Boolean(r.active),
    };
  }

  public static create(roomData: Partial<Room> & { exam_department?: string | null }, actor = 'System Admin'): Room {
    const db = getDatabase();
    const now = new Date().toISOString();
    const id = roomData.id || `RM-${Date.now().toString().slice(-4)}`;
    const examDept = roomData.examDepartment !== undefined ? roomData.examDepartment : (roomData.exam_department ?? null);

    db.prepare(`
      INSERT INTO rooms (id, name, building, floor, capacity, exam_department, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      roomData.name || `Room ${id}`,
      roomData.building || 'Main Block',
      roomData.floor ?? 1,
      roomData.capacity ?? 30,
      examDept,
      roomData.active !== false ? 1 : 0,
      now,
      now
    );

    const created = RoomService.getById(id)!;
    AuditService.log({
      entity: 'room',
      entityId: id,
      action: 'CREATE',
      actor,
      newValues: created,
    });

    return created;
  }

  public static update(id: string, updates: Partial<Room> & { exam_department?: string | null }, actor = 'System Admin'): Room | null {
    const db = getDatabase();
    const old = RoomService.getById(id);
    if (!old) return null;

    const now = new Date().toISOString();
    const examDept = updates.examDepartment !== undefined ? updates.examDepartment : (updates.exam_department !== undefined ? updates.exam_department : null);

    // Guard: Prevent deactivating room with active duties in approved schedules
    if (updates.active === false) {
      const activeRoomDuty = db.prepare(`
        SELECT s.id as scheduleId, s.state
        FROM assignments a
        JOIN schedules s ON a.schedule_id = s.id
        WHERE a.room_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
        LIMIT 1
      `).get(id) as any;
      if (activeRoomDuty) {
        throw new Error(`Cannot deactivate room: Room is assigned to active duties in ${activeRoomDuty.state.toLowerCase()} schedule "${activeRoomDuty.scheduleId}". Reassign duties before deactivating room.`);
      }
    }

    // Guard: Prevent setting examDepartment if assigned faculty is in that department
    if (examDept && examDept.trim().length > 0) {
      const deptConflict = db.prepare(`
        SELECT s.id as scheduleId, f.id as facultyId, f.name as facultyName, f.department
        FROM assignments a
        JOIN schedules s ON a.schedule_id = s.id
        JOIN faculty f ON a.faculty_id = f.id
        WHERE a.room_id = ? AND a.status != 'CANCELLED' AND s.state IN ('APPROVED', 'PUBLISHED', 'IN_PROGRESS')
          AND LOWER(TRIM(f.department)) = LOWER(TRIM(?))
        LIMIT 1
      `).get(id, examDept.trim()) as any;
      if (deptConflict) {
        throw new Error(`Cannot set examination department "${examDept}": Assigned faculty ${deptConflict.facultyName} (${deptConflict.facultyId}) in approved schedule "${deptConflict.scheduleId}" is from the same department.`);
      }
    }

    db.prepare(`
      UPDATE rooms SET
        name = COALESCE(?, name),
        building = COALESCE(?, building),
        floor = COALESCE(?, floor),
        capacity = COALESCE(?, capacity),
        exam_department = COALESCE(?, exam_department),
        active = COALESCE(?, active),
        updated_at = ?
      WHERE id = ?
    `).run(
      updates.name ?? null,
      updates.building ?? null,
      updates.floor ?? null,
      updates.capacity ?? null,
      examDept,
      updates.active !== undefined ? (updates.active ? 1 : 0) : null,
      now,
      id
    );

    const updated = RoomService.getById(id)!;
    AuditService.log({
      entity: 'room',
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
    const old = RoomService.getById(id);
    if (!old) return false;

    const hasAssignments = db.prepare('SELECT 1 FROM assignments WHERE room_id = ? LIMIT 1').get(id);
    if (hasAssignments) {
      throw new Error(`Cannot delete room "${id}": Referenced in existing examination assignments.`);
    }

    db.prepare('DELETE FROM rooms WHERE id = ?').run(id);

    AuditService.log({
      entity: 'room',
      entityId: id,
      action: 'DELETE',
      actor,
      oldValues: old,
    });

    return true;
  }
}
