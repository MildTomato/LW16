/**
 * Tickets: every visitor makes one — their own Visual Engine artwork with
 * their username etched in the corner — and the stack on the site is made of
 * the latest of them. Kept in Supabase: a row per person (signed in with
 * their Supabase account, so it's theirs) and the rendered image in the
 * public tickets bucket. New and remixed tickets arrive live.
 */
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { accountToken } from './account.ts';
import { ENGINE_AVAILABLE, engineStages, randomDesignLayer, type DesignLayer } from './engineArt.ts';
import { ASCII, fetchDataUrl, groundPage, inkPage, plainGroundPage, loadImage, loadOwnerFont, marksPage, ownerPage, stackPages } from './gridArt.ts';

declare const __ENGINE_REV__: string;

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase = URL_BASE && API_KEY ? createClient(URL_BASE, API_KEY) : null;

/** where tickets are written: the server checks who's signed in, then saves */
const TICKET_API = `${import.meta.env.BASE_URL}api/ticket`;

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
  /** the linework alone: the artwork built up a layer at a time, and each layer on its own */
  inkStages: HTMLImageElement[];
  layerInks: HTMLImageElement[];
  /** the design it was drawn from, if it had one */
  design?: DesignLayer[];
  /** the owner's lettering a line at a time, for the laser to cut in turn: the number, then the name */
  ownerNumber: HTMLImageElement | null;
  ownerName: HTMLImageElement | null;
  /** the stages and the lettered ticket again, on plain metal (the Room surface) rather than the printed ground */
  plain: { stages: HTMLImageElement[]; lettered: HTMLImageElement };
}

/** the plain metal's tone under the artwork: the scene's own plain ground */
export const PLAIN_GROUND = '#f1f2f4';

/** a ticket in the making: what it's drawn from */
export interface TicketDraft {
  username: string;
  engine: string;
  seed: number;
  layers: number;
  /** its own design, layer by layer (engine is then ENGINE_DESIGN, seed the first layer's, layers how many) */
  design?: DesignLayer[];
}

/** a ticket drawn from a design made layer by layer */
export const ENGINE_DESIGN = 'Design';

/** a draft from a design: its engine, seed and layer count follow from it */
export const designDraft = (username: string, design: DesignLayer[]): TicketDraft => ({
  username,
  engine: ENGINE_DESIGN,
  seed: design[0]?.seed ?? 1,
  layers: design.length,
  design,
});

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

/** a new random design of two to four layers */
export const randomDraft = (username: string): TicketDraft =>
  designDraft(username, Array.from({ length: 2 + Math.floor(Math.random() * 3) }, randomDesignLayer));

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

/** The number the next ticket will get (a guess until it's saved: someone may get there first). */
export async function nextTicketNumber(): Promise<number | undefined> {
  if (!supabase) return undefined;
  const { data } = await supabase.from('tickets').select('number').order('number', { ascending: false }).limit(1).maybeSingle();
  return ((data as { number: number } | null)?.number ?? 0) + 1;
}

