import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let currentDb: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (currentDb && !dbPath) {
    return currentDb;
  }

  if (currentDb && dbPath) {
    try {
      currentDb.close();
    } catch {}
    currentDb = null;
  }

  const targetPath = dbPath || process.env.DATABASE_URL || path.resolve(process.cwd(), 'faculty_allotment.db');
  
  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(targetPath);
  
  // Enforce SQLite production best practices
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  currentDb = db;

  return db;
}

export function closeDatabase(): void {
  if (currentDb) {
    try {
      currentDb.close();
    } catch {}
    currentDb = null;
  }
}
