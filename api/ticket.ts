// /api/ticket: the only way a ticket is written. The caller proves who they are
// with their supabase.com session (the one www and the dashboard keep); this
// checks it with supabase.com's auth server and then writes with the LW16
// secret key. The LW16 project only stores: its tables are read-only to browsers.
//
//   GET  /api/ticket   → the caller's ticket, or null
//   POST /api/ticket   → make or remix it: multipart form with `ticket` (JSON) and `image` (webp)
//
// Both need `Authorization: Bearer <supabase.com access token>`.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { env, parseUsername } from './_lib/tickets.js';

interface Account {
  id: string;
  email?: string;
}

const MAX_IMAGE = 2 * 1024 * 1024;
/** the image plus the ticket's layers (which can be large) */
const MAX_BODY = 6 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Who the token belongs to (null if nobody). On supabase.com (TICKETS_LOGIN=supabase-com)
 * that's supabase.com's auth server; on previews and localhost, this project's own
 * auth, which the mock sign-in page signs in to.
 */
async function account(req: IncomingMessage): Promise<Account | null> {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const platform = env('TICKETS_LOGIN') === 'supabase-com';
  const authUrl = platform ? env('PLATFORM_AUTH_URL') : `${env('VITE_SUPABASE_URL')?.replace(/\/+$/, '')}/auth/v1`;
  if (!authUrl) throw new Error('PLATFORM_AUTH_URL must be set');
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (!platform) headers.apikey = env('VITE_SUPABASE_PUBLISHABLE_KEY') ?? '';
  const r = await fetch(`${authUrl.replace(/\/+$/, '')}/user`, { headers });
  if (!r.ok) return null;
  const user = (await r.json()) as { id?: string; email?: string };
  return user.id ? { id: user.id, email: user.email } : null;
}

/** the LW16 project, with the secret key: only ever used here, after the caller's been checked */
function store() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and SUPABASE_SECRET_KEY must be set');
  const base = url.replace(/\/+$/, '');
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  return {
    async mine(id: string) {
      const r = await fetch(`${base}/rest/v1/tickets?select=*&user_id=eq.${encodeURIComponent(id)}&limit=1`, { headers });
      if (!r.ok) throw new Error(`ticket lookup failed: ${r.status}`);
      return ((await r.json()) as unknown[])[0] ?? null;
    },
    async upload(path: string, image: Blob) {
      const r = await fetch(`${base}/storage/v1/object/tickets/${path}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'image/webp', 'cache-control': 'max-age=31536000' },
        body: image,
      });
      if (!r.ok) throw new Error(`image upload failed: ${r.status} ${await r.text()}`);
    },
    /** the row, or the database's own complaint (taken or malformed username) */
    async upsert(row: Record<string, unknown>) {
      const r = await fetch(`${base}/rest/v1/tickets?on_conflict=user_id`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row),
      });
      const body = (await r.json()) as unknown;
      return r.ok ? { ticket: (body as unknown[])[0] } : { error: body as { code?: string; message?: string; details?: string } };
    },
  };
}

/** the light the ticket's shown in: one of the scene's lightings by name, or none */
const cardLighting = (raw: unknown) => (typeof raw === 'string' && /^[A-Za-z ]{1,40}$/.test(raw) ? raw : null);

/** the stickers, as plain numbers and known-shaped ids, at most a dozen */
function ticketStickers(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
  return raw.slice(0, 12).flatMap((s) => {
    const o = s as Record<string, unknown>;
    const id = typeof o.id === 'string' && /^[a-z0-9-]{1,32}$/.test(o.id) ? o.id : null;
    const u = num(o.u, 0, 1), v = num(o.v, 0, 1), scale = num(o.scale, 0.02, 1), rotation = num(o.rotation, -360, 360);
    return id && u !== null && v !== null && scale !== null && rotation !== null ? [{ id, u, v, scale, rotation }] : [];
  });
}

/** the request as a Web Request, so FormData can read the multipart body */
async function webRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return new Request('http://local/api/ticket', {
    method: 'POST',
    headers: { 'content-type': String(req.headers['content-type'] ?? '') },
    body: Buffer.concat(chunks),
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('allow', 'GET, POST');
      return send(res, 405, { error: 'method not allowed' });
    }
    const who = await account(req);
    if (!who) return send(res, 401, { error: 'not signed in' });
    const db = store();
    if (req.method === 'GET') return send(res, 200, { ticket: await db.mine(who.id) });

    const form = await (await webRequest(req)).formData();
    const image = form.get('image');
    let draft: Record<string, unknown>;
    try {
      draft = JSON.parse(String(form.get('ticket') ?? ''));
    } catch {
      return send(res, 400, { error: 'ticket must be JSON' });
    }
    const username = parseUsername(String(draft.username ?? ''));
    if (!username) return send(res, 400, { error: 'Usernames are 2–24 lowercase letters, numbers or underscores.' });
    if (!(image instanceof Blob) || image.type !== 'image/webp' || image.size > MAX_IMAGE) {
      return send(res, 400, { error: 'image must be a webp under 2MB' });
    }

    // a new file per version: images are never overwritten, so caches stay honest
    const path = `${who.id}/${Date.now()}.webp`;
    await db.upload(path, image);
    const { ticket, error } = await db.upsert({
      user_id: who.id,
      username,
      engine: String(draft.engine ?? ''),
      seed: Number(draft.seed),
      layers: Number(draft.layers),
      engine_rev: String(draft.engine_rev ?? 'unknown'),
      image_path: path,
      composition: Array.isArray(draft.composition) ? draft.composition : [],
      lighting: cardLighting(draft.lighting),
      stickers: ticketStickers(draft.stickers),
    });
    if (error) {
      if (error.code === '23505' && /username/i.test(`${error.message} ${error.details ?? ''}`)) {
        return send(res, 409, { error: 'That username is taken. Try another.' });
      }
      return send(res, 400, { error: error.message ?? 'the ticket could not be saved' });
    }
    return send(res, 200, { ticket });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    console.error('[api/ticket]', err);
    return send(res, status, { error: status === 413 ? 'the ticket is too large' : 'the ticket could not be saved' });
  }
}
