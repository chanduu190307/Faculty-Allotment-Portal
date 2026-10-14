import express from 'express';
import cors from 'cors';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';
import { apiRouter } from './routes/api.routes';

export function createApp(): express.Application {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(authMiddleware);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'faculty-allotment-api', timestamp: new Date().toISOString() });
  });

  // REST API Routes
  app.use('/api', apiRouter);

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
}
