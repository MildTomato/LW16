/**
 * Tickets: every visitor makes one — their own Visual Engine artwork with
 * their username etched in the corner — and the stack on the site is made of
 * the latest of them. Kept in Supabase: a row per person (signed in
 * anonymously, so it's theirs without a form) and the rendered image in the
 * public tickets bucket. New and remixed tickets arrive live.
 */
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { ENGINE_AVAILABLE, ENGINE_RANDOM, engineStages } from './engineArt.ts';
import { ASCII, fetchDataUrl, groundPage, inkPage, loadImage, loadOwnerFont, marksPage, ownerPage, stackPages } from './gridArt.ts';

declare const __ENGINE_REV__: string;

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase = URL_BASE && API_KEY ? createClient(URL_BASE, API_KEY) : null;

export interface Ticket {
  id: string;
  /** null for tickets seeded for the stack */
  user_id: string | null;
  username: string;
  /** in the order tickets were made */
  number: number;
  engine: string;
  seed: number;
  layers: number;
  engine_rev: string;
  image_path: string;
  /** the engine's layers the artwork is made of */
  composition: unknown[];
  updated_at: string;
}

/**
 * A drawn ticket: its artwork's stages in the order the laser cuts them
 * (ground first), its lettering (the page's marks and its owner) alone and
 * over the finished artwork, its linework alone (what's stored), and the
 * layers it's drawn from.
 */
export interface DrawnTicket {
  stages: HTMLImageElement[];
  /** all the lettering; the page's marks (finished); the owner (cut through) */
  lettering: HTMLImageElement;
  marks: HTMLImageElement;
  owner: HTMLImageElement | null;
  lettered: HTMLImageElement;
  ink: HTMLImageElement;
  composition: unknown[];
}

/** a ticket in the making: what it's drawn from */
export interface TicketDraft {
  username: string;
  engine: string;
  seed: number;
  layers: number;
}

/** how many of the latest tickets the stack is made of */
/** a ticket's image, as stored: the page at half size */
export const TICKET_SIZE = { w: 1000, h: 1500 };
export const USERNAME_MAX = 24;

/** a username as the table takes it: lowercase letters, digits and underscores */
export const cleanUsername = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, USERNAME_MAX);

/** making a ticket needs the engine (drawn here, in the browser) and somewhere to keep it */
export const CAN_MAKE_TICKETS = ENGINE_AVAILABLE && !!supabase;

export const ticketImageUrl = (t: Pick<Ticket, 'image_path'>) =>
  `${URL_BASE}/storage/v1/object/public/tickets/${t.image_path}`;

export const randomDraft = (username: string): TicketDraft => ({
  username,
  engine: ENGINE_RANDOM,
  seed: 1 + Math.floor(Math.random() * 999999),
  layers: 2 + Math.floor(Math.random() * 3),
});

/** what the stack needs of a ticket (not its layers, which can be large) */
const TICKET_FIELDS = 'id, user_id, username, number, engine, seed, layers, engine_rev, image_path, updated_at';

/** How many tickets there are. Throws if that can't be fetched. */
export async function ticketCount(): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase.from('tickets').select('id', { count: 'exact', head: true });
  if (error) throw new Error(`tickets couldn't be counted: ${error.message}`);
  return count ?? 0;
}

/** Tickets from-th to to-th (inclusive) in number order: only what's about to be shown. Throws if they can't be fetched. */
export async function ticketRange(from: number, to: number): Promise<Ticket[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('tickets').select(TICKET_FIELDS).order('number').range(from, to);
  if (error) throw new Error(`tickets ${from}–${to} couldn't be fetched: ${error.message}`);
  return data as unknown as Ticket[];
}

