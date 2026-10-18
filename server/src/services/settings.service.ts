import { getDatabase } from '../db/connection';
import { AuditService } from './audit.service';

export class SettingsService {
  public static getAll(): Record<string, string> {
    const db = getDatabase();
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  public static get(key: string, defaultValue = ''): string {
    const db = getDatabase();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  }

  public static getInstitutionName(): string {
    const val = SettingsService.get('institution_name') || SettingsService.get('college_name');
    return val && val.trim() ? val.trim() : 'Institution Name';
  }

  public static validateSettings(settings: Record<string, string>): void {
    if (settings.default_room_count !== undefined) {
      const val = settings.default_room_count.trim();
      const num = Number(val);
      if (!val || isNaN(num) || !Number.isInteger(num) || num < 1 || num > 2000) {
        throw new Error('Invalid expected room count: must be an integer between 1 and 2000.');
      }
    }

    if (settings.default_faculty_count !== undefined) {
      const val = settings.default_faculty_count.trim();
      const num = Number(val);
      if (!val || isNaN(num) || !Number.isInteger(num) || num < 1 || num > 10000) {
        throw new Error('Invalid expected faculty count: must be an integer between 1 and 10000.');
      }
    }

    if (settings.default_max_duties !== undefined) {
      const val = settings.default_max_duties.trim();
      const num = Number(val);
      if (!val || isNaN(num) || !Number.isInteger(num) || num < 1 || num > 50) {
        throw new Error('Invalid maximum duties limit: must be an integer between 1 and 50.');
      }
    }

    if (settings.sessions_per_day !== undefined) {
      const val = settings.sessions_per_day.trim();
      const num = Number(val);
      if (!val || isNaN(num) || !Number.isInteger(num) || num < 1 || num > 6) {
        throw new Error('Invalid daily examination sessions: must be an integer between 1 and 6.');
      }
    }

    if (settings.rooms_per_floor !== undefined) {
      const val = settings.rooms_per_floor.trim();
      const num = Number(val);
      if (!val || isNaN(num) || !Number.isInteger(num) || num < 1 || num > 100) {
        throw new Error('Invalid rooms per floor: must be an integer between 1 and 100.');
      }
    }

    if (settings.floors_per_block !== undefined) {
      const val = settings.floors_per_block.trim();
      const num = Number(val);
      if (!val || isNaN(num) || !Number.isInteger(num) || num < 1 || num > 20) {
        throw new Error('Invalid floors per block: must be an integer between 1 and 20.');
      }
    }
  }

  public static getRoomsPerFloor(): number {
    const val = Number(SettingsService.get('rooms_per_floor', '25'));
    return !isNaN(val) && val > 0 ? val : 25;
  }

  public static getFloorsPerBlock(): number {
    const val = Number(SettingsService.get('floors_per_block', '4'));
    return !isNaN(val) && val > 0 ? val : 4;
  }

  public static getExpectedRoomCount(): number {
    const val = Number(SettingsService.get('default_room_count', '200'));
    return !isNaN(val) && val > 0 ? val : 200;
  }

  public static getExpectedFacultyCount(): number {
    const val = Number(SettingsService.get('default_faculty_count', '500'));
    return !isNaN(val) && val > 0 ? val : 500;
  }

  public static getDefaultMaxDuties(): number {
    const val = Number(SettingsService.get('default_max_duties', '6'));
    return !isNaN(val) && val > 0 ? val : 6;
  }

  public static getSystemCountsSummary(): {
    expectedRooms: number;
    registeredRoomsTotal: number;
    registeredRoomsActive: number;
    roomsMismatch: boolean;
    expectedFaculty: number;
    registeredFacultyTotal: number;
    registeredFacultyActive: number;
    registeredFacultyExempt: number;
    registeredFacultyUnavailable: number;
    eligibleFacultyCount: number;
    facultyMismatch: boolean;
    defaultMaxDuties: number;
    sessionsPerDay: number;
    institutionName: string;
  } {
    const db = getDatabase();
    const expectedRooms = SettingsService.getExpectedRoomCount();
    const expectedFaculty = SettingsService.getExpectedFacultyCount();
    const defaultMaxDuties = SettingsService.getDefaultMaxDuties();
    const sessionsPerDay = Number(SettingsService.get('sessions_per_day', '2')) || 2;
    const institutionName = SettingsService.getInstitutionName();

    const roomCounts = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) as active
      FROM rooms
    `).get() as { total: number; active: number };

    const facultyCounts = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) as active,
        COALESCE(SUM(CASE WHEN exempt = 1 THEN 1 ELSE 0 END), 0) as exempt,
        COALESCE(SUM(CASE WHEN active = 1 AND exempt = 0 THEN 1 ELSE 0 END), 0) as eligible
      FROM faculty
    `).get() as { total: number; active: number; exempt: number; eligible: number };

    const registeredRoomsTotal = roomCounts?.total || 0;
    const registeredRoomsActive = roomCounts?.active || 0;
    const registeredFacultyTotal = facultyCounts?.total || 0;
    const registeredFacultyActive = facultyCounts?.active || 0;
    const registeredFacultyExempt = facultyCounts?.exempt || 0;
    const eligibleFacultyCount = facultyCounts?.eligible || 0;
    const registeredFacultyUnavailable = registeredFacultyTotal - eligibleFacultyCount;

    return {
      expectedRooms,
      registeredRoomsTotal,
      registeredRoomsActive,
      roomsMismatch: expectedRooms !== registeredRoomsActive,
      expectedFaculty,
      registeredFacultyTotal,
      registeredFacultyActive,
      registeredFacultyExempt,
      registeredFacultyUnavailable,
      eligibleFacultyCount,
      facultyMismatch: expectedFaculty !== registeredFacultyActive,
      defaultMaxDuties,
      sessionsPerDay,
      institutionName,
    };
  }

  public static set(key: string, value: string, actor = 'System Admin', description?: string): void {
    SettingsService.validateSettings({ [key]: value });
    const db = getDatabase();
    const old = SettingsService.get(key);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO settings (key, value, description, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, description || null, now);

    AuditService.log({
      entity: 'settings',
      entityId: key,
      action: 'UPDATE',
      actor,
      oldValues: { [key]: old },
      newValues: { [key]: value },
    });
  }

  public static updateMany(settings: Record<string, string>, actor = 'System Admin'): void {
    SettingsService.validateSettings(settings);
    const db = getDatabase();
    const oldValues = SettingsService.getAll();

    const tx = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      const now = new Date().toISOString();
      for (const [key, value] of Object.entries(settings)) {
        stmt.run(key, value, now);
      }
    });

    tx();

    AuditService.log({
      entity: 'settings',
      entityId: 'bulk',
      action: 'UPDATE',
      actor,
      oldValues,
      newValues: settings,
    });
  }
}
