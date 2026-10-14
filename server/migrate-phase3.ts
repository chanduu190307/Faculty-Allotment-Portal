import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { runMigrations } from './src/db/schema';

const dbPath = path.resolve(__dirname, 'faculty_allotment.db');
const backupPath = path.resolve(__dirname, 'faculty_allotment_backup_phase3_20261014.db');

console.log('[Phase 3 Migration] Target DB:', dbPath);
const dbPre = new Database(dbPath);
dbPre.pragma('wal_checkpoint(TRUNCATE)');
dbPre.close();

fs.copyFileSync(dbPath, backupPath);
console.log('[Backup] Created backup at:', backupPath, 'Size:', fs.statSync(backupPath).size);

const db = new Database(dbPath);
console.log('[Migration] Running runMigrations()...');
runMigrations(db);
console.log('[Migration] Migration completed successfully.');

const schedCols = db.prepare('PRAGMA table_info(schedules)').all() as any[];
console.log('[Inspection] Schedules columns:', schedCols.map(c => c.name));

const tables = ['faculty', 'rooms', 'examinations', 'schedules', 'assignments', 'audit_logs'];
const counts: any = {};
for (const t of tables) {
  counts[t] = (db.prepare('SELECT count(*) as count FROM ' + t).get() as any).count;
}
console.log('[Inspection] Row counts after migration:', JSON.stringify(counts, null, 2));

const pragmaIntegrity = db.pragma('integrity_check');
console.log('[Integrity Check]:', pragmaIntegrity);

const pragmaFK = db.pragma('foreign_key_check');
console.log('[Foreign Key Check]:', pragmaFK);

db.close();