/** The signed-in person's ticket, if they've made one (null when nobody's signed in). */
export async function myTicket(): Promise<Ticket | null> {
  const token = await accountToken();
  if (!token) return null;
  const res = await fetch(TICKET_API, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return ((await res.json()) as { ticket: Ticket | null }).ticket;
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
let lastArt: { key: string; art: Promise<{ stages: string[]; singles: string[]; layers: unknown[] }> } | null = null;

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * Draw a ticket in the order the laser cuts it (SVG images, sharp at any
 * size): the bare ground, then the engine's layers one more at a time, and
 * last the whole ticket with the page's marks and its owner. Each stage only
 * stacks the ticket's separate layers — ground, ink, marks, owner — see gridArt.
 */
export async function drawTicket(d: TicketDraft, number?: number): Promise<DrawnTicket> {
  const box = { x: ASCII.x0, y: ASCII.y0, w: ASCII.x1 - ASCII.x0, h: ASCII.y1 - ASCII.y0 };
  const key = `${d.engine}|${d.seed}|${d.layers}|${JSON.stringify(d.design ?? null)}`;
  if (lastArt?.key !== key) lastArt = { key, art: engineStages(d.engine, d.seed, box, d.layers, d.design) };
  const [{ stages, singles, layers }, field] = await Promise.all([
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
  const plain = svgUrl(plainGroundPage(PLAIN_GROUND));
  const stageOn = (g: string) => [loadImage(svgUrl(stackPages([g]))), ...inks.map((i) => loadImage(svgUrl(stackPages([g, i]))))];
  // the number's there before a name is: it's the ticket's, not the owner's
  const ownerLine = (only: 'name' | 'number') =>
    d.username || only === 'number' ? loadImage(svgUrl(ownerPage({ username: d.username, number, only }))) : Promise.resolve(null);
  const [ownerNumber, ownerName] = await Promise.all([number ? ownerLine('number') : Promise.resolve(null), ownerLine('name')]);
  // the linework alone, for the engraver's screen: built up a layer at a time, and each layer on its own
  const [inkStages, layerInks] = await Promise.all([
    Promise.all(inks.map((i) => loadImage(i))),
    Promise.all(singles.map((linework) => loadImage(svgUrl(inkPage(linework))))),
  ]);
  const [inkImage, marksImage, ownerImage, letteringImage, letteredImage, plainLettered, stagesP, plainStagesP] = await Promise.all([
    loadImage(ink),
    loadImage(marks),
    owner ? loadImage(owner) : Promise.resolve(null),
    loadImage(svgUrl(stackPages(lettering))),
    loadImage(svgUrl(stackPages([ground, ink, ...lettering]))),
    loadImage(svgUrl(stackPages([plain, ink, ...lettering]))),
    Promise.all(stageOn(ground)),
    Promise.all(stageOn(plain)),
  ]);
  return {
    stages: stagesP,
    lettering: letteringImage,
    marks: marksImage,
    owner: ownerImage,
    lettered: letteredImage,
    ink: inkImage,
    composition: layers,
    design: d.design,
    inkStages,
    layerInks,
    ownerNumber,
    ownerName,
    plain: { stages: plainStagesP, lettered: plainLettered },
  };
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

/** A save that failed, put the way someone making a ticket would want to hear it. */
function saveError(err: unknown): Error {
  const msg = (err as Error)?.message ?? String(err);
  if (/fetch|network/i.test(msg)) return new Error("Couldn't reach the server. Check your connection and try again.");
  return new Error(msg);
}

/** Put the signed-in person's ticket in the stack (or replace theirs with a remix). */
export async function saveTicket(d: TicketDraft, drawn: DrawnTicket): Promise<Ticket> {
  try {
    return await saveTicketOnce(d, drawn);
  } catch (err) {
    throw saveError(err);
  }
}

async function saveTicketOnce(d: TicketDraft, drawn: DrawnTicket): Promise<Ticket> {
  const token = await accountToken();
  if (!token) throw new Error('Log in with Supabase to print your ticket.');
  const form = new FormData();
  form.set(
    'ticket',
    JSON.stringify({
      username: cleanUsername(d.username),
      engine: d.engine,
      seed: d.seed,
      layers: d.layers,
      engine_rev: __ENGINE_REV__ || 'unknown',
      composition: drawn.composition,
    }),
  );
  form.set('image', await ticketBlob(drawn), 'ticket.webp');
  const res = await fetch(TICKET_API, { method: 'POST', body: form, headers: { authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { ticket?: Ticket; error?: string };
  if (res.status === 401) throw new Error('Your login has expired. Log in with Supabase again.');
  if (!res.ok || !body.ticket) throw new Error(body.error ?? `Your ticket couldn't be saved (${res.status}).`);
  return body.ticket;
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
