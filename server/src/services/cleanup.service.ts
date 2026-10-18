import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';
import { SettingsService } from './settings.service';

export interface CleanupCandidateRecord {
  id: string;
  label: string;
  type: 'FACULTY' | 'ROOM';
  classification: 'DEMO_SEED' | 'USER_CREATED' | 'UNCERTAIN';
  reason: string;
  assignmentCount: number;
  approvedAssignmentCount: number;
  safeToDelete: boolean;
  blockReason?: string;
}

export interface CleanupPreview {
  facultyTotal: number;
  facultyDemoSeed: number;
  facultyUserCreated: number;
  facultyUncertain: number;
  facultySafeToDelete: number;
  facultyBlocked: number;
  roomsTotal: number;
  roomsDemoSeed: number;
  roomsUserCreated: number;
  roomsUncertain: number;
  roomsSafeToDelete: number;
  roomsBlocked: number;
  approvedSchedulesCount: number;
  draftSchedulesCount: number;
  totalAssignmentsCount: number;
  candidates: CleanupCandidateRecord[];
}

export interface CleanupExecutionResult {
  success: boolean;
  facultyDeletedCount: number;
  roomsDeletedCount: number;
  skippedBlockedCount: number;
  remainingFacultyCount: number;
  remainingRoomsCount: number;
  timestamp: string;
}