/** whoever is signed in here, if anyone (without signing in) */
export async function currentUserId() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** The number the next ticket will get (a guess until it's saved: someone may get there first). */
export async function nextTicketNumber(): Promise<number | undefined> {
  if (!supabase) return undefined;
  const { data } = await supabase.from('tickets').select('number').order('number', { ascending: false }).limit(1).maybeSingle();
  return ((data as { number: number } | null)?.number ?? 0) + 1;
}

/** This browser's ticket, if it has made one. */
export async function myTicket(): Promise<Ticket | null> {
  const uid = await currentUserId();
  if (!supabase || !uid) return null;
  const { data } = await supabase.from('tickets').select('*').eq('user_id', uid).maybeSingle();
  return (data as Ticket | null) ?? null;
}

/** New and remixed tickets, as they happen. Returns the unsubscribe. */
export function onTicket(handler: (t: Ticket) => void): () => void {
  if (!supabase) return () => {};
  const channel: RealtimeChannel = supabase
    .channel('tickets')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (change) => {
      if (change.new && 'id' in change.new) handler(change.new as Ticket);
    })
    .subscribe((status, err) => {
      // the client rejoins by itself; say so, rather than going quiet
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`[holocloth] live tickets ${status.toLowerCase().replace('_', ' ')}; reconnecting`, err ?? '');
      }
    });
  return () => {
    supabase.removeChannel(channel);
  };
}

let fieldUrl: Promise<string> | null = null;
/** the last artwork drawn, so typing a username doesn't redraw the engine */
let lastArt: { key: string; art: Promise<{ stages: string[]; layers: unknown[] }> } | null = null;

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * Draw a ticket in the order the laser cuts it (SVG images, sharp at any
 * size): the bare ground, then the engine's layers one more at a time, and
 * last the whole ticket with the page's marks and its owner. Each stage only
 * stacks the ticket's separate layers — ground, ink, marks, owner — see gridArt.
 */
export async function drawTicket(d: TicketDraft, number?: number): Promise<DrawnTicket> {
  const box = { x: ASCII.x0, y: ASCII.y0, w: ASCII.x1 - ASCII.x0, h: ASCII.y1 - ASCII.y0 };
  const key = `${d.engine}|${d.seed}|${d.layers}`;
  if (lastArt?.key !== key) lastArt = { key, art: engineStages(d.engine, d.seed, box, d.layers) };
  const [{ stages, layers }, field] = await Promise.all([
    lastArt.art,
    (fieldUrl ??= fetchDataUrl('/artwork/field.png')),
    loadOwnerFont(),
  ]);
  const ground = svgUrl(groundPage(field));
  const inks = stages.map((linework) => svgUrl(inkPage(linework)));
  const ink = inks[inks.length - 1];
  const marks = svgUrl(marksPage());
  const owner = d.username ? svgUrl(ownerPage({ username: d.username, number })) : null;
  const lettering = owner ? [marks, owner] : [marks];
  const [inkImage, marksImage, ownerImage, letteringImage, letteredImage, ...images] = await Promise.all([
    loadImage(ink),
    loadImage(marks),
    owner ? loadImage(owner) : Promise.resolve(null),
    loadImage(svgUrl(stackPages(lettering))),
    loadImage(svgUrl(stackPages([ground, ink, ...lettering]))),
    loadImage(svgUrl(stackPages([ground]))),
    ...inks.map((i) => loadImage(svgUrl(stackPages([ground, i])))),
  ]);
  return { stages: images, lettering: letteringImage, marks: marksImage, owner: ownerImage, lettered: letteredImage, ink: inkImage, composition: layers };
}

/** What a ticket keeps: its linework alone, on clear ground, as WebP (the page and labels are added when it's shown). */
async function ticketBlob(drawn: DrawnTicket): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = TICKET_SIZE.w;
  canvas.height = TICKET_SIZE.h;
  canvas.getContext('2d')!.drawImage(drawn.ink, 0, 0, TICKET_SIZE.w, TICKET_SIZE.h);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', 0.92));
  if (!blob) throw new Error('could not encode the ticket');
  return blob;
}

