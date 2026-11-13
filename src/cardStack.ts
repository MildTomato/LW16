import * as THREE from 'three';
import { PAGE } from './gridArt.ts';

/**
 * Many copies of the card arranged as one sculpture: thin plates, each
 * turned a little further than the last, so the stack reads as a single
 * twisting form and its edges catch the light in rhythm. Every arrangement
 * is a rule, not a scatter — plate i's place follows from i alone.
 */
export const STACK_SHAPES = ['Single', 'Twist', 'Wave', 'Fan', 'Bloom', 'Möbius', 'Ring', 'Flip', 'Helix', 'Vortex', 'Tiles', 'Rolodex', 'Wheel'] as const;
/**
 * Tiles: a curved wall — the inside of a drum, this many columns round, of
 * this many plates (the tickets repeat to fill it). You stand at its middle.
 */
export const TILE_COLS = 12;
export const TILE_COUNT = 120;
const TILE_SCALE = 0.42;
/**
 * On the wall every card lies on its side (landscape), so its owner, lettered
 * up its right edge, reads along the bottom: a column is a card's long side
 * wide, a row its short side tall. The long side is 3; the short one follows
 * from the ticket page's shape.
 */
const CARD_LONG = 3;
const CARD_SHORT = 3 * Math.min(PAGE.w, PAGE.h) / Math.max(PAGE.w, PAGE.h);
/** a column's width round the drum, and the drum's radius that fits them all */
const TILE_CELL_W = CARD_LONG * TILE_SCALE * 1.14;
/** a row's height on the wall */
const TILE_CELL_H = CARD_SHORT * TILE_SCALE * 1.12;
/** a quarter turn in a card's own plane: its right edge down (landscape) */
const ON_ITS_SIDE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
export const TILE_RADIUS = (TILE_COLS * TILE_CELL_W) / (Math.PI * 2);

const TILE_ROWS = Math.ceil(TILE_COUNT / TILE_COLS);
/** the view's shape the wall's filled for: widescreen */
const VIEW_ASPECT = 1.6;

/**
 * Where on the wall plate i sits (unscrolled): the first plates nearest the
 * middle of the view, the rest spiralling out from there. So the cards that
 * fly in from another formation (its first few) land in the middle of the
 * wall, around the eye line, not along its top row.
 */
const TILE_SLOTS: { row: number; col: number }[] = (() => {
  const mid = Math.floor(TILE_ROWS / 2);
  const slots: { row: number; col: number; d: number }[] = [];
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLS; col++) {
      // columns round the drum either side of straight ahead. Nearest first as they're seen:
      // a column's as wide as a card is long, a row as tall as it is short, and the view's
      // wider than it's tall, so the cards from another formation fill the wall in front, not round the back
      const across = col < TILE_COLS / 2 ? col : col - TILE_COLS;
      const dx = (across * TILE_CELL_W) / VIEW_ASPECT, dy = (row - mid) * TILE_CELL_H;
      slots.push({ row, col, d: Math.hypot(dx, dy) + (across < 0 ? 0.001 : 0) });
    }
  }
  return slots.sort((a, b) => a.d - b.d).map(({ row, col }) => ({ row, col }));
})();

/**
 * Which of n tickets (in order) Tiles plate i shows, the wall scrolled by
 * scrollY: plate i shows ticket i (as it does in every formation, so cards
 * keep their tickets moving onto the wall), and a whole wall's worth on for
 * each time its row has wrapped round — so scrolling goes through every ticket.
 */
export function tileTicket(i: number, n: number, scrollY: number) {
  const ch = TILE_CELL_H;
  const { row } = TILE_SLOTS[i % TILE_COUNT];
  // how many times this plate's row has wrapped round (as laid out in plateMatrix)
  const wraps = Math.floor((row * ch + scrollY) / (TILE_ROWS * ch));
  const k = (i - wraps * TILE_COUNT) % n;
  return k < 0 ? k + n : k;
}
/** how far along (in plates) the Helix has screwed: its turn so far over the turn between two plates */
function helixShift(n: number, twist: number, phase: number, turned: number) {
  const step = (twist * Math.PI * 2) / Math.max(1, n - 1);
  return step > 1e-4 ? (phase * Math.PI * 2 + turned) / step : 0;
}

/** where Helix plate i is along it (0 at one end, n at the other), wrapping round */
export function helixSlot(i: number, n: number, twist: number, phase: number, turned: number) {
  const u = (i + helixShift(n, twist, phase, turned)) % n;
  return u < 0 ? u + n : u;
}

/** how much of Helix plate i shows: fading out at one end, and back in at the other */
export function helixFade(i: number, n: number, twist: number, phase: number, turned: number) {
  const u = helixSlot(i, n, twist, phase, turned);
  return THREE.MathUtils.smoothstep(Math.min(u + 0.5, n - 0.5 - u), 0, 3);
}

/** how many times Helix plate i has gone round, out of the top and back in at the bottom */
export function helixLap(i: number, n: number, twist: number, phase: number, turned: number) {
  return Math.floor((i + helixShift(n, twist, phase, turned)) / n);
}

export type StackShape = (typeof STACK_SHAPES)[number];
/** the panel's choices: a shape, or Cycle through them all */
export const STACK_OPTIONS = [...STACK_SHAPES, 'Cycle'] as const;
/** Cycle's running order: out of one card and back into it */
const CYCLE: StackShape[] = ['Single', 'Twist', 'Wave', 'Möbius', 'Flip', 'Helix', 'Vortex', 'Bloom', 'Fan'];
/** seconds Cycle holds each formation, and how long the move between takes */
const HOLD = 3.2;
const MOVE = 2.6;
/** to or from the Tiles wall the move is quicker and less staggered, keeping pace with the camera */
const TILES_MOVE = 1.4;
const TILES_STAGGER = 0.3;
/** to and from the one card (making a ticket): the plates clear out of the way quickly, nearly together */
const SINGLE_MOVE = 0.9;
const SINGLE_STAGGER = 0.15;
/** how far (up or down) a plate not needed by the next formation flies to leave the view */
const FLY_OFF = 8;
/** most plates drawn */
export const MAX_PLATES = 160;

export interface StackParams {
  /** 'One' shows just the card, whatever the shape; 'Stack' the formation */
  cards?: string;
  shape: string;
  /** how many plates */
  count: number;
  /** how far the form turns end to end, 0..1 of each shape's full turn */
  twist: number;
  /** gap between plates, in plate thicknesses */
  spacing: number;
  /** how fast the form turns through itself; 0 holds it still */
  flow: number;
  /** draw each plate as its outline over the page, not as metal */
  outlines?: boolean;
  /** the Wheel's cards: standing tall on the spine, or on their side */
  orient?: string;
  /** the Helix standing up, or on its side */
  axis?: string;
  /** the outlines' thickness, in screen pixels */
  outlineWidth?: number;
}

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const p = new THREE.Vector3();
const e = new THREE.Euler();
const basis = new THREE.Matrix4();
// scratch for the per-frame paths, so moving the plates allocates nothing
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();

