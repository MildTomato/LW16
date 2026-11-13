import { PAGE } from './gridArt.ts';
/**
 * A laser engraver's job for one pass: compare what's on the card with what
 * it should become, find the new ink, and plan the head's route. It goes
 * row by row, back and forth, but only through rows with something to cut;
 * within a row it cuts each run of ink and skips across the gaps between
 * them, firing only over the ink. Dense layers take longer than sparse ones,
 * as they would on the machine.
 */

/** raster rows down the card, and cells across (square cells on a 2:3 card) */
export const LASER_ROWS = 300;
export const LASER_COLS = 200;
const COLS = LASER_COLS;
/** how much darker a cell must get to count as new ink (averaged hairlines included) */
const INK_DELTA = 0.025;
/** gaps in a row narrower than this many cells are cut through, as one run */
const BRIDGE = 2;
/** a pass's length, s: the head's speed sets it, within these bounds */
const MIN_SECONDS = 3.5;
const MAX_SECONDS = 20;
/** work units: a card-width cut is 1; moving without firing is this much quicker */
const MOVE_COST = 0.15;
/** a beat at each turn: the head stops, steps, and starts again */
const TURN = 0.006;
/** seconds per unit of work */
const SECONDS_PER_WORK = 0.16;

/** a stretch of the route: cutting a run of ink, or moving (from row0 to row) without firing */
type Segment = { t0: number; t1: number; row0: number; row: number; x0: number; x1: number; cut: boolean };

export interface LaserPlan {
  /** per cell (top row first): when the head cuts it, 0..1 through the pass; -1 = nothing to cut */
  times: Float32Array;
  /** the pass's length in seconds */
  seconds: number;
  segments: Segment[];
}

let ctx: CanvasRenderingContext2D | null = null;


/** how much of each cell an image (on clear ground) covers */
function coverage(img: CanvasImageSource, c: CanvasRenderingContext2D) {
  c.clearRect(0, 0, COLS, LASER_ROWS);
  c.drawImage(img, 0, 0, COLS, LASER_ROWS);
  const px = c.getImageData(0, 0, COLS, LASER_ROWS).data;
  const out = new Float32Array(COLS * LASER_ROWS);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3] / 255;
  return out;
}

function luminance(img: CanvasImageSource, c: CanvasRenderingContext2D) {
  c.clearRect(0, 0, COLS, LASER_ROWS);
  c.drawImage(img, 0, 0, COLS, LASER_ROWS);
  const px = c.getImageData(0, 0, COLS, LASER_ROWS).data;
  const lum = new Float32Array(COLS * LASER_ROWS);
  for (let i = 0; i < lum.length; i++) lum[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
  return lum;
}

/** a row's runs of ink, as [first cell, last cell + 1], small gaps bridged */
function runsOf(ink: Uint8Array, row: number) {
  const runs: [number, number][] = [];
  for (let c = 0; c < COLS; c++) {
    if (!ink[row * COLS + c]) continue;
    const last = runs[runs.length - 1];
    if (last && c - last[1] <= BRIDGE) last[1] = c + 1;
    else runs.push([c, c + 1]);
  }
  return runs;
}

/**
 * Plan the pass that turns `before` into `after` (both the whole card),
 * leaving uncut whatever `keepClear` covers (the ticket's lettering), and
 * cutting whatever `cutOut` covers (the owner's name, cut out of the face:
 * lighter, not darker, so it isn't new ink).
 */
export function planPass(
  before: CanvasImageSource,
  after: CanvasImageSource,
  keepClear?: CanvasImageSource | null,
  cutOut?: CanvasImageSource | null,
): LaserPlan {
  if (!ctx) {
    const c = document.createElement('canvas');
    c.width = COLS;
    c.height = LASER_ROWS;
    ctx = c.getContext('2d', { willReadFrequently: true })!;
  }
  const a = luminance(before, ctx);
  const b = luminance(after, ctx);
  const ink = new Uint8Array(COLS * LASER_ROWS);
  for (let i = 0; i < ink.length; i++) ink[i] = a[i] - b[i] > INK_DELTA ? 1 : 0;
  if (keepClear) {
    const clear = coverage(keepClear, ctx);
    for (let i = 0; i < ink.length; i++) if (clear[i] > 0.5) ink[i] = 0;
  }
  if (cutOut) {
    const cut = coverage(cutOut, ctx);
    for (let i = 0; i < ink.length; i++) if (cut[i] > 0.2) ink[i] = 1;
  }

  // the route, in work units: cut each run, move between them
  const segments: Segment[] = [];
  let work = 0;
  let at: { row: number; u: number } | null = null;
  let forward = true;
  const moveTo = (row: number, u: number) => {
    if (!at) return;
    const cost = Math.hypot(u - at.u, ((row - at.row) / LASER_ROWS) * (PAGE.h / PAGE.w)) * MOVE_COST + TURN;
    segments.push({ t0: work, t1: work + cost, row0: at.row, row, x0: at.u, x1: u, cut: false });
    work += cost;
  };
  for (let row = 0; row < LASER_ROWS; row++) {
    const runs = runsOf(ink, row);
    if (!runs.length) continue;
    if (!forward) runs.reverse();
    for (const [lo, hi] of runs) {
      const x0 = (forward ? lo : hi) / COLS, x1 = (forward ? hi : lo) / COLS;
      moveTo(row, x0);
      const span = Math.abs(x1 - x0);
      segments.push({ t0: work, t1: work + span, row0: row, row, x0, x1, cut: true });
      work += span;
      at = { row, u: x1 };
    }
    forward = !forward;
  }

  // when each cell is cut, through the pass
  const times = new Float32Array(COLS * LASER_ROWS).fill(-1);
  const total = work || 1;
  for (const s of segments) {
    s.t0 /= total;
    s.t1 /= total;
    if (!s.cut) continue;
    const c0 = Math.round(Math.min(s.x0, s.x1) * COLS), c1 = Math.round(Math.max(s.x0, s.x1) * COLS);
    for (let c = c0; c < c1; c++) {
      const u = (c + 0.5) / COLS;
      const f = (u - s.x0) / (s.x1 - s.x0);
      times[s.row * COLS + c] = s.t0 + (s.t1 - s.t0) * f;
    }
  }
  const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, work * SECONDS_PER_WORK));
  return { times, seconds, segments };
}

/** Where the head is at p (0..1 through the pass), as the card's uv, and whether it's firing. */
export function headAt(plan: LaserPlan, p: number): { u: number; v: number; firing: boolean } {
  const segs = plan.segments;
  if (!segs.length) return { u: 0.5, v: 0.5, firing: false };
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].t1 < p) lo = mid + 1;
    else hi = mid;
  }
  const s = segs[lo];
  const f = s.t1 > s.t0 ? Math.min(1, Math.max(0, (p - s.t0) / (s.t1 - s.t0))) : 1;
  return {
    u: s.x0 + (s.x1 - s.x0) * f,
    v: 1 - (s.row0 + (s.row - s.row0) * f + 0.5) / LASER_ROWS,
    firing: s.cut && p < 1,
  };
}
