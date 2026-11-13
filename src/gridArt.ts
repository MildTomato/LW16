/**
 * Variations on the construction drawing, built by its rules — never by
 * scattering. A row is the original's frame: squares side by side on one
 * centre line, guides at every unit, a midline between the end-circle
 * centres, circles tangent to each end. Rows can halve their unit (2, 4, 8
 * squares across the same frame width), so stacked rows meet edge to edge
 * as a power-of-two grid. Each square holds one figure from the original:
 * an inscribed circle, a half-width ellipse in its left or right half, or
 * nothing but its guides.
 */

export interface GridOptions {
  /** frames stacked edge to edge */
  rows: number;
  /** how many times a row may halve its unit (0 = all rows at full size) */
  depth: number;
  /** 0..1 share of squares that get a figure */
  fill: number;
  /** circles tangent to both ends of each row */
  endCircles: boolean;
  /** unit guides and the midline */
  guides: boolean;
  seed: number;
}

/**
 * A ticket's page: square. (The construction drawing it grew from,
 * public/artwork/construction.svg, was 2000 x 3000: the margins, unit and
 * line are still its own, with the bottom margin measured up from the foot.)
 */
export const PAGE = { w: 2000, h: 3000 };
const W = PAGE.w;
const H = PAGE.h;
const UNIT = 229;
/** the original's frame: two squares, 4 units by 2 */
const FRAME_W = 4 * UNIT;
const STROKE = '#1a1a1a';
const STROKE_W = 2;
/** the margin rule between the labels (see marginMarks) */
const RULE_X = 100;
const RULE_BOTTOM = H - 174;
/** Growth's outer square: as large as fits between the margins, in steps of 256 so every halving stays on whole pixels */
const GROWTH_SIDE = Math.min(1792, Math.floor((RULE_BOTTOM - 176) / 256) * 256);

/** small, fast, seedable PRNG so a seed always gives the same drawing */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => +n.toFixed(1);
const line = (x1: number, y1: number, x2: number, y2: number) =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
const circle = (cx: number, cy: number, r: number) =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/>`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"/>`;

type Figure = 'circle' | 'ellipseL' | 'ellipseR' | 'none';

/** One square's figure, weighted toward the original's circles. */
function pickFigure(r: number, fill: number): Figure {
  if (r >= fill) return 'none';
  const t = r / fill;
  return t < 0.5 ? 'circle' : t < 0.75 ? 'ellipseL' : 'ellipseR';
}

/** Linework only, in page coordinates. */
export function gridLinework(o: GridOptions): string {
  const rand = mulberry32(o.seed);
  const rows = Math.max(1, Math.round(o.rows));
  const depth = Math.max(0, Math.round(o.depth));

  // the first row is always full size, like the original; each later row
  // keeps the unit or halves it once more, so the scale steps down as a
  // progression instead of jumping
  const scales: number[] = [0];
  for (let i = 1; i < rows; i++) {
    const prev = scales[i - 1];
    scales.push(prev < depth && rand() < 0.5 ? prev + 1 : prev);
  }
  const units = scales.map((k) => UNIT / 2 ** k);
  const totalH = units.reduce((t, s) => t + 2 * s, 0);

  const x0 = (W - FRAME_W) / 2;
  let y = (H - totalH) / 2;
  const out: string[] = [];

  for (const s of units) {
    const cy = y + s;
    const squares = Math.round(FRAME_W / (2 * s));
    const figures: Figure[] = Array.from({ length: squares }, () => pickFigure(rand(), o.fill));
    // never an empty frame: the original always has something to look at
    if (!figures.some((fig) => fig !== 'none')) {
      figures[Math.floor(rand() * squares)] = 'circle';
    }

    if (o.guides) {
      const reach = o.endCircles ? s : 0;
      out.push(line(x0 - reach, cy, x0 + FRAME_W + reach, cy));
      for (let u = 1; u < squares * 2; u++) out.push(line(x0 + u * s, y, x0 + u * s, y + 2 * s));
    }
    if (o.endCircles) {
      out.push(circle(x0 - s, cy, s));
      out.push(circle(x0 + FRAME_W + s, cy, s));
    }
    figures.forEach((fig, i) => {
      const sx = x0 + i * 2 * s;
      if (fig === 'circle') out.push(circle(sx + s, cy, s));
      else if (fig === 'ellipseL') out.push(ellipse(sx + s / 2, cy, s / 2, s));
      else if (fig === 'ellipseR') out.push(ellipse(sx + (3 * s) / 2, cy, s / 2, s));
    });
    out.push(`<rect x="${f(x0)}" y="${f(y)}" width="${f(FRAME_W)}" height="${f(2 * s)}"/>`);
    y += 2 * s;
  }
  return out.join('\n    ');
}