/**
 * Plate i of n's transform, card centred at the origin facing +z.
 * w, h: card size; t: thickness; phase: the flow, in turns.
 */
export function plateMatrix(
  shape: StackShape,
  i: number,
  n: number,
  w: number,
  h: number,
  t: number,
  { twist, spacing, orient, axis }: StackParams,
  phase: number,
  /** opens the formation out (radius, rise) to clear collisions; 1 = as designed */
  spread = 1,
  out = new THREE.Matrix4(),
  /** Tiles: how far the wall's been turned and scrolled */
  scroll: TileState = NO_SCROLL,
  /** Helix: where along it the plate sits (its place in the ring, gliding); the plate's own number if not given */
  at = i,
) {
  // 0..1 along the form
  const f = n > 1 ? i / (n - 1) : 0;
  // round a closed loop: the last plate stops a step short of the first
  const loop = i / Math.max(1, n);
  // never closer than a thickness and a bit: parallel plates can't touch
  const gap = t * (1 + Math.max(0.3, spacing));
  switch (shape) {
    case 'Twist': {
      // a tower of plates going back from the face, each turned about the
      // stack's axis: front plate square to the viewer, the rest winding away
      const turn = twist * Math.PI * (1 + 0.25 * Math.sin(phase * Math.PI * 2));
      e.set(0, 0, -f * turn);
      q.setFromEuler(e);
      p.set(0, 0, -i * gap);
      s.setScalar(1);
      return out.compose(p, q, s);
    }
    case 'Fan': {
      // pivoted on the lower-left corner like a hand of cards, opening out
      const spread = twist * Math.PI * 0.75 * (0.85 + 0.15 * Math.sin(phase * Math.PI * 2));
      const a = (f - 0.5) * spread;
      q.setFromAxisAngle(Z, -a);
      // rotate about the corner: corner -> origin, turn, back
      const cx = -w / 2, cy = -h / 2;
      p.set(-cx, -cy, 0).applyQuaternion(q).add(v1.set(cx, cy, -i * gap));
      s.setScalar(1);
      return out.compose(p, q, s);
    }
    case 'Ring':
    case 'Möbius': {
      // slats round a ring, each standing in the ring's cross-section (face
      // along the way round), so neighbours fan apart and never meet. In a
      // Möbius each slat turns within that plane as the ring goes round —
      // an odd number of half turns per lap closes the band on itself
      const scale = 0.32;
      const R = (h * scale * 0.5 + w * 0.42) * spread;
      const phi = loop * TAU + phase * TAU;
      const halfTurns = shape === 'Ring' ? 0 : twist < 0.75 ? 1 : 3;
      ringSlat(phi, (phi / 2) * halfTurns, R, q, p);
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    case 'Tiles': {
      // the inside of a drum, facing its middle: dragged round it's endless,
      // and every column faces you a little differently, so the light varies
      // across the wall. Rows wrap round top to bottom out of view, a tile
      // shrinking away to nothing at the wrap.
      const ch = TILE_CELL_H;
      const rows = Math.ceil(n / TILE_COLS);
      const H = rows * ch;
      const wrap = (v: number, m: number) => ((v % m) + m) % m;
      const slot = TILE_SLOTS[i % TILE_COUNT];
      const a = (slot.col * TILE_CELL_W + scroll.x) / TILE_RADIUS;
      const y = -(wrap(slot.row * ch + scroll.y, H) - H / 2 + ch / 2);
      const k = THREE.MathUtils.smoothstep((H / 2 - Math.abs(y)) / ch, 0, 0.6);
      q.setFromAxisAngle(Y, -a).multiply(ON_ITS_SIDE);
      p.set(TILE_RADIUS * Math.sin(a), y, -TILE_RADIUS * Math.cos(a));
      s.setScalar(TILE_SCALE * Math.max(1e-3, k));
      return out.compose(p, q, s);
    }
    case 'Helix': {
      // a spiral stair with no end: plates wind up the y axis, the whole of it
      // screwing along as it turns (the flow, or turned by hand with scroll.x),
      // so cards go out at one end and come back in at the other with the next
      // tickets (see helixLap)
      const scale = 0.55;
      const turn = twist * Math.PI * 2;
      const step = turn / Math.max(1, n - 1);
      const u = helixSlot(at, n, twist, phase, scroll.x);
      q.setFromAxisAngle(Y, u * step);
      // lying almost flat, stepping up — turned a quarter in its own plane,
      // so its right edge (where a ticket's username and number run) faces out
      q.multiply(LIE).multiply(EDGE_OUT);
      const rise = Math.max(gap * 2.2, (h * 1.2) / Math.max(1, n)) * spread;
      p.set(0, (u - (n - 1) / 2) * rise, 0);
      // on its side: the whole spiral turned a quarter, rising left to right
      if (axis === 'Sideways') { q.premultiply(SIDEWAYS); p.applyQuaternion(SIDEWAYS); }
      // at the ends, where cards go out and come back in, they fade (helixFade)
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    case 'Wave': {
      // the Twist tower with a ripple running front to back through it:
      // each plate swings and slides a beat after the one in front. Only
      // within its own plane, so the plates stay parallel and never touch
      const beat = TAU * (phase * 3 - f * 1.5);
      q.setFromAxisAngle(Z, -f * twist * Math.PI * 0.5 + 0.35 * Math.sin(beat));
      p.set(0.15 * Math.sin(beat + 2), 0.2 * Math.sin(beat + 0.5), -i * gap);
      s.setScalar(1);
      return out.compose(p, q, s);
    }
    case 'Bloom': {
      // a rosette: every plate pivots on one corner, spread round a full
      // turn, opening and closing like an aperture
      const scale = 0.5;
      const open = 0.65 + 0.35 * Math.sin(TAU * phase * 2);
      q.setFromAxisAngle(Z, -f * TAU * (0.6 + 0.4 * twist) * open);
      // corner at the origin, the plate swinging about it
      p.set((w / 2) * scale, (h / 2) * scale, 0).applyQuaternion(q);
      p.z = -i * gap * scale;
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    case 'Flip': {
      // the ring of slats with waves running round it: each slat swings
      // from lying along the radius to standing up as a wave passes, all
      // within its own cross-section, so they never touch
      const scale = 0.32;
      const R = (h * scale * 0.5 + w * 0.42) * spread;
      const phi = loop * TAU;
      const waves = 1 + Math.round(twist * 4);
      ringSlat(phi, (Math.PI / 2) * (0.5 + 0.5 * Math.sin(waves * phi - TAU * phase * 3)), R, q, p);
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    case 'Rolodex': {
      // pages round a spine, like a rolodex spun open: every card hinged on
      // its long edge, spread round the full turn, the spine leaning across the view
      const scale = 0.62;
      // turning with the flow, and spun by dragging (the scroll's x, as an angle)
      const a = loop * TAU + phase * TAU * 0.5 + scroll.x;
      // the cards stand off the spine, leaving an open ring at the middle
      const r = (ROLODEX_HOLLOW * spread + 0.5) * w * scale;
      q.setFromAxisAngle(Y, a);
      p.set(Math.cos(a) * r, 0, -Math.sin(a) * r);
      q.premultiply(ROLODEX_LEAN);
      p.applyQuaternion(ROLODEX_LEAN);
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    case 'Wheel': {
      // a paddle wheel: every card standing on the upright spine by its
      // long edge, radiating out round the full turn like pages fanned open
      // landscape: each card turned a quarter in its own plane, its short edge
      // on the spine, and smaller, so the wheel comes out the same size
      const landscape = orient === 'Landscape';
      const scale = landscape ? (0.62 * w) / h : 0.62;
      const a = loop * TAU + phase * TAU * 0.5 + scroll.x;
      // the inner edges just clear the spine, so neighbours meet only there
      const r = (WHEEL_HUB * spread + 0.5) * (landscape ? h : w) * scale;
      q.setFromAxisAngle(Y, a);
      if (landscape) q.multiply(EDGE_OUT);
      p.set(Math.cos(a) * r, 0, -Math.sin(a) * r);
      q.premultiply(WHEEL_LEAN);
      p.applyQuaternion(WHEEL_LEAN);
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    case 'Vortex': {
      // fins on a spiral round a vertical axis, each standing out along
      // its radius, the whole column winding round
      const scale = 0.4;
      const r0 = 0.25 * spread;
      const a = f * TAU * (0.5 + twist * 1.5) + phase * TAU;
      // the fin's width runs out along the radius, its face round the turn
      q.setFromAxisAngle(Y, a - Math.PI / 2);
      const r = r0 + (w * scale) / 2;
      p.set(Math.sin(a) * r, (f - 0.5) * h * 0.9, Math.cos(a) * r);
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    default:
      return out.identity();
  }
}

const TAU = Math.PI * 2;

/**
 * A slat at angle phi round a ring of radius R, standing in the ring's
 * cross-section: its long side turned chi from the radius toward the
 * ring's axis, its face pointing the way round.
 */
function ringSlat(phi: number, chi: number, R: number, q: THREE.Quaternion, p: THREE.Vector3) {
  const radial = v1.set(Math.cos(phi), Math.sin(phi), 0);
  const long = v2.copy(radial).multiplyScalar(Math.cos(chi)).addScaledVector(Z, Math.sin(chi));
  const across = v3.copy(radial).multiplyScalar(-Math.sin(chi)).addScaledVector(Z, Math.cos(chi));
  basis.makeBasis(across, long, v4.crossVectors(across, long));
  q.setFromRotationMatrix(basis);
  p.copy(radial).multiplyScalar(R);
}
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
/** a Helix plate lying almost flat, its right edge to the front */
const LIE = new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2 + 0.35);
const EDGE_OUT = new THREE.Quaternion().setFromAxisAngle(Z, -Math.PI / 2);
/** the Helix laid on its side: its axis along the default camera's screen-right, so it runs straight across the view */
const SIDEWAYS = new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(-0.556, 0, -0.831).normalize());
/** the open ring at the Rolodex's middle, as a fraction of a card's width */
const ROLODEX_HOLLOW = 0.45;
/**
 * the Rolodex's spine, pointed mostly toward the stack's view (the camera
 * sits out along +x, a little behind) and tipped up and to the left, so
 * the open ring reads as a rosette rather than side on
 */
const ROLODEX_LEAN = new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(0.85, 0.58, -0.15).normalize());
/** the Rolodex's spine (stack space), for shots that ride round it */
export const ROLODEX_SPINE = Y.clone().applyQuaternion(ROLODEX_LEAN);
/** the Wheel's hub: just enough round the spine for the cards' edges to clear */
const WHEEL_HUB = 0.03;
/** the Wheel's spine leans across the view the same way as the Rolodex's */
const WHEEL_LEAN = ROLODEX_LEAN;
/** the Wheel's spine (stack space) */
export const WHEEL_SPINE = Y.clone().applyQuaternion(WHEEL_LEAN);

/** a pulled-out plate's spot, in the stack's space; pushed further out when the formation is deeper */
export const FRONT = new THREE.Vector3(0, 0, 1.4);
const FACE_ON = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
/** seconds to pull a plate out, or put it back */
const PULL = 1.1;
/** how long a hovered plate takes to pop out (s), and how far: a fraction of its short side */
const HOVER = 0.18;
const POP = 0.07;
/**
 * The Helix's cards opening a gap for a newcomer: each glides along (a
 * spring damped just enough not to overshoot: smooth, no bounce), a beat
 * after the card nearer the gap.
 */
const GLIDE_SPRING = 90;
const GLIDE_DAMP = 2 * Math.sqrt(GLIDE_SPRING);
const GLIDE_RIPPLE = 0.035;
/** a gap's outline: how long it waits for the cards either side to clear (s), and how long it takes to draw in */
const GAP_CLEAR = 0.35;
const GAP_DRAW = 0.7;
/** a tile coming onto the wall: from this far behind it, and this much smaller */
const TILE_BEHIND = 0.6;
const TILE_SHRINK = 0.12;
/** and how long it takes (s), swinging in from this far round (radians) on the card's long axis */
const TILE_APPEAR = 0.45;
const TILE_SWING = 0.7;
const SWING_AXIS = new THREE.Vector3(1, 0, 0);
const swingQ = new THREE.Quaternion();
/** a card waiting for its artwork: its outline draws in this quickly (s) */
const WAIT_DRAW = 0.3;
/** seconds a tile takes to come off the wall to the viewer, or go back */
const TILE_PULL = 0.45;
/** how quickly a let-go Tiles wall slows (per second) */
const TILE_GLIDE = 3;
/** seconds a ticket's plate takes to drop into place once its artwork is in */
const APPEAR = 1.3;
/**
 * The opening: each plate's outline is drawn in first, one after another,
 * then the plates come in over them in the same order. Seconds.
 */
const OUTLINE_DRAW = 0.55;
const OUTLINE_STAGGER = 0.05;
/** once drawn, each outline's fill eases back to the page's colour before the plates come */
const FILL_SETTLE = 0.6;
const INTRO_STAGGER = 0.12;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

const pa = new THREE.Vector3(), pb = new THREE.Vector3();
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
const sa = new THREE.Vector3(), sb = new THREE.Vector3();
const ma = new THREE.Matrix4(), mb = new THREE.Matrix4();
const nrm = new THREE.Vector3(), away = new THREE.Vector3(), side = new THREE.Vector3();
const toward = new THREE.Vector3(), sideFront = new THREE.Vector3(), lean = new THREE.Quaternion();
const tiltEuler = new THREE.Euler();

// ---- collisions --------------------------------------------------------

/** a plate as an oriented box: centre, unit axes, half extents */
interface Box {
  c: THREE.Vector3;
  a: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  e: [number, number, number];
  /** bounding radius, for a quick reject */
  r: number;
}

function boxOf(m: THREE.Matrix4, w: number, h: number, t: number, pad: number): Box {
  const c = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  m.decompose(c, q, sc);
  const k = sc.x;
  const e: [number, number, number] = [(w * k) / 2 + pad, (h * k) / 2 + pad, (t * k) / 2 + pad];
  return {
    c,
    a: [X.clone().applyQuaternion(q), Y.clone().applyQuaternion(q), Z.clone().applyQuaternion(q)],
    e,
    r: Math.hypot(e[0], e[1], e[2]),
  };
}

/** Separating-axis test for two oriented boxes. */
function overlaps(A: Box, B: Box) {
  const d = new THREE.Vector3().subVectors(B.c, A.c);
  if (d.length() > A.r + B.r) return false;
  const R: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const AR: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i][j] = A.a[i].dot(B.a[j]);
      AR[i][j] = Math.abs(R[i][j]) + 1e-6;
    }
  }
  const T = [d.dot(A.a[0]), d.dot(A.a[1]), d.dot(A.a[2])];
  for (let i = 0; i < 3; i++) {
    const rb = B.e[0] * AR[i][0] + B.e[1] * AR[i][1] + B.e[2] * AR[i][2];
    if (Math.abs(T[i]) > A.e[i] + rb) return false;
  }
  for (let j = 0; j < 3; j++) {
    const ra = A.e[0] * AR[0][j] + A.e[1] * AR[1][j] + A.e[2] * AR[2][j];
    if (Math.abs(T[0] * R[0][j] + T[1] * R[1][j] + T[2] * R[2][j]) > ra + B.e[j]) return false;
  }
  for (let i = 0; i < 3; i++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3;
    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3, j2 = (j + 2) % 3;
      const ra = A.e[i1] * AR[i2][j] + A.e[i2] * AR[i1][j];
      const rb = B.e[j1] * AR[i][j2] + B.e[j2] * AR[i][j1];
      if (Math.abs(T[i2] * R[i1][j] - T[i1] * R[i2][j]) > ra + rb) return false;
    }
  }
  return true;
}

