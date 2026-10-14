import { createApp } from './app';
import { getDatabase } from './db/connection';
import { runMigrations } from './db/schema';
import { seedDatabase } from './db/seed';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

function startServer(): void {
  const db = getDatabase();
  runMigrations(db);

  // If no faculty exist, seed initial defaults
  const facCount = (db.prepare('SELECT count(*) as count FROM faculty').get() as { count: number }).count;
  if (facCount === 0) {
    console.log('[Server] Seeding initial defaults...');
    seedDatabase(db);
  }

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