const MARK_FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';

/** a ticket's owner: their username, and the ticket's number once it has one */
export interface TicketOwner {
  username: string;
  number?: number;
  /** draw just one line, where it sits with both: the laser cuts them one at a time */
  only?: 'name' | 'number';
}

/**
 * The owner's font, Geist Pixel Line — striped, so it cuts as a run of
 * slots. An SVG drawn as an image can't reach the page's fonts, so it travels
 * inside the SVG, as data: load it before drawing an owner.
 */
let ownerFont = '';
let ownerFontLoad: Promise<void> | null = null;
export const loadOwnerFont = () =>
  (ownerFontLoad ??= fetchDataUrl('/fonts/GeistPixel-Line.woff2').then((url) => {
    ownerFont = url;
  }));

/** Corner labels and the margin rule between them — identical in construction.svg. */
const marginMarks = () => `<g fill="#1a1a1a" stroke="none" font-family="${MARK_FONT}" font-size="44" font-weight="300" letter-spacing="0.5">
    <text x="100" y="132">Petabyte</text>
    <text x="100" y="${H - 100}">Prototype</text>
  </g>
  <line x1="100" y1="176" x2="100" y2="${RULE_BOTTOM}" stroke="#1a1a1a" stroke-width="2"/>`;
const escapeXml = (t: string) => t.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Full page: the colour field (as a data URL) under the generated linework. */
export function gridSvg(o: GridOptions, fieldDataUrl: string): string {
  return pageSvg(gridLinework(o), fieldDataUrl);
}

/**
 * Prototype to Petabyte, as a recursive L-tiling. A square splits into a
 * quarter-size square in its bottom-left corner plus an L of three squares
 * around it; the inner square splits the same way, and so on — a
 * power-of-two grid zooming into one corner. That corner sits on the foot of
 * the margin rule over "Prototype"; the outermost squares span the page.
 *
 * The original illustration lives in every L: the top two squares are its
 * 2:1 frame, with the half-width ellipse in square one's right half, the
 * circle in square two, the quarter line and the midline. The third square,
 * below, is that pair mirrored across the diagonal — the ellipse lies down
 * in its top half and the guides turn with it — so each L is symmetric about
 * the line from Prototype to the far corner without drawing it. The
 * innermost square holds a single circle: the seed.
 */
export function growthLinework(o: Pick<GridOptions, 'rows' | 'guides'>): string {
  const levels = Math.min(8, Math.max(2, Math.round(o.rows)));
  const x0 = RULE_X;
  const y1 = RULE_BOTTOM;
  const out: string[] = [];
  const square = (x: number, y: number, side: number) =>
    `<rect x="${f(x)}" y="${f(y)}" width="${f(side)}" height="${f(side)}"/>`;

  // S: side of this level's three L squares; the inner square is S too
  let S = GROWTH_SIDE / 2;
  for (let lv = 0; lv < levels; lv++) {
    const tl = { x: x0, y: y1 - 2 * S };
    const tr = { x: x0 + S, y: y1 - 2 * S };
    const br = { x: x0 + S, y: y1 - S };

    if (o.guides) {
      // the pair's midline and square one's quarter line (the ellipse's edge)
      out.push(line(tl.x, tl.y + S / 2, tr.x + S, tl.y + S / 2));
      out.push(line(tl.x + S / 2, tl.y, tl.x + S / 2, tl.y + S));
      // mirrored: the column's midline and the lower square's half line
      out.push(line(tr.x + S / 2, tr.y, tr.x + S / 2, br.y + S));
      out.push(line(br.x, br.y + S / 2, br.x + S, br.y + S / 2));
    }
    out.push(ellipse(tl.x + 0.75 * S, tl.y + S / 2, S / 4, S / 2));
    out.push(circle(tr.x + S / 2, tr.y + S / 2, S / 2));
    out.push(ellipse(br.x + S / 2, br.y + 0.25 * S, S / 2, S / 4));
    out.push(square(tl.x, tl.y, S), square(tr.x, tr.y, S), square(br.x, br.y, S));
    S /= 2;
  }
  // the seed, in the innermost square
  const seed = 2 * S;
  out.push(square(x0, y1 - seed, seed));
  out.push(circle(x0 + seed / 2, y1 - seed / 2, seed / 2));
  return out.join('\n    ');
}