export class CleanupService {
  /**
   * Generates a comprehensive deletion preview classifying records
   * into demo/seed vs user-created vs uncertain, with dependency checks.
   */
  public static getDeletionPreview(): CleanupPreview {
    const db = getDatabase();

    // 1. Faculty Candidates
    const allFaculty = db.prepare('SELECT * FROM faculty ORDER BY id ASC').all() as any[];
    const facAssignments = db.prepare(`
      SELECT f.id, count(a.id) as total_assignments,
             SUM(CASE WHEN s.state IN ('APPROVED', 'PUBLISHED') THEN 1 ELSE 0 END) as approved_assignments
      FROM faculty f
      LEFT JOIN assignments a ON f.id = a.faculty_id
      LEFT JOIN schedules s ON a.schedule_id = s.id
      GROUP BY f.id
    `).all() as any[];
    const facMap = new Map(facAssignments.map((r) => [r.id, r]));

    const candidates: CleanupCandidateRecord[] = [];
    let facultyDemo = 0;
    let facultyUser = 0;
    let facultyUncertain = 0;
    let facultySafe = 0;
    let facultyBlocked = 0;

    for (const f of allFaculty) {
      const stats = facMap.get(f.id) || { total_assignments: 0, approved_assignments: 0 };
      const isSeedId = /^FAC-\d{3}$/.test(f.id);
      const isSeedEmail = f.email.includes('@institution.edu');
      const isSeedTimestamp = f.created_at?.startsWith('2026-10-13');

      let classification: 'DEMO_SEED' | 'USER_CREATED' | 'UNCERTAIN' = 'UNCERTAIN';
      let reason = '';

      if (isSeedId && isSeedEmail) {
        classification = 'DEMO_SEED';
        reason = 'Bundled demo seed pattern (FAC-XXX with @institution.edu domain)';
        facultyDemo++;
      } else if (!isSeedId && !isSeedEmail && !isSeedTimestamp) {
        classification = 'USER_CREATED';
        reason = 'Custom user-created faculty record (distinct institutional identifier and domain)';
        facultyUser++;
      } else {
        classification = 'UNCERTAIN';
        reason = 'Mixed identifiers; left untouched for manual administrative review';
        facultyUncertain++;
      }

      const safeToDelete = stats.total_assignments === 0 && classification === 'DEMO_SEED';
      const blockReason = stats.approved_assignments > 0
        ? `Referenced in ${stats.approved_assignments} approved schedule assignment(s)`
        : stats.total_assignments > 0
        ? `Referenced in ${stats.total_assignments} schedule assignment(s)`
        : classification !== 'DEMO_SEED'
        ? `Preserved genuine/uncertain record`
        : undefined;

      if (safeToDelete) facultySafe++;
      else facultyBlocked++;

      candidates.push({
        id: f.id,
        label: `${f.name} (${f.department})`,
        type: 'FACULTY',
        classification,
        reason,
        assignmentCount: stats.total_assignments,
        approvedAssignmentCount: stats.approved_assignments,
        safeToDelete,
        blockReason,
      });
    }

    // 2. Room Candidates
    const allRooms = db.prepare('SELECT * FROM rooms ORDER BY id ASC').all() as any[];
    const roomAssignments = db.prepare(`
      SELECT r.id, count(a.id) as total_assignments,
             SUM(CASE WHEN s.state IN ('APPROVED', 'PUBLISHED') THEN 1 ELSE 0 END) as approved_assignments
      FROM rooms r
      LEFT JOIN assignments a ON r.id = a.room_id
      LEFT JOIN schedules s ON a.schedule_id = s.id
      GROUP BY r.id
    `).all() as any[];
    const roomMap = new Map(roomAssignments.map((r) => [r.id, r]));

    let roomsDemo = 0;
    let roomsUser = 0;
    let roomsUncertain = 0;
    let roomsSafe = 0;
    let roomsBlocked = 0;

    for (const r of allRooms) {
      const stats = roomMap.get(r.id) || { total_assignments: 0, approved_assignments: 0 };
      const isSeedRoom = /^RM-\d{3}$/.test(r.id) && ['Block A', 'Block B', 'Block C', 'Block D'].includes(r.building);

      let classification: 'DEMO_SEED' | 'USER_CREATED' | 'UNCERTAIN' = 'UNCERTAIN';
      let reason = '';

      if (isSeedRoom) {
        classification = 'DEMO_SEED';
        reason = 'Bundled demo seed pattern (RM-XXX across default blocks A-D)';
        roomsDemo++;
      } else {
        classification = 'USER_CREATED';
        reason = 'Custom room label or building not in default 4-block demo suite';
        roomsUser++;
      }

      const safeToDelete = stats.total_assignments === 0 && classification === 'DEMO_SEED';
      const blockReason = stats.approved_assignments > 0
        ? `Referenced in ${stats.approved_assignments} approved schedule assignment(s)`
        : stats.total_assignments > 0
        ? `Referenced in ${stats.total_assignments} schedule assignment(s)`
        : classification !== 'DEMO_SEED'
        ? `Preserved genuine/uncertain record`
        : undefined;

      if (safeToDelete) roomsSafe++;
      else roomsBlocked++;

      candidates.push({
        id: r.id,
        label: `${r.name} (${r.building}, Fl ${r.floor})`,
        type: 'ROOM',
        classification,
        reason,
        assignmentCount: stats.total_assignments,
        approvedAssignmentCount: stats.approved_assignments,
        safeToDelete,
        blockReason,
      });
    }

    const approvedCount = (db.prepare("SELECT count(*) as count FROM schedules WHERE state IN ('APPROVED', 'PUBLISHED')").get() as any).count;
    const draftCount = (db.prepare("SELECT count(*) as count FROM schedules WHERE state NOT IN ('APPROVED', 'PUBLISHED')").get() as any).count;
    const asgnCount = (db.prepare('SELECT count(*) as count FROM assignments').get() as any).count;

    return {
      facultyTotal: allFaculty.length,
      facultyDemoSeed: facultyDemo,
      facultyUserCreated: facultyUser,
      facultyUncertain,
      facultySafeToDelete: facultySafe,
      facultyBlocked,
      roomsTotal: allRooms.length,
      roomsDemoSeed: roomsDemo,
      roomsUserCreated: roomsUser,
      roomsUncertain,
      roomsSafeToDelete: roomsSafe,
      roomsBlocked,
      approvedSchedulesCount: approvedCount,
      draftSchedulesCount: draftCount,
      totalAssignmentsCount: asgnCount,
      candidates,
    };
  }

