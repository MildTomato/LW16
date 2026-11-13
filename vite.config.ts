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
 * The Vercel functions that the site itself calls (/api/ticket, /api/og), run by the dev
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
      type Handler = { default: (q: unknown, r: unknown) => Promise<void> };
      // mounted paths: the handler sees the rest of the path (the og image reads its username from it)
      const route = (path: string, file: string) =>
        server.middlewares.use(path, async (req, res) => {
          await ((await server.ssrLoadModule(file)) as Handler).default(req, res);
        });
      route('/api/ticket', '/api/ticket.ts');
      route('/api/og', '/api/og/[username].ts');
      // dev only, never deployed: write a seeded ticket (no owner) with the secret key, for filling the stack
      server.middlewares.use('/__dev/seed', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        try {
          const url = process.env.VITE_SUPABASE_URL?.replace(/\/+$/, '');
          const key = process.env.SUPABASE_SECRET_KEY;
          if (req.method !== 'POST' || !url || !key) return send(400, { error: 'POST, with VITE_SUPABASE_URL and SUPABASE_SECRET_KEY set' });
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const form = await new Request('http://local/', { method: 'POST', headers: { 'content-type': String(req.headers['content-type'] ?? '') }, body: Buffer.concat(chunks) }).formData();
          const t = JSON.parse(String(form.get('ticket')));
          const image = form.get('image') as Blob;
          const auth = { apikey: key, authorization: `Bearer ${key}` };
          const path = `seed/${t.username}/${Date.now()}.webp`;
          const up = await fetch(`${url}/storage/v1/object/tickets/${path}`, { method: 'POST', headers: { ...auth, 'content-type': 'image/webp', 'cache-control': 'max-age=31536000' }, body: image });
          if (!up.ok) return send(500, { error: `upload ${up.status} ${await up.text()}` });
          const row = { username: t.username, engine: t.engine, seed: t.seed, layers: t.layers, engine_rev: t.engine_rev, composition: t.composition, image_path: path, user_id: null };
          const ins = await fetch(`${url}/rest/v1/tickets`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(row) });
          const body = await ins.json();
          return send(ins.ok ? 200 : 400, body);
        } catch (err) {
          return send(500, { error: String(err) });
        }
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
        x: fileURLToPath(new URL('./x.html', import.meta.url)),
      },
    },
  },
  server: {
    port: Number(process.env.PORT) || 5199,
  },
});
