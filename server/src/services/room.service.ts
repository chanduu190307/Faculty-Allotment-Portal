import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';
import { SettingsService } from './settings.service';
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

    const name = roomData.name?.trim() || `Room ${roomData.id || ''}`;
    const building = roomData.building?.trim() || 'Block A';
    const floor = typeof roomData.floor === 'number' ? roomData.floor : 1;
    const capacity = typeof roomData.capacity === 'number' ? roomData.capacity : 30;
    const examDept = roomData.examDepartment !== undefined ? roomData.examDepartment : (roomData.exam_department ?? null);

    // Duplicate check: same room name on same floor of same building
    const existing = db.prepare(`
      SELECT id FROM rooms WHERE LOWER(TRIM(building)) = LOWER(TRIM(?)) AND floor = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))
    `).get(building, floor, name) as any;
    if (existing) {
      throw new Error(`A room named "${name}" already exists on Floor ${floor} of ${building} (ID: ${existing.id}).`);
    }

    const cleanBlock = building.replace(/[^A-Za-z0-9]/g, '');
    const cleanName = name.replace(/[^A-Za-z0-9]/g, '');
    let id = roomData.id?.trim() || `RM-${cleanBlock}-F${floor}-${cleanName}`;
    if (db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id)) {
      id = `RM-${cleanBlock}-F${floor}-${cleanName}-${Date.now().toString().slice(-4)}`;
    }

    db.prepare(`
      INSERT INTO rooms (id, name, building, floor, capacity, exam_department, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      building,
      floor,
      capacity,
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

    // Guard: Prevent renaming room referenced by approved schedules
    if (updates.name && updates.name.trim() !== old.name) {
      const approvedDuty = db.prepare(`
        SELECT s.id as scheduleId
        FROM assignments a
        JOIN schedules s ON a.schedule_id = s.id
        WHERE a.room_id = ? AND s.state IN ('APPROVED', 'PUBLISHED')
        LIMIT 1
      `).get(id);
      if (approvedDuty) {
        throw new Error(`Cannot rename room "${old.name}": Referenced by approved schedule. Fork a revision to alter room references.`);
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
      updates.name?.trim() ?? null,
      updates.building?.trim() ?? null,
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

  /**
   * Checks whether a room can be safely deleted or must be deactivated.
   */
  public static checkDeletable(id: string): { canDelete: boolean; assignmentCount: number; approvedCount: number; message?: string } {
    const db = getDatabase();
    const stats = db.prepare(`
      SELECT count(a.id) as total,
             SUM(CASE WHEN s.state IN ('APPROVED', 'PUBLISHED') THEN 1 ELSE 0 END) as approved
      FROM assignments a
      LEFT JOIN schedules s ON a.schedule_id = s.id
      WHERE a.room_id = ? AND a.status != 'CANCELLED'
    `).get(id) as { total: number; approved: number };

    if (stats && stats.total > 0) {
      return {
        canDelete: false,
        assignmentCount: stats.total,
        approvedCount: stats.approved || 0,
        message: `Room "${id}" is referenced in ${stats.total} duty assignment(s)${stats.approved > 0 ? ` (${stats.approved} in approved schedules)` : ''}. Permanent deletion is blocked to preserve institutional history. Safe deactivation is available instead.`
      };
    }
    return { canDelete: true, assignmentCount: 0, approvedCount: 0 };
  }

  public static delete(id: string, actor = 'System Admin'): boolean {
    const db = getDatabase();
    const old = RoomService.getById(id);
    if (!old) return false;

    const check = RoomService.checkDeletable(id);
    if (!check.canDelete) {
      throw new Error(check.message);
    }

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM examination_rooms WHERE room_id = ?').run(id);
      db.prepare('DELETE FROM rooms WHERE id = ?').run(id);

      AuditService.log({
        entity: 'room',
        entityId: id,
        action: 'DELETE',
        actor,
        oldValues: old,
      }, db);
    });

    tx();
    return true;
  }

  public static deactivate(id: string, actor = 'System Admin'): Room {
    const updated = RoomService.update(id, { active: false }, actor);
    if (!updated) throw new Error(`Room "${id}" not found.`);
    return updated;
  }

  /**
   * Previews proposed bulk room generation for a chosen block and floor.
   * Default: 25 rooms per floor.
   */
  public static bulkGeneratePreview(options: {
    block: string;
    floor: number;
    count?: number;
    prefix?: string;
    startingNumber?: number;
    capacity?: number;
  }): {
    block: string;
    floor: number;
    totalProposed: number;
    newCount: number;
    alreadyExistsCount: number;
    proposedRooms: Array<{
      id: string;
      name: string;
      building: string;
      floor: number;
      capacity: number;
      alreadyExists: boolean;
      existingId?: string;
    }>;
  } {
    const db = getDatabase();
    const { block, floor } = options;
    const count = options.count && options.count > 0 ? options.count : 25;
    const startNum = options.startingNumber && options.startingNumber > 0 ? options.startingNumber : 1;
    const capacity = options.capacity && options.capacity > 0 ? options.capacity : 30;

    // Determine prefix from block (e.g. "Block A" -> "A")
    const blockLetterMatch = block.match(/Block\s+([A-Za-z0-9]+)/i);
    const blockLetter = options.prefix || (blockLetterMatch ? blockLetterMatch[1] : block.substring(0, 1).toUpperCase());

    const proposedRooms: any[] = [];
    let newCount = 0;
    let alreadyExistsCount = 0;

    for (let i = 0; i < count; i++) {
      const roomNumSeq = startNum + i;
      // Standard institutional format: A-101, A-102, ... A-125
      const roomLabel = `${blockLetter}-${floor}${roomNumSeq.toString().padStart(2, '0')}`;
      const cleanBlock = block.replace(/[^A-Za-z0-9]/g, '');
      const roomId = `RM-${cleanBlock}-F${floor}-${roomLabel.replace(/[^A-Za-z0-9]/g, '')}`;

      // Check if room with this name already exists in this block and floor
      const existing = db.prepare(`
        SELECT id FROM rooms WHERE LOWER(TRIM(building)) = LOWER(TRIM(?)) AND floor = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))
      `).get(block, floor, roomLabel) as { id: string } | undefined;

      if (existing) {
        alreadyExistsCount++;
        proposedRooms.push({
          id: existing.id,
          name: roomLabel,
          building: block,
          floor,
          capacity,
          alreadyExists: true,
          existingId: existing.id,
        });
      } else {
        newCount++;
        proposedRooms.push({
          id: roomId,
          name: roomLabel,
          building: block,
          floor,
          capacity,
          alreadyExists: false,
        });
      }
    }

    return {
      block,
      floor,
      totalProposed: count,
      newCount,
      alreadyExistsCount,
      proposedRooms,
    };
  }

  /**
   * Commits proposed rooms to database.
   * Skips already existing rooms to prevent duplicate creation on repeated generation.
   */
  public static bulkGenerateCommit(
    optionsOrBlock: {
      block: string;
      floor: number;
      count?: number;
      prefix?: string;
      startingNumber?: number;
      capacity?: number;
      rooms?: Array<{ id: string; name: string; building: string; floor: number; capacity: number }>;
    } | string,
    floorOrActor?: number | string,
    roomsArg?: Array<{ id: string; name: string; building: string; floor: number; capacity: number }>,
    actorParam?: string
  ): {
    success: boolean;
    createdCount: number;
    skippedCount: number;
    createdRooms: Room[];
  } {
    const db = getDatabase();
    let options: {
      block: string;
      floor: number;
      count?: number;
      prefix?: string;
      startingNumber?: number;
      capacity?: number;
      rooms?: Array<{ id: string; name: string; building: string; floor: number; capacity: number }>;
    };
    let actor = 'System Admin';

    if (typeof optionsOrBlock === 'string') {
      options = {
        block: optionsOrBlock,
        floor: Number(floorOrActor),
        rooms: roomsArg || [],
      };
      actor = actorParam || 'System Admin';
    } else {
      options = optionsOrBlock;
      actor = (typeof floorOrActor === 'string' ? floorOrActor : actorParam) || 'System Admin';
    }

    const preview = options.rooms && options.rooms.length > 0
      ? { proposedRooms: options.rooms.map((r) => ({ ...r, alreadyExists: false })) }
      : RoomService.bulkGeneratePreview(options);

    const toInsert = preview.proposedRooms.filter((r) => !r.alreadyExists);
    const now = new Date().toISOString();
    const createdRooms: Room[] = [];

    const insertStmt = db.prepare(`
      INSERT INTO rooms (id, name, building, floor, capacity, exam_department, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const r of toInsert) {
        // Final duplicate check
        const exists = db.prepare('SELECT id FROM rooms WHERE id = ?').get(r.id);
        if (!exists) {
          insertStmt.run(r.id, r.name, r.building, r.floor, r.capacity, null, now, now);
          createdRooms.push({
            id: r.id,
            name: r.name,
            building: r.building,
            floor: r.floor,
            capacity: r.capacity,
            active: true,
          });
        }
      }

      AuditService.log({
        entity: 'room',
        entityId: `${options.block}-F${options.floor}`,
        action: 'BULK_GENERATE',
        actor,
        reason: `Bulk generated ${createdRooms.length} room(s) for ${options.block} Floor ${options.floor}.`,
      }, db);
    });

    tx();

    return {
      success: true,
      createdCount: createdRooms.length,
      skippedCount: preview.proposedRooms.length - createdRooms.length,
      createdRooms,
    };
  }

  /**
   * Returns diagnostic breakdown of expected vs registered rooms by block and floor.
   */
  public static getRoomHierarchyDiagnostics(): {
    blocks: string[];
    defaultFloorsPerBlock: number;
    defaultRoomsPerFloor: number;
    totalExpectedRooms: number;
    totalRegisteredRooms: number;
    totalActiveRooms: number;
    breakdown: Array<{
      block: string;
      floor: number;
      expected: number;
      registered: number;
      active: number;
      deficit: number;
    }>;
  } {
    const db = getDatabase();
    const defaultFloors = Number(SettingsService.get('floors_per_block', '4')) || 4;
    const defaultRoomsPerFloor = Number(SettingsService.get('rooms_per_floor', '25')) || 25;
    const standardBlocks = ['Block A', 'Block B', 'Block C'];

    const breakdown: any[] = [];
    let totalRegistered = 0;
    let totalActive = 0;

    for (const block of standardBlocks) {
      for (let floor = 1; floor <= defaultFloors; floor++) {
        const stats = db.prepare(`
          SELECT count(*) as total,
                 SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active
          FROM rooms
          WHERE LOWER(TRIM(building)) = LOWER(TRIM(?)) AND floor = ?
        `).get(block, floor) as { total: number; active: number };

        const reg = stats?.total || 0;
        const act = stats?.active || 0;
        totalRegistered += reg;
        totalActive += act;

        breakdown.push({
          block,
          floor,
          expected: defaultRoomsPerFloor,
          registered: reg,
          active: act,
          deficit: Math.max(0, defaultRoomsPerFloor - act),
        });
      }
    }

    return {
      blocks: standardBlocks,
      defaultFloorsPerBlock: defaultFloors,
      defaultRoomsPerFloor: defaultRoomsPerFloor,
      totalExpectedRooms: standardBlocks.length * defaultFloors * defaultRoomsPerFloor,
      totalRegisteredRooms: totalRegistered,
      totalActiveRooms: totalActive,
      breakdown,
    };
  }
}