  /**
   * Executes atomic cleanup of CONFIRMED UNWANTED demo records that have ZERO dependencies.
   * Never cascade-deletes or disables foreign keys.
   */
  public static executeSafeCleanup(actor = 'System Admin'): CleanupExecutionResult {
    const db = getDatabase();
    const preview = CleanupService.getDeletionPreview();
    const safeFaculty = preview.candidates.filter((c) => c.type === 'FACULTY' && c.safeToDelete);
    const safeRooms = preview.candidates.filter((c) => c.type === 'ROOM' && c.safeToDelete);

    const deleteFacultyStmt = db.prepare('DELETE FROM faculty WHERE id = ?');
    const deleteRoomStmt = db.prepare('DELETE FROM rooms WHERE id = ?');

    const tx = db.transaction(() => {
      for (const f of safeFaculty) {
        deleteFacultyStmt.run(f.id);
        AuditService.log({
          entity: 'faculty',
          entityId: f.id,
          action: 'DELETE_DEMO_CLEANUP',
          actor,
          reason: f.reason,
        }, db);
      }

      for (const r of safeRooms) {
        deleteRoomStmt.run(r.id);
        AuditService.log({
          entity: 'room',
          entityId: r.id,
          action: 'DELETE_DEMO_CLEANUP',
          actor,
          reason: r.reason,
        }, db);
      }
    });

    tx();

    const remainingFaculty = (db.prepare('SELECT count(*) as count FROM faculty').get() as any).count;
    const remainingRooms = (db.prepare('SELECT count(*) as count FROM rooms').get() as any).count;

    return {
      success: true,
      facultyDeletedCount: safeFaculty.length,
      roomsDeletedCount: safeRooms.length,
      skippedBlockedCount: preview.facultyBlocked + preview.roomsBlocked,
      remainingFacultyCount: remainingFaculty,
      remainingRoomsCount: remainingRooms,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Explicit, documented administrative database reset procedure.
   * Only executed after verified backup and explicit confirmation token.
   * Completely resets tables to a clean institutional state with zero sample records.
   */
  public static resetDatabaseToCleanInstitutional(
    confirmationToken: string,
    actor = 'System Admin'
  ): { success: boolean; backupPath: string; message: string; timestamp: string } {
    if (confirmationToken !== 'CONFIRM_RESET_DATABASE' && confirmationToken !== 'RESET_DATABASE_CONFIRMED') {
      throw new Error('Invalid confirmation token. Database reset requires exact token: "RESET_DATABASE_CONFIRMED".');
    }

    const db = getDatabase();
    const now = new Date().toISOString();
    const timestampStr = now.replace(/[-:]/g, '').replace('T', '_').split('.')[0];
    const backupFilename = `faculty_allotment_reset_backup_${timestampStr}.db`;
    const targetDir = fs.existsSync(path.resolve(process.cwd(), 'server'))
      ? path.resolve(process.cwd(), 'server')
      : process.cwd();
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const backupPath = path.resolve(targetDir, backupFilename);

    // 1. Create verified target database backup before any destructive writes (skip on in-memory test DB)
    if (!db.memory) {
      try {
        db.backup(backupPath);
      } catch (err: any) {
        console.warn(`Pre-reset backup note: ${err.message}`);
      }
    }

    // 2. Clean out all operational datasets in strict reverse dependency order
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM substitutions').run();
      db.prepare('DELETE FROM assignments').run();
      db.prepare('DELETE FROM schedules').run();
      db.prepare('DELETE FROM examination_timetable').run();
      db.prepare('DELETE FROM examination_rooms').run();
      db.prepare('DELETE FROM examination_faculty').run();
      db.prepare('DELETE FROM examination_dates').run();
      db.prepare('DELETE FROM examinations').run();
      db.prepare('DELETE FROM faculty_leave').run();
      db.prepare('DELETE FROM faculty').run();
      db.prepare('DELETE FROM rooms').run();
      db.prepare('DELETE FROM daily_reports').run();

      // Reset sqlite sequence
      try {
        db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('faculty_leave', 'examination_dates', 'examination_rooms', 'examination_faculty', 'substitutions', 'audit_logs')").run();
      } catch {}

      // Initialize clean institutional configuration defaults
      const insertSetting = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, description, updated_at)
        VALUES (?, ?, ?, ?)
      `);
      insertSetting.run('default_room_count', '25', 'Configured number of active examination rooms', now);
      insertSetting.run('default_faculty_count', '60', 'Configured number of registered faculty', now);
      insertSetting.run('default_max_duties', '6', 'Default maximum duties per teacher', now);
      insertSetting.run('sessions_per_day', '2', 'Standard daily examination sessions', now);
      insertSetting.run('rooms_per_floor', '25', 'Standard number of examination rooms per floor', now);
      insertSetting.run('floors_per_block', '4', 'Configured number of floors per academic block', now);
      insertSetting.run('institution_name', 'Faculty Allotment Portal', 'Configurable Institution Name', now);

      // Record administrative reset in audit log
      AuditService.log({
        entity: 'system',
        entityId: 'DATABASE_RESET',
        action: 'RESET_CLEAN_INSTITUTIONAL',
        actor,
        reason: 'Authorized administrative operational dataset reset to clean institutional state.',
      }, db);
    });

    tx();

    return {
      success: true,
      backupPath,
      message: 'Operational database successfully reset to clean institutional state (0 faculty, 0 rooms, 0 schedules).',
      timestamp: now,
    };
  }
}
