import { getDatabase, closeDatabase } from './connection';
import { runMigrations } from './schema';
import { seedDatabase } from './seed';

export function initializeDatabase(): void {
  console.log('[DB] Connecting to database...');
  const db = getDatabase();
  console.log('[DB] Running schema migrations...');
  runMigrations(db);
  console.log('[DB] Initializing default configuration keys...');
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, description, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  insertSetting.run('default_room_count', '20', 'Configured number of active examination rooms', now);
  insertSetting.run('default_faculty_count', '50', 'Configured number of registered faculty', now);
  insertSetting.run('default_max_duties', '6', 'Default maximum duties per teacher', now);
  insertSetting.run('sessions_per_day', '2', 'Standard daily examination sessions', now);
  insertSetting.run('institution_name', 'Faculty Allotment Portal', 'Configurable Institution Name', now);
  console.log('[DB] Clean database initialization complete (0 sample faculty/rooms).');
}

if (require.main === module) {
  try {
    initializeDatabase();
  } catch (err) {
    console.error('[DB] Initialization failed:', err);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}
