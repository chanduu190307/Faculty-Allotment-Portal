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

  public static set(key: string, value: string, actor = 'System Admin', description?: string): void {
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
