import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { MAX_PLATES, StackAnimator, helixFade, helixLap, helixSlot, type StackParams } from './cardStack.ts';
import { Monitor } from './monitor.ts';

/** thin, like a die-cut metal ticket */
const THICKNESS = 0.02;
const plateM = new THREE.Matrix4();
/** the printed face sits a hair proud of the slab, so the two never z-fight */
const FACE_LIFT = 0.0004;
/** the engraver: how far in front of the face its module floats, and its nozzle's length */
const GANTRY_GAP = 0.42;
const GANTRY_NOZZLE = 0.09;
/** the floating laser module's size */
const GANTRY_HEAD_SCALE = 1.7;
/** how far above it starts, and how long it takes to float down into place */
const GANTRY_DROP = 7;
const GANTRY_ARRIVE = 1.1;
const CORNER_SEGMENTS = 10;
/** a small 45° chamfer where face meets side: the facet that glints as the card turns */
const CHAMFER = 0.006;
/** a soft round glow, for the laser's spot */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,200,140,0.8)');
  grad.addColorStop(0.5, 'rgba(255,120,40,0.25)');
  grad.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** card outline: a rectangle with rounded corners (radius 0 = sharp), centred */
function cardOutline(width: number, height: number, radius: number) {
  const r = Math.min(Math.max(radius, 0), width / 2, height / 2);
  const x = -width / 2, y = -height / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + width - r, y);
  if (r > 0) s.quadraticCurveTo(x + width, y, x + width, y + r);
  s.lineTo(x + width, y + height - r);
  if (r > 0) s.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  s.lineTo(x + r, y + height);
  if (r > 0) s.quadraticCurveTo(x, y + height, x, y + height - r);
  s.lineTo(x, y + r);
  if (r > 0) s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * A laser warning sticker, drawn: the yellow triangle with the beam's
 * starburst; the label with it and WARNING / LASER RADIATION; or a strip
 * of black and yellow hazard stripes.
 */
