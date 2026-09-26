/**
 * The API as a Cloud Function. Firebase Hosting rewrites `/api/**` here (see
 * firebase.json), so the SPA and the API share an origin and need no CORS.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import type { FastifyInstance } from 'fastify';

// Class times are stored as wall-clock "16:30" and expanded into dates in
// server-local time; Functions run in UTC, so pin the school's zone.
process.env.TZ = 'America/Los_Angeles';

const jwtSecret = defineSecret('JWT_SECRET');

let ready: Promise<FastifyInstance> | undefined;

function getApp() {
  ready ??= import('../../backend/src/app.js')
    .then(async ({ buildApp }) => {
      const app = await buildApp({ cloudFunction: true });
      await app.ready();
      return app;
    })
    .catch((err) => {
      ready = undefined; // let the next request retry a failed cold start
      throw err;
    });
  return ready;
}

export const api = onRequest(
  { region: 'us-central1', secrets: [jwtSecret], memory: '512MiB', maxInstances: 5 },
  async (req, res) => {
    const app = await getApp();
    app.server.emit('request', req, res);
  },
);