export function growthSvg(o: Pick<GridOptions, 'rows' | 'guides'>, fieldDataUrl: string): string {
  return pageSvg(growthLinework(o), fieldDataUrl);
}

/**
 * Stepped bars: a stack of black bars, each one's top edge stepping down
 * partway along it. The step slides left by the same amount every row,
 * and the bars thin evenly toward the bottom, so the steps read as one
 * diagonal running through the stack. Measured from the reference (in its
 * pixels, below) and fitted between the margin rule and the right margin,
 * sitting low on the page with open space above.
 */
export function barsLinework(): string {
  // reference measurements
  const REF_X0 = 12, REF_X1 = 1838, REF_TOP = 437, REF_PITCH = 99.4;
  const ROWS = 14;
  const STEP_START = 1708, STEP_SHIFT = 103.9, STEP_W = 126;
  const LEFT_H0 = 79, LEFT_H1 = 39, RIGHT_H0 = 44, RIGHT_H1 = 22;
  // page placement: clear of the rule, bottom of the stack just above "Prototype"
  const PAGE_X0 = RULE_X + 40, PAGE_X1 = W - RULE_X, PAGE_BOTTOM = RULE_BOTTOM - 120;
  const k = (PAGE_X1 - PAGE_X0) / (REF_X1 - REF_X0);
  const refHeight = (ROWS - 1) * REF_PITCH + LEFT_H1;
  const top0 = PAGE_BOTTOM - refHeight * k;
  const X = (x: number) => f(PAGE_X0 + (x - REF_X0) * k);

  const out: string[] = [];
  for (let i = 0; i < ROWS; i++) {
    const t = i / (ROWS - 1);
    const left = (LEFT_H0 + (LEFT_H1 - LEFT_H0) * t) * k;
    const right = (RIGHT_H0 + (RIGHT_H1 - RIGHT_H0) * t) * k;
    const top = top0 + i * REF_PITCH * k;
    const bottom = top + left;
    const s0 = STEP_START - i * STEP_SHIFT;
    out.push(`<path d="M${X(REF_X0)} ${f(top)} H${X(s0)} L${X(s0 + STEP_W)} ${f(bottom - right)} ` +
      `H${X(REF_X1)} V${f(bottom)} H${X(REF_X0)} Z" fill="${STROKE}" stroke="none"/>`);
  }
  return out.join('\n    ');
}

export function barsSvg(fieldDataUrl: string): string {
  return pageSvg(barsLinework(), fieldDataUrl);
}

/**
 * A photograph set in type: the page between the margin rule and the right
 * margin becomes a grid of monospaced characters, each cell's glyph chosen
 * by how bright the photo is there — denser glyphs for brighter. On the
 * page the ink is dark, so a bright flower on black prints as a dark mass of
 * characters on open paper.
 */
export const ASCII = {
  x0: RULE_X + 40,
  x1: W - RULE_X,
  y0: 176,
  y1: RULE_BOTTOM,
  /** a cell at Small: one glyph's advance by one line */
  cellW: 16,
  cellH: 26,
};
/** type sizes: how many Small cells wide one glyph is */
export const ASCII_SIZES: Record<string, number> = { Small: 1, Medium: 1.5, Large: 2, Huge: 3 };
const cell = (size = 'Small') => {
  const k = ASCII_SIZES[size] ?? 1;
  return { w: ASCII.cellW * k, h: ASCII.cellH * k };
};
/** light to dense */
const RAMP = ' .:-=+*#%@';

