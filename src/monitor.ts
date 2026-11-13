import * as THREE from 'three';
import { PAGE } from './gridArt.ts';

/**
 * The engraver's old CRT screen, floating beside the card: where the ticket's layers
 * are "designed". It lists the laser's passes (the number, the name, then
 * each layer of the artwork), marks the one being cut, and shows that
 * layer's linework drawing itself in on green phosphor as the laser goes.
 */

const SCREEN_W = 640;
const SCREEN_H = 480;
/** the screen's size, in card units: big enough to read across the room */
const SCREEN_SIZE = { w: 2.3, h: 1.725 };
const PHOSPHOR = '#7dffb0';
const DIM = '#1f6b46';
const GLASS = '#06140d';

/** a soft diagonal sheen, the room's light on the glass */
function sheenTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.03)');
  grad.addColorStop(0.36, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface MonitorState {
  /** the design's layers, by name, and each one's linework on its own (dark on clear) */
  layers: { name: string; ink: CanvasImageSource | null }[];
  /** the artwork built up: after each layer, its linework so far (dark on clear) */
  together: CanvasImageSource[];
  /** what the laser's on: the number, the name, an artwork layer (its index), or nothing (done or waiting) */
  cutting: { kind: 'number' | 'name' } | { kind: 'layer'; index: number } | null;
  /** 0..1 through the pass it's on, and through the whole job */
  progress: number;
  /**
   * the pass's plan: when the beam cuts each cell (200 × 300, top row first;
   * -1 never), and where its head is (the card's uv) — so the screen burns in
   * exactly as the card does
   */
  plan?: { times: Float32Array; head: { u: number; v: number } };
  overall: number;
  ticket: string;
}

export class Monitor {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private state: MonitorState | null = null;
  private drawnAt = -1;
  /** linework lifted off its ground as phosphor, once per image */
  private glows = new WeakMap<object, HTMLCanvasElement>();
  /** and its pixels, for burning in cell by cell */
  private glowPixels = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
  private burnCanvas = Object.assign(document.createElement('canvas'), { width: 200, height: 300 });

  constructor() {
    this.canvas.width = SCREEN_W;
    this.canvas.height = SCREEN_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.build();
    this.draw(0);
  }

  private build() {
    // just the tube's face: the glass, bulging a little, with the room's sheen on it
    const sw = SCREEN_SIZE.w, sh = SCREEN_SIZE.h;
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sh, 24, 18),
      new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }),
    );
    const pos = glass.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / (sw / 2), y = pos.getY(i) / (sh / 2);
      pos.setZ(i, 0.08 * (1 - (x * x + y * y) / 2));
    }
    glass.geometry.computeVertexNormals();
    const sheen = new THREE.Mesh(
      glass.geometry,
      new THREE.MeshBasicMaterial({ map: sheenTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    sheen.position.z = 0.002;
    this.group.add(glass, sheen);
  }

  /** What to show: the design and what the laser's doing with it (null: nothing yet). */
  set(state: MonitorState | null) {
    this.state = state;
  }

  /** Redraw the screen now and then (a CRT's own refresh is all it needs). */
  update(time: number) {
    if (time - this.drawnAt < 1 / 20) return;
    this.drawnAt = time;
    this.draw(time);
    this.tex.needsUpdate = true;
  }

  /** linework as phosphor: its dark marks lit green, the rest clear */
  private phosphorOf(img: CanvasImageSource) {
    const known = this.glows.get(img as object);
    if (known) return known;
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 300;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, c.width, c.height);
    const data = g.getImageData(0, 0, c.width, c.height);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      const ink = Math.max(0, Math.min(1, (0.75 - lum) * 3)) * (d[i + 3] / 255);
      d[i] = 125;
      d[i + 1] = 255;
      d[i + 2] = 176;
      d[i + 3] = ink * 255;
    }
    g.putImageData(data, 0, 0);
    this.glows.set(img as object, c);
    return c;
  }

  /** a card's frame on the screen, and its linework in it: all of it, or only as far as the beam has cut it */
  private card(img: CanvasImageSource | null, x: number, y: number, w: number, h: number, alpha = 1, burn?: { times: Float32Array; p: number }) {
    const g = this.ctx;
    if (!img) return;
    const glow = this.phosphorOf(img);
    g.globalAlpha = alpha;
    g.drawImage(burn ? this.burnt(glow, burn.times, burn.p) : glow, x, y, w, h);
    g.globalAlpha = 1;
  }

  /** linework shown only where the beam's been: each cell once its time in the plan has come */
  private burnt(glow: HTMLCanvasElement, times: Float32Array, p: number) {
    let px = this.glowPixels.get(glow);
    if (!px) {
      px = glow.getContext('2d')!.getImageData(0, 0, 200, 300).data;
      this.glowPixels.set(glow, px);
    }
    const g = this.burnCanvas.getContext('2d')!;
    const out = g.createImageData(200, 300);
    const d = out.data;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t < 0 || t > p) continue;
      const k = i * 4;
      d[k] = px[k];
      d[k + 1] = px[k + 1];
      d[k + 2] = px[k + 2];
      d[k + 3] = px[k + 3];
    }
    g.putImageData(out, 0, 0);
    return this.burnCanvas;
  }

  private draw(time: number) {
    const g = this.ctx;
    const s = this.state;
    g.fillStyle = GLASS;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    g.textBaseline = 'top';
    g.font = "20px 'Geist Mono', ui-monospace, monospace";
    g.fillStyle = PHOSPHOR;
    g.fillText('LAYER DESIGN', 24, 18);
    g.fillStyle = DIM;
    g.textAlign = 'right';
    g.fillText(s?.ticket ?? '', SCREEN_W - 24, 18);
    g.textAlign = 'left';
    g.fillRect(24, 48, SCREEN_W - 48, 2);

    const layers = s?.layers ?? [];
    const cut = s?.cutting ?? null;
    const cutIndex = cut?.kind === 'layer' ? cut.index : cut ? -1 : layers.length;
    const progress = Math.min(1, Math.max(0, s?.progress ?? 0));

    // together: the whole design, or while the artwork's burning, what's cut so far
    // and the layer under way drawing in row by row behind the scan line
    const tx = 24, ty = 66, tw = 196, th = Math.round((196 * PAGE.h) / PAGE.w);
    g.strokeStyle = DIM;
    g.lineWidth = 1;
    g.strokeRect(tx - 0.5, ty - 0.5, tw + 1, th + 1);
    const together = s?.together ?? [];
    if (cut?.kind === 'layer') {
      // the design to come, faint; what's cut, bright
      this.card(together[together.length - 1] ?? null, tx, ty, tw, th, 0.18);
      if (cut.index > 0) this.card(together[cut.index - 1] ?? null, tx, ty, tw, th);
      const burn = s?.plan ? { times: s.plan.times, p: progress } : undefined;
      this.card(layers[cut.index]?.ink ?? null, tx, ty, tw, th, 1, burn);
      // the head, where it is: its row, and a bright dot on it
      if (s?.plan) {
        const hy = ty + th * (1 - s.plan.head.v), hx = tx + tw * s.plan.head.u;
        g.fillStyle = DIM;
        g.fillRect(tx, hy, tw, 1);
        g.fillStyle = PHOSPHOR;
        g.fillRect(hx - 3, hy - 3, 6, 6);
      }
    } else {
      this.card(together[together.length - 1] ?? null, tx, ty, tw, th, cut ? 0.35 : 1);
    }
    g.font = "14px 'Geist Mono', ui-monospace, monospace";
    g.fillStyle = DIM;
    g.fillText('TOGETHER', tx, ty + th + 8);

    // isolated: each layer on its own, the one being cut outlined, the cut ones ticked
    const cols = 3, gx = 244, gy = 66, gap = 10;
    const cw = Math.floor((SCREEN_W - 24 - gx - gap * (cols - 1)) / cols), chh = Math.round((cw * PAGE.h) / PAGE.w);
    layers.forEach((l, i) => {
      const x = gx + (i % cols) * (cw + gap), y = gy + Math.floor(i / cols) * (chh + 30);
      const on = i === cutIndex, done = i < cutIndex;
      g.strokeStyle = on ? PHOSPHOR : DIM;
      g.lineWidth = on ? 2 : 1;
      g.strokeRect(x - 0.5, y - 0.5, cw + 1, chh + 1);
      this.card(l.ink, x, y, cw, chh, on || done || !cut ? 1 : 0.45, on && s?.plan ? { times: s.plan.times, p: progress } : undefined);
      g.fillStyle = on || done || !cut ? PHOSPHOR : DIM;
      g.font = "13px 'Geist Mono', ui-monospace, monospace";
      const label = `${String(i + 1).padStart(2, '0')} ${l.name.toUpperCase()}`;
      g.fillText(label.length > 15 ? label.slice(0, 14) + '…' : label, x, y + chh + 6);
      if (done) g.fillText('✓', x + cw - 12, y + chh + 6);
    });

    // progress: what the laser's on, how far through it, and through the whole job
    g.font = "18px 'Geist Mono', ui-monospace, monospace";
    const py = SCREEN_H - 70;
    const what = !s
      ? 'READY'
      : cut?.kind === 'number'
        ? 'CUTTING NUMBER'
        : cut?.kind === 'name'
          ? 'CUTTING NAME'
          : cut?.kind === 'layer'
            ? `BURNING ${String(cut.index + 1).padStart(2, '0')} ${(layers[cut.index]?.name ?? '').toUpperCase()}`
            : 'DONE';
    g.fillStyle = PHOSPHOR;
    g.fillText(`> ${what}`, 24, py);
    if (Math.floor(time * 2) % 2 === 0) g.fillRect(24 + g.measureText(`> ${what}`).width + 6, py, 11, 20);
    if (cut) {
      g.textAlign = 'right';
      g.fillText(`${String(Math.round(progress * 100)).padStart(3, ' ')}%`, SCREEN_W - 24, py);
      g.textAlign = 'left';
    }
    const bx = 24, bw = SCREEN_W - 48;
    g.fillStyle = DIM;
    g.fillRect(bx, py + 30, bw, 4);
    g.fillRect(bx, py + 40, bw, 10);
    g.fillStyle = PHOSPHOR;
    g.fillRect(bx, py + 30, bw * (cut ? progress : s ? 1 : 0), 4);
    g.fillRect(bx, py + 40, bw * Math.min(1, Math.max(0, s?.overall ?? 0)), 10);

    // a tube: the picture glows a little past its edges, the refresh band rolls
    // down it, the whole thing flickers faintly, and it's drawn in scanlines
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.18;
    g.filter = 'blur(6px)';
    g.drawImage(this.canvas, 0, 0);
    g.filter = 'none';
    g.globalAlpha = 1;
    const band = ((time * 0.22) % 1.3) * SCREEN_H - SCREEN_H * 0.15;
    const roll = g.createLinearGradient(0, band - 60, 0, band + 60);
    roll.addColorStop(0, 'rgba(125,255,176,0)');
    roll.addColorStop(0.5, 'rgba(125,255,176,0.07)');
    roll.addColorStop(1, 'rgba(125,255,176,0)');
    g.fillStyle = roll;
    g.fillRect(0, band - 60, SCREEN_W, 120);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(0,0,0,${0.04 + 0.04 * Math.random()})`;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < SCREEN_H; y += 3) g.fillRect(0, y, SCREEN_W, 1);
    const v = g.createRadialGradient(SCREEN_W / 2, SCREEN_H / 2, SCREEN_H * 0.35, SCREEN_W / 2, SCREEN_H / 2, SCREEN_W * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = v;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }
}
