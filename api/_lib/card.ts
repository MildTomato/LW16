// A shared ticket's card, 1200x630: og/ticket-card.html (the approved design,
// light theme) as one SVG, rasterised with resvg. Keep the two in step.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { ticketNumber, type Ticket } from './tickets.js';

const W = 1200;
const H = 630;

// light theme from ticket-card.html
const PAPER = '#e8e6e1';
const INK = '#161616';
const METAL = '#45e09c';
const METAL_HI = '#7af0bd';
const ETCH = '#0d5a36';
const SHADOW = 'rgba(40, 40, 30, 0.22)';

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

export function cardSvg(ticket: Ticket, linework: string): string {
  const number = ticketNumber(ticket.number);

  // ownerPage in src/gridArt.ts: up the right edge from the bottom corner,
  // the name a line in and the number nearest the edge
  const CW = 2000, RULE_X = 100, RULE_BOTTOM = 2826;
  const name = `@${ticket.username}`;
  const reach = RULE_BOTTOM - 176 - 40;
  const size = Math.min(420, Math.floor(reach / (0.62 * Math.max(name.length, number.length))));
  const line = Math.round(size * 1.05);
  const at = (x: number, text: string) => `<text transform="translate(${x} ${RULE_BOTTOM}) rotate(-90)">${esc(text)}</text>`;

  const title = (x: number, anchor: string, text: string) =>
    `<text x="${x}" y="${baseline(262, 112)}" text-anchor="${anchor}" font-family="Geist Pixel Square" font-size="112" fill="${INK}" fill-opacity="0.94">${text}</text>`;
  const label = (x: number, top: number, anchor: string, text: string) =>
    `<text x="${x}" y="${baseline(top, 13)}" text-anchor="${anchor}" font-family="Geist Mono" font-size="13" letter-spacing="1.04" fill="${INK}" fill-opacity="0.82">${esc(text.toUpperCase())}</text>`;

  // the ticket box in the page, as in the mockup's CSS (left 434, top 65, 333x500)
  const TX = 434, TY = 65, TW = 333, TH = 500;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="shadow" filterUnits="userSpaceOnUse" x="${TX - 80}" y="${TY - 60}" width="${TW + 160}" height="${TH + 160}">
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
  ${title(767 - 12, 'start', '16')}
  <g filter="url(#shadow)">
    <svg x="${TX}" y="${TY}" width="${TW}" height="${TH}" viewBox="0 0 ${CW} 3000">
      <defs>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${METAL_HI}" />
          <stop offset="0.45" stop-color="${METAL}" />
          <stop offset="1" stop-color="${METAL}" />
        </linearGradient>
        <!-- the owner, cut through the card; the hairline stroke matches Chromium's heavier render of the thin pixel lines -->
        <mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${CW}" height="3000">
          <rect width="${CW}" height="3000" rx="40" fill="#fff" />
          <g fill="#000" stroke="#000" stroke-width="3" font-family="Geist Pixel Line" font-size="${size}">${at(CW - RULE_X - line, name)}${at(CW - RULE_X, number)}</g>
        </mask>
        <filter id="etch" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0.05  0 0 0 0 0.35  0 0 0 0 0.21  0 0 0 0.92 0" />
        </filter>
      </defs>
      <g mask="url(#cut)">
        <rect width="${CW}" height="3000" rx="40" fill="url(#sheen)" />
        <image x="0" y="0" width="${CW}" height="3000" filter="url(#etch)" href="${linework}" />
        <g fill="${ETCH}" font-family="Geist" font-size="44" font-weight="300" letter-spacing="0.5">
          <text x="100" y="132">Petabyte</text>
          <text x="100" y="2900">Prototype</text>
        </g>
        <line x1="100" y1="176" x2="100" y2="2826" stroke="${ETCH}" stroke-width="2" />
      </g>
    </svg>
  </g>
  ${title(W - (1200 - 434 - 64), 'end', 'LW')}
  ${label(48, 40, 'start', 'Supabase')}
  ${label(W - 48, 40, 'end', `Ticket ${number}`)}
  ${label(W - 48, H - 40 - 13, 'end', 'Make your ticket →')}
  <g opacity="0.55" style="mix-blend-mode:multiply">
    <rect width="${W}" height="${H}" filter="url(#noise)" />
  </g>
</svg>`;
}

/** the stored linework (webp, which resvg can't decode) as a PNG data URL */
export async function lineworkDataUrl(webp: Buffer): Promise<string> {
  const png = await sharp(webp).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function renderCard(ticket: Ticket, webp: Buffer): Promise<Buffer> {
  const svg = cardSvg(ticket, await lineworkDataUrl(webp));
  // resvg skips a missing font without a word and draws the card with no text: fail instead
  const missing = FONT_FILES.filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`fonts missing from the function bundle: ${missing.join(', ')}`);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Geist Mono' },
  });
  return Buffer.from(resvg.render().asPng());
}
