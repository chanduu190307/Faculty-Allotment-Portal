import { createApp } from './app';
import { getDatabase } from './db/connection';
import { runMigrations } from './db/schema';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

function startServer(): void {
  const db = getDatabase();
  runMigrations(db);

  // Initialize essential institutional setting defaults if missing (without generating sample records)
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

  const app = createApp();

  const server = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` Faculty Allotment System Backend Service`);
    console.log(` Running on: http://localhost:${PORT}`);
    console.log(` Health Check: http://localhost:${PORT}/health`);
    console.log(` API Base: http://localhost:${PORT}/api`);
    console.log(` Mode: Production-Grade SQLite WAL Engine`);
    console.log(`=======================================================`);
  });

  const shutdown = () => {
    console.log('\n[Server] Shutting down gracefully...');
    server.close(() => {
      console.log('[Server] HTTP listener closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  startServer();
}
