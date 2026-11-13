// GET /api/og/<username>?v=<image version>: the ticket's share image, 1200x630 PNG.
// The version in the URL changes on every remix, so a matching one is cached forever.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderCard } from '../_lib/card.js';
import { fetchTicket, fetchTicketImage, imageVersion, parseUsername } from '../_lib/tickets.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const raw = url.searchParams.get('username') ?? url.pathname.split('/').filter(Boolean).pop();
  const username = parseUsername(raw);
  const send = (status: number, body: string, cache: string) => {
    res.statusCode = status;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', cache);
    res.end(body);
  };
  if (!username) return send(400, 'bad username', 'public, max-age=3600');

  try {
    const ticket = await fetchTicket(username);
    if (!ticket) return send(404, 'no such ticket', 'public, max-age=0, s-maxage=60');
    const png = await renderCard(ticket, await fetchTicketImage(ticket));
    // an old ?v= gets today's image, but only briefly, so it can't pin the wrong one
    const current = url.searchParams.get('v') === imageVersion(ticket);
    res.statusCode = 200;
    res.setHeader('content-type', 'image/png');
    res.setHeader('content-length', png.length);
    res.setHeader('cache-control', current ? 'public, max-age=31536000, immutable' : 'public, max-age=0, s-maxage=300');
    res.end(png);
  } catch (err) {
    console.error(err);
    send(500, 'could not draw the ticket', 'no-store');
  }
}
