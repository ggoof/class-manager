import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { env } from './env.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { teacherRoutes } from './routes/teacher.js';
import { studentRoutes } from './routes/student.js';

/**
 * Builds the API without listening, so the same routes serve both the local
 * server (`server.ts`) and the Cloud Function (`functions/src/index.ts`).
 */
export async function buildApp(options: { cloudFunction?: boolean } = {}) {
  const app = Fastify({
    logger: env.isProduction
      ? true
      : { transport: undefined, level: 'info' },
  });

  if (options.cloudFunction) {
    // Cloud Functions has already read and parsed the body by the time the
    // request reaches us, so the stream is drained; hand Fastify what it parsed.
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser('application/json', {}, (req, _payload, done) => {
      done(null, (req.raw as unknown as { body?: unknown }).body);
    });
  }

  await app.register(cors, {
    origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  });

  await app.register(jwt, { secret: env.jwtSecret });

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(teacherRoutes);
  await app.register(studentRoutes);

  app.setErrorHandler((err, req, reply) => {
    req.log.error(err);
    const error = err as { code?: string; statusCode?: number; message?: string };
    // A lost race for a username, email or class code is user error, not server
    // error — `UniqueViolation` carries its own 409 and message.
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.code(status).send({
      error: status === 500 ? 'Something went wrong on the server' : (error.message ?? 'Request failed'),
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: `No route for ${req.method} ${req.url}` });
  });

  return app;
}