/** The grid's size in cells, to sample the photo at. */
export function asciiGrid(size?: string) {
  const { w, h } = cell(size);
  return {
    cols: Math.floor((ASCII.x1 - ASCII.x0) / w),
    rows: Math.floor((ASCII.y1 - ASCII.y0) / h),
  };
}

/** Rows of glyphs from per-cell brightness (0..1, row-major, cols x rows). */
export function asciiLinework(lum: Float32Array, cols: number, rows: number, size?: string): string {
  const { w, h } = cell(size);
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let row = '';
    for (let c = 0; c < cols; c++) {
      const v = lum[r * cols + c];
      row += RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
    }
    if (!row.trim()) continue;
    const y = ASCII.y0 + (r + 0.8) * h;
    // the row is pinned to the grid's exact width, whatever the font's advance
    out.push(`<text x="${ASCII.x0}" y="${f(y)}" textLength="${cols * w}" lengthAdjust="spacing" xml:space="preserve">${row}</text>`);
  }
  return `<g fill="${STROKE}" stroke="none" font-family="Menlo, Monaco, 'Courier New', monospace" font-size="${h * 0.85}">
    ${out.join('\n    ')}
  </g>`;
}

export function asciiSvg(lum: Float32Array, cols: number, rows: number, fieldDataUrl: string, size?: string): string {
  return pageSvg(asciiLinework(lum, cols, rows, size), fieldDataUrl);
}

/**
 * A photo's brightness on a cols x rows grid, 0..1 per cell. The photo
 * covers the grid's shape, cropped evenly from the sides; the black ground
 * drops out and the subject's tones are spread over the full range.
 */
export async function sampleLuminance(src: string, cols: number, rows: number, cellAspect = ASCII.cellW / ASCII.cellH) {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  const tone = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // find the subject: the box around everything brighter than the black ground
  const P = 200;
  canvas.width = canvas.height = P;
  ctx.drawImage(img, 0, 0, P, P);
  const probe = ctx.getImageData(0, 0, P, P).data;
  let x0 = P, y0 = P, x1 = 0, y1 = 0;
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const i = (y * P + x) * 4;
      if (tone(probe[i], probe[i + 1], probe[i + 2]) > 0.12) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 <= x0) { x0 = 0; y0 = 0; x1 = P; y1 = P; }
  // that box, with generous air round it, grown to the grid's shape on the page
  // (cells are taller than wide: a glyph and its line)
  const sx = img.width / P, sy = img.height / P;
  let w = (x1 - x0) * sx * 1.6, h = (y1 - y0) * sy * 1.35;
  const aspect = (cols * cellAspect) / rows;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  const cx = ((x0 + x1) / 2) * sx, cy = ((y0 + y1) / 2) * sy;

  canvas.width = cols;
  canvas.height = rows;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cols, rows);
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h, 0, 0, cols, rows);
  const px = ctx.getImageData(0, 0, cols, rows).data;
  const raw = new Float32Array(cols * rows);
  for (let i = 0; i < raw.length; i++) raw[i] = tone(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  // the subject's own range — darkest to brightest petal, trimmed of
  // outliers — spread over the whole ramp, so a pale flower keeps its
  // modelling instead of printing as one dense block
  const GROUND = 0.07;
  const subject = Array.from(raw).filter((l) => l > GROUND).sort((a, b) => a - b);
  const lo = subject[Math.floor(subject.length * 0.03)] ?? GROUND;
  const hi = subject[Math.floor(subject.length * 0.985)] ?? 1;
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] <= GROUND) continue; // the black ground drops out
    const v = Math.max(0, Math.min(1, (raw[i] - lo) / Math.max(0.05, hi - lo)));
    // the faintest glyph and up; only the real highlights reach the densest
    lum[i] = 0.1 + 0.9 * v ** 1.6;
  }
  return lum;
}

