import * as THREE from 'three';

/**
 * The event's name, in the scene itself so it can sit in it. The page opens
 * on "Launch Week 16" across the middle; then "aunch" and "eek" fold away,
 * leaving LW, which moves left to overlap the stack's side while 16 moves
 * right and tucks in behind it. Every piece faces the camera and keeps its
 * size on screen wherever the camera goes, and it all fades away when it's
 * not wanted (a ticket being made, the wall, a card being shown).
 */

const FONT = "'Geist Pixel Square'";
/** the titles' height, in world units at the stack's distance */
const SIZE = 0.5;
/** how far out from the stack's middle each title's inner edge sits at rest (world units at the stack's distance) */
const LW_EDGE = 1.6;
const SIXTEEN_EDGE = 1.7;
/** how far toward (LW) and away from (16) the camera they sit, as a fraction of the stack's distance */
const NEAR = 0.25;
const FAR = 0.25;
const FADE = 4;
/** the opening: how long "Launch Week 16" holds, then how long it takes to fold to LW and part */
const HOLD = 1.2;
const MOVE = 0.8;

interface Piece {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** width, in title heights */
  width: number;
}

const PX = 256;

function measure(text: string) {
  const g = document.createElement('canvas').getContext('2d')!;
  g.font = `${PX}px ${FONT}`;
  return g.measureText(text).width / (PX * 0.78);
}

function makePiece(text: string): Piece {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = `${PX}px ${FONT}`;
  c.width = Math.max(1, Math.ceil(g.measureText(text).width));
  c.height = Math.ceil(PX * 0.78);
  g.font = `${PX}px ${FONT}`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  g.fillText(text, 0, c.height);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, opacity: 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  return { mesh, width: c.width / c.height };
}

const ease = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const right = new THREE.Vector3(), toward = new THREE.Vector3(), at = new THREE.Vector3();

export class Titles {
  readonly group = new THREE.Group();
  private pieces: { L: Piece; aunch: Piece; W: Piece; eek: Piece; sixteen: Piece; space: number } | null = null;
  private shown = 0;
  /** seconds since the opening began; it begins the first time the titles are wanted */
  private clock = -1;

  constructor() {
    // the type is set once its font has loaded
    document.fonts
      .load(`${PX}px ${FONT}`)
      .catch(() => undefined)
      .then(() => {
        const p = { L: makePiece('L'), aunch: makePiece('aunch'), W: makePiece('W'), eek: makePiece('eek'), sixteen: makePiece('16'), space: measure(' ') };
        this.pieces = p;
        this.group.add(p.L.mesh, p.aunch.mesh, p.W.mesh, p.eek.mesh, p.sixteen.mesh);
      });
  }

  /** Place them about `anchor` (the stack's middle) for this camera, fading toward `show`. */
  update(dt: number, camera: THREE.PerspectiveCamera, anchor: THREE.Vector3, show: boolean, ink: THREE.Color) {
    const p = this.pieces;
    if (!p) return;
    if (show && this.clock < 0) this.clock = 0;
    if (this.clock >= 0) this.clock += dt;
    this.shown += THREE.MathUtils.clamp((show ? 1 : 0) - this.shown, -dt * FADE, dt * FADE);
    this.group.visible = this.shown > 0;
    if (!this.group.visible) return;
    const opening = THREE.MathUtils.clamp((this.clock - HOLD) / MOVE, 0, 1);
    // the words fold to their initials as the two parts move apart, together
    const fold = ease(opening);
    const part = fold;
    const open = 1 - fold;

    // widths along the line, in world units at the stack's distance
    const wL = p.L.width * SIZE, wA = p.aunch.width * SIZE, wS = p.space * SIZE;
    const wW = p.W.width * SIZE, wE = p.eek.width * SIZE, w16 = p.sixteen.width * SIZE;
    // each letter goes straight from its place in the line to its place at
    // rest: the whole line centred to start; at rest LW ends left of the
    // middle and 16 starts right of it
    const line = wL + wA + wS + wW + wE + wS + w16;
    const xL = THREE.MathUtils.lerp(-line / 2, -LW_EDGE - wL - wW, part);
    const xW = THREE.MathUtils.lerp(-line / 2 + wL + wA + wS, -LW_EDGE - wW, part);
    const x16 = THREE.MathUtils.lerp(line / 2 - w16, SIXTEEN_EDGE, part);

    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    const alpha = this.shown * this.shown * (3 - 2 * this.shown);
    const place = (piece: Piece, x: number, w: number, depth: number, fade = 1, shown = 1) => {
      // a folding word isn't squeezed: it's cut back from its end, showing less of itself
      piece.mesh.material.map!.repeat.x = shown;
      // where it'd sit at the stack's distance, then slid along the line of sight
      at.copy(anchor).addScaledVector(right, x + w / 2);
      toward.copy(at).sub(camera.position);
      const f = 1 + depth;
      piece.mesh.position.copy(camera.position).addScaledVector(toward, f);
      piece.mesh.quaternion.copy(camera.quaternion);
      piece.mesh.scale.set(Math.max(1e-4, w) * f, SIZE * f, 1);
      piece.mesh.material.color.copy(ink);
      piece.mesh.material.opacity = alpha * fade;
    };
    // the rest of each word follows its initial, cut back from its end as it goes
    place(p.L, xL, wL, -NEAR);
    place(p.aunch, xL + wL, wA * open, -NEAR, open, open);
    place(p.W, xW, wW, -NEAR);
    place(p.eek, xW + wW, wE * open, -NEAR, open, open);
    // 16 starts in front with the rest of the line, then goes in behind the stack
    const behind = part > 0.5;
    p.sixteen.mesh.material.depthTest = behind;
    p.sixteen.mesh.renderOrder = behind ? -1 : 10;
    place(p.sixteen, x16, w16, THREE.MathUtils.lerp(-NEAR, FAR, part));
  }
}
