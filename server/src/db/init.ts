import { getDatabase, closeDatabase } from './connection';
import { runMigrations } from './schema';
import { seedDatabase } from './seed';

export function initializeDatabase(): void {
  console.log('[DB] Connecting to database...');
  const db = getDatabase();
  console.log('[DB] Running schema migrations...');
  runMigrations(db);
  console.log('[DB] Seeding default configuration, rooms, and faculty...');
  seedDatabase(db);
  console.log('[DB] Database initialization complete.');
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