/**
 * Dither: the same margin as the type, as a grid of square pixels on the 8px
 * grid. Each style turns the photo's tones into ink a different way —
 * Atkinson diffuses the error (the old 1-bit Mac look, clipped highlights),
 * Bayer uses an ordered threshold (a regular crosshatched texture), and
 * Halftone sets one dot per cell, its size the tone.
 */
export const DITHER_STYLES = ['Atkinson', 'Bayer', 'Halftone'];

/** Pixel size per type size: 8px grid units. */
const ditherPx = (size?: string, style?: string) =>
  8 * (ASCII_SIZES[size ?? 'Small'] ?? 1) * (style === 'Halftone' ? 2 : 1);

export function ditherGrid(size?: string, style?: string) {
  const px = ditherPx(size, style);
  return {
    cols: Math.floor((ASCII.x1 - ASCII.x0) / px),
    rows: Math.floor((ASCII.y1 - ASCII.y0) / px),
  };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function ditherLinework(lum: Float32Array, cols: number, rows: number, style: string, size?: string): string {
  const px = ditherPx(size, style);
  const x = (c: number) => ASCII.x0 + c * px;
  const y = (r: number) => ASCII.y0 + r * px;
  if (style === 'Halftone') {
    const dots: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = lum[r * cols + c];
        if (v <= 0) continue;
        // area tracks tone; the densest dots just kiss their neighbours
        const rad = (px / 2) * Math.sqrt(v) * 1.05;
        dots.push(`<circle cx="${f(x(c) + px / 2)}" cy="${f(y(r) + px / 2)}" r="${f(rad)}"/>`);
      }
    }
    return `<g fill="${STROKE}" stroke="none">${dots.join('')}</g>`;
  }
  const on = new Uint8Array(cols * rows);
  if (style === 'Bayer') {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = lum[r * cols + c];
        on[r * cols + c] = v > 0 && v > (BAYER4[(r % 4) * 4 + (c % 4)] + 0.5) / 16 ? 1 : 0;
      }
    }
  } else {
    // Atkinson: pass on 6/8 of the error, so highlights and shadows clip
    const e = Float32Array.from(lum);
    const push = (c: number, r: number, d: number) => {
      if (c >= 0 && c < cols && r < rows && lum[r * cols + c] > 0) e[r * cols + c] += d;
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (lum[i] <= 0) continue; // the ground stays clear paper
        const ink = e[i] >= 0.5 ? 1 : 0;
        on[i] = ink;
        const d = (e[i] - ink) / 8;
        push(c + 1, r, d); push(c + 2, r, d);
        push(c - 1, r + 1, d); push(c, r + 1, d); push(c + 1, r + 1, d);
        push(c, r + 2, d);
      }
    }
  }
  // one path, a run of pixels per segment
  let d = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!on[r * cols + c]) continue;
      let run = 1;
      while (c + run < cols && on[r * cols + c + run]) run++;
      d += `M${x(c)} ${y(r)}h${run * px}v${px}h${-run * px}z`;
      c += run - 1;
    }
  }
  return `<path fill="${STROKE}" stroke="none" d="${d}"/>`;
}

/**
 * A photo (a webcam shot) etched: cropped to fill the artwork's box, levelled,
 * and dithered into square pixels where it's dark, so a face reads the right
 * way round in dark ink on bright metal.
 */
export async function photoLinework(src: string, style = 'Atkinson', size = 'Small'): Promise<string> {
  const { cols, rows } = ditherGrid(size, style);
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  // cover the box: crop the photo to its shape, centred
  const k = Math.max(cols / img.width, rows / img.height);
  const w = cols / k, h = rows / k;
  ctx.drawImage(img, (img.width - w) / 2, (img.height - h) / 2, w, h, 0, 0, cols, rows);
  const px = ctx.getImageData(0, 0, cols, rows).data;
  const raw = new Float32Array(cols * rows);
  for (let i = 0; i < raw.length; i++) raw[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  // its own range over the whole ramp, trimmed of outliers, then turned over: dark is ink
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.98)];
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < raw.length; i++) {
    const v = Math.max(0, Math.min(1, (raw[i] - lo) / Math.max(0.05, hi - lo)));
    // the brightest stays clear metal; the rest is ink, darker for darker
    lum[i] = v > 0.92 ? 0 : (1 - v) ** 1.2;
  }
  return ditherLinework(lum, cols, rows, style, size);
}

