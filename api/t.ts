// GET /t/<username> (rewritten here by vercel.json): the site's index.html with the
// og:* / twitter:* tags pointing at that ticket, since crawlers don't run JS.
// The SPA still boots from it. An unknown ticket gets the plain index.html.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchTicket, imageVersion, parseUsername, ticketNumber, type Ticket } from './_lib/tickets.js';

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v)?.split(',')[0].trim();
};

function origin(req: IncomingMessage) {
  const host = header(req, 'x-forwarded-host') ?? header(req, 'host') ?? 'localhost';
  const proto = header(req, 'x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

let indexHtml: Promise<string> | undefined;
/** the built index.html: bundled with the function (vercel.json includeFiles), else from the deployment itself */
function loadIndex(site: string): Promise<string> {
  return (indexHtml ??= (async () => {
    try {
      return readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf8');
    } catch {
      const res = await fetch(`${site}/index.html`);
      if (!res.ok) throw new Error(`index.html fetch failed: ${res.status}`);
      return res.text();
    }
  })().catch((err) => {
    indexHtml = undefined;
    throw err;
  }));
}

const attr = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** replace the meta tag for `key` (og:* by property, twitter:* by name) wherever it is, or add it before </head> */
function setMeta(html: string, key: string, value: string) {
  const kind = key.startsWith('og:') ? 'property' : 'name';
  const tag = `<meta ${kind}="${key}" content="${attr(value)}" />`;
  const existing = new RegExp(`<meta\\b[^>]*\\b(?:property|name)\\s*=\\s*["']${reEscape(key)}["'][^>]*>`, 'gi');
  let found = false;
  const out = html.replace(existing, () => (found ? '' : ((found = true), tag)));
  return found ? out : out.replace(/\n?([ \t]*)<\/head>/i, (_, indent: string) => `\n${indent}  ${tag}\n${indent}</head>`);
}

export function ticketHtml(html: string, ticket: Ticket, site: string) {
  const title = `@${ticket.username}'s Launch Week 16 ticket ${ticketNumber(ticket.number)}`;
  const image = `${site}/api/og/${ticket.username}?v=${encodeURIComponent(imageVersion(ticket))}`;
  const tags: [string, string][] = [
    ['og:type', 'website'],
    ['og:url', `${site}/t/${ticket.username}`],
    ['og:title', title],
    ['og:image', image],
    ['og:image:width', '1200'],
    ['og:image:height', '630'],
    ['og:image:alt', title],
    ['twitter:card', 'summary_large_image'],
    ['twitter:title', title],
    ['twitter:image', image],
    ['twitter:image:alt', title],
  ];
  let out = tags.reduce((h, [k, v]) => setMeta(h, k, v), html);
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${attr(title)}</title>`);
  return out;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const raw = url.searchParams.get('username') ?? url.pathname.match(/\/t\/([^/]+)/)?.[1];
  const username = parseUsername(raw);
  const site = origin(req);

  const send = (html: string, cache: string) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', cache);
    res.end(html);
  };

  let html: string;
  try {
    html = await loadIndex(site);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader('cache-control', 'no-store');
    return res.end('could not load the page');
  }

  if (!username) return send(html, 'public, max-age=0, s-maxage=300');
  let ticket: Ticket | null;
  try {
    ticket = await fetchTicket(username);
  } catch (err) {
    console.error(err);
    return send(html, 'public, max-age=0, s-maxage=10');
  }
  // not made yet: the plain page, briefly, so a ticket made a minute later gets its card
  if (!ticket) return send(html, 'public, max-age=0, s-maxage=60');
  send(ticketHtml(html, ticket, site), 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
}
