import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** the Visual Engine commit this build draws with: cached artwork is only reused for the same one */
function engineRev() {
  try {
    return execSync('git rev-parse --short HEAD:visual-engine-generator', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/**
 * The Vercel functions that the site itself calls (/api/ticket), run by the dev
 * server too, so saving a ticket works on localhost without `vercel dev`.
 * Settings come from .env and .env.local, as Vercel's would from the project.
 */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
      server.middlewares.use('/api/ticket', async (req, res) => {
        const mod = (await server.ssrLoadModule('/api/ticket.ts')) as { default: (q: typeof req, r: typeof res) => Promise<void> };
        await mod.default(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __ENGINE_REV__: JSON.stringify(engineRev()),
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        lw: fileURLToPath(new URL('./lw.html', import.meta.url)),
        signIn: fileURLToPath(new URL('./sign-in.html', import.meta.url)),
      },
    },
  },
  server: {
    port: Number(process.env.PORT) || 5199,
  },
});