function warningSticker(kind: 'triangle' | 'label' | 'strip') {
  const yellow = '#f4c20d', black = '#151515';
  const c = document.createElement('canvas');
  const [w, h] = kind === 'triangle' ? [256, 256] : kind === 'label' ? [512, 272] : [64, 768];
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  // the laser symbol: a triangle with a starburst, its beam out to the right
  const triangle = (cx: number, cy: number, s: number) => {
    g.beginPath();
    g.moveTo(cx, cy - s * 0.55);
    g.lineTo(cx + s * 0.6, cy + s * 0.48);
    g.lineTo(cx - s * 0.6, cy + s * 0.48);
    g.closePath();
    g.fillStyle = yellow;
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = s * 0.09;
    g.strokeStyle = black;
    g.stroke();
    const ox = cx - s * 0.12, oy = cy + s * 0.14;
    g.fillStyle = black;
    g.beginPath();
    g.arc(ox, oy, s * 0.06, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = s * 0.028;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const r0 = s * 0.09, r1 = s * (k % 2 ? 0.15 : 0.2);
      g.beginPath();
      g.moveTo(ox + Math.cos(a) * r0, oy + Math.sin(a) * r0);
      g.lineTo(ox + Math.cos(a) * r1, oy + Math.sin(a) * r1);
      g.stroke();
    }
    g.lineWidth = s * 0.04;
    g.beginPath();
    g.moveTo(ox + s * 0.08, oy);
    g.lineTo(cx + s * 0.38, oy);
    g.stroke();
  };
  if (kind === 'triangle') {
    triangle(w / 2, h / 2 + 8, 220);
  } else if (kind === 'label') {
    g.fillStyle = yellow;
    g.fillRect(0, 0, w, h);
    g.lineWidth = 10;
    g.strokeStyle = black;
    g.strokeRect(5, 5, w - 10, h - 10);
    // the black band across the top with WARNING in it
    g.fillStyle = black;
    g.fillRect(0, 0, w, 84);
    g.fillStyle = yellow;
    g.font = "700 60px 'Geist Mono', ui-monospace, monospace";
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText('WARNING', w / 2, 46);
    triangle(96, 182, 150);
    g.fillStyle = black;
    g.textAlign = 'left';
    g.font = "700 54px 'Geist Mono', ui-monospace, monospace";
    g.fillText('LASER', 196, 152);
    g.font = "500 27px 'Geist Mono', ui-monospace, monospace";
    g.fillText('AVOID EXPOSURE', 196, 204);
    g.fillText('CLASS 4 BEAM', 196, 238);
  } else {
    g.fillStyle = yellow;
    g.fillRect(0, 0, w, h);
    g.fillStyle = black;
    for (let y = -w; y < h + w; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + w);
      g.lineTo(w, y + w + 32);
      g.lineTo(0, y + 32);
      g.closePath();
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** radians of spin per pixel dragged */
const SPIN_PER_PX = 0.008;
/** fastest spin a flick can give it, rad/s — a lively few turns, not a blur */
const MAX_SPIN = 14;
/** how quickly a flung card slows, per second */
const SPIN_DRAG = 2.2;
/** below this speed (rad/s) the card eases back to face-on */
const SETTLE_BELOW = 1.5;
const SETTLE_RATE = 3;

/**
 * The artwork as a rigid metal card: a thin slab cut square at the edges,
 * art on polished, lacquered metal with a thin-film flash on the front;
 * brushed metal on the back and satin, machined edges. The linework is
 * printed, or etched into the metal. Drag to spin; it keeps turning, slows,
 * then settles face-on (front or back) and floats.
 */
export class MetalCard {
  readonly group = new THREE.Group();
  /** the metal slab: back and edges */
  readonly slab: THREE.Mesh<THREE.ExtrudeGeometry, THREE.Material[]>;
  /** the printed face — the only part stickers and the artwork live on */
  readonly face: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshPhysicalMaterial>;
  /** the stack's plates: every copy of the card, drawn instanced */
  readonly stackSlab: THREE.InstancedMesh<THREE.ExtrudeGeometry, THREE.Material[]>;
  readonly stackFace: THREE.InstancedMesh<THREE.ShapeGeometry, THREE.MeshPhysicalMaterial>;
  dragging = false;

  private stack = new StackAnimator();
  private stackParams: StackParams = { shape: 'Single', count: 48, twist: 0.5, spacing: 0.4, flow: 0 };
  private front: THREE.MeshPhysicalMaterial;
  private plateFront: THREE.MeshPhysicalMaterial;
  /** a different artwork per plate, cycled through the stack; none = the card's */
  /** each plate's layer of the plate art: plates show any ticket in the pool, not just their own index */
  private plateLayer = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PLATES).map((_, i) => i), 1);
  /** how much of each plate shows (1 all, 0 none): the endless Helix's ends fade into the background */
  private plateFade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PLATES).fill(1), 1);
  /** the background a fading plate fades into */
  private fadeU = { uFadeBg: { value: new THREE.Color() } };
  private plateArt = {
    uPlateArt: { value: null as THREE.DataArrayTexture | null },
    /** the page's marks on every ticket plate (null: none) */
    uPlateMarks: { value: null as THREE.Texture | null },
    /** the pulled-out plate's artwork at full size, and the pool layer it stands in for (-1: none) */
    uFocusArt: { value: null as THREE.Texture | null },
    uFocusLayer: { value: -1 },
    uFocusTexel: { value: new THREE.Vector2(1 / 1000, 1 / 1500) },
    uPlateArtCount: { value: 0 },
    uPlateTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1536) },
  };
  private metal: THREE.MeshPhysicalMaterial;
  private edge: THREE.MeshPhysicalMaterial;
  private size = { w: 2, h: 3 };
  private corner = 0.04;
  /** the opening: a hairline outline per plate, drawn in before the plate comes in over it */
  private introLines: Line2[] = [];
  /** and its fill, a tint of the page, coming in as the outline closes */
  private introFills: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>[] = [];
  private outlineShape: THREE.Shape | null = null;
  private outlinePoints: THREE.Vector2[] = [];
  private outlineInk = new THREE.Color('#1a1a1a');
  private outlineFill = new THREE.Color('#e6e4df');
  private outlinePaper = new THREE.Color('#e8e6e1');
  private backMirror = false;
  private bump = 0;
  private stickerMap: { value: THREE.Texture };
  /** how the artwork's linework is applied: printed, or etched into the metal */
  private etch = {
    uEtchMode: { value: 0 },
    uEtchDepth: { value: 0.5 },
    uEtchBevel: { value: 1 },
    uMapTexel: { value: new THREE.Vector2(1 / 2048, 1 / 3072) },
    /** a ticket's owner (username and number): 0 ink, 1 mirror, 2 etched; and the ink's colour */
    uOwnerFinish: { value: 0 },
    /** how light an etched groove's floor is: darker when the room colours plain metal, so the linework reads */
    uGrooveTone: { value: 0.55 },
    /** a holographic foil over the face: rainbow bands set by the angle it's seen at */
    uFoil: { value: 0 },
    /** the Tiles wall shaded as one smooth curve (1), or each card flat (0) */
    uTileCurve: { value: 0 },
    uOwnerInk: { value: new THREE.Color(0.025, 0.025, 0.025) },
  };
  /** the laser etching the face: on, and how far through (0..1) */
  private laserU = {
    uLaserOn: { value: 0 },
    uLaserP: { value: 0 },
    /** the pass's route: when the head cuts each cell of the face (see laser.ts) */
    uLaserPlan: { value: null as THREE.DataTexture | null },
    uLaserSeconds: { value: 1 },
    uLaserHead: { value: new THREE.Vector2() },
    uLaserFiring: { value: 0 },
    uLaserAspect: { value: 1.5 },
    /** the face before the laser: its ground with nothing cut in */
    uLaserGround: { value: null as THREE.Texture | null },
    /** a ticket's lettering on the card's face, its own layer (its coverage in alpha); off: none */
    uFaceLettering: { value: null as THREE.Texture | null },
    /** 0: no lettering; 1: the artwork keeps clear of it; 2: the laser is cutting it; 3: cut through the card */
    uFaceLetteringOn: { value: 0 },
    uFaceMarks: { value: null as THREE.Texture | null },
    uFaceOwner: { value: null as THREE.Texture | null },
    uFacePlainGround: { value: null as THREE.Texture | null },
    /** the card's size, for where a slab point sits on the face */
    uCardSize: { value: new THREE.Vector2(2, 3) },
  };
  /** the laser itself: a beam down onto the face, its spot, and the light it throws */
  private laser = new THREE.Group();
  /**
   * The engraver: a laser module floating in front of the face, moving over
   * it as it cuts, the beam firing from its nozzle. (Its beam and head groups
   * carry the y and x of the cut; there's no frame.)
   */
  private gantry = new THREE.Group();
  private gantryBeam = new THREE.Group();
  private gantryHead = new THREE.Group();
  /** and its monitor, to the right, where the layers are designed */
  readonly monitor = new Monitor();
  /** wanted (making a ticket), and how far it's come down into place (0..1) */
  private gantryWanted = false;
  private gantryK = 0;
  /** where the head is going (the card's uv), and where it is */
  private headGoal = new THREE.Vector2(0, 1);
  private headAt = new THREE.Vector2(0, 1);
  private laserLight = new THREE.PointLight('#ff8a3d', 0, 0.9, 2);
  private rot = { x: 0, y: 0 };
  /** an exact angle (and offset) held by the cinematic reel; null = spin and settle */
  private posed: THREE.Euler | null = null;
  private posedAt = new THREE.Vector3();
  private vel = { x: 0, y: 0 };

  constructor(surface: THREE.Texture, stickers: THREE.Texture) {
    this.stickerMap = { value: stickers };
    this.front = new THREE.MeshPhysicalMaterial({
      map: surface,
      metalness: 0.85,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      iridescence: 0.5,
      iridescenceIOR: 1.4,
      iridescenceThicknessRange: [180, 520],
    });
    this.front.onBeforeCompile = (shader) => this.patchFace(shader, false);
    // the face always draws over the body it sits a hair above: at a
    // distance (the long Tiles lens) the depth buffer can't tell them apart,
    // and they'd fight through each other in blocks
    this.front.polygonOffset = true;
    this.front.polygonOffsetFactor = -1;
    this.front.polygonOffsetUnits = -4;
    // the plates' face: the same, but each plate can carry its own artwork
    this.plateFront = this.front.clone();
    this.plateFront.onBeforeCompile = (shader) => {
      this.patchFace(shader, true);
      this.patchFade(shader);
    };
    this.plateFront.customProgramCacheKey = () => 'card-plates';
    const metal = (this.metal = new THREE.MeshPhysicalMaterial({
      color: '#c3c8cf',
      metalness: 1,
      roughness: 0.38,
      anisotropy: 0.8,
      clearcoat: 0.3,
      clearcoatRoughness: 0.3,
    }));
    metal.onBeforeCompile = (shader) => this.patchSlab(shader);
    // machined edges: square-cut and chamfered, polished metal brushed along the edge
    this.edge = new THREE.MeshPhysicalMaterial({
      color: '#c9ced6',
      metalness: 1,
      roughness: 0.22,
      anisotropy: 0.8,
      clearcoat: 0.2,
      clearcoatRoughness: 0.15,
    });
    this.edge.onBeforeCompile = (shader) => this.patchFade(shader);
    // extrude groups: 0 = the two caps (metal), 1 = the sides (edge)
    this.slab = new THREE.Mesh(new THREE.ExtrudeGeometry(), [metal, this.edge]);
    this.face = new THREE.Mesh(new THREE.ShapeGeometry(), this.front);
    this.stackSlab = new THREE.InstancedMesh(this.slab.geometry, [metal, this.edge], MAX_PLATES);
    this.stackFace = new THREE.InstancedMesh(this.face.geometry, this.plateFront, MAX_PLATES);
    this.slab.geometry.setAttribute('aPlateLayer', this.plateLayer);
    this.face.geometry.setAttribute('aPlateLayer', this.plateLayer);
    this.slab.geometry.setAttribute('aPlateFade', this.plateFade);
    this.face.geometry.setAttribute('aPlateFade', this.plateFade);
    for (const m of [this.stackSlab, this.stackFace]) {
      m.count = 0;
      m.visible = false;
      // the formation moves every frame: cheaper to draw it than to cull it
      m.frustumCulled = false;
    }
    this.group.add(this.slab, this.face, this.stackSlab, this.stackFace);
    this.buildLaser();
    this.buildGantry();
    this.group.add(this.laser);
    this.group.visible = false;
    this.rebuild();
  }

  /** Match the cloth's size (it follows the artwork's shape). */
  setSize(width: number, height: number) {
    if (width === this.size.w && height === this.size.h) return;
    this.size = { w: width, h: height };
    this.laserU.uCardSize.value.set(width, height);
    this.rebuild();
  }

  get dims() {
    return this.size;
  }

  /** Hold an exact angle (the cinematic reel drives it); null hands it back to spin and settle. */
  setPose(rot: THREE.Euler | null, at?: THREE.Vector3) {
    if (rot) {
      this.posed = rot;
      this.posedAt.copy(at ?? new THREE.Vector3());
      return;
    }
    if (this.posed) {
      this.rot = { x: this.posed.x, y: this.posed.y };
      this.vel = { x: 0, y: 0 };
      this.posed = null;
    }
  }

  /** Corner rounding in world units; 0 is a sharp rectangle. Edges stay square-cut. */
  setCorner(radius: number) {
    if (radius === this.corner) return;
    this.corner = radius;
    this.rebuild();
  }

  private rebuild() {
    const { w, h } = this.size;
    const outline = cardOutline(w, h, this.corner);
    // the opening's outlines follow the card's shape: start again from it
    this.outlinePoints = outline.getPoints(CORNER_SEGMENTS);
    this.outlinePoints.push(this.outlinePoints[0].clone());
    for (const line of this.introLines) line.geometry.setPositions(this.outlinePositions());
    this.outlineShape = outline;
    for (const fill of this.introFills) {
      fill.geometry.dispose();
      fill.geometry = new THREE.ShapeGeometry(outline, CORNER_SEGMENTS);
    }
    // the slab: straight sides with a one-step chamfer at each face, centred
    // on z. The negative offset keeps the sides on the outline, so the
    // chamfer cuts inward and the card stays its full size.
    const slab = new THREE.ExtrudeGeometry(outline, {
      depth: THICKNESS - 2 * CHAMFER,
      curveSegments: CORNER_SEGMENTS,
      bevelEnabled: true,
      bevelThickness: CHAMFER,
      bevelSize: CHAMFER,
      bevelOffset: -CHAMFER,
      bevelSegments: 1,
    });
    slab.translate(0, 0, -(THICKNESS / 2 - CHAMFER));
    // the face: the outline inside the chamfer, uv 0..1 across the whole card
    // so the artwork keeps its place
    const inner = cardOutline(w - 2 * CHAMFER, h - 2 * CHAMFER, Math.max(0, this.corner - CHAMFER));
    const face = new THREE.ShapeGeometry(inner, CORNER_SEGMENTS);
    const pos = face.attributes.position;
    const uv = face.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    }
    face.translate(0, 0, THICKNESS / 2 + FACE_LIFT);
    this.slab.geometry.dispose();
    this.face.geometry.dispose();
    this.slab.geometry = slab;
    this.face.geometry = face;
    if (this.stackSlab) {
      this.stackSlab.geometry = slab;
      this.stackFace.geometry = face;
      slab.setAttribute('aPlateLayer', this.plateLayer);
      face.setAttribute('aPlateLayer', this.plateLayer);
      slab.setAttribute('aPlateFade', this.plateFade);
      face.setAttribute('aPlateFade', this.plateFade);
    }
  }

  /** Copies of the card arranged into a formation (Single = just the card); Cycle moves through them all. */
  setStack(params: StackParams) {
    this.stackParams = { ...params, count: Math.round(THREE.MathUtils.clamp(params.count, 2, MAX_PLATES)) };
    // One (or an old link's Single) folds the plates back into one card
    this.stack.setTarget(params.cards !== 'Stack' ? 'Single' : params.shape);
  }

  /** whether the card is showing as a formation of plates (not a single card) */
  get stacked() {
    return !this.stack.collapsed;
  }

  /** Which plate a raycast hit, or null. */
  plateAt(hit: THREE.Intersection | null) {
    if (!hit || hit.instanceId === undefined) return null;
    return hit.object === this.stackSlab || hit.object === this.stackFace ? hit.instanceId : null;
  }

  /** Pull a plate out to the front (null puts it back); the card stops spinning meanwhile. */
  focusPlate(i: number | null) {
    this.stack.setFocus(i);
    if (i !== null) this.vel = { x: 0, y: 0 };
  }

  /**
   * Present the pulled-out plate at a world pose — in front of the camera,
   * square to it — instead of the formation's front; null for the front.
   */
  presentPlate(position: THREE.Vector3 | null, quaternion?: THREE.Quaternion, scale = 1) {
    if (!position || !quaternion) {
      this.stack.presentAt(null);
      return;
    }
    this.group.updateWorldMatrix(true, false);
    const inv = this.group.matrixWorld.clone().invert();
    const local = position.clone().applyMatrix4(inv);
    const groupQ = new THREE.Quaternion();
    this.group.getWorldQuaternion(groupQ);
    this.stack.presentAt(local, groupQ.invert().multiply(quaternion), scale);
  }

  /** The formation's middle and how far it reaches, in world space — what a presented plate must clear. */
  formationBounds(centre: THREE.Vector3) {
    this.group.updateWorldMatrix(true, false);
    centre.setFromMatrixPosition(this.group.matrixWorld);
    return this.stack.reach;
  }

  /** Lean the pulled-out plate's face by (x, y) radians, toward the right and up. */
  tiltPlate(x: number, y: number) {
    this.stack.setTilt(x, y);
  }

  /** The plate under the pointer (null: none) pops out a little. */
  hoverPlate(i: number | null) {
    this.stack.setHover(i);
  }

  get focusedPlate() {
    return this.stack.focused;
  }

  /** Where a pulled-out plate sits, and which way it faces, in world space. */
  plateSpot(position: THREE.Vector3, normal: THREE.Vector3, up: THREE.Vector3) {
    this.group.updateWorldMatrix(true, false);
    position.copy(this.stack.front).applyMatrix4(this.group.matrixWorld);
    normal.set(0, 0, 1).transformDirection(this.group.matrixWorld);
    // on its side: the card's left edge up, so the owner (lettered up its right edge) reads left to right along the bottom
    up.set(-1, 0, 0).transformDirection(this.group.matrixWorld);
  }

  /**
   * Stand the wall round a viewer at `eye` (world space) looking `yaw` round
   * from -z: its middle where the viewer would be inside it, turned to face
   * their way. The wall's as it was built for a viewer at `viewer` (its own
   * space) looking down -z.
   */
  standWall(eye: THREE.Vector3, yaw: number, pitch: number, viewer: THREE.Vector3) {
    this.group.updateWorldMatrix(true, false);
    // turned to the viewer's way, and tipped to their look (up or down), so it's seen square on
    const world = new THREE.Matrix4()
      .makeTranslation(eye.x, eye.y, eye.z)
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeRotationX(pitch))
      .multiply(new THREE.Matrix4().makeTranslation(-viewer.x, -viewer.y, -viewer.z));
    this.stack.wallFrame.copy(this.group.matrixWorld).invert().multiply(world);
  }

  /** plates whose place on the wall is off screen: they don't fly across the view to it (or from it) */
  setOffstage(mask: readonly boolean[] | null) {
    this.stack.setOffstage(mask);
  }

  /** the plates in order along the formation: left to right along the Helix */
  get plateOrder(): readonly number[] {
    return this.stack.plateOrder;
  }

  /** where Helix plate i is along it now (0 at one end, the plate count at the other) */
  helixSlot(i: number) {
    return helixSlot(this.stack.pos(i), this.stackParams.count, this.stackParams.twist, this.stack.flowPhase, this.stack.scrollX);
  }

  /** plate i's place in the Helix's ring (a whole number), as its ticket is dealt by */
  ringPlace(i: number) {
    return this.stack.ringPlace(i);
  }

  /** the Helix's ring place showing nearest its middle */
  middlePlace() {
    return this.stack.middlePlace(this.stackParams.count, this.stackParams.twist);
  }

  /** open a gap at ring place `at` for a newcomer: the cards from there on glide one along; returns the plate that comes into the gap */
  openGap(at: number) {
    return this.stack.openGap(at, this.stackParams.count);
  }

  /** how many plates the stack is drawing */
  get plateCount() {
    return this.stackParams.count;
  }

  /**
   * A point on plate i's face, (u, v) from its middle in fractions of the
   * card (-0.5..0.5), and the face's normal — in world space, as it is now.
   */
  platePoint(i: number, u: number, v: number, point: THREE.Vector3, normal: THREE.Vector3) {
    this.group.updateWorldMatrix(true, false);
    this.stackSlab.getMatrixAt(i, plateM);
    plateM.premultiply(this.group.matrixWorld);
    const { w, h } = this.size;
    point.set(u * w, v * h, THICKNESS / 2).applyMatrix4(plateM);
    normal.set(0, 0, 1).transformDirection(plateM);
  }

  /** Plate i's middle, in world space, where it rests in the formation. */
  plateCentre(i: number, out: THREE.Vector3) {
    // its place in the formation, not where it's drawn now: a plate still on
    // its way in (from out of view) is wanted where it'll land. A plate new
    // this frame has no place worked out yet: where it's drawn will do
    const rest = this.stack.restMatrix(i);
    if (rest) plateM.copy(rest);
    else this.stackSlab.getMatrixAt(i, plateM);
    plateM.premultiply(this.group.matrixWorld);
    return out.setFromMatrixPosition(plateM);
  }

  /** Where a world point lies on plate i, in fractions of the card from its middle. */
  plateUv(i: number, point: THREE.Vector3) {
    this.group.updateWorldMatrix(true, false);
    this.stackSlab.getMatrixAt(i, plateM);
    plateM.premultiply(this.group.matrixWorld).invert();
    const local = point.clone().applyMatrix4(plateM);
    return { u: local.x / this.size.w, v: local.y / this.size.h };
  }

  /**
   * The outline of each plate that's showing (or of the card alone), as
   * world-space points round its edge on the slab's middle plane.
   */
  outlines(): THREE.Vector3[][] {
    this.group.updateWorldMatrix(true, true);
    const { w, h } = this.size;
    const ring = cardOutline(w, h, this.corner).getPoints(CORNER_SEGMENTS);
    const n = this.stacked ? this.stackParams.count : 1;
    const out: THREE.Vector3[][] = [];
    for (let i = 0; i < n; i++) {
      if (this.stacked) {
        this.stackSlab.getMatrixAt(i, plateM);
        plateM.premultiply(this.group.matrixWorld);
      } else {
        plateM.copy(this.slab.matrixWorld);
      }
      out.push(ring.map((p) => new THREE.Vector3(p.x, p.y, 0).applyMatrix4(plateM)));
    }
    return out;
  }

  /** The solid metal that's showing — the card, or the stack's plates — for aiming rays at. */
  get solid(): THREE.Object3D {
    return this.stacked ? this.stackSlab : this.slab;
  }

  /** whether a hit landed on the card's printed face (the card's own, or a plate's) */
  isFace(object: THREE.Object3D) {
    return object === this.face || object === this.stackFace;
  }

  /**
   * The face's shading: the artwork's linework printed or etched, stickers
   * over it. Plates can each take their own artwork (a texture array layer
   * per plate); otherwise they share the card's.
   */
  /**
   * The card's body: where a ticket's owner is cut, its front and back go too,
   * so the letters open right through. A plate reads its cut from its ticket
   * (the alpha's lower half); the card from the lettering once it's cut through.
   */
  private patchSlab(shader: THREE.WebGLProgramParametersWithUniforms) {
    Object.assign(shader.uniforms, this.plateArt, this.laserU);
    // the stack's plates (instanced) or the one card — decided here: three.js
    // only defines USE_INSTANCING for the vertex shader
    const plates = shader.instancing;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec2 uCardSize;
        varying vec2 vCardUv;
        varying float vCap;
        ${plates ? 'attribute float aPlateLayer;\n        flat varying float vPlate;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCardUv = position.xy / uCardSize + 0.5;
        vCap = abs(normal.z);
        ${plates ? 'vPlate = aPlateLayer;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vCardUv;
        varying float vCap;
        ${plates ? `
          flat varying float vPlate;
          uniform highp sampler2DArray uPlateArt;
          uniform float uPlateArtCount;
          uniform sampler2D uFocusArt;
          uniform float uFocusLayer;
          float slabCut() {
            if (uPlateArtCount < 0.5) return 0.0;
            bool focused = uFocusLayer > -0.5 && abs(vPlate - uFocusLayer) < 0.5;
            return 1.0 - (focused ? texture2D(uFocusArt, vCardUv).a : texture(uPlateArt, vec3(vCardUv, vPlate)).a);
          }` : `
          uniform sampler2D uFaceOwner;
          uniform float uFaceLetteringOn;
          float slabCut() { return uFaceLetteringOn > 2.5 ? texture2D(uFaceOwner, vCardUv).a : 0.0; }`}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // only the flat front and back: the sides stay whole
        if (vCap > 0.9 && slabCut() > 0.5) discard;`);
    this.patchFade(shader);
  }

  /** The endless Helix's plates fade out at one end and back in at the other; in any other formation they all show. */
  private updatePlateFade() {
    const helix = this.stackParams.shape === 'Helix' && this.stack.shapeNow === 'Helix';
    const n = this.stackParams.count;
    const a = this.plateFade.array as Float32Array;
    let changed = false;
    for (let i = 0; i < n; i++) {
      // the Helix fades at its ends; a tile on the wall fades in as it comes forward
      const tiles = this.stackParams.shape === 'Tiles' && this.stack.shapeNow === 'Tiles';
      const shown = this.stack.plateShown(i);
      const k = helix
        ? helixFade(this.stack.pos(i), n, this.stackParams.twist, this.stack.flowPhase, this.stack.scrollX)
        : tiles
          ? shown * shown * (3 - 2 * shown)
          : 1;
      if (Math.abs(a[i] - k) > 1e-4) {
        a[i] = k;
        changed = true;
      }
    }
    if (changed) this.plateFade.needsUpdate = true;
  }

  /** A stack plate fades into the background as its fade drops (the endless Helix's ends). */
  private patchFade(shader: THREE.WebGLProgramParametersWithUniforms) {
    if (!shader.instancing) return;
    Object.assign(shader.uniforms, this.fadeU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPlateFade;\nvarying float vPlateFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlateFade = aPlateFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPlateFade;\nuniform vec3 uFadeBg;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(uFadeBg, gl_FragColor.rgb, vPlateFade);');
  }

  private patchFace(shader: THREE.WebGLProgramParametersWithUniforms, plates: boolean) {
    Object.assign(shader.uniforms, this.etch, this.plateArt, this.laserU, { uStickerMap: this.stickerMap });
    if (plates) {
      // each plate's own artwork: a layer of the texture array, the plate's slot in the pool
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPlateLayer;\nflat varying float vPlate;\nvarying vec3 vDrumPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlate = aPlateLayer;\nvDrumPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    }
    // helpers go after map_pars_fragment, where the artwork's map sampler is declared
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_pars_fragment>', /* glsl */ `#include <map_pars_fragment>
      uniform sampler2D uStickerMap;
      uniform float uEtchMode;   // 0 printed, 1 etched (bare metal), 2 etched + filled
      uniform float uEtchDepth;
      uniform float uEtchBevel;  // groove shoulder width, in artwork texels
      uniform vec2 uMapTexel;
      uniform float uGrooveTone;
      uniform float uFoil;
      uniform float uOwnerFinish; // the owner: 0 ink, 1 mirror, 2 etched
      uniform vec3 uOwnerInk;     // and the ink's colour
      ${plates ? `
      uniform highp sampler2DArray uPlateArt;
      uniform float uPlateArtCount;  // 0: the plates share the card's artwork
      uniform vec2 uPlateTexel;
      flat varying float vPlate;
      uniform sampler2D uFocusArt;
      uniform float uFocusLayer;
      uniform vec2 uFocusTexel;
      bool cardFocused() { return uFocusLayer > -0.5 && abs(vPlate - uFocusLayer) < 0.5; }
      vec4 cardArt(vec2 uv) {
        if (cardFocused()) return texture2D(uFocusArt, uv);
        return uPlateArtCount > 0.5 ? texture(uPlateArt, vec3(uv, vPlate)) : texture2D(map, uv);
      }
      vec2 cardTexel() { return cardFocused() ? uFocusTexel : uPlateArtCount > 0.5 ? uPlateTexel : uMapTexel; }
      // a ticket's lettering, apart from its artwork: the page's marks (the
      // same on every ticket, their own texture), and the owner, cut through
      // (in the alpha)
      uniform sampler2D uPlateMarks;
      float cardOwnerAt(vec2 uv) {
        return uPlateArtCount > 0.5 ? texture2D(uPlateMarks, uv).a : 0.0;
      }
      float cardCutAt(vec2 uv) {
        if (uPlateArtCount < 0.5) return 0.0;
        return 1.0 - (cardFocused() ? texture2D(uFocusArt, uv).a : texture(uPlateArt, vec3(uv, vPlate)).a);
      }
      // a plate's artwork is already cut out under its lettering (when the plate is made)
      float cardKeepClear(vec2 uv) { return 0.0; }
      vec3 cardPlainGround(vec2 uv) { return cardArt(uv).rgb; }
      // the Tiles wall shaded as one smooth curve: each point catches light as
      // the drum's curve would there, not as its flat card does — so light
      // sweeps across neighbouring cards in one band
      varying vec3 vDrumPos;
      uniform float uTileCurve;
      // the surface's own detail (scratches, the etch) kept: the flat card's
      // facing is swapped for the curve's, and the detail rides on top
      vec3 cardSurfaceNormal(vec3 n, vec3 cardFlat) {
        if (uTileCurve < 0.5) return n;
        vec3 inward = normalize((viewMatrix * vec4(normalize(vec3(-vDrumPos.x, 0.0, -vDrumPos.z)), 0.0)).xyz);
        return dot(inward, cardFlat) > 0.0 ? normalize(n - cardFlat + inward) : n;
      }
      // plates are never mid-etch
      float cardReveal(vec2 uv) { return 1.0; }
      vec3 cardLaserGlow(vec2 uv, float ink) { return vec3(0.0); }
      ` : `
      vec4 cardArt(vec2 uv) { return texture2D(map, uv); }
      vec2 cardTexel() { return uMapTexel; }
      vec3 cardSurfaceNormal(vec3 n, vec3 cardFlat) { return n; }

      // the laser: it rasters the face row by row, back and forth, cutting
      // only the runs of new ink in each row and skipping the gaps
      uniform float uLaserOn;
      uniform float uLaserP;        // 0..1 through the pass
      uniform sampler2D uLaserPlan; // per cell, top row first: when it's cut (-1: never)
      uniform float uLaserSeconds;
      uniform vec2 uLaserHead;      // where the head is (uv)
      uniform float uLaserFiring;   // and whether it's cutting there
      uniform float uLaserAspect;   // the card's height over its width
      // when the beam crosses uv, 0..1 through the pass (-1: it never does)
      float laserTime(vec2 uv) { return texture2D(uLaserPlan, vec2(uv.x, 1.0 - uv.y)).r; }
      float cardReveal(vec2 uv) { return uLaserOn > 0.5 ? step(laserTime(uv), uLaserP) : 1.0; }
      // a ticket's lettering, its own layer: shown as far as the laser has cut it
      uniform sampler2D uFaceLettering; // all of it: the artwork keeps clear of it
      uniform sampler2D uFaceMarks;     // the page's marks, finished
      uniform sampler2D uFaceOwner;     // the owner, cut
      uniform float uFaceLetteringOn;   // 0 none; 1 keeping clear; 2 being cut; 3 cut through
      float cardOwnerAt(vec2 uv) {
        return uFaceLetteringOn > 1.5 ? texture2D(uFaceMarks, uv).a * cardReveal(uv) : 0.0;
      }
      float cardCutAt(vec2 uv) {
        return uFaceLetteringOn > 1.5 ? texture2D(uFaceOwner, uv).a * cardReveal(uv) : 0.0;
      }
      // no artwork under the lettering: the bare colour field there
      uniform sampler2D uFacePlainGround;
      float cardKeepClear(vec2 uv) {
        return uFaceLetteringOn < 0.5 ? 0.0 : texture2D(uFaceLettering, uv).a;
      }
      vec3 cardPlainGround(vec2 uv) { return texture2D(uFacePlainGround, uv).rgb; }
      // freshly cut metal glows, cooling within a moment; the spot under a firing head is white-hot
      vec3 cardLaserGlow(vec2 uv, float ink) {
        if (uLaserOn < 0.5) return vec3(0.0);
        float t = laserTime(uv);
        float age = (uLaserP - t) * uLaserSeconds;
        float trail = t >= 0.0 && age >= 0.0 ? exp(-age * 5.0) : 0.0;
        vec2 d = (uv - uLaserHead) * vec2(1.0, uLaserAspect);
        float r2 = dot(d, d);
        return vec3(1.0, 0.38, 0.1) * ink * trail * 3.0
          + uLaserFiring * (vec3(1.0, 0.82, 0.6) * exp(-r2 / 0.00001) * 6.0
            + vec3(1.0, 0.45, 0.15) * exp(-r2 / 0.0003) * 0.7);
      }
      `}

      // how much of the artwork's dark linework is under uv (none yet where the
      // laser hasn't been) — and the owner too, when it's etched like the artwork
      float cardInkAt(vec2 uv) {
        float lum = dot(cardArt(uv).rgb, vec3(0.299, 0.587, 0.114));
        float ink = (1.0 - smoothstep(0.12, 0.4, lum)) * cardReveal(uv) * (1.0 - cardKeepClear(uv));
        return uOwnerFinish > 1.5 ? max(ink, cardOwnerAt(uv)) : ink;
      }

      // the face where the laser hasn't been yet: the bare ground
      uniform sampler2D uLaserGround;
      vec3 cardGround(vec2 uv) { return texture2D(uLaserGround, uv).rgb; }

      // tilt the normal by a height gradient measured across the artwork
      // (per uv), not across screen pixels — smooth, so fine lines don't
      // bead. The face is flat, so this tangent frame is exact.
      vec3 cardEtchPerturb(vec3 surfPos, vec3 surfNorm, vec2 uv, vec2 dHduv) {
        vec3 q0 = dFdx(surfPos), q1 = dFdy(surfPos);
        vec2 st0 = dFdx(uv), st1 = dFdy(uv);
        vec3 q1perp = cross(q1, surfNorm), q0perp = cross(surfNorm, q0);
        vec3 T = q1perp * st0.x + q0perp * st1.x;
        vec3 B = q1perp * st0.y + q0perp * st1.y;
        float det = max(dot(T, T), dot(B, B));
        float scale = det == 0.0 ? 0.0 : inversesqrt(det);
        return normalize(surfNorm - (dHduv.x * T + dHduv.y * B) * scale);
      }
    `)
      .replace('#include <map_fragment>', /* glsl */ `// the owner's letters are die-cut out of the card
        if (cardCutAt(vMapUv) > 0.5) discard;
        vec4 cardColor = cardArt(vMapUv);
        // not yet cut: the plain ground, no linework
        if (cardReveal(vMapUv) < 0.5) cardColor.rgb = cardGround(vMapUv);
        // under the lettering: the ground, without the linework
        cardColor.rgb = mix(cardColor.rgb, cardPlainGround(vMapUv), cardKeepClear(vMapUv));
        diffuseColor *= cardColor;
        // holographic foil: a diffraction grating's rainbow, its hue set by
        // the angle between the viewer and the face, banded across it — so it
        // rolls over the card as it turns, or as the wall is dragged
        if (uFoil > 0.5) {
          vec3 foilV = normalize(vViewPosition);
          vec3 foilR = reflect(-foilV, normalize(vNormal));
          float foilHue = fract(foilR.x * 0.9 + foilR.y * 0.6 + (vMapUv.x * 0.7 + vMapUv.y * 1.3) * 1.6);
          vec3 foil = 0.5 + 0.5 * cos(6.2832 * (foilHue + vec3(0.0, 0.33, 0.67)));
          diffuseColor.rgb *= 0.25 + 0.85 * foil;
        }
        float cardSticker = 0.0;
        // the owner as its own material: ink or mirror (etched, it's part of the linework)
        float cardOwner = uOwnerFinish < 1.5 ? cardOwnerAt(vMapUv) : 0.0;
        float cardOwnerMirror = uOwnerFinish > 0.5 ? cardOwner : 0.0;
        float cardOwnerInk = cardOwner - cardOwnerMirror;
        float cardInk = 0.0;    // the artwork's linework
        float cardEtchH = 0.0;  // groove depth, 0..1
        vec2 cardEtchGrad = vec2(0.0);  // its slope across the artwork
        bool cardEtched = uEtchMode > 0.5;
        bool cardBare = cardEtched && uEtchMode < 1.5;
        {
          cardInk = cardInkAt(vMapUv);
          if (cardEtched) {
            // the groove's walls are as wide as the bevel: its slope is the
            // change in ink across that width
            vec2 o = cardTexel() * uEtchBevel;
            float l = cardInkAt(vMapUv - vec2(o.x, 0.0)), r = cardInkAt(vMapUv + vec2(o.x, 0.0));
            float d = cardInkAt(vMapUv - vec2(0.0, o.y)), u = cardInkAt(vMapUv + vec2(0.0, o.y));
            cardEtchH = max(cardInk, 0.25 * (l + r + d + u));
            cardEtchGrad = vec2(r - l, u - d) * 0.5;
          }
          // etched bare: the groove shows the plate itself, a cool silver,
          // shadowed inside the cut so each line reads as one line
          if (cardBare) {
            float shade = 1.0 - 0.55 * cardEtchH * clamp(uEtchDepth * 1.5, 0.0, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 1.02, 1.09) * uGrooveTone * shade, cardInk);
          }
          // the owner over the artwork: matte black ink, or a bright mirror polish
          diffuseColor.rgb = mix(diffuseColor.rgb, uOwnerInk, cardOwnerInk);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98), cardOwnerMirror);
          // stickers sit on top of everything
          vec4 stk = texture2D(uStickerMap, vMapUv);
          cardSticker = stk.a;
          diffuseColor.rgb = mix(diffuseColor.rgb, stk.rgb, stk.a);
        }`)
      // printed or filled ink is matte paint; a bare etched groove is frosted metal
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = cardBare
          ? mix(mix(roughnessFactor, 0.5, cardInk), 0.55, cardSticker * 0.5)
          : mix(roughnessFactor, 0.55, max(cardInk, cardSticker * 0.5));
        roughnessFactor = mix(roughnessFactor, 0.6, cardOwnerInk);
        // polished, but not so sharp the highlight shrinks to a point: it sweeps the letters as the card turns
        roughnessFactor = mix(roughnessFactor, 0.14, cardOwnerMirror);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.0, cardBare ? cardSticker : max(cardInk, cardSticker));
        metalnessFactor = mix(metalnessFactor, 0.0, cardOwnerInk);
        metalnessFactor = mix(metalnessFactor, 1.0, cardOwnerMirror);`)
      // the groove: its shoulders bend the light, so the cut catches it as the card turns
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = cardSurfaceNormal(normal, nonPerturbedNormal);
        if (cardEtched && uEtchDepth > 0.0) {
          // a cut: height falls into the ink, so the slope points out of it
          vec2 dHduv = -cardEtchGrad * uEtchDepth * 0.08 * (1.0 - cardSticker);
          normal = cardEtchPerturb(-vViewPosition, normal, vMapUv, dHduv / cardTexel());
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += cardLaserGlow(vMapUv, cardInk);
        // polished letters never go dull: a faint lift under the shine
        totalEmissiveRadiance += vec3(0.1) * cardOwnerMirror;`)
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
        clearcoatNormal = cardSurfaceNormal(clearcoatNormal, nonPerturbedNormal);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_IRIDESCENCE
          material.iridescence *= 1.0 - max(max(cardInk, cardSticker), cardOwner);
        #endif
        #ifdef USE_CLEARCOAT
          // a full, glassy clearcoat over polished letters: a second, sharper glint
          material.clearcoat = mix(material.clearcoat, 1.0, cardOwnerMirror);
          material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.02, cardOwnerMirror);
        #endif`);
  }

  /** The surface textures are recreated when the artwork's shape changes. */
  setTextures(surface: THREE.Texture, stickers: THREE.Texture) {
    this.front.map = surface;
    this.plateFront.map = surface;
    this.stickerMap.value = stickers;
    const img = surface.image as { width?: number; height?: number } | undefined;
    if (img?.width && img.height) this.etch.uMapTexel.value.set(1 / img.width, 1 / img.height);
  }

  /** The page's marks on every ticket plate, finished like the owner setting says (the caller owns the texture). */
  setPlateMarks(marks: THREE.Texture | null) {
    this.plateArt.uPlateMarks.value = marks;
  }

  /** Tiles: turn and scroll the wall by (dx, dy) in the stack's units; hold it while dragging, or let it glide on at (vx, vy). */
  scrollTiles(dx: number, dy: number) {
    this.stack.scrollBy(dx, dy);
  }


  /** Where the rest of the Helix steps aside to while a card's out: a world direction and distance. */
  setAside(world: THREE.Vector3) {
    const local = world.clone().applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion()).invert());
    this.stack.setAside(local.x, local.y, local.z);
  }

  /** how many times Helix plate i has gone round its endless spiral */
  helixLap(i: number) {
    const n = this.stackParams.count;
    return helixLap(this.stack.ringPlace(i), n, this.stackParams.twist, this.stack.flowPhase, this.stack.scrollX);
  }

  /** Tiles: how far the wall's been scrolled */
  get tilesScrollY() {
    return this.stack.scrollY;
  }

  holdTiles(held: boolean, vx = 0, vy = 0) {
    this.stack.holdScroll(held, vx, vy);
  }

  /** The pulled-out plate's artwork at full size, standing in for pool layer `layer` (null, -1: none). The caller owns the texture. */
  setFocusArt(art: THREE.Texture | null, layer: number) {
    this.plateArt.uFocusArt.value = art;
    this.plateArt.uFocusLayer.value = art ? layer : -1;
    const img = art?.image as { width: number; height: number } | undefined;
    if (img) this.plateArt.uFocusTexel.value.set(1 / img.width, 1 / img.height);
  }

  /** Which layer of the plate art plate i shows (its ticket's slot in the pool). */
  setPlateLayer(i: number, layer: number) {
    if (this.plateLayer.getX(i) === layer) return;
    this.plateLayer.setX(i, layer);
    this.plateLayer.needsUpdate = true;
  }

  /** Plates made of tickets: each hidden until its artwork is in (see StackAnimator.gate). */
  gatePlates(on: boolean) {
    this.stack.gate(on);
  }

  plateReady(i: number, ready = true) {
    this.stack.setReady(i, ready);
  }

  /**
   * A different artwork for each plate of the stack — the layers of a
   * texture array, cycled through the plates — or null to give them all the
   * card's. The caller owns the texture.
   */
  setPlateArt(art: THREE.DataArrayTexture | null) {
    this.plateArt.uPlateArt.value = art;
    this.plateArt.uPlateArtCount.value = art ? art.image.depth : 0;
    if (art) this.plateArt.uPlateTexel.value.set(1 / art.image.width, 1 / art.image.height);
  }

  /**
   * Linework printed on the metal, or etched into it: bare (the groove shows
   * frosted plate) or filled with matte black. Depth 0..1; bevel is the
   * groove's shoulder width in artwork texels.
   */
  /** Shade the stack as the Tiles drum's one smooth curve (on), or each plate as itself. */
  setTileCurve(on: boolean) {
    this.etch.uTileCurve.value = on ? 1 : 0;
  }

  /** A holographic foil over the face (on), or none. */
  setFoil(on: boolean) {
    this.etch.uFoil.value = on ? 1 : 0;
  }

  /** How light the etched grooves are: the usual pale silver, or darker on plain metal in a coloured room. */
  setGrooveTone(tone: number) {
    this.etch.uGrooveTone.value = tone;
  }

  /** How a ticket's username and number are finished: polished Mirror, printed Ink, or Etched like the artwork. */
  setOwnerFinish(finish: string) {
    this.etch.uOwnerFinish.value = finish === 'Ink' ? 0 : finish === 'Etched' ? 2 : 1;
  }

  setEtch(ink: string, depth: number, bevel: number) {
    this.etch.uEtchMode.value = ink === 'Etched' ? 1 : ink === 'Etched + filled' ? 2 : 0;
    this.etch.uEtchDepth.value = depth;
    this.etch.uEtchBevel.value = bevel;
  }

  /**
   * The cloth's surface detail — its scratch bump map (tiled by Bump
   * Tiling, which lives on the shared texture) and grain roughness — so the
   * card has the same texture. The back and edges take a lighter dose.
   */
  setDetail(normalMap: THREE.Texture | null, roughnessMap: THREE.Texture | null) {
    for (const m of [this.front, this.plateFront, this.metal, this.edge]) {
      const changed = !!m.normalMap !== !!normalMap || !!m.roughnessMap !== !!roughnessMap;
      m.normalMap = normalMap;
      m.roughnessMap = roughnessMap;
      // map presence changes the shader program
      if (changed) m.needsUpdate = true;
    }
  }

  /**
   * The back: brushed (satin, grain along the card) or a mirror polish that
   * reflects the room, its scratches nearly polished out.
   */
  setBack(finish: string) {
    const mirror = finish === 'Mirror';
    if (mirror === this.backMirror) return;
    this.backMirror = mirror;
    const m = this.metal;
    m.color.set(mirror ? '#d9dde3' : '#c3c8cf');
    m.roughness = mirror ? 0.03 : 0.38;
    m.anisotropy = mirror ? 0 : 0.8;
    m.clearcoat = mirror ? 1 : 0.3;
    m.clearcoatRoughness = mirror ? 0.02 : 0.3;
    this.setBump(this.bump);
  }

  setBump(strength: number) {
    this.bump = strength;
    this.front.normalScale.set(strength, strength);
    this.plateFront.normalScale.set(strength, strength);
    // the back takes a lighter dose; polished, hardly any
    const back = strength * (this.backMirror ? 0.1 : 0.5);
    this.metal.normalScale.set(back, back);
    // the edges carry the full scratches, like the face
    this.edge.normalScale.set(strength, strength);
  }

  /** Let go of any spin and settle front-on (the formation's own way round), not on the back. */
  faceFront() {
    this.vel = { x: 0, y: 0 };
    this.homeFront = true;
  }

  /** settling to the front only, not whichever face is nearer: until the card's next dragged */
  private homeFront = false;
  /** held still and front-on (making a ticket): no float, no spin, so stickers go where they're put */
  held = false;
  /** how far the formation rises (world units) to make room below it for an opened ticket; it eases there */
  liftGoal = 0;
  private lift = 0;

  /** Spin by a pointer drag of (dx, dy) pixels over dt seconds. */
  drag(dx: number, dy: number, dt: number) {
    if (this.held) return;
    this.homeFront = false;
    this.rot.y += dx * SPIN_PER_PX;
    this.rot.x += dy * SPIN_PER_PX;
    this.vel.y = THREE.MathUtils.clamp((dx * SPIN_PER_PX) / dt, -MAX_SPIN, MAX_SPIN);
    this.vel.x = THREE.MathUtils.clamp((dy * SPIN_PER_PX) / dt, -MAX_SPIN, MAX_SPIN);
  }

  private buildLaser() {
    const hot = { color: '#ffb27a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    // the beam: thin and bright, fading up out of the spot
    const beamGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 1.4, 8, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, 0.7);
    // the beam runs from the face up to the gantry's nozzle, no further
    beamGeo.scale(1, 1, (GANTRY_GAP - GANTRY_NOZZLE) / 1.4);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ ...hot, opacity: 0.55 }));
    const spot = new THREE.Sprite(new THREE.SpriteMaterial({ ...hot, color: '#ffffff', map: glowTexture() }));
    spot.scale.setScalar(0.09);
    spot.name = 'spot';
    this.laser.add(beam, spot, this.laserLight);
    this.laserLight.position.z = 0.04;
    this.laser.visible = false;
  }

  private buildGantry() {
    // anodised aluminium extrusion, black fittings, polished steel, and the laser's orange shield
    const alu = new THREE.MeshStandardMaterial({ color: '#c3c7c9', metalness: 0.85, roughness: 0.32 });
    const black = new THREE.MeshStandardMaterial({ color: '#191a1b', metalness: 0.35, roughness: 0.55 });
    const steel = new THREE.MeshStandardMaterial({ color: '#e4e6e6', metalness: 1, roughness: 0.16 });
    const shield = new THREE.MeshStandardMaterial({
      color: '#ff7a1a',
      metalness: 0,
      roughness: 0.15,
      transparent: true,
      opacity: 0.55,
      emissive: '#ff5a00',
      emissiveIntensity: 0.25,
      depthWrite: false,
    });
    const box = (x: number, y: number, z: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat);
    const rod = (r: number, len: number, mat: THREE.Material) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20), mat);
    // the classic yellow warning stickers, printed on canvas
    const stickers = { triangle: warningSticker('triangle'), label: warningSticker('label'), strip: warningSticker('strip') };
    const sticker = (kind: keyof typeof stickers, w: number, h: number) =>
      new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ map: stickers[kind], transparent: true, metalness: 0, roughness: 0.55 }),
      );
    this.gantry.name = 'gantry';
    this.gantry.add(this.gantryBeam, this.monitor.group);
    this.gantryBeam.add(this.gantryHead);
    this.group.add(this.gantry);
    this.layoutGantry = () => {
      const { w, h } = this.size;
      for (const g of [this.gantry, this.gantryBeam, this.gantryHead]) {
        for (const c of [...g.children]) if (c !== this.gantryBeam && c !== this.gantryHead && c !== this.monitor.group) {
          g.remove(c);
          c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        }
      }
      // just the laser module, floating over the face: no frame, no rails
      // the laser module: the finned body above the nozzle, the nozzle under
      // its orange shield, right over the spot it's cutting
      const body = box(0.11, 0.12, 0.09, black);
      body.position.set(0, 0.075, 0.02);
      const fins = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const fin = box(0.125, 0.006, 0.08, alu);
        fin.position.set(0, 0.06 + k * 0.016, 0.02);
        fins.add(fin);
      }
      const tri = sticker('triangle', 0.07, 0.07);
      tri.position.set(0, 0.06, 0.066);
      // the shield: a short orange cylinder round the nozzle, open to the face
      const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.06, 24, 1, true), shield);
      guard.rotation.x = Math.PI / 2;
      guard.position.z = -0.045;
      const nozzle = rod(0.012, GANTRY_NOZZLE, steel);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.z = -GANTRY_NOZZLE / 2 + 0.01;
      // its label on top, and the shield's glow for a lamp
      const label = sticker('label', 0.2, 0.105);
      label.position.set(0, 0.21, 0.02);
      this.gantryHead.add(body, fins, tri, guard, nozzle, label);
      this.gantryHead.scale.setScalar(GANTRY_HEAD_SCALE);
      this.gantryBeam.position.z = GANTRY_GAP;
      this.gantryLamp = guard;
      // the monitor stands off to the right, turned a little toward the card
      this.monitor.group.position.set(w / 2 + 1.75, 0, 0.5);
      this.monitor.group.rotation.y = -0.2;
    };
    this.layoutGantry();
    this.gantry.visible = false;
  }

  /** the power unit's lamp: lit while the laser's firing */
  private gantryLamp: THREE.Mesh | null = null;

  /** set the gantry's parts to the card's size */
  private layoutGantry = () => {};

  /** Show the engraver over the card (making a ticket), or put it away. */
  setGantry(on: boolean) {
    this.gantryWanted = on;
  }

  /** the gantry: lowered in or lifted away, its beam and head running after the laser */
  private updateGantry(dt: number, time: number) {
    const goal = this.gantryWanted ? 1 : 0;
    this.gantryK += THREE.MathUtils.clamp(goal - this.gantryK, -dt / GANTRY_ARRIVE, dt / GANTRY_ARRIVE);
    this.gantry.visible = this.gantryK > 0;
    if (!this.gantry.visible) return;
    const k = this.gantryK;
    const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
    // floated down from above
    this.gantry.position.y = (1 - e) * GANTRY_DROP;
    this.monitor.update(time);
    // the beam and head carry the laser: right over the spot it's cutting
    this.headAt.copy(this.headGoal);
    const { w, h } = this.size;
    this.gantryBeam.position.y = (this.headAt.y - 0.5) * h;
    this.gantryHead.position.x = (this.headAt.x - 0.5) * w;
  }

  /**
   * A ticket's lettering on the face, like the stack's: the artwork keeps
   * clear of all of it; at stage 1 the laser is cutting it (the marks
   * finished, the owner cut out of the face), at 2 it's cut through the card.
   * Null: none. The caller owns the textures.
   */
  setFaceLettering(all: THREE.Texture | null, marks: THREE.Texture | null, owner: THREE.Texture | null, stage: number) {
    const u = this.laserU;
    u.uFaceLettering.value = all;
    u.uFaceMarks.value = marks;
    u.uFaceOwner.value = owner;
    u.uFaceLetteringOn.value = all ? 1 + stage : 0;
  }

  /** The ticket's bare colour field, under its lettering where the artwork isn't (the caller owns the texture). */
  setFacePlainGround(ground: THREE.Texture | null) {
    this.laserU.uFacePlainGround.value = ground;
  }

  /** What the face looks like before the laser cuts it (the caller owns the texture). */
  setLaserGround(ground: THREE.Texture | null) {
    this.laserU.uLaserGround.value = ground;
  }

  /** The pass the laser is about to run (see laser.ts): its route, row by row, and its length. */
  setLaserPlan(times: Float32Array, cols: number, rows: number, seconds: number) {
    this.laserU.uLaserPlan.value?.dispose();
    const plan = new THREE.DataTexture(times, cols, rows, THREE.RedFormat, THREE.FloatType);
    plan.minFilter = plan.magFilter = THREE.NearestFilter;
    plan.needsUpdate = true;
    this.laserU.uLaserPlan.value = plan;
    this.laserU.uLaserSeconds.value = seconds;
  }

  /**
   * Etch the face: p 0..1 through the pass, the head at uv (u, v), firing or
   * just moving; null when the laser's done (or not running).
   */
  setLaser(p: number | null, head?: { u: number; v: number; firing: boolean }, time = 0) {
    const on = p !== null && !!head && this.laserU.uLaserGround.value !== null && this.laserU.uLaserPlan.value !== null;
    this.laserU.uLaserOn.value = on ? 1 : 0;
    this.laser.visible = on && head.firing;
    this.laserLight.intensity = 0;
    // the unit's lamp and the head's shield glow while it fires
    const glow = this.gantryLamp?.material as THREE.MeshStandardMaterial | undefined;
    if (glow) glow.emissiveIntensity = on && head.firing ? 1.6 : 0.25;
    if (!on) return;
    this.laserU.uLaserP.value = p;
    this.laserU.uLaserAspect.value = this.size.h / this.size.w;
    this.laserU.uLaserHead.value.set(head.u, head.v);
    this.headGoal.set(head.u, head.v);
    this.laserU.uLaserFiring.value = head.firing ? 1 : 0;
    this.laser.position.set((head.u - 0.5) * this.size.w, (head.v - 0.5) * this.size.h, THICKNESS / 2 + FACE_LIFT + 0.0005);
    // it flickers as it cuts
    const flicker = 0.75 + 0.25 * Math.sin(time * 97) * Math.sin(time * 61);
    this.laserLight.intensity = 0.9 * flicker;
    (this.laser.getObjectByName('spot') as THREE.Sprite).scale.setScalar(0.07 + 0.025 * flicker);
  }

  update(dt: number, time: number) {
    this.updateStack(dt);
    this.updateGantry(dt, time);
    if (this.posed) {
      this.group.rotation.copy(this.posed);
      this.group.position.copy(this.posedAt);
      return;
    }
    if (!this.dragging) {
      this.rot.x += this.vel.x * dt;
      this.rot.y += this.vel.y * dt;
      const slow = Math.exp(-SPIN_DRAG * dt);
      this.vel.x *= slow;
      this.vel.y *= slow;
      if (Math.hypot(this.vel.x, this.vel.y) < SETTLE_BELOW) {
        // face-on again, front or back, whichever is nearer (or the front, when
        // it's been asked to come home); and level
        const ease = 1 - Math.exp(-SETTLE_RATE * dt);
        const step = this.homeFront ? 2 * Math.PI : Math.PI;
        this.rot.y += (Math.round(this.rot.y / step) * step - this.rot.y) * ease;
        this.rot.x += (0 - this.rot.x) * ease;
      }
    }
    this.group.rotation.set(this.rot.x, this.rot.y, 0);
    // a slow float, so it never looks parked
    this.lift += (this.liftGoal - this.lift) * (1 - Math.exp(-4 * dt));
    this.group.position.y = (this.held ? 0 : Math.sin(time * 0.9) * 0.04) + this.lift;
  }

  /** Begin the opening: each plate's outline drawn in, then the plates over them. */
  beginIntro() {
    this.stack.beginIntro();
  }

  /** how far plate i has come in (0..1): 1 once it's in place with its ticket */
  plateShown(i: number) {
    return this.stack.plateShown(i);
  }

  /** Plates appear in place at once, without the opening or flying in (the cinematic reel). */
  setInstantPlates(on: boolean) {
    this.stack.setInstant(on);
  }

  /** the outline as a flat list of positions, for the fat lines */
  private outlinePositions() {
    return this.outlinePoints.flatMap((p) => [p.x, p.y, 0]);
  }

  /** the outlines' colour, the page's ink; their fill, a little of it over the page */
  setOutlineInk(ink: THREE.Color, paper: THREE.Color) {
    this.outlineInk.copy(ink);
    this.outlineFill.copy(paper).lerp(ink, 0.07);
    this.outlinePaper.copy(paper);
    // and what a fading plate fades into
    this.fadeU.uFadeBg.value.copy(paper);
  }

  /** each plate's outline, drawn as far as the opening has it, fading as the plate comes in over it */
  private updateOutlines() {
    // with Outlines on, every plate is drawn as its outline wherever it is, moves included
    const only = !!this.stackParams.outlines;
    const n = this.stack.collapsed ? 0 : only ? this.stackSlab.count : this.stackParams.count;
    for (let i = 0; i < Math.max(n, this.introLines.length); i++) {
      const drawn = i < n ? (only ? 1 : this.stack.outlineDrawn(i)) : 0;
      // as its plate comes down onto it an outline goes a lighter shade, and only as it lands does it go
      const coming = only ? 0 : this.stack.plateShown(i);
      // at the Helix's ends an outline fades as the cards do (only the Helix: the wall's plate fade is its tiles coming in)
      const helixNow = this.stackParams.shape === 'Helix' && this.stack.shapeNow === 'Helix';
      const endFade = helixNow && i < n ? (this.plateFade.array as Float32Array)[i] : 1;
      // on the wall there's nothing behind an outline to hide, so it's just the line: no fill
      const wall = this.stackParams.shape === 'Tiles' && this.stack.shapeNow === 'Tiles';
      const fade = drawn > 0 ? (only ? 1 : 1 - THREE.MathUtils.smoothstep(coming, 0.88, 1)) : 0;
      let line = this.introLines[i];
      let fill = this.introFills[i];
      if (fade <= 0.001) {
        if (line) line.visible = false;
        if (fill) fill.visible = false;
        continue;
      }
      if (!fill) {
        // fills write depth, so a plate's outline is hidden behind the fills in front of it
        const mat = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
        fill = this.introFills[i] = new THREE.Mesh(new THREE.ShapeGeometry(this.outlineShape!, CORNER_SEGMENTS), mat);
        fill.matrixAutoUpdate = false;
        fill.frustumCulled = false;
        this.group.add(fill);
      }
      fill.visible = !wall;
      if (only) this.stackSlab.getMatrixAt(i, fill.matrix);
      else fill.matrix.copy(this.stack.restMatrix(i) ?? fill.matrix);
      // a tint as the outline closes, easing back to the page before the plate comes
      fill.material.color.copy(this.outlineFill).lerp(this.outlinePaper, only ? 1 : this.stack.outlineSettled(i));
      fill.material.opacity = fade * endFade * THREE.MathUtils.smoothstep(drawn, 0.6, 1);
      if (!line) {
        // fat lines: WebGL draws plain lines one pixel wide whatever their width
        const geo = new LineGeometry().setPositions(this.outlinePositions());
        const mat = new LineMaterial({ transparent: true, depthWrite: false, toneMapped: false, linewidth: 1 });
        line = this.introLines[i] = new Line2(geo, mat);
        line.matrixAutoUpdate = false;
        line.frustumCulled = false;
        this.group.add(line);
      }
      line.visible = true;
      line.matrix.copy(only ? fill.matrix : this.stack.restMatrix(i) ?? line.matrix);
      // drawn as far as the opening has it, a segment at a time
      line.geometry.instanceCount = Math.ceil(drawn * (this.outlinePoints.length - 1));
      line.material.linewidth = this.stackParams.outlineWidth ?? 1;
      line.material.color.copy(this.outlineInk).lerp(this.outlinePaper, 0.55 * THREE.MathUtils.smootherstep(coming, 0.15, 0.85));
      // each outline fades in as it starts to draw, rather than appearing at full strength
      line.material.opacity = fade * endFade * THREE.MathUtils.smoothstep(drawn, 0, 0.45);
    }
  }

  private updateStack(dt: number) {
    const { w, h } = this.size;
    // a pulled-out plate past the end of a shrunk stack goes back
    const f = this.stack.focused;
    if (f !== null && f >= this.stackParams.count) this.stack.setFocus(null);
    this.stack.update(dt, [this.stackSlab, this.stackFace], this.stackParams.count, w, h, THICKNESS, this.stackParams);
    this.updatePlateFade();
    this.updateOutlines();
    // folding to one card: the card itself rises in from below as the plates
    // fly off, and once it's settled only the card is drawn
    const arrival = this.stack.singleArrival;
    this.slab.visible = this.face.visible = arrival > 0;
    this.slab.position.y = this.face.position.y = -((1 - arrival) ** 2) * StackAnimator.FLY_OFF;
    // outlines stand in for the plates (they still take hovers and clicks)
    this.stackSlab.visible = this.stackFace.visible = !this.stack.collapsed && !this.stackParams.outlines;
  }
}
