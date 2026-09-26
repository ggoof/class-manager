/**
 * Bundles the Fastify API (backend/ + shared/) into lib/, so Cloud Build only
 * has to install the two packages the Functions runtime insists on resolving
 * itself. Run by the functions predeploy hook in firebase.json.
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('lib', { recursive: true, force: true });

await build({
  entryPoints: ['src/index.ts'],
  outdir: 'lib',
  bundle: true,
  // Keeps the API in its own chunk behind a dynamic import, so the CLI's
  // function discovery never evaluates backend/src/env.ts.
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['firebase-admin', 'firebase-functions'],
  // Bundled CommonJS deps call require() for Node builtins; ESM has none.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