/** Put this browser's ticket in the stack (or replace it with a remix). */
/** A save that failed, put the way someone making a ticket would want to hear it. */
function saveError(err: unknown): Error {
  const e = err as { message?: string; code?: string; details?: string };
  const msg = e?.message ?? String(err);
  if (/anonymous sign-ins are disabled/i.test(msg)) return new Error("Making tickets isn't switched on yet.");
  if (e?.code === '23505' && /username/i.test(`${msg} ${e.details ?? ''}`)) return new Error('That username is taken. Try another.');
  if (e?.code === '23514' && /username/i.test(msg)) return new Error('Usernames are 2–24 lowercase letters, numbers or underscores.');
  if (/fetch|network/i.test(msg)) return new Error("Couldn't reach the server. Check your connection and try again.");
  return new Error(`Your ticket couldn't be saved: ${msg}`);
}

export async function saveTicket(d: TicketDraft, drawn: DrawnTicket): Promise<Ticket> {
  try {
    return await saveTicketOnce(d, drawn);
  } catch (err) {
    throw saveError(err);
  }
}

async function saveTicketOnce(d: TicketDraft, drawn: DrawnTicket): Promise<Ticket> {
  if (!supabase) throw new Error('no Supabase project configured');
  let uid = await currentUserId();
  if (!uid) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    uid = data.user!.id;
  }
  const blob = await ticketBlob(drawn);
  // a new file per version: images are never overwritten, so caches stay honest
  const path = `${uid}/${Date.now()}.webp`;
  const upload = await supabase.storage.from('tickets').upload(path, blob, {
    contentType: 'image/webp',
    cacheControl: '31536000',
  });
  if (upload.error) throw upload.error;
  const row = {
    user_id: uid,
    username: cleanUsername(d.username),
    engine: d.engine,
    seed: d.seed,
    layers: d.layers,
    engine_rev: __ENGINE_REV__ || 'unknown',
    image_path: path,
    composition: drawn.composition,
  };
  const { data, error } = await supabase.from('tickets').upsert(row, { onConflict: 'user_id' }).select().single();
  if (error) throw error;
  return data as Ticket;
}

/**
 * Dev only: fill the stack with tickets — each its own random artwork (all
 * its layers kept) under a username — through the seed-tickets Edge Function,
 * which only takes them with its key. Run from the console:
 * `await __seedTickets(key, ['ada', 'grace'])`.
 */
export async function seedTickets(key: string, usernames: string[]) {
  const made: unknown[] = [];
  for (const username of usernames) {
    const draft = randomDraft(cleanUsername(username));
    const drawn = await drawTicket(draft);
    const form = new FormData();
    form.set('ticket', JSON.stringify({ ...draft, engine_rev: __ENGINE_REV__ || 'unknown', composition: drawn.composition }));
    form.set('image', await ticketBlob(drawn), 'ticket.webp');
    const res = await fetch(`${URL_BASE}/functions/v1/seed-tickets`, { method: 'POST', body: form, headers: { 'x-seed-key': key } });
    if (!res.ok) throw new Error(`${username}: ${res.status} ${await res.text()}`);
    made.push(await res.json());
  }
  return made;
}

/**
 * Dev only: fresh artwork for the seeded tickets — each keeps its username
 * and number, and gets a new random draw (all its layers kept) — through the
 * seed-tickets Edge Function while it's open for it.
 */
export async function refreshSeededTickets(key: string) {
  if (!supabase) throw new Error('no Supabase project configured');
  const { data, error } = await supabase.from('tickets').select('*').is('user_id', null).order('number');
  if (error) throw error;
  const done: string[] = [];
  for (const t of data as Ticket[]) {
    const draft = randomDraft(t.username);
    const drawn = await drawTicket(draft);
    const form = new FormData();
    form.set('id', t.id);
    form.set('art', JSON.stringify({ engine: draft.engine, seed: draft.seed, layers: draft.layers, engine_rev: __ENGINE_REV__ || 'unknown', composition: drawn.composition }));
    form.set('image', await ticketBlob(drawn), 'ticket.webp');
    const res = await fetch(`${URL_BASE}/functions/v1/seed-tickets`, { method: 'POST', body: form, headers: { 'x-seed-key': key } });
    if (!res.ok) throw new Error(`${t.username}: ${res.status} ${await res.text()}`);
    done.push(t.username);
  }
  return done;
}

if (import.meta.env.DEV) Object.assign(window, { __seedTickets: seedTickets, __refreshSeededTickets: refreshSeededTickets });
