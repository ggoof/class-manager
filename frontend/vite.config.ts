import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // The API origin is baked into the bundle at build time, so a forgotten
  // placeholder ships a site where every request 404s against a host that does
  // not exist. Fail here instead, where the cause is obvious.
  if (mode === 'production' && (env.VITE_API_BASE_URL ?? '').includes('REPLACE-ME')) {
    throw new Error(
      'VITE_API_BASE_URL in frontend/.env.production is still the placeholder. ' +
        'Set it to your deployed API origin (see DEPLOY.md step 5) before building.',
    );
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // The UI calls /api/* on its own origin; Vite forwards to Fastify in dev,
      // so there is no CORS story to get wrong locally.
      proxy: {
        '/api': { target: 'http://localhost:3000', changeOrigin: true },
      },
    },
  };
});
