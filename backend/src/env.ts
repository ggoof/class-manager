import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimal .env loader. Avoids a dotenv dependency and the Node `--env-file`
 * flag, which errors out when the file is absent. Existing process env wins.
 */
function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(resolve(backendRoot, '.env'));
loadDotEnv(resolve(backendRoot, '.env.example')); // dev fallback so a fresh clone just runs

/**
 * The service account may arrive as raw JSON or, because most hosting dashboards
 * mangle multi-line values, base64. Accept either.
 */
function readServiceAccount(): string | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  try {
    const parsed = JSON.parse(json) as { project_id?: string };
    // Let the key file settle the project, so the two can never disagree.
    if (parsed.project_id) process.env.FIREBASE_PROJECT_ID ??= parsed.project_id;
    return json;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON (or base64-encoded JSON)');
  }
}

const firebaseServiceAccount = readServiceAccount();

export const env = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-insecure-secret-change-me',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  isProduction: process.env.NODE_ENV === 'production',

  firebaseServiceAccount,
  firebaseProjectId:
    process.env.FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT,
  /** Set by `firebase emulators:start`; when present no credentials are needed. */
  firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
};

if (env.isProduction && env.jwtSecret.startsWith('dev-only')) {
  throw new Error('JWT_SECRET must be set to a real secret in production');
}

if (!env.firebaseProjectId) {
  throw new Error(
    'No Firebase project. Set FIREBASE_PROJECT_ID (and FIREBASE_SERVICE_ACCOUNT, or ' +
      'GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key file).',
  );
}

if (env.isProduction && !firebaseServiceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Application-default credentials still work on Google infrastructure; this is
  // only a warning because that is a legitimate way to run.
  console.warn(
    '[env] No FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS — falling back to ' +
      'application-default credentials.',
  );
}
