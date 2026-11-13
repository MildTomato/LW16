// A shared ticket's card, 1200x630: og/ticket-card.html (the approved design,
// light theme) as one SVG, rasterised with resvg. Keep the two in step.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { ticketNumber, type Ticket } from './tickets.js';

const W = 1200;
const H = 630;

// light theme from ticket-card.html; dark is the site's own dark room
const THEMES = {
  // the site's light room as it's rendered (measured: about #f5f3ee); the grain darkens what's under it a
  // little, so the paper is that much lighter to come out the same
  light: { paper: '#faf8f3', ink: '#161616', shadow: 'rgba(40, 40, 30, 0.2)', noise: 0.3, blend: 'multiply' },
  dark: { paper: '#000805', ink: '#ededea', shadow: 'rgba(0, 0, 0, 0.7)', noise: 0.18, blend: 'screen' },
} as const;
export type CardTheme = keyof typeof THEMES;
export const cardTheme = (raw: string | null | undefined): CardTheme => (raw === 'dark' ? 'dark' : 'light');
const METAL = '#45e09c';
const METAL_HI = '#7af0bd';
const ETCH = '#0d5a36';

// resvg can't read woff2: the Geist Pixel faces are decompressed to TTF in api/fonts.
// Their shared typographic family ("Geist Pixel", name IDs 16/17) is dropped from those
// TTFs so resvg can tell Line from Square by family name. Geist Light (from the geist
// package) stands in for the card's Helvetica marks.
const FONT_DIR = join(process.cwd(), 'api', 'fonts');
const FONT_FILES = ['GeistPixel-Line.ttf', 'GeistPixel-Square.ttf', 'GeistMono-Regular.ttf', 'Geist-Light.ttf'].map((f) =>
  join(FONT_DIR, f),
);

/** CSS `line-height: 1` puts the baseline this far below the box top (Geist's ascent 1005, descent 295 per 1000) */
const baseline = (top: number, size: number) => top + size * ((1 - 1.3) / 2 + 1.005);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * How the share card is laid out:
 * - centre: LW and 16 either side of the ticket (the approved mockup)
 * - left: "LW16" on one line at the left, the ticket on the right
 * - stacked: LW over 16 at the left, large, the ticket on the right
 * - bleed: "LW16" at the left, the ticket large on the right, running off the edge
 * - landscape: a landscape card (a loyalty card), centred between LW and 16: the
 *   artwork square on its left, the owner and a row of five day stamps on its right
 * - landscape-left: "LW16" at the left, the landscape card on the right
 */
export const CARD_LAYOUTS = ['centre', 'left', 'stacked', 'bleed', 'landscape', 'landscape-left'] as const;
export type CardLayout = (typeof CARD_LAYOUTS)[number];
export const cardLayout = (raw: string | null | undefined): CardLayout =>
  (CARD_LAYOUTS as readonly string[]).includes(raw ?? '') ? (raw as CardLayout) : 'centre';