/**
 * Formations whose plates all lie parallel, a gap apart, can't touch
 * whatever they do within their planes. The rest are checked.
 */
const PARALLEL = new Set<StackShape>(['Single', 'Twist', 'Wave', 'Fan', 'Bloom', 'Tiles']);
/** Tiles: how far the wall's been turned (round, x) and scrolled (y), in stack units */
export type TileState = { x: number; y: number };
const NO_SCROLL: TileState = { x: 0, y: 0 };

/** whether any two plates of a formation touch, at a few points through its flow */
function collides(shape: StackShape, n: number, w: number, h: number, t: number, params: StackParams, spread: number) {
  // keep a sliver of air between plates, not just "not inside"
  const pad = t * 0.25;
  for (const phase of [0, 0.13, 0.29, 0.41, 0.6, 0.77]) {
    const boxes: Box[] = [];
    for (let i = 0; i < n; i++) boxes.push(boxOf(plateMatrix(shape, i, n, w, h, t, params, phase, spread, ma), w, h, t, pad));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) if (overlaps(boxes[i], boxes[j])) return true;
    }
  }
  return false;
}

/**
 * How far a formation must open out (radius, rise) for no two plates to
 * touch: 1 if it's clear as designed, else the least spread that is.
 */
function clearSpread(shape: StackShape, n: number, w: number, h: number, t: number, params: StackParams) {
  if (PARALLEL.has(shape) || !collides(shape, n, w, h, t, params, 1)) return 1;
  let lo = 1, hi = 2;
  while (collides(shape, n, w, h, t, params, hi) && hi < 16) {
    lo = hi;
    hi *= 2;
  }
  for (let k = 0; k < 8; k++) {
    const mid = (lo + hi) / 2;
    if (collides(shape, n, w, h, t, params, mid)) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Moves the plates. A change of formation never jumps: plates leave the old
 * one in order, front to back, each easing into its place in the new — a
 * wave through the stack — each on its own layer so they pass, not collide.
 * Cycle steps through every formation by itself.
 */
export class StackAnimator {
  /** what is on screen when nothing is moving */
  shape: StackShape = 'Single';
  private from: StackShape = 'Single';
  /** 0..1 through a move; 1 = settled */
  private move = 1;
  /** how many plates the stack had when this move began, and has now */
  private fromN = 0;
  private lastN = 0;
  private hold = 0;
  private phase = 0;
  private cycleAt = 0;
  /** the plate pulled out to the front, if any, and how far out each plate is (0..1) */
  private focus: number | null = null;
  private out = new Float32Array(MAX_PLATES);
  /** the plate under the pointer, and how far each has popped out (0..1) */
  private hover: number | null = null;
  private lift = new Float32Array(MAX_PLATES);
  /** Tiles: how far the sheet's been moved, and how fast it's still going once let go */
  private scroll = new THREE.Vector2();
  private scrollVel = new THREE.Vector2();
  private scrolling = false;
  /** where the rest of the Helix steps to while a card is out (stack units), and how far there it is */
  private aside = new THREE.Vector3();
  private asideK = 0;

  /**
   * Plates made of tickets wait for their artwork: hidden until it's in,
   * then they drop into place. Ungated, every plate is simply there.
   */
  private gated = false;
  private ready = new Uint8Array(MAX_PLATES);
  private shown = new Float32Array(MAX_PLATES).fill(1);
  /** each plate's place in the formation this frame, worked out once */
  private places: THREE.Matrix4[] = [];
  /** each formation's clearing spread, for the settings it was worked out at */
  private spreads = new Map<string, number>();
  /** where a pulled-out plate is shown: clear in front of the formation */
  readonly front = FRONT.clone();
  /**
   * Or where it's presented instead — in front of the viewer, square to
   * them (the stack's own space) — when the camera is theirs to place.
   */
  private present: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number } | null = null;
  /** how far the formation reaches from its middle, plates included (stack space) */
  reach = 0;
  /** a lean on the pulled-out plate, in its own axes — toward the cursor */
  private tilt = new THREE.Quaternion();

  /** Lean the pulled-out plate: turn its face by (x, y) radians, right and up. */
  setTilt(x: number, y: number) {
    this.tilt.setFromEuler(tiltEuler.set(-y, x, 0));
  }

  /** Present a pulled-out plate at this pose and size (stack space) rather than the front; null for the front. */
  presentAt(position: THREE.Vector3 | null, quaternion?: THREE.Quaternion, scale = 1) {
    if (!position || !quaternion) {
      this.present = null;
      return;
    }
    this.present ??= { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1 };
    this.present.position.copy(position);
    this.present.quaternion.copy(quaternion);
    this.present.scale = scale;
  }

  /** Pull plate i out to the front, face-on; null sends it back into the formation. */
  setFocus(i: number | null) {
    this.focus = i;
  }

  get focused() {
    return this.focus;
  }

  /** The plate under the pointer pops out a little; null lets it settle back. */
  setHover(i: number | null) {
    this.hover = i;
  }

  /** Tiles: turn and scroll the wall (stack units) — held (dragging), or let go with a speed it glides on at. */
  scrollBy(dx: number, dy: number) {
    this.scroll.x += dx;
    this.scroll.y += dy;
  }

  /** Where the rest of the stack steps aside to while a card's out (stack units). */
  setAside(x: number, y: number, z: number) {
    this.aside.set(x, y, z);
  }

  /** the formation it's in (or on its way to) */
  get shapeNow() {
    return this.shape;
  }

  /** the flow so far (turns), and how far the stack's been turned by hand */
  get flowPhase() {
    return this.phase;
  }
  get scrollX() {
    return this.scroll.x;
  }

  /** Tiles: how far the wall's been scrolled down */
  get scrollY() {
    return this.scroll.y;
  }

  holdScroll(held: boolean, vx = 0, vy = 0) {
    this.scrolling = held;
    this.scrollVel.set(held ? 0 : vx, held ? 0 : vy);
  }

  /** seconds into the opening, or -1 when there's none (before, after, or cut short) */
  private introAt = -1;
  /** how many plates the opening began with: its timings are theirs */
  private introN = 0;

  /** plates appear in place at once (the cinematic reel): no opening, no flying in */
  private instant = false;

  setInstant(on: boolean) {
    this.instant = on;
    if (on) this.introAt = -1;
  }

  /** Begin the opening: outlines drawn in, then the plates over them. */
  beginIntro() {
    if (this.instant) return;
    this.introAt = 0;
    this.rank = [];
    this.introN = 0;
    this.shown.fill(0);
  }

  /** when the opening holds plate i back until (s) */
  private introRelease(i: number) {
    // the outlines draw, and the green cards come in over them, left to right along the formation
    return (this.introN - 1) * OUTLINE_STAGGER + OUTLINE_DRAW + FILL_SETTLE + (this.rank[i] ?? i) * INTRO_STAGGER;
  }

  /** how far plate i's outline is drawn (0..1); 0 also when there's no opening to draw */
  outlineDrawn(i: number) {
    // a gap opened for a newcomer: its outline, drawing in, until the card lands
    if (this.gapDraw[i] >= 0) return this.gapDraw[i];
    if (this.introAt < 0 || (this.introN > 0 && i >= this.introN)) return 0;
    return THREE.MathUtils.clamp((this.introAt - (this.rank[i] ?? i) * OUTLINE_STAGGER) / OUTLINE_DRAW, 0, 1);
  }

  /** how far plate i's fill has eased back to the page's colour (0..1) */
  outlineSettled(i: number) {
    if (this.gapDraw[i] >= 0) return 1;
    if (this.introAt < 0) return 0;
    return THREE.MathUtils.clamp((this.introAt - (this.rank[i] ?? i) * OUTLINE_STAGGER - OUTLINE_DRAW) / FILL_SETTLE, 0, 1);
  }

  /** how far plate i has come in over its outline (0..1) */
  plateShown(i: number) {
    return this.shown[i];
  }

  /** plate i's place in the formation, as it rests (group space) */
  restMatrix(i: number): THREE.Matrix4 | undefined {
    return this.places[i];
  }

  /** whether the opening still holds plate i back */
  private introHolds(i: number) {
    if (this.introAt < 0 || i >= this.introN) return false;
    return this.introAt < this.introRelease(i);
  }

  /** Show only the plates whose artwork is in (true), or every plate (false). */
  gate(on: boolean) {
    if (on === this.gated) return;
    this.gated = on;
    if (on) {
      this.ready.fill(0);
      this.shown.fill(0);
    } else {
      this.shown.fill(1);
    }
  }

  /** the plates in order along the formation: left to right along the Helix, else as numbered; and each plate's place in it */
  private order: number[] = [];
  private rank: number[] = [];
  private rankPlates(n: number, params: StackParams) {
    // through the opening the order holds as it was when it began: the Helix turning doesn't reshuffle it
    if (this.introAt >= 0 && this.rank.length >= n) return;
    const key = (i: number) => (this.shape === 'Helix' ? helixSlot(this.pos(i), n, params.twist, this.phase, this.scroll.x) : i);
    this.order = Array.from({ length: n }, (_, i) => i).sort((a, b) => key(a) - key(b));
    this.order.forEach((i, r) => (this.rank[i] = r));
  }

  /** the plates in order along the formation (left to right along the Helix), so their artwork's fetched in that order */
  get plateOrder(): readonly number[] {
    return this.order;
  }

  /**
   * The Helix as a ring of places: each plate's place in it (whole numbers,
   * 0 to the count), and how far it still has to glide to get there. A
   * newcomer opens a gap: every plate from its place on moves one along and
   * glides there; the one pushed off the far end comes round into the gap,
   * hidden, to be the newcomer.
   */
  private ring = new Float32Array(MAX_PLATES).map((_, i) => i);
  private glide = new Float32Array(MAX_PLATES);
  /** the glide's speed (it springs), and how long a card waits before it starts (the ripple from the gap) */
  private glideV = new Float32Array(MAX_PLATES);
  private glideWait = new Float32Array(MAX_PLATES);
  /** a gap's outline, drawing in (0..1) while its newcomer's on its way; -1: none. And how long it waits for the cards to clear first */
  private gapDraw = new Float32Array(MAX_PLATES).fill(-1);
  private gapWait = new Float32Array(MAX_PLATES);
  /** that outline is a card waiting for its artwork (it draws quicker than a gap's) */
  private waitOutline = new Uint8Array(MAX_PLATES);
  private ringN = 0;

  /**
   * Where the wall stands (in the formation's space): built round the viewer
   * wherever they are, facing the way they look, so going to the wall moves
   * the cards and not the camera. Identity: round the formation's middle.
   */
  readonly wallFrame = new THREE.Matrix4();

  /**
   * Plates whose place on the wall (going to it, or coming from it) is off
   * screen: they don't fly across the view to or from the back of the drum.
   */
  private offstage = new Uint8Array(MAX_PLATES);
  setOffstage(mask: readonly boolean[] | null) {
    this.offstage.fill(0);
    mask?.forEach((off, i) => (this.offstage[i] = off ? 1 : 0));
  }

  /** where plate i sits along the ring now, gliding included */
  pos(i: number) {
    return this.ring[i] + this.glide[i];
  }

  /** plate i's place in the ring (a whole number), as its ticket is dealt by */
  ringPlace(i: number) {
    return this.ring[i];
  }

  /** the ring place showing nearest the middle of the Helix */
  middlePlace(n: number, twist: number) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(helixSlot(this.ring[i], n, twist, this.phase, this.scroll.x) - (n - 1) / 2);
      if (d < bestD) (bestD = d), (best = this.ring[i]);
    }
    return best;
  }

  /** Open a gap at ring place `at` for a newcomer: returns the plate that comes into it (hidden until its artwork's in). */
  openGap(at: number, n: number) {
    let newcomer = -1;
    for (let i = 0; i < n; i++) {
      if (this.ring[i] < at) continue;
      // further from the gap, a beat later
      this.glideWait[i] = Math.max(this.glideWait[i], (this.ring[i] - at) * GLIDE_RIPPLE);
      this.ring[i] += 1;
      this.glide[i] -= 1;
      if (this.ring[i] >= n) newcomer = i;
    }
    if (newcomer >= 0) {
      this.ring[newcomer] = at;
      this.glide[newcomer] = 0;
      this.glideV[newcomer] = 0;
      this.glideWait[newcomer] = 0;
      this.gapDraw[newcomer] = 0;
      this.gapWait[newcomer] = GAP_CLEAR;
      this.shown[newcomer] = 0;
    }
    return newcomer;
  }

  /** Plate i's artwork is in (it drops into place), or gone again (it vanishes until the next is). */
  setReady(i: number, ready = true) {
    this.ready[i] = ready ? 1 : 0;
    if (!ready) {
      this.shown[i] = 0;
      // once the opening's over, a card waiting for its artwork (dealt a new ticket as the
      // Helix is dragged, say) shows its outline, drawing in quickly, until it flies in
      if (this.gated && this.shape === 'Helix' && this.openingOver() && this.gapDraw[i] < 0) {
        this.gapDraw[i] = 0;
        this.gapWait[i] = 0;
        this.waitOutline[i] = 1;
      }
    }
  }

  /** whether the opening's done (or there wasn't one) */
  private openingOver() {
    return this.introAt < 0 || this.introN === 0 || this.introAt > this.introRelease(this.introN - 1) + APPEAR;
  }

  /**
   * Folding down to the one card: how far (0..1) the card itself has come in,
   * up from out of view, as the plates fly off. 0 when it's not wanted.
   */
  get singleArrival() {
    if (this.shape !== 'Single') return 0;
    return ease(THREE.MathUtils.clamp(this.move, 0, 1));
  }

  /** how far up or down a plate (or the one card) travels to be out of view */
  static readonly FLY_OFF = FLY_OFF;

  /** true when every plate sits on the single card (draw the plain card instead) */
  get collapsed() {
    return this.shape === 'Single' && this.move >= 1;
  }

  /** Head for a formation (or Cycle). The first one is simply there: no move in at startup. */
  setTarget(option: string) {
    const first = !this.started;
    this.started = true;
    const cycling = option === 'Cycle';
    if (cycling) {
      if (this.cycling) return;
      this.cycling = true;
      this.cycleAt = Math.max(0, CYCLE.indexOf(this.shape));
      this.hold = HOLD * 0.5; // first move comes soon
      return;
    }
    this.cycling = false;
    const shape = (STACK_SHAPES as readonly string[]).includes(option) ? (option as StackShape) : 'Single';
    this.goTo(shape, first);
  }

  private cycling = false;
  private started = false;

  private goTo(shape: StackShape, snap = false) {
    if (shape === this.shape) return;
    this.from = snap ? shape : this.shape;
    this.fromN = this.lastN;
    // a new formation cuts the opening short: every plate held back comes in now
    this.introAt = -1;
    this.shape = shape;
    this.move = snap ? 1 : 0;
  }

  private spreadFor(shape: StackShape, n: number, w: number, h: number, t: number, params: StackParams) {
    const key = `${shape}|${n}|${w}|${h}|${params.twist}|${params.spacing}`;
    let v = this.spreads.get(key);
    if (v === undefined) {
      v = clearSpread(shape, n, w, h, t, params);
      if (this.spreads.size > 64) this.spreads.clear();
      this.spreads.set(key, v);
    }
    return v;
  }

  /** Advance by dt and write every plate into the meshes. */
  update(
    dt: number,
    meshes: THREE.InstancedMesh[],
    n: number,
    w: number,
    h: number,
    t: number,
    params: StackParams,
  ) {
    this.phase += params.flow * dt * 0.06;
    if (this.introAt >= 0) {
      // the opening is timed for the plates it began with, and ends once the last is in
      if (this.introN === 0) this.introN = n;
      this.introAt += dt;
      if (this.introAt > this.introRelease(this.introN - 1) + APPEAR) this.introAt = -1;
    }
    // a let-go sheet glides on, slowing
    if (!this.scrolling && this.scrollVel.lengthSq() > 1e-6) {
      this.scroll.addScaledVector(this.scrollVel, dt);
      this.scrollVel.multiplyScalar(Math.exp(-TILE_GLIDE * dt));
    }
    if (this.move < 1) {
      const tiles = this.shape === 'Tiles' || this.from === 'Tiles';
      const single = this.shape === 'Single' || this.from === 'Single';
      this.move = Math.min(1, this.move + dt / (single ? SINGLE_MOVE : tiles ? TILES_MOVE : MOVE));
    } else if (this.cycling) {
      this.hold += dt;
      if (this.hold >= HOLD) {
        this.hold = 0;
        this.cycleAt = (this.cycleAt + 1) % CYCLE.length;
        this.goTo(CYCLE[this.cycleAt]);
      }
    }
    const spreadTo = this.spreadFor(this.shape, n, w, h, t, params);
    // mid-move the plates the old formation had are still drawn, laid out
    // as they were (the count can change with the shape, as Helix to Tiles)
    const fromN = this.move < 1 && this.fromN > 0 ? this.fromN : n;
    const drawn = Math.min(MAX_PLATES, Math.max(n, fromN));
    // folding down to the one card, every plate flies off out of view and the
    // card itself comes in on its own, blank (see singleArrival); opening
    // again, the first plate grows out of the card and the rest fly back in
    const toN = this.shape === 'Single' ? 0 : n;
    const fromKept = this.from === 'Single' ? 1 : fromN;
    const spreadFrom = this.move < 1 ? this.spreadFor(this.from, fromN, w, h, t, params) : 1;

    // the formation's reach, so a pulled-out plate can go round it, not through it
    const plateR = Math.hypot(w, h) / 2;
    let reach = 0, deepest = -Infinity;
    for (let i = 0; i < n; i++) {
      const place = (this.places[i] ??= new THREE.Matrix4());
      plateMatrix(this.shape, i, n, w, h, t, params, this.phase, spreadTo, place, this.scroll, this.pos(i));
      if (this.shape === 'Tiles') place.premultiply(this.wallFrame);
      pb.setFromMatrixPosition(place);
      reach = Math.max(reach, pb.length());
      deepest = Math.max(deepest, pb.z);
    }
    reach += plateR;
    this.reach = reach;
    this.rankPlates(n, params);
    // the ring: plates back in order when the count changes; a gap opened for a newcomer closing as the cards glide
    if (n !== this.ringN) {
      this.ringN = n;
      for (let i = 0; i < MAX_PLATES; i++) (this.ring[i] = i), (this.glide[i] = 0), (this.glideV[i] = 0), (this.glideWait[i] = 0);
    }
    // each card springs along to its new place, a beat after the one nearer the gap: a ripple, a little bounce
    const step = Math.min(dt, 1 / 30);
    for (let i = 0; i < n; i++) {
      if (this.glide[i] === 0 && this.glideV[i] === 0) continue;
      if (this.glideWait[i] > 0) {
        this.glideWait[i] -= dt;
        continue;
      }
      this.glideV[i] += (-GLIDE_SPRING * this.glide[i] - GLIDE_DAMP * this.glideV[i]) * step;
      this.glide[i] += this.glideV[i] * step;
      if (Math.abs(this.glide[i]) < 1e-3 && Math.abs(this.glideV[i]) < 1e-2) (this.glide[i] = 0), (this.glideV[i] = 0);
    }
    // a gap's outline waits for the cards to clear, draws in, and goes once its card has landed
    // (gaps and waiting cards are the Helix's: any other formation has none)
    if (this.shape !== 'Helix') this.gapDraw.fill(-1), this.waitOutline.fill(0);
    for (let i = 0; i < n; i++) {
      if (this.gapDraw[i] < 0) continue;
      if (this.gapWait[i] > 0) this.gapWait[i] -= dt;
      else if (this.shown[i] >= 1) (this.gapDraw[i] = -1), (this.waitOutline[i] = 0);
      else this.gapDraw[i] = Math.min(1, this.gapDraw[i] + dt / (this.waitOutline[i] ? WAIT_DRAW : GAP_DRAW));
    }

    // tilted plates can reach a half-diagonal past their centres
    this.front.set(0, 0, Math.max(FRONT.z, deepest + plateR + 0.1));

    // with a card out of the Helix, the rest of it steps aside, easing there and back
    const asideGoal = this.focus !== null && this.shape !== 'Tiles' ? 1 : 0;
    this.asideK += THREE.MathUtils.clamp(asideGoal - this.asideK, -dt / PULL, dt / PULL);
    const asideK = this.asideK;
    // each plate's own move takes half the time, starting in turn
    const stagger =
      this.shape === 'Single' || this.from === 'Single' ? SINGLE_STAGGER : this.shape === 'Tiles' || this.from === 'Tiles' ? TILES_STAGGER : 0.5;
    // the wall is far off and wide: plates headed to or from it keep low lanes
    const laneMax = this.shape === 'Tiles' || this.from === 'Tiles' ? 1.2 : Math.max(1.2, Math.min(n, fromN) * t * 3);
    for (let i = 0; i < drawn; i++) {
      if (i < n) mb.copy(this.places[i]);
      if (this.move < 1) {
        const start = drawn > 1 ? (i / (drawn - 1)) * stagger : 0;
        const k = ease(THREE.MathUtils.clamp((this.move - start) / (1 - stagger), 0, 1));
        if (i >= toN) {
          // a plate the new formation doesn't have flies off, up or down out of view
          plateMatrix(this.from, i, fromN, w, h, t, params, this.phase, spreadFrom, mb, this.scroll, this.pos(i));
          if (this.from === 'Tiles') mb.premultiply(this.wallFrame);
          this.flyOff(mb, k);
        } else if (i >= fromKept) {
          // a plate the old one didn't have flies in from there
          this.flyOff(mb, 1 - k);
        } else if (this.offstage[i] && this.from === 'Tiles') {
          // off-screen on the wall: it doesn't come round from behind the viewer, it drops in from above
          this.flyOff(mb, 1 - k);
        } else if (k < 1) {
          plateMatrix(this.from, i, fromN, w, h, t, params, this.phase, spreadFrom, ma, this.scroll, this.pos(i));
          if (this.from === 'Tiles') ma.premultiply(this.wallFrame);
          ma.decompose(pa, qa, sa);
          mb.decompose(pb, qb, sb);
          pa.lerp(pb, k);
          qa.slerp(qb, k);
          sa.lerp(sb, k);
          // plates in flight travel on their own layers — the first to
          // leave rides highest — so they pass over one another
          const lane = 0.35 + (1 - i / Math.max(1, drawn - 1)) * laneMax;
          pa.z += Math.sin(k * Math.PI) * lane;
          mb.compose(pa, qa, sa);
        }
      }
      // a plate pulled out (or on its way back) leaves its slot for the front
      const target = i === this.focus ? 1 : 0;
      const pull = this.shape === 'Tiles' ? TILE_PULL : PULL;
      const o = (this.out[i] += THREE.MathUtils.clamp(target - this.out[i], -dt / pull, dt / pull));
      // hovered: eased a little way out of the formation, within its own plane
      const lifted = (this.lift[i] += THREE.MathUtils.clamp((i === this.hover && o === 0 ? 1 : 0) - this.lift[i], -dt / HOVER, dt / HOVER));
      if (lifted > 0) this.popOut(mb, ease(lifted) * Math.min(w, h) * POP, this.shape === 'Tiles');
      if (o > 0) this.pullOut(mb, ease(o), reach, this.shape === 'Tiles', plateR);
      // a card out of the Helix: the rest of it steps aside (the card itself doesn't)
      if (asideK > 0 && o < 1) {
        const k = ease(asideK) * (1 - ease(o));
        mb.elements[12] += this.aside.x * k;
        mb.elements[13] += this.aside.y * k;
        mb.elements[14] += this.aside.z * k;
      }
      // a newcomer waits until its gap's outline is drawn (a card just waiting for its artwork doesn't)
      const gapHolds = this.gapDraw[i] >= 0 && this.gapDraw[i] < 1 && !this.waitOutline[i];
      const want = this.introHolds(i) || gapHolds ? 0 : this.gated ? this.ready[i] : 1;
      const appear = this.shape === 'Tiles' && this.move >= 1 ? TILE_APPEAR : APPEAR;
      const shown = (this.shown[i] = this.instant ? Math.max(this.shown[i], want) : this.shown[i] + THREE.MathUtils.clamp(want - this.shown[i], 0, dt / appear));
      // a plate on its way in flies in at its full size, from out of view to its place;
      // on the wall a tile comes forward instead, from just behind it, growing a little as it fades in
      if (shown < 1) {
        if (this.shape === 'Tiles' && this.move >= 1) this.fromBehind(mb, shown);
        else this.flyOff(mb, 1 - ease(shown));
      }
      for (const mesh of meshes) mesh.setMatrixAt(i, mb);
    }
    this.lastN = n;
    for (const mesh of meshes) {
      mesh.count = drawn;
      mesh.instanceMatrix.needsUpdate = true;
      // recomputed when a raycast needs it
      mesh.boundingSphere = null;
    }
  }

  /**
   * A tile `shown` (0..1) of the way onto the wall: from just behind its
   * place and a little smaller, swinging in on its upright edge like a door
   * (a touch past flat, then settling).
   */
  private fromBehind(m: THREE.Matrix4, shown: number) {
    if (shown >= 1) return;
    const k = 1 - ease(shown);
    // ease-out-back: overshoots a little before it lands
    const c = 1.9, x = shown - 1;
    const swing = 1 - (1 + (c + 1) * x * x * x + c * x * x);
    m.decompose(pa, qa, sa);
    nrm.copy(Z).applyQuaternion(qa);
    pa.addScaledVector(nrm, -k * TILE_BEHIND);
    sa.multiplyScalar(1 - k * TILE_SHRINK);
    qa.multiply(swingQ.setFromAxisAngle(SWING_AXIS, swing * TILE_SWING));
    m.compose(pa, qa, sa);
  }

  /** A plate k (0..1) of the way off: away up or down, whichever side of the middle it's on, out of view. */
  private flyOff(m: THREE.Matrix4, k: number) {
    if (k <= 0) return;
    m.decompose(pa, qa, sa);
    // every plate comes in (and goes off) from above, so an opening reads as one sweep
    pa.y += k * k * FLY_OFF;
    m.compose(pa, qa, sa);
  }

  /**
   * A plate nudged `by` out of the formation: within its own plane, away
   * from the middle (out of a ring, off the end of a fan), never into its
   * neighbours.
   */
  private popOut(m: THREE.Matrix4, by: number, toward = false) {
    m.decompose(pa, qa, sa);
    nrm.copy(Z).applyQuaternion(qa);
    away.copy(pa).addScaledVector(nrm, -pa.dot(nrm));
    // a plate on the axis (a straight stack), or a tile in a sheet, lifts toward the viewer instead
    if (toward || away.lengthSq() < 1e-4) {
      away.copy(nrm);
      by *= toward ? 0.35 : 1;
    }
    pa.addScaledVector(away.normalize(), by);
    m.compose(pa, qa, sa);
  }

  /**
   * A plate k (0..1) of the way from its slot to the front, going round the
   * formation rather than through it: first it slides out sideways within
   * its own plane — never into its neighbours — until it's clear of
   * everything; then comes forward, turning to face the viewer; then slides
   * in to the middle.
   */
  private pullOut(m: THREE.Matrix4, k: number, reach: number, straight = false, halfDiag = 1) {
    m.decompose(pa, qa, sa);
    // a tile comes straight off the wall to the viewer: nothing's in its way
    if (straight) {
      const dest = this.present?.position ?? this.front;
      const destQ = this.present?.quaternion ?? FACE_ON;
      pb.copy(pa).lerp(dest, k);
      qb.copy(qa).slerp(destQ, k);
      if (k > 0.7) qb.multiply(lean.identity().slerp(this.tilt, (k - 0.7) / 0.3));
      sb.copy(sa).lerp(ONE, k).multiplyScalar(THREE.MathUtils.lerp(1, this.present?.scale ?? 1, k));
      m.compose(pb, qb, sb);
      return;
    }
    // within the plate's plane, away from the formation's middle
    nrm.copy(Z).applyQuaternion(qa);
    away.copy(pa).addScaledVector(nrm, -pa.dot(nrm));
    if (away.lengthSq() < 1e-4) away.copy(X).applyQuaternion(qa);
    away.normalize();
    // just far enough to clear its neighbours (its own half and theirs) —
    // not the whole formation's reach, which on a tall Helix sends it far off
    const plate = halfDiag * Math.max(sa.x, sa.y);
    side.copy(pa).addScaledVector(away, Math.min(reach, 2 * plate + 0.1));
    // where it ends up, facing which way: the front, or presented to the viewer
    const dest = this.present?.position ?? this.front;
    const destQ = this.present?.quaternion ?? FACE_ON;
    // out toward the viewer (along the final facing) to the destination's depth, still clear to the side
    toward.copy(Z).applyQuaternion(destQ);
    sideFront.copy(side).addScaledVector(toward, Math.max(0, v1.subVectors(dest, side).dot(toward)));
    const seg = (a: number, b: number) => ease(THREE.MathUtils.clamp((k - a) / (b - a), 0, 1));
    const s1 = seg(0, 0.35), s2 = seg(0.35, 0.7), s3 = seg(0.7, 1);
    pb.copy(pa).lerp(side, s1).lerp(sideFront, s2).lerp(dest, s3);
    qb.copy(qa).slerp(destQ, s2);
    // once it's arrived, it leans (in its own axes, so it reads the same from any view)
    if (s3 > 0) qb.multiply(lean.identity().slerp(this.tilt, s3));
    sb.copy(sa).lerp(ONE, s2).multiplyScalar(THREE.MathUtils.lerp(1, this.present?.scale ?? 1, s3));
    m.compose(pb, qb, sb);
  }
}