export function ditherSvg(lum: Float32Array, cols: number, rows: number, fieldDataUrl: string, style: string, size?: string): string {
  return pageSvg(ditherLinework(lum, cols, rows, style, size), fieldDataUrl);
}

/** The page around some linework: the colour field, the linework in ink, and (unless left off) the margin's marks. */
export function pageWith(linework: string, fieldDataUrl: string, marks = true): string {
  return pageSvg(linework, fieldDataUrl, marks);
}

/*
 * A ticket is four layers, each its own whole-page image, laid one over
 * another only when it's shown:
 *   the ground — the colour field, the same on every ticket;
 *   the ink — the ticket's own linework on clear ground (all that's stored);
 *   the marks — "Petabyte", "Prototype" and the margin rule;
 *   the owner — the username and ticket number, from the ticket's row.
 */
const page = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;

export function groundPage(fieldDataUrl: string): string {
  return pageSvg('', fieldDataUrl, false);
}

/** the ground of a plain metal card: one flat tone, the room giving it its colour */
export function plainGroundPage(tone: string): string {
  return page(`<rect width="${W}" height="${H}" fill="${tone}"/>`);
}

export function inkPage(linework: string): string {
  return page(`<g fill="none" stroke="${STROKE}" stroke-width="${STROKE_W}" stroke-linecap="round">
    ${linework}
  </g>`);
}

export function marksPage(): string {
  return page(marginMarks());
}

/**
 * The owner up the right edge, from the bottom corner: the username large,
 * and on the next line (nearer the edge) the ticket's number, the same size —
 * as large as both fit along the edge. Load the owner font first.
 */
export function ownerPage(o: TicketOwner): string {
  const name = `@${o.username}`;
  const number = o.number ? `#${String(o.number).padStart(4, '0')}` : '';
  // Geist Pixel's advance is about 0.62 of its size
  const reach = RULE_BOTTOM - 176 - 40;
  const size = Math.min(420, Math.floor(reach / (0.62 * Math.max(name.length, number.length))));
  const line = Math.round(size * 1.05);
  // turned a quarter, a line's "below" is toward the edge: the number sits there, the name a line in
  const at = (x: number, text: string) =>
    `<text transform="translate(${x} ${RULE_BOTTOM}) rotate(-90)">${escapeXml(text)}</text>`;
  return page(`<defs><style>@font-face { font-family: 'Geist Pixel Line'; src: url(${ownerFont}) format('woff2'); }</style></defs>
  <g fill="#1a1a1a" font-family="'Geist Pixel Line', monospace" font-size="${size}">
    ${o.only === 'number' ? '' : at(number ? W - RULE_X - line : W - RULE_X, name)}${number && o.only !== 'name' ? `
    ${at(W - RULE_X, number)}` : ''}
  </g>`);
}

/** Layers (each a whole-page image's URL) laid one over another, as one image of the page. */
export function stackPages(urls: string[]): string {
  return page(urls.map((u) => `<image href="${u}" x="0" y="0" width="${W}" height="${H}"/>`).join(''));
}

function pageSvg(linework: string, fieldDataUrl: string, marks = true): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="soft" x="-200" y="-200" width="${W + 400}" height="${H + 400}" filterUnits="userSpaceOnUse">
      <feGaussianBlur stdDeviation="40"/>
      <feColorMatrix type="saturate" values="0.4"/>
    </filter>
  </defs>
  <image href="${fieldDataUrl}" x="-120" y="-180" width="${W + 240}" height="${H + 360}" preserveAspectRatio="none" filter="url(#soft)"/>
  <g fill="none" stroke="${STROKE}" stroke-width="${STROKE_W}" stroke-linecap="round">
    ${linework}
  </g>
  ${marks ? marginMarks() : ''}
</svg>`;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed to decode: ${src.slice(0, 48)}`));
    img.src = src;
  });
}

/** Fetch a same-origin asset as a data URL, so an SVG image can embed it. */
export async function fetchDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