export function cardSvg(ticket: Ticket, linework: string, layout: CardLayout = 'centre', theme: CardTheme = 'light'): string {
  const number = ticketNumber(ticket.number);
  const { paper: PAPER, ink: INK, shadow: SHADOW, noise, blend } = THEMES[theme];

  // ownerPage in src/gridArt.ts: up the right edge from the bottom corner,
  // the name a line in and the number nearest the edge
  // the page (PAGE in src/gridArt.ts): 2:3 portrait, the bottom margin measured up from the foot
  const CW = 2000, CH = 3000, RULE_X = 100, RULE_BOTTOM = CH - 174;
  const name = `@${ticket.username}`;
  const reach = RULE_BOTTOM - 176 - 40;
  const size = Math.min(420, Math.floor(reach / (0.62 * Math.max(name.length, number.length))));
  const line = Math.round(size * 1.05);
  const at = (x: number, text: string) => `<text transform="translate(${x} ${RULE_BOTTOM}) rotate(-90)">${esc(text)}</text>`;

  const title = (x: number, top: number, anchor: string, text: string, px = 112) =>
    `<text x="${x}" y="${baseline(top, px)}" text-anchor="${anchor}" font-family="Geist Pixel Square" font-size="${px}" fill="${INK}" fill-opacity="0.94">${text}</text>`;
  /** the small type: the corners, and the owner under the title (big enough to read at X's feed width) */
  const LABEL = 20;
  const label = (x: number, top: number, anchor: string, text: string) =>
    `<text x="${x}" y="${baseline(top, LABEL)}" text-anchor="${anchor}" font-family="Geist Mono" font-size="${LABEL}" letter-spacing="${LABEL * 0.08}" fill="${INK}" fill-opacity="0.82">${esc(text.toUpperCase())}</text>`;

  /**
   * The ticket, s long, centred in an s-square box at (x, y), and turned on
   * its side (landscape) as the site shows a card you open: the owner,
   * lettered up its right edge, then reads left to right along the bottom.
   */
  const ticketW = (s: number) => (s * CW) / CH;
  const ticketAt = (x: number, y: number, s: number, deg = 90) => `<g filter="url(#shadow)" transform="rotate(${deg} ${x + s / 2} ${y + s / 2})">
    <svg x="${x + (s - ticketW(s)) / 2}" y="${y}" width="${ticketW(s)}" height="${s}" viewBox="0 0 ${CW} ${CH}">
      <defs>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${METAL_HI}" />
          <stop offset="0.45" stop-color="${METAL}" />
          <stop offset="1" stop-color="${METAL}" />
        </linearGradient>
        <!-- the owner, cut through the card; the hairline stroke matches Chromium's heavier render of the thin pixel lines -->
        <mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${CW}" height="${CH}">
          <rect width="${CW}" height="${CH}" rx="40" fill="#fff" />
          <g fill="#000" stroke="#000" stroke-width="3" font-family="Geist Pixel Line" font-size="${size}">${at(CW - RULE_X - line, name)}${at(CW - RULE_X, number)}</g>
        </mask>
        <filter id="etch" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0.05  0 0 0 0 0.35  0 0 0 0 0.21  0 0 0 0.92 0" />
        </filter>
      </defs>
      <g mask="url(#cut)">
        <rect width="${CW}" height="${CH}" rx="40" fill="url(#sheen)" />
        <!-- an older 2:3 ticket's linework fits whole, centred (preserveAspectRatio's default) -->
        <image x="0" y="0" width="${CW}" height="${CH}" filter="url(#etch)" href="${linework}" />
        <g fill="${ETCH}" font-family="Geist" font-size="44" font-weight="300" letter-spacing="0.5">
          <text x="100" y="132">Petabyte</text>
          <text x="100" y="${CH - 100}">Prototype</text>
        </g>
        <line x1="100" y1="176" x2="100" y2="${RULE_BOTTOM}" stroke="${ETCH}" stroke-width="2" />
      </g>
    </svg>
  </g>`;

  /**
   * The ticket as a landscape card, w by h with its top-left at (x, y): the
   * artwork square on the left, then the owner, and five day stamps (three
   * collected) like a loyalty card's.
   */
  const landscapeAt = (x: number, y: number, w: number, h: number) => {
    const pad = h * 0.06;
    const art = h - 2 * pad;
    const rx = x + pad + art + pad * 1.4; // the right-hand column
    const rw = x + w - pad - rx;
    const ink = ETCH;
    const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
    const STAMP_INKS = ['#c2185b', '#1565c0', '#0d5a36'];
    const box = Math.min(rw / 5 - 6, h * 0.16);
    const boxY = y + h - pad - box - 18;
    const stamps = DAYS.map((d, i) => {
      const bx = rx + i * (rw / 5);
      const cx = bx + box / 2, cy = boxY + box / 2;
      const stamped = i < 3;
      const turn = [-12, 8, -5][i] ?? 0;
      return `<rect x="${bx}" y="${boxY}" width="${box}" height="${box}" rx="${box * 0.14}" fill="none" stroke="${ink}" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="4 3" />
      <text x="${cx}" y="${boxY + box + 15}" text-anchor="middle" font-family="Geist Mono" font-size="${Math.round(box * 0.2)}" letter-spacing="1" fill="${ink}" fill-opacity="0.75">${d}</text>
      ${stamped ? `<g transform="rotate(${turn} ${cx} ${cy})" opacity="0.88">
        <circle cx="${cx}" cy="${cy}" r="${box * 0.42}" fill="none" stroke="${STAMP_INKS[i]}" stroke-width="${box * 0.06}" />
        <circle cx="${cx}" cy="${cy}" r="${box * 0.32}" fill="none" stroke="${STAMP_INKS[i]}" stroke-width="${box * 0.025}" />
        <text x="${cx}" y="${cy + box * 0.1}" text-anchor="middle" font-family="Geist Pixel Square" font-size="${Math.round(box * 0.3)}" fill="${STAMP_INKS[i]}">16</text>
      </g>` : ''}`;
    }).join('');
    const nameSize = Math.min(h * 0.13, (rw / Math.max(4, name.length)) * 1.55);
    return `<g filter="url(#shadow)">
    <svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" overflow="visible">
      <defs>
        <linearGradient id="sheenL" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${METAL_HI}" />
          <stop offset="0.45" stop-color="${METAL}" />
          <stop offset="1" stop-color="${METAL}" />
        </linearGradient>
        <filter id="etchL" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0.05  0 0 0 0 0.35  0 0 0 0 0.21  0 0 0 0.92 0" />
        </filter>
        <clipPath id="artL"><rect x="${x + pad}" y="${y + pad}" width="${art}" height="${art}" rx="6" /></clipPath>
      </defs>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h * 0.06}" fill="url(#sheenL)" />
      <g clip-path="url(#artL)">
        <rect x="${x + pad}" y="${y + pad}" width="${art}" height="${art}" fill="#000" fill-opacity="0.04" />
        <image x="${x + pad}" y="${y + pad}" width="${art}" height="${art}" filter="url(#etchL)" href="${linework}" />
      </g>
      <rect x="${x + pad}" y="${y + pad}" width="${art}" height="${art}" rx="6" fill="none" stroke="${ink}" stroke-opacity="0.35" />
      <text x="${rx}" y="${y + pad + 14}" font-family="Geist Mono" font-size="13" letter-spacing="1.3" fill="${ink}" fill-opacity="0.8">LW16 · LOYALTY CARD</text>
      <text x="${rx}" y="${y + pad + 22 + nameSize}" font-family="Geist Pixel Square" font-size="${nameSize.toFixed(1)}" fill="${ink}">${esc(name)}</text>
      <text x="${rx}" y="${y + pad + 22 + nameSize + 34}" font-family="Geist Pixel Line" font-size="30" fill="${ink}">${esc(number)}</text>
      <text x="${rx}" y="${boxY - 14}" font-family="Geist Mono" font-size="12" letter-spacing="1.2" fill="${ink}" fill-opacity="0.7">COLLECT ALL 5 · 3/5</text>
      ${stamps}
    </svg>
  </g>`;
  };

  const M = 48;
  // the corners, the same in every layout; the bottom-left stays clear, as X lays the domain there
  const corners = `${label(M, 40, 'start', 'Supabase Launch Week 16')}
  ${label(W - M, 40, 'end', `Ticket ${number}`)}
  ${label(W - M, H - 40 - LABEL, 'end', 'Make yours at supabase.com/hackathon')}`;
  let body: string;
  // on its side the ticket is s wide and two-thirds of s tall, centred in its s-square box
  if (layout === 'left') {
    const s = 660, x = W - M - s, y = (H - s) / 2 + 8;
    body = `${title(M, H / 2 - 92, 'start', 'LW16', 150)}
  ${label(M, H / 2 + 80, 'start', name)}
  ${ticketAt(x, y, s)}`;
  } else if (layout === 'stacked') {
    const s = 660, x = W - M - s, y = (H - s) / 2 + 8;
    body = `${title(M - 6, 120, 'start', 'LW', 190)}
  ${title(M - 6, 300, 'start', '16', 190)}
  ${label(M, 300 + 190 + 8, 'start', name)}
  ${ticketAt(x, y, s)}`;
  } else if (layout === 'bleed') {
    const s = 980, x = W - s + 200, y = (H - s) / 2 + 60;
    body = `${ticketAt(x, y, s)}
  ${title(M, H / 2 - 92, 'start', 'LW16', 150)}
  ${label(M, H / 2 + 80, 'start', name)}`;
  } else if (layout === 'landscape') {
    const h = 460, w = Math.round(h * 1.586), x = (W - w) / 2, y = (H - h) / 2 - 6;
    // as the centre layout has it: 16 tucked under the card's right edge, LW over its left
    const top = y + h / 2 - 56;
    body = `${title(x + w - 12, top, 'start', '16')}
  ${landscapeAt(x, y, w, h)}
  ${title(x + 64, top, 'end', 'LW')}`;
  } else if (layout === 'landscape-left') {
    const h = 400, w = Math.round(h * 1.586), x = W - M - w, y = (H - h) / 2 + 8;
    body = `${title(M, 150, 'start', 'LW', 150)}
  ${title(M, 300, 'start', '16', 150)}
  ${landscapeAt(x, y, w, h)}`;
  } else {
    // the ticket on its side, centred: LW over its left edge, 16 tucked under its right
    const s = 720, x = (W - s) / 2, y = (H - s) / 2 - 4;
    const top = H / 2 - 60;
    body = `${title(x + s - 12, top, 'start', '16')}
  ${ticketAt(x, y, s)}
  ${title(x + 64, top, 'end', 'LW')}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="shadow" filterUnits="userSpaceOnUse" x="-200" y="-200" width="${W + 400}" height="${H + 400}">
      <feDropShadow dx="0" dy="18" stdDeviation="11" flood-color="${SHADOW}" result="far" />
      <feDropShadow in="far" dx="0" dy="2" stdDeviation="1.5" flood-color="${SHADOW}" />
    </filter>
    <filter id="noise" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
      <feColorMatrix type="saturate" values="0" />
      <feComponentTransfer><feFuncA type="table" tableValues="0 0.5" /></feComponentTransfer>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${PAPER}" />
  ${body}
  ${corners}
  <g opacity="${noise}" style="mix-blend-mode:${blend}">
    <rect width="${W}" height="${H}" filter="url(#noise)" />
  </g>
</svg>`;
}

/** the stored linework (webp, which resvg can't decode) as a PNG data URL */
export async function lineworkDataUrl(webp: Buffer): Promise<string> {
  const png = await sharp(webp).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function renderCard(ticket: Ticket, webp: Buffer, layout: CardLayout = 'centre', theme: CardTheme = 'light'): Promise<Buffer> {
  const svg = cardSvg(ticket, await lineworkDataUrl(webp), layout, theme);
  // resvg skips a missing font without a word and draws the card with no text: fail instead
  const missing = FONT_FILES.filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`fonts missing from the function bundle: ${missing.join(', ')}`);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Geist Mono' },
  });
  return Buffer.from(resvg.render().asPng());
}
