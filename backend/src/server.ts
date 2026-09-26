import { env } from './env.js';
import { disconnect } from './db.js';
import { buildApp } from './app.js';

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: env.port, host: '0.0.0.0' });
  app.log.info(`Class Manager API on http://localhost:${env.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
