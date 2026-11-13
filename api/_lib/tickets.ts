// Shared by the share page (api/t.ts) and its image (api/og/[username].ts).
// Files under api/_lib are helpers, not routes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Ticket = { username: string; number: number; image_path: string };

const USERNAME = /^[a-z0-9_]{2,24}$/;

/** the username from a path segment, or null if it can't be one (same rule as the tickets table) */
export function parseUsername(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name: string;
  try {
    name = decodeURIComponent(raw).trim().toLowerCase().replace(/^@/, '');
  } catch {
    return null;
  }
  return USERNAME.test(name) ? name : null;
}

let dotenv: Record<string, string> | undefined;
/** the committed .env (bundled via vercel.json includeFiles): Vite reads it at build time, but functions don't get it as env */
function fromDotenv(name: string): string | undefined {
  if (!dotenv) {
    dotenv = {};
    try {
      for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m) dotenv[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    } catch {
      // no .env: the project's environment variables are all there is
    }
  }
  return dotenv[name];
}

/** a setting from the function's environment, else the committed .env */
export const env = (name: string): string | undefined => process.env[name] ?? fromDotenv(name);

function supabase() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set');
  return { url: url.replace(/\/+$/, ''), key };
}

/** the ticket row over REST with the publishable key (tickets are public to read) */
export async function fetchTicket(username: string): Promise<Ticket | null> {
  const { url, key } = supabase();
  const query = new URLSearchParams({ select: 'username,number,image_path', username: `eq.${username}`, limit: '1' });
  const res = await fetch(`${url}/rest/v1/tickets?${query}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`tickets query failed: ${res.status}`);
  const rows = (await res.json()) as Ticket[];
  return rows[0] ?? null;
}

/** the stored ticket image (webp) from the public bucket */
export async function fetchTicketImage(ticket: Ticket): Promise<Buffer> {
  const { url } = supabase();
  const path = ticket.image_path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${url}/storage/v1/object/public/tickets/${path}`);
  if (!res.ok) throw new Error(`ticket image fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** a remix writes a new image_path (<owner>/<version>.webp), so its file name versions the share image */
export function imageVersion(ticket: Ticket): string {
  const file = ticket.image_path.split('/').pop() ?? '';
  return file.replace(/\.[a-z0-9]+$/i, '');
}

export const ticketNumber = (n: number) => `#${String(n).padStart(4, '0')}`;
