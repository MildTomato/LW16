import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Lighting, isFieldRoom } from './lighting.ts';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ClothSim, type HangMode } from './cloth.ts';
import { createHoloMaterial, type HoloUniforms } from './holoMaterial.ts';
import { SurfaceLayer, type DecalItem } from './decals.ts';
import { normalMapFromImage } from './textures.ts';
import { MacroDofPass } from './dofPass.ts';
import { BAKED_POSE } from './bakedPose.ts';
import { engineLinework } from './engineArt.ts';
import { LASER_COLS, LASER_ROWS, headAt, planPass, type LaserPlan } from './laser.ts';
import { gridSvg, growthSvg, barsSvg, asciiSvg, asciiGrid, ditherSvg, ditherGrid, pageWith, groundPage, marksPage, ownerPage, loadOwnerFont, ASCII, sampleLuminance, loadImage, fetchDataUrl } from './gridArt.ts';
import { FaceTracker } from './faceTracker.ts';
import { MetalCard } from './card.ts';
import { Titles } from './titles.ts';
// a card's ground when the room colours it: bright, plain metal
import { PLAIN_GROUND } from './tickets.ts';
import { ROLODEX_SPINE, WHEEL_SPINE, TILE_COUNT, TILE_RADIUS, tileTicket, type StackParams } from './cardStack.ts';
import {
  nextShot, shotCamera, shotLight, shotPose, nextClothShot, rolodexShot, moveProgress, shotProgress, type Shot, type ClothShot,
} from './cinematic.ts';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { HandTracker, type HandsFrame } from './handTracker.ts';
import type { TrackerStatus } from './cameraTracker.ts';
import { FaceCollider } from './faceCollider.ts';

/** Per-version snapshot of everything image-related (session-scoped). */
export interface ImagesState {
  clothImage: HTMLImageElement | null;
  decals: DecalItem[];
}

export interface HoloParams {
  performance: string;
  /** webcam hands hold the poster's corners */
  hands: boolean;
  /** the lighting setup: Studio (the original), Softbox, Strips, Window, Neon, Ring or Sunset */
  lighting?: string;
  /** Flag / Poster / Original / Face / Card */
  mode: string;
  /** the card's cinematic reel: cuts between raking shots with a light sweep */
  cinematic: boolean;
  /** the metal card: linework printed or etched, and its corners */
  card: {
    ink: string;
    etchDepth: number;
    etchBevel: number;
    corner: number;
    /** the back: Mirror or Brushed */
    back?: string;
    /** the face: plain metal the Room colours, the Printed colour field, or a holographic Foil */
    surface?: string;
    /** a ticket's username and number: Mirror, Ink or Etched */
    owner?: string;
    /** roughly how long each cinematic shot holds (s), and how dramatic its light is */
    shotLength: number;
    drama: number;
  };
  /** Card mode: dragging the card 'Spin card's it, or 'Move camera' orbits */
  drag?: string;
  /** Card mode: 'One' card, or a 'Stack' of them */
  cards?: string;
  /** copies of the card stacked into a formation, and how it moves */
  stack?: StackParams;
  physics: {
    viscosity: number;
    stiffness: number;
    iterations: number;
    smoothing: number;
    grabRadius: number;
    gravity: number;
    hang: string;
    pinSpread: number;
    wind: number;
    windDir: number;
    flutter: number;
    gust: number;
    dynamicWind: boolean;
    bend: number;
    compress: number;
    selfCollide: boolean;
    stretch: number;
    faceDepth: number;
  };
  material: {
    preset: string;
    finish: string;
    baseColor: string;
    holoIntensity: number;
    holoScale: number;
    bandFreq: number;
    saturation: number;
    hueShift: number;
    sparkle: number;
    specTint: number;
    iridescence: number;
    roughness: number;
    metalness: number;
    clearcoat: number;
    coatRoughness: number;
    sheen: number;
    bump: number;
    bumpTiling: number;
  };
  grid: {
    pattern: string;
    /** Flower: which flower is set in type */
    flower?: string;
    /** Engine: which Visual Engine system draws the artwork, or Random layers */
    engine?: string;
    /** Engine Random: how many layers */
    layers?: number;
    /** Flower: glyph size, Small to Huge */
    type?: string;
    /** Flower: set in type (ASCII) or dithered (Atkinson, Bayer, Halftone) */
    style?: string;
    /** Growth: how many halvings from Petabyte down to Prototype */
    steps: number;
    rows: number;
    depth: number;
    fill: number;
    endCircles: boolean;
    guides: boolean;
    seed: number;
  };
  images: {
    edit: boolean;
    useImage: boolean;
    scale: number;
    rotation: number;
    opacity: number;
    cornerRadius: number;
  };
  render: {
    background: string;
    exposure: number;
    environment: number;
    /** turns the lighting setup round the card, degrees */
    lightAngle?: number;
    bloom: number;
    bloomThreshold: number;
    noise: number;
    toneMapping: string;
    occlusion: boolean;
    occlusionStrength: number;
    dof: boolean;
    dofAperture: number;
    dofBlur: number;
    dofRange: number;
  };
}

/** how far (world units) the rest of the Helix steps to the left while a card is out */
const HELIX_ASIDE = 2.6;
const camQ = new THREE.Quaternion(), camQe = new THREE.Quaternion(), camU0 = new THREE.Vector3(), camU1 = new THREE.Vector3();
const IDENTITY_Q = new THREE.Quaternion();
/** how much of the view's height a shown card fills */
const PLATE_FILL = 0.66;
const asideDir = new THREE.Vector3();
/** how far the Tiles wall fades out behind a pulled-out tile */
const TILE_VEIL = 0.7;
/** how far ahead of the camera the veil hangs: nearer than any of the wall in view */
const TILE_VEIL_DIST = 3;
/** seconds the veil takes to fade in, or out */
const VEIL_TIME = 0.4;
/** Tiles is lit up: its wall faces inward, away from most of the room's light */
const TILES_LIGHT = 1.45;
/** how far (radians) the Tiles wall's light is turned round from the Helix's */
const TILES_LIGHT_TURN = THREE.MathUtils.degToRad(-134);
/** and how far (radians) its light is tipped up toward the top of the wall */
const TILES_LIGHT_TIP = 0.55;
/** Tiles is seen from inside its drum, looking at the wall ahead */
const TILES_VIEW = {
  // back from the middle toward the far wall, for more of it in view
  camera: [0, 0, 1.6] as [number, number, number],
  target: [0, 0, -2] as [number, number, number],
  fov: 56,
};
/** how much of the view's height the card fills while a ticket's being made */
const FRONT_FILL = 0.58;
/** and how far right of the card the view's centred, for the monitor */
const FRONT_SHIFT = 0.8;
/** the lens everywhere else */
const LENS_FOV = 38;
/** the view a page opens on, unless its link carries one */
const DEFAULT_VIEW = {
  camera: [7.005, 1.436, -4.691] as [number, number, number],
  target: [0, -0.046, -0.034] as [number, number, number],
};
const TONE_MAPPINGS: Record<string, THREE.ToneMapping> = {
  AgX: THREE.AgXToneMapping,
  ACES: THREE.ACESFilmicToneMapping,
  Neutral: THREE.NeutralToneMapping,
};

/** the Flower artwork's photos: each a single stem on solid black */
/** room for this many tickets in the stack, each at this size (a 2:3 page) */
/**
 * The plate art pool: one for both views, so switching between them reloads
 * nothing — the Helix's few tickets and the wall's on-screen ones fit — and
 * a pulled-out card, filling the view, gets its own at full size (FOCUS_ART)
 */
const POOL = { count: 64, w: 480, h: 720 };
const POOLS = { Helix: POOL, Tiles: POOL };
const FOCUS_ART = { w: 1000, h: 1500 };
/** how far round the view (stack units) a wall card still counts as on screen: about a card */
const TILE_VIEW_MARGIN = 1.6;
const viewFrustum = new THREE.Frustum();
const viewMatrix = new THREE.Matrix4();
const viewSphere = new THREE.Sphere();
type PoolKind = keyof typeof POOLS;
/** how long before a ticket image that failed to load is tried again */
const TICKET_RETRY_MS = 5000;
/** tickets are fetched this many at a time (two rows of the Tiles wall), as they come into view */
const TICKET_PAGE = 48;
/** the Helix shows the latest of the tickets, at most this many */
const HELIX_TICKETS = 40;
/** the laser's lettering passes, before the artwork's: the owner's number, then their name */
const LETTER_PASSES = 2;
/** how far (radians) the Rolodex turns for a pixel dragged across it */
const ROLODEX_SPIN_PER_PX = 0.006;
/** and how fast (radians a second) it can be flicked to glide */
const ROLODEX_MAX_SPIN = 6;
/** how often the Rolodex's reel cuts to a detail of one card, rather than the whole fan */
const ROLODEX_DETAIL = 0.5;
/** the wall in the reel: how far (rows, either side of the middle) its shots stay, and how fast it scrolls on (units a second) */
const TILE_CINE_ROWS = 1.4;
const TILE_CINE_SCROLL = 0.18;
/** the Rolodex is a loose handful of them, open wide enough to see each */
const ROLODEX_TICKETS = 16;
/** the Wheel is a turn of them round its spine, spaced enough to see each */
const WHEEL_TICKETS = 16;
/** how many cards each formation starts with when picked from the view switch; the panel's Count can change it after */
export const SHAPE_TICKETS: Record<string, number> = { Rolodex: ROLODEX_TICKETS, Wheel: WHEEL_TICKETS, Helix: HELIX_TICKETS };
/** a ticket for the stack: its image (its linework alone) and its owner's username */
type TicketSource = { id: string; url: string; owner: string; number: number };
/** a slot of the plate art: which ticket's image it holds, whether that's in, and when it was last on a plate */
type TicketSlot = { id: string | null; ready: boolean; used: number };
/** a drawn ticket, as the laser cuts it: its stages, and its lettering (all of it, its marks, its owner, and over the artwork) */
type TicketCut = {
  stages: HTMLImageElement[];
  lettering: HTMLImageElement;
  marks: HTMLImageElement;
  owner: HTMLImageElement | null;
  lettered: HTMLImageElement;
  /** the same on plain metal, for the Room surface */
  plain?: { stages: HTMLImageElement[]; lettered: HTMLImageElement };
  /** the design it's drawn from, layer by layer */
  design?: { system: string; seed: number }[];
  /** the whole artwork's linework, for the monitor */
  ink?: HTMLImageElement;
  /** the linework alone, for the screen: built up a layer at a time, and each layer on its own */
  inkStages?: HTMLImageElement[];
  layerInks?: HTMLImageElement[];
  /** the artwork's layers, as the engine made them (each names its generator) */
  composition?: unknown[];
  /** the owner a line at a time: the laser cuts the number, then the name */
  ownerNumber?: HTMLImageElement | null;
  ownerName?: HTMLImageElement | null;
};
/**
 * The laser cutting a ticket: which pass of how many (the last is the
 * lettering), how far through it, where the head is (the card's uv), and
 * whether it's firing.
 */
export interface LaserStatus {
  pass: number;
  passes: number;
  progress: number;
  u: number;
  v: number;
  firing: boolean;
}
const newCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
};
const svgImage = (svg: string) => loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);


/** how far a pulled-out plate leans toward a cursor at the edge of the view (radians), and how fast it follows */
const PLATE_LEAN = THREE.MathUtils.degToRad(10);
const PLATE_LEAN_RATE = 6;

/** how far (px) the pointer can stray from a hovered plate before it settles back */
const HOVER_HOLD_PX = 40;

/** out of focus, a frame every this many ms: 30 a second */
const BLURRED_FRAME_MS = 1000 / 30;
/** the longest step a frame takes (s), however long it was since the last */
const MAX_DT = 0.1;

/** A view from the link (?cam=x,y,z&target=x,y,z), if it has a whole one. */
function readCameraUrl() {
  const params = new URLSearchParams(window.location.search);
  const vec = (key: string) => {
    const n = (params.get(key) ?? '').split(',').map(Number);
    return n.length === 3 && n.every(Number.isFinite) ? new THREE.Vector3(n[0], n[1], n[2]) : null;
  };
  const cam = vec('cam'), target = vec('target');
  return cam && target ? { cam, target } : null;
}

/** The view into the link, leaving every other param as it is. */
function writeCameraUrl(cam: THREE.Vector3, target: THREE.Vector3) {
  const params = new URLSearchParams(window.location.search);
  const fmt = (v: THREE.Vector3) => [v.x, v.y, v.z].map((n) => +n.toFixed(3)).join(',');
  params.set('cam', fmt(cam));
  params.set('target', fmt(target));
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
}

const flowerSrc = (name: string) =>
  `/artwork/flowers/${name.toLowerCase()}.jpg`;

const CLOTH_LONG_SIDE = 3;
/** seconds for the camera to move in on a pulled-out plate, or back */
const PLATE_CAM_TIME = 0.9;
// Hands: the camera frame maps onto this world width, centred this high
const HOLD_SPAN = 3.2;
const HOLD_CENTER_Y = 1.0;
/** hand size (wrist to middle knuckle, share of frame height) when far / near */
const HAND_FAR = 0.12;
const HAND_NEAR = 0.32;
/** how far the held corner sits from the wall, far hand to near hand */
const HOLD_Z_FAR = -0.6;
const HOLD_Z_NEAR = 0.9;
/** sticker width as a fraction of cloth width */
const STICKER_SCALE = 0.26;
const CLOTH_SEGMENTS = 48;
const WHITE = new THREE.Color(0xffffff);


const GrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 0.08 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uTime;
    varying vec2 vUv;
    // sinless hash (Dave Hoskins style): sin-based hashes lose precision at
    // large arguments on some ANGLE backends (Chrome on Windows/Metal) and
    // collapse into marching bands — this one stays white noise everywhere
    float gHash(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // coords wrapped to keep magnitudes float32-safe; time is a hash
      // dimension, not an offset, so no pattern travels between frames
      vec2 p = mod(gl_FragCoord.xy, 1024.0);
      float n = gHash(vec3(p, mod(uTime * 120.0, 512.0))) - 0.5;
      c.rgb += n * uAmount;
      gl_FragColor = c;
    }
  `,
};

export class HoloApp {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private dofPass: MacroDofPass;
  private grainPass: ShaderPass;
  private cavityAttr!: THREE.BufferAttribute;
  private sim!: ClothSim;
  private clothMesh: THREE.Mesh;
  private card: MetalCard;
  private cardMode = false;
  /** px of the canvas's right edge the panel covers; the view centres in the rest */
  private viewInset = 0;
  private panelCheck = 0;
  private revealed = false;
  private cardDragId: number | null = null;
  private cardLast = { x: 0, y: 0, t: 0 };
  /** a press on the stack that may turn out to be a click: on a plate, or on nothing */
  private plateClick: { id: number; x: number; y: number; plate: number | null } | null = null;
  /**
   * The camera's move in on a pulled-out plate: 0 at rest, 1 framing it.
   * `rest` is where it was before, to go back to.
   */
  private plateCam = { k: 0, rest: null as { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 } | null };
  /** the card's cinematic reel: the shot on screen, and the camera to go back to */
  private cine: {
    /** a card shot, in Card mode */
    shot: Shot | null;
    /** a cloth shot, in the other modes */
    cloth: ClothShot | null;
    /** which the current shot is of, to cut when the mode changes */
    forCard: boolean;
    /**
     * a shot of one plate of the stack: which spot it's on (so the camera
     * can follow it as the formation moves), and where that spot was when
     * the shot was framed
     */
    plate: { i: number; u: number; v: number; start: THREE.Vector3 } | null;
    t0: number;
    saved: { position: THREE.Vector3; target: THREE.Vector3 };
  } | null = null;
  /** the reel's focus distance, eased so it doesn't flicker between plates */
  private cineFocusDist = 0;
  private cinePose = new THREE.Euler();
  private cinePos = new THREE.Vector3();
  private cineFocus = new THREE.Vector3();
  private shotLength = 2.2;
  /** 0..1: how dark the room goes and how hot the strip light is while the reel runs */
  private drama = 0.7;
  /** the reel's strip light, placed per shot so its reflection sweeps the face */
  private cineLight: THREE.RectAreaLight | null = null;
  private lighting: Lighting;
  private cameraUrlTimer: number | null = null;
  /** the pulled-out plate's lean toward the cursor, now (radians) */
  private plateLean = new THREE.Vector2();
  /** the plate held as hovered, and where the pointer last touched it (NDC) */
  private hovered: number | null = null;
  private hoverAt = new THREE.Vector2();
  /** the direct lights, turned with the environment by Light Angle */
  private lightRig = new THREE.Group();
  private rectLightsReady = false;
  private clothGeometry!: THREE.BufferGeometry;
  private holoUniforms: HoloUniforms;
  private holoMaterial: THREE.MeshPhysicalMaterial;
  private surface: SurfaceLayer;
  private bumpSource: HTMLImageElement | null = null;
  private thumbCache = new WeakMap<HTMLImageElement, string>();
  private perfProfile = 'High';
  private clothSegments = CLOTH_SEGMENTS;
  private currentPR = Math.min(window.devicePixelRatio, 2);
  private background = new THREE.Color('#0b0c12');
  private clock = new THREE.Clock();
  private elapsed = 0;
  /** the window has focus; without it the loop runs cheaper (fewer frames, no hover) */
  private focused = document.hasFocus();
  /** the out-of-focus loop: a timer, so the page isn't woken every display frame */
  private slowLoop: number | null = null;
  /** the pointer is over the canvas: only then is there anything to hover */
  private pointerOver = false;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private dragPlane = new THREE.Plane();
  private grabbing = false;
  private grabPointerId: number | null = null;
  private draggingDecal = false;
  private decalGrabOffset = { u: 0, v: 0 };
  private pickingFocus = false;
  private focusVertex: number | null = null;
  private pickReleaseId: number | null = null;
  private spaceHeld = false;
  private focusTmp = new THREE.Vector3();
  private editMode = false;
  private prevUseImage = false;
  private hoverCursor = 'default';
  private resizeObserver: ResizeObserver;
  private params: HoloParams | null = null;
  private disposed = false;

  /** App-level hook: fired when a decal is selected or resized via wheel. */
  onDecalSelect: ((scale: number, rotation: number) => void) | null = null;
  /** App-level hook: any uploaded image (cloth/decal/bump) changed. */
  onImagesChanged: (() => void) | null = null;
  /** the laser's state while it cuts a ticket (a few times a second), and null when it's done */
  onLaser: ((s: LaserStatus | null) => void) | null = null;
  private laserReported = 0;
  /** App-level hook: a sticker was peeled off the cloth; the app carries it from here. */
  onStickerPick: ((item: DecalItem, e: PointerEvent) => void) | null = null;
  /** App-level hook: face tracking state, for the on-screen notice */
  onFaceStatus: ((status: TrackerStatus | null) => void) | null = null;
  /** App-level hook: hand tracking state, for the on-screen notice */
  onHandStatus: ((status: TrackerStatus | null) => void) | null = null;
  /** webcam hands holding the poster's corners (Hands on) */
  private handTracker: HandTracker | null = null;
  private latestHands: HandsFrame | null = null;
  /** each top corner's held position, eased toward the hand (or back to the wall) */
  private grips: ({ x: number; y: number; z: number } | null)[] = [null, null];
  /** webcam tracking while the cloth lies over your face (Face mode) */
  private faceTracker: FaceTracker | null = null;
  private faceCollider = new FaceCollider();
  /** stickers mid slap-down, animating their pop back to 1 */
  private slaps: { item: DecalItem; t0: number }[] = [];
  /** last grid settings applied; a change regenerates the cloth art */
  private gridKey = '';
  private gridJob = 0;
  private gridTimer: number | null = null;
  private gridField: Promise<string> | null = null;
  /** the tickets the stack is made of, oldest first: plate i is ticket i */
  /**
   * The tickets, in number order — only those fetched so far, by their place
   * in that order: how many there are, and a page of them is fetched as its
   * rows come into view
   */
  private ticketTotal = 0;
  private ticketAt = new Map<number, TicketSource>();
  private ticketIndex = new Map<string, number>();
  private fetchTicketRange: ((from: number, to: number) => Promise<TicketSource[]>) | null = null;
  private pagesAsked = new Set<number>();
  /**
   * The plate art is a pool of slots, each holding one ticket's image:
   * plates show whichever tickets are in view, each from its slot, and a
   * slot long out of view is reused — so any number of tickets can scroll by.
   */
  private slots: TicketSlot[] = [];
  /** which pool the plate art is now */
  private pool: PoolKind | null = null;
  private slotOf = new Map<string, number>();
  /** which ticket each plate shows */
  private plateTickets: (string | null)[] = [];
  private slotFrame = 0;
  /** tickets whose image just failed to load, and when */
  private ticketFailed = new Map<string, number>();
  /** a ticket to pull out once its plate is in */
  private pendingShow: string | null = null;
  private ticketArt: THREE.DataArrayTexture | null = null;
  private ticketCtx: CanvasRenderingContext2D | null = null;
  private ticketGroundImg: Promise<HTMLImageElement> | null = null;
  /** whether the cards print their colour field (off in the Field room, which lights them with it) */
  private groundPrinted = true;
  /** the pulled-out card's full-size artwork, and the job drawing it */
  private focusArt: THREE.DataTexture | null = null;
  private focusJob = 0;
  /** scratch canvases for laying a ticket's layers together, at the size last used */
  private composeSize = '';
  private composeCtx: CanvasRenderingContext2D[] | null = null;
  private ownerCtx: CanvasRenderingContext2D | null = null;
  private marksCtx: CanvasRenderingContext2D | null = null;
  /** the page's marks on the stack's plates (the same on every ticket) */
  private plateMarks: THREE.Texture | null = null;
  private inkCtx: CanvasRenderingContext2D | null = null;
  private ticketMarksImg: Promise<HTMLImageElement> | null = null;
  /** a ticket is being made on the card; the laser's progress through cutting it (null: not cutting) */
  private ticketing = false;
  /** the stack is the Tiles sheet: dragged and scrolled, not orbited */
  private tilesView = false;
  /** the Rolodex is up: dragging spins it on its spine */
  private rolodexView = false;
  /** LW and 16, either side of the stack */
  private titles = new Titles();
  private titleInk = new THREE.Color();
  /** whether the stack's opening has run */
  private opened = false;
  /** the view the camera is framed for: the stack's, Tiles, or square on to the card being made */
  private view = 'Helix';
  /**
   * Tiles: a veil in the background's colour, just in front of the wall,
   * so the wall fades out while a tile is looked at
   */
  private veil = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }),
  );
  private veilK = 0;
  /** each setup light's own intensity (stepped back on the Tiles wall) */
  private lightBase = new Map<THREE.Light, number>();
  /** how much brighter the view is lit (Tiles is turned up), eased */
  private viewLight = 1;
  private tileDrag: { id: number; x: number; y: number; t: number; vx: number; vy: number } | null = null;
  /** the camera easing to a view: from, to, and how far (0..1) */
  private camMove: { from: [THREE.Vector3, THREE.Vector3, number]; to: [THREE.Vector3, THREE.Vector3, number]; k: number } | null = null;
  private etch: number | null = null;
  /** the ticket's stages, ground first, and the pass the laser is on (cutting stage pass + 1) */
  private etchStages: HTMLImageElement[] = [];
  private etchPass = 0;
  /** this card's number and name are cut (a new design only needs its artwork cut again) */
  private lettersCut = false;
  /** the laser's only cutting a new name into a finished card, then stopping */
  private letterOnly = false;
  /** every pass the laser makes: the number, the name, then each layer of the artwork */
  private get etchPasses() {
    return LETTER_PASSES + this.etchStages.length - 1;
  }
  /** the ticket's lettering: all of it, its marks, its owner, and over the finished artwork (to plan its pass) */
  private etchCut: TicketCut | null = null;
  private letteringTexs: (THREE.Texture | null)[] = [];
  /** the ticket's bare colour field: what shows under the lettering, where the artwork isn't */
  private plainGroundTex: THREE.Texture | null = null;
  private etchPlan: LaserPlan | null = null;
  private ticketGround: THREE.Texture | null = null;
  /** a photo uploaded for the Flower artwork, in place of the chosen flower; and a count that changes with it */
  private flowerUpload: string | null = null;
  private flowerVersion = 0;
  private lastFlower: string | undefined;
  private originalArt: Promise<HTMLImageElement> | null = null;

  constructor(private host: HTMLElement) {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // MSAA happens on the composer's render target
      powerPreference: 'high-performance',
      stencil: false,
      alpha: true, // transparent-background export
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = this.background;
    this.camera = new THREE.PerspectiveCamera(LENS_FOV, width / height, 0.1, 200);
    this.camera.position.set(...BAKED_POSE.camera);

    // image-based lighting and direct lights, by setup (Studio: a neutral
    // room, a cool rim, a warm rim and a white key)
    this.lighting = new Lighting(this.renderer);
    this.scene.environment = this.lighting.use('Studio');
    for (const light of this.lighting.lights) this.lightBase.set(light, light.intensity);
    // the Field room is painted with the page's colour field: once it's in,
    // use it if that's the setup asked for
    loadImage('/artwork/field.png')
      .then((img) => {
        if (this.disposed) return;
        this.lighting.setField(img);
        if (isFieldRoom(this.params?.lighting ?? 'Studio')) {
          this.lighting.current = '';
          if (this.params) this.applyParams(this.params);
        }
      })
      .catch((err) => console.warn('[holocloth] the Field room has no field; Studio stands in', err));
    this.lightRig.add(...this.lighting.lights);
    this.scene.add(this.lightRig);

    // surface layer (uploaded graphics) + cloth
    this.surface = new SurfaceLayer();
    const holo = createHoloMaterial(this.surface.texture, this.surface.stickerTexture);
    this.holoMaterial = holo.material;
    this.holoUniforms = holo.uniforms;
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    if (this.holoMaterial.roughnessMap) this.holoMaterial.roughnessMap.anisotropy = maxAniso;
    this.surface.texture.anisotropy = maxAniso;
    this.surface.stickerTexture.anisotropy = maxAniso;

    // the artwork as a metal card (Card mode), sized with the cloth
    this.card = new MetalCard(this.surface.texture, this.surface.stickerTexture);
    this.scene.add(this.card.group);
    this.scene.add(this.titles.group);
    this.card.setDetail(this.holoMaterial.normalMap, this.holoMaterial.roughnessMap);

    this.clothMesh = new THREE.Mesh(undefined, this.holoMaterial);
    this.clothMesh.frustumCulled = false;
    // hidden until the app has loaded its assets and calls reveal()
    this.clothMesh.visible = false;
    this.buildCloth(1);
    this.scene.add(this.clothMesh);

    // interaction listeners BEFORE OrbitControls so grabs win the pointer
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('focus', this.onWindowFocus);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.6;
    this.controls.maxDistance = 30;
    // the opening view: low, from behind and to the right, so the stack's
    // die-cut edges catch the light
    this.camera.position.set(...DEFAULT_VIEW.camera);
    this.controls.target.set(...DEFAULT_VIEW.target);
    // a link can carry a view: ?cam=x,y,z&target=x,y,z
    const view = readCameraUrl();
    if (view) {
      this.camera.position.copy(view.cam);
      this.controls.target.copy(view.target);
    }
    this.controls.update();
    // and moving the view writes it back, once it settles — only your own
    // moves: the reel and a focused plate drive the camera without controls
    this.controls.addEventListener('change', () => {
      if (this.cameraUrlTimer !== null) window.clearTimeout(this.cameraUrlTimer);
      this.cameraUrlTimer = window.setTimeout(() => {
        this.cameraUrlTimer = null;
        // only the stack's own view, as you've left it: not the ticket-making view,
        // the wall, or a move between views (a reload would open on those)
        if (this.cine || this.plateCam.k > 0 || this.disposed) return;
        if (this.ticketing || this.tilesView || this.camMove) return;
        writeCameraUrl(this.camera.position, this.controls.target);
      }, 400);
    });

    // post: MSAA + half-float HDR chain, bloom, tonemap+sRGB, grain
    const rt = new THREE.WebGLRenderTarget(width, height, {
      samples: 8,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.dofPass = new MacroDofPass(this.scene, this.camera);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.18, 0.85, 1.0);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.grainPass = new ShaderPass(GrainShader);
    this.composer.addPass(this.grainPass);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(host);

    this.runLoop();

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__holo = this;
    }
  }

  private clothAspect = 1;

  /** (Re)build the sim + geometry for a given aspect ratio (w/h). */
  private buildCloth(aspect: number) {
    this.clothAspect = aspect;
    const w = aspect >= 1 ? CLOTH_LONG_SIDE : CLOTH_LONG_SIDE * aspect;
    const h = aspect >= 1 ? CLOTH_LONG_SIDE / aspect : CLOTH_LONG_SIDE;
    const segs = this.clothSegments;
    const segX = aspect >= 1 ? segs : Math.max(10, Math.round(segs * aspect));
    const segY = aspect >= 1 ? Math.max(10, Math.round(segs / aspect)) : segs;
    this.sim = new ClothSim(w, h, segX, segY);
    this.card.setSize(w, h);
    // a fresh sim starts free-floating: hold it the way the panel says, or a
    // rebuild (performance switch, new image shape) drops the flag/poster
    if (this.params) {
      this.sim.setPinSpread(this.params.physics.pinSpread);
      this.sim.setHang(this.params.physics.hang as HangMode);
    }
    if (this.faceTracker) this.sim.setCollider(this.faceCollider);
    const geo = new THREE.PlaneGeometry(w, h, segX, segY);
    const posAttr = new THREE.BufferAttribute(this.sim.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    this.cavityAttr = new THREE.BufferAttribute(new Float32Array(this.sim.count), 1);
    this.cavityAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCavity', this.cavityAttr);
    geo.computeVertexNormals();
    const old = this.clothMesh.geometry;
    this.clothMesh.geometry = geo;
    this.clothGeometry = geo;
    if (old) old.dispose();
    this.holoUniforms.uClothSize.value.set(w, h);
    this.focusVertex = null; // vertex indices are invalid after a rebuild
    this.cancelInteraction();
  }

  /** Fully tear down any in-flight grab/decal drag (e.g. cloth rebuilt). */
  private cancelInteraction() {
    if (this.grabPointerId !== null &&
        this.renderer.domElement.hasPointerCapture(this.grabPointerId)) {
      this.renderer.domElement.releasePointerCapture(this.grabPointerId);
    }
    this.grabbing = false;
    this.draggingDecal = false;
    this.grabPointerId = null;
    this.sim.endGrab();
    // buildCloth also runs in the constructor, before controls exist
    if (this.controls) this.controls.enabled = true;
  }

  applyParams(p: HoloParams) {
    this.params = p;
    this.updateGridArt(p.grid);
    // spread first: setHang pins at the current spread
    this.sim.setPinSpread(p.physics.pinSpread);
    this.sim.setHang(p.physics.hang as HangMode);
    this.setFaceTracking(p.physics.hang === 'Face');
    this.setHandTracking(!!p.hands);
    this.setCardMode(p.mode === 'Card');
    if (p.card) {
      this.card.setEtch(p.card.ink, p.card.etchDepth, p.card.etchBevel);
      this.card.setOwnerFinish(p.card.owner ?? 'Etched');
      this.card.setCorner(p.card.corner);
      this.card.setBack(p.card.back ?? 'Mirror');
    }
    this.applyStack();
    this.drama = p.card?.drama ?? 0.7;
    this.setCinematic(!!p.cinematic, p.card?.shotLength ?? 2.2);
    this.faceCollider.depth = p.physics.faceDepth;
    if (p.performance !== this.perfProfile) this.applyPerfProfile(p.performance);
    const m = this.holoMaterial;
    m.color.set(p.material.baseColor);
    m.roughness = p.material.roughness;
    m.metalness = p.material.metalness;
    m.clearcoat = p.material.clearcoat;
    m.clearcoatRoughness = p.material.coatRoughness;
    m.sheen = p.material.sheen;
    // sheen fibers carry the dye color, halfway toward white at the rim
    m.sheenColor.set(p.material.baseColor).lerp(WHITE, 0.5);
    m.iridescence = p.material.iridescence;
    m.normalScale.set(p.material.bump, p.material.bump);
    this.card.setBump(p.material.bump);
    if (m.normalMap) m.normalMap.repeat.set(p.material.bumpTiling, p.material.bumpTiling);
    // material.envMapIntensity is ignored when lighting comes from
    // scene.environment — the renderer reads scene.environmentIntensity
    this.scene.environmentIntensity = p.render.environment;
    if ((p.lighting ?? 'Studio') !== this.lighting.current) this.useLighting();
    // the card's surface: plain metal the room colours, the printed colour
    // field, or a holographic foil; plates are drawn again when it changes
    const surface = p.card?.surface ?? 'Room';
    const printed = surface === 'Printed';
    this.card.setFoil(surface === 'Foil');
    // on plain metal the grooves cut darker, so the linework reads against the room's colour
    this.card.setGrooveTone(printed ? 0.55 : 0.22);
    if (printed !== this.groundPrinted) {
      this.groundPrinted = printed;
      this.pool = null;
      this.applyStack();
    }
    // turning the setup round the card slides its reflections across the metal
    const turn = THREE.MathUtils.degToRad(p.render.lightAngle ?? 0);
    this.scene.environmentRotation.y = turn;
    this.lightRig.rotation.y = turn;

    const u = this.holoUniforms;
    u.uHoloIntensity.value = p.material.holoIntensity;
    u.uHoloScale.value = p.material.holoScale;
    u.uBandFreq.value = p.material.bandFreq;
    u.uSaturation.value = p.material.saturation;
    u.uHueShift.value = p.material.hueShift;
    u.uSparkle.value = p.material.sparkle;
    u.uSpecTint.value = p.material.specTint;
    u.uSurfaceOpacity.value = p.images.opacity;
    u.uCornerRound.value = p.images.cornerRadius;

    this.background.set(p.render.background);
    this.renderer.toneMappingExposure = p.render.exposure;
    const tm = TONE_MAPPINGS[p.render.toneMapping] ?? THREE.AgXToneMapping;
    if (this.renderer.toneMapping !== tm) this.renderer.toneMapping = tm;
    this.applyBloom();
    this.grainPass.uniforms.uAmount.value = p.render.noise;
    u.uCavityAmount.value = p.render.occlusion ? p.render.occlusionStrength : 0;
    this.dofPass.enabled = p.render.dof;
    this.dofPass.setParams(p.render.dofAperture * 1e-2, p.render.dofBlur, p.render.dofRange * 0.5);

    this.editMode = p.images.edit;
    this.controls.enableZoom = !this.editMode;

    // the useImage toggle doubles as the image-as-cloth state indicator;
    // edge-triggered so a stale false from a mid-upload render can't wipe
    // a freshly set image
    if (this.prevUseImage && !p.images.useImage && this.surface.clothImage) {
      this.removeClothImage();
    }
    this.prevUseImage = p.images.useImage;

    // sliders drive the selected decal
    const sel = this.surface.selected;
    if (sel && (sel.scale !== p.images.scale || sel.rotation !== p.images.rotation)) {
      sel.scale = p.images.scale;
      sel.rotation = p.images.rotation;
      this.surface.redraw();
    }
  }

  /**
   * Original = the hand-drawn construction; Generated = the power-of-two
   * grid built from these settings. Debounced, and stale results dropped,
   * so dragging a slider doesn't queue up renders.
   */
  private updateGridArt(g: HoloParams['grid']) {
    // a ticket in the making owns the card's face
    if (!g || this.ticketing) return;
    const generated = g.pattern === 'Generated' || g.pattern === 'Growth' || g.pattern === 'Bars' || g.pattern === 'Flower' || g.pattern === 'Engine';
    const key = g.pattern === 'Generated'
      ? ['Generated', g.rows, g.depth, g.fill, g.endCircles, g.guides, g.seed].join('|')
      : g.pattern === 'Growth'
        ? ['Growth', g.steps, g.guides].join('|')
        : g.pattern === 'Engine' ? `Engine|${g.engine}|${g.seed}|${g.layers}`
        : g.pattern === 'Flower' ? `Flower|${g.flower}|${g.style}|${g.type}|${this.flowerVersion}`
        : g.pattern === 'Bars' ? 'Bars' : 'Original';
    if (key === this.gridKey) return;
    // picking a flower from the list replaces an uploaded photo
    if (g.flower !== this.lastFlower && this.lastFlower !== undefined) this.flowerUpload = null;
    this.lastFlower = g.flower;
    const first = this.gridKey === '';
    this.gridKey = key;
    // at boot the app is already loading the original as the startup image
    if (first && !generated) return;
    const job = ++this.gridJob;
    if (this.gridTimer !== null) window.clearTimeout(this.gridTimer);
    this.gridTimer = window.setTimeout(() => {
      this.gridTimer = null;
      const art = generated
        ? this.generateGridArt(g)
        : (this.originalArt ??= loadImage('/artwork/construction.svg'));
      art.then((img) => {
        if (job !== this.gridJob || this.disposed) return;
        this.swapClothArt(img);
      }).catch((err) => console.error('[holocloth] grid art failed', err));
    }, 90);
  }

  /**
   * How many tickets there are, and how to fetch a range of them (in number
   * order) — only what's about to be shown is. Each plate stays hidden until
   * its ticket's image is in, then drops into place — never a plate without
   * its own ticket.
   */
  setTickets(total: number, fetch: (from: number, to: number) => Promise<TicketSource[]>) {
    this.ticketTotal = total;
    this.fetchTicketRange = fetch;
    this.ticketAt.clear();
    this.ticketIndex.clear();
    this.pagesAsked.clear();
    this.card.gatePlates(true);
    this.applyStack();
  }

  /** the ticket at place k in number order, if fetched; if not, its page is asked for */
  private ticketAtPlace(k: number) {
    const t = this.ticketAt.get(k);
    if (!t) this.askPage(Math.floor(k / TICKET_PAGE));
    return t;
  }

  /** Fetch a page of tickets (once); a failed page is asked for again after a pause. */
  private askPage(page: number) {
    if (!this.fetchTicketRange || this.pagesAsked.has(page)) return;
    this.pagesAsked.add(page);
    const from = page * TICKET_PAGE;
    this.fetchTicketRange(from, from + TICKET_PAGE - 1)
      .then((list) => {
        if (this.disposed) return;
        list.forEach((t, j) => this.putTicket(from + j, t));
        this.assignPlates();
      })
      .catch((err) => {
        console.warn('[holocloth] a page of tickets failed; asking again shortly', err);
        window.setTimeout(() => this.pagesAsked.delete(page), TICKET_RETRY_MS);
      });
  }

  private putTicket(k: number, t: TicketSource) {
    this.ticketAt.set(k, t);
    this.ticketIndex.set(t.id, k);
  }


  /**
   * Making a ticket happens on the card itself: the stack folds down to the
   * one card, and each new artwork is cut into it by the laser.
   */
  beginTicket() {
    if (this.ticketing) return;
    this.ticketing = true;
    this.lettersCut = false;
    this.focusPlate(null);
    // a blank card: nothing on it until the laser cuts the new artwork in
    this.surface.setClothImage(null);
    this.onImagesChanged?.();
    // and the engraver lowered over it
    this.card.setGantry(true);
    this.applyStack();
  }

  /**
   * Cut a ticket into the card, a pass of the laser per stage: from the bare
   * ground, each engine layer in turn; and last its lettering (the page's
   * marks, the owner's username and number), cut in the lettering's own
   * finish — its own layer, never part of the artwork.
   */
  etchTicket(cut: TicketCut) {
    // cut on the card the stack is made of: plain metal unless the Surface is printed
    const t = !this.groundPrinted && cut.plain ? { ...cut, stages: cut.plain.stages, lettered: cut.plain.lettered } : cut;
    if (!this.ticketing || t.stages.length < 2) return;
    this.etchStages = t.stages;
    this.etchCut = t;
    this.plainGroundTex?.dispose();
    this.plainGroundTex = new THREE.Texture(t.stages[0]);
    this.plainGroundTex.colorSpace = THREE.SRGBColorSpace;
    this.plainGroundTex.needsUpdate = true;
    this.card.setFacePlainGround(this.plainGroundTex);
    this.letterOnly = false;
    // a new design on a card whose number and name are already cut: only the artwork's cut again
    if (this.lettersCut) {
      this.etchPass = LETTER_PASSES;
      this.setLettering(true, true);
    } else {
      this.etchPass = 0;
      this.setLettering(false);
    }
    this.startPass();
    this.showOnMonitor();
  }

  /** A new username (or number): new lettering; once the laser has reached it, the card shows it at once. */
  retitleTicket(cut: TicketCut) {
    if (!this.ticketing) return;
    const t = !this.groundPrinted && cut.plain ? { ...cut, lettered: cut.plain.lettered } : cut;
    this.etchCut = { ...t, stages: this.etchStages };
    // still on the number or the name: the laser starts the lettering again, with the new name
    if (this.etch !== null && this.etchPass < LETTER_PASSES) {
      this.etchPass = 0;
      this.lettersCut = false;
      this.startPass();
      return;
    }
    // the card's finished: the laser comes back and cuts the new name in over the artwork
    if (this.etch === null && this.etchStages.length) {
      this.letterOnly = true;
      this.etchPass = 0;
      this.lettersCut = false;
      this.startPass();
      return;
    }
    // mid-artwork: the new name is shown at once, cut through
    this.setLettering(true, true);
  }

  /**
   * The lettering on the face: the artwork always keeps clear of it; once the
   * laser reaches it the marks show, and the owner is cut — through the face
   * as the laser goes, then through the card once it's done.
   */
  private setLettering(shown: boolean, through = false, ownerOnly?: HTMLImageElement | null) {
    const t = this.etchCut;
    if (!t) return;
    const tex = (img: HTMLImageElement | null) => {
      if (!img) return null;
      const out = new THREE.Texture(img);
      out.needsUpdate = true;
      return out;
    };
    for (const old of this.letteringTexs) old?.dispose();
    this.letteringTexs = [tex(t.lettering), tex(t.marks), tex(ownerOnly === undefined ? t.owner : ownerOnly)];
    const [all, marks, owner] = this.letteringTexs;
    this.card.setFaceLettering(all, marks, owner, shown ? (through ? 2 : 1) : 0);
  }

  /** The laser's done: it stops, and the card's as cut. */
  private finishEtch() {
    this.etch = null;
    this.letterOnly = false;
    this.card.setLaser(null);
    this.onLaser?.(null);
    this.showOnMonitor();
  }

  /** The engraver's screen: the design, each layer alone and all together, and what the laser's doing with it. */
  private showOnMonitor() {
    const t = this.etchCut;
    if (!t) return this.card.monitor.set(null);
    // the layers by the names they're picked by (an older ticket's by its engine's generators)
    const names = t.design?.map((d) => d.system) ?? (t.composition ?? []).map((l) => String((l as { gen?: string }).gen ?? 'layer'));
    const inks = t.layerInks ?? [];
    const layers = names.map((name, i) => ({ name, ink: inks[i] ?? null }));
    const done = this.etch === null;
    const pass = this.etchPass;
    const cutting = done
      ? null
      : pass < LETTER_PASSES
        ? { kind: pass === 0 ? ('number' as const) : ('name' as const) }
        : { kind: 'layer' as const, index: pass - LETTER_PASSES };
    const progress = done ? 1 : (this.etch ?? 0);
    const overall = done ? 1 : (pass + progress) / Math.max(1, this.etchPasses);
    // the laser's own plan for the pass, so the screen burns in as the card does
    const plan = !done && this.etchPlan ? { times: this.etchPlan.times, head: headAt(this.etchPlan, progress) } : undefined;
    this.card.monitor.set({ layers, together: t.inkStages ?? [], cutting, progress, overall, plan, ticket: 'LW16' });
  }

  /** a texture of a stage, for what the laser hasn't cut yet */
  private setGround(img: HTMLImageElement) {
    this.ticketGround?.dispose();
    this.ticketGround = new THREE.Texture(img);
    this.ticketGround.colorSpace = THREE.SRGBColorSpace;
    this.ticketGround.needsUpdate = true;
    this.card.setLaserGround(this.ticketGround);
  }

  /**
   * The laser's next pass. The blank card comes with its marks (Petabyte,
   * Prototype) already on it. First the laser cuts the owner's number out of
   * it, then their name; once both are cut they open right through the card.
   * Then a pass per layer of the artwork: what's cut so far is the ground,
   * the next stage the artwork it cuts in, keeping clear of the lettering.
   */
  private startPass(): void {
    const t = this.etchCut!;
    if (this.etchPass < LETTER_PASSES) {
      // on the blank card, or (relettering a finished one) over its artwork
      const bare = this.letterOnly ? this.etchStages[this.etchStages.length - 1] : this.etchStages[0];
      this.setGround(bare);
      // the number alone, then the whole owner (the number already cut, so only the name's left)
      const line = this.etchPass === 0 ? (t.ownerNumber ?? null) : (t.ownerName ?? null);
      // nothing to cut on this pass (no name yet): straight on to the next
      if (!line) {
        this.etchPass++;
        if (this.etchPass === LETTER_PASSES) this.lettersCut = true;
        if (this.letterOnly && this.etchPass === LETTER_PASSES) return this.finishEtch();
        return this.startPass();
      }
      this.etchPlan = planPass(bare, bare, null, line);
      this.setLettering(true, false, this.etchPass === 0 ? (t.ownerNumber ?? null) : undefined);
    } else {
      const ground = this.etchStages[this.etchPass - LETTER_PASSES];
      const next = this.etchStages[this.etchPass - LETTER_PASSES + 1];
      this.setGround(ground);
      this.swapClothArt(next);
      this.etchPlan = planPass(ground, next, this.etchCut?.lettering);
    }
    this.card.setLaserPlan(this.etchPlan.times, LASER_COLS, LASER_ROWS, this.etchPlan.seconds);
    this.etch = 0;
    this.card.setLaser(0, headAt(this.etchPlan, 0), this.elapsed);
  }

  /** Done making (or put away): the card goes back to its artwork, and the stack unfolds. */
  endTicket() {
    if (!this.ticketing) return;
    this.ticketing = false;
    this.card.setGantry(false);
    // a card flipped while it was being made goes back front-on: the stack's not left turned round
    this.card.faceFront();
    this.etch = null;
    this.etchStages = [];
    this.card.setLaser(null);
    this.card.setFaceLettering(null, null, null, 0);
    for (const old of this.letteringTexs) old?.dispose();
    this.letteringTexs = [];
    this.etchCut = null;
    this.refreshGridArt();
    this.applyStack();
  }

  /** Tickets are on their way: hold the stack's plates back until they arrive, rather than show them blank. */
  awaitTickets() {
    this.card.gatePlates(true);
  }

  /** A ticket made or remixed just now: its new image replaces the old, or it joins the end of the list. */
  upsertTicket(t: TicketSource) {
    const known = this.ticketIndex.get(t.id);
    const old = known !== undefined ? this.ticketAt.get(known) : undefined;
    if (old && old.url === t.url && old.owner === t.owner && old.number === t.number) return;
    // a ticket not seen before is the newest: it joins the end
    if (known !== undefined) this.putTicket(known, t);
    else this.putTicket(this.ticketTotal++, t);
    // a slot already holding it: load it afresh
    const slot = this.slotOf.get(t.id);
    if (slot !== undefined) {
      this.slots[slot].ready = false;
      this.plateTickets.forEach((id, p) => id === t.id && this.card.plateReady(p, false));
      this.loadTicket(t, slot);
    }
    this.applyStack();
  }

  /** the ticket plate i shows: the Helix the latest few, Tiles every one as it scrolls */
  private ticketForPlate(i: number) {
    const n = this.ticketTotal;
    // the Helix shows the latest few; the wall starts at them too, so the
    // cards that fly from the one to the other keep their tickets on the way
    const latest = n - Math.min(n, HELIX_TICKETS);
    if (this.tilesView) return this.ticketAtPlace((tileTicket(i, n, this.card.tilesScrollY, this.card.dims.h) + latest) % n);
    // the formation shows the latest as many as it has cards, starting over when it has more cards than tickets
    const count = this.card.plateCount;
    // the Helix has no end: each time a card comes back round it's a whole
    // spiral's worth further back through the tickets
    const lap = this.params?.stack?.shape === 'Helix' ? this.card.helixLap(i) : 0;
    const k = (Math.max(0, n - count) + i - lap * count) % n;
    return this.ticketAtPlace(k < 0 ? k + n : k);
  }

  /**
   * Give every plate its ticket: from the slot already holding it, or a
   * free (or long-unused) one it's loaded into. Each frame in Tiles, as the
   * wall scrolls; otherwise when the tickets change.
   */
  private assignPlates() {
    if (!this.ticketTotal || !this.pool) return;
    const frame = ++this.slotFrame;
    // on the wall only what's on screen (and a card's width round it) has a
    // ticket loaded: the drum's other cards, behind you or past the edges,
    // let theirs go
    const inView = this.tilesView ? this.platesInView() : null;
    for (let i = 0; i < this.card.plateCount; i++) {
      if (inView && !inView[i]) {
        this.dropPlate(i);
        continue;
      }
      const t = this.ticketForPlate(i);
      if (!t) continue;
      // its image failed a moment ago: try again in a while, not every frame
      const failed = this.ticketFailed.get(t.id);
      if (failed !== undefined && performance.now() - failed < TICKET_RETRY_MS) continue;
      let slot = this.slotOf.get(t.id);
      if (slot === undefined) {
        const free = this.claimSlot(frame);
        // the pool's full of what's on screen: this card waits, hidden, never showing another's image
        if (free < 0) continue;
        const was = this.slots[free].id;
        if (was) {
          this.slotOf.delete(was);
          this.plateTickets.forEach((id, p) => id === was && this.dropPlate(p));
        }
        this.slots[free] = { id: t.id, ready: false, used: frame };
        this.slotOf.set(t.id, free);
        this.loadTicket(t, free);
        slot = free;
      }
      this.slots[slot].used = frame;
      if (this.plateTickets[i] !== t.id) {
        this.plateTickets[i] = t.id;
        this.card.setPlateLayer(i, slot);
        this.card.plateReady(i, this.slots[slot].ready);
      }
    }
  }

  /** a plate lets its ticket go: hidden until it's given one again */
  private dropPlate(i: number) {
    if (!this.plateTickets[i]) return;
    this.plateTickets[i] = null;
    this.card.plateReady(i, false);
  }

  /** which plates are on screen, or within a card's width of it */
  private platesInView() {
    this.camera.updateMatrixWorld();
    viewFrustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.card.group.updateWorldMatrix(true, false);
    const out: boolean[] = [];
    for (let i = 0; i < this.card.plateCount; i++) {
      viewSphere.center.copy(this.card.plateCentre(i, viewSphere.center));
      viewSphere.radius = TILE_VIEW_MARGIN;
      out.push(viewFrustum.intersectsSphere(viewSphere));
    }
    return out;
  }

  /** The lighting setup the panel asks for. */
  private useLighting() {
    this.scene.environment = this.lighting.use(this.params?.lighting ?? 'Studio');
    for (const light of this.lighting.lights) this.lightBase.set(light, light.intensity);
  }

  /**
   * The bloom: just as the panel's sliders set it.
   */
  private applyBloom() {
    const r = this.params?.render;
    if (!r) return;
    this.bloomPass.strength = r.bloom;
    this.bloomPass.threshold = r.bloomThreshold;
  }

  /** Size the plate art for the view: a new pool, its slots empty, refilled as plates are given tickets. */
  private usePool(kind: PoolKind) {
    if (this.pool === kind) return;
    // the same pool for both views: keep it, and every image in it
    if (this.pool && POOLS[this.pool] === POOLS[kind]) {
      this.pool = kind;
      return;
    }
    this.pool = kind;
    this.ticketArt?.dispose();
    this.ticketArt = null;
    this.card.setPlateArt(null);
    this.slots = Array.from({ length: POOLS[kind].count }, () => ({ id: null, ready: false, used: -1 }));
    this.slotOf.clear();
    // the drawing canvases are the pool's size
    this.ticketCtx = this.marksCtx = this.ownerCtx = this.inkCtx = null;
    for (let i = 0; i < this.card.plateCount; i++) this.card.plateReady(i, false);
  }

  /** a slot to load into: an empty one, or the one longest off every plate (never one on a plate this frame); -1 if none */
  private claimSlot(frame: number) {
    let best = -1;
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (!slot.id) return s;
      if (slot.used === frame) continue;
      if (best < 0 || slot.used < this.slots[best].used) best = s;
    }
    return best;
  }

  /** Pull a ticket's plate out to the front, once it's in. */
  showTicket(id: string) {
    const i = this.plateTickets.indexOf(id);
    const slot = this.slotOf.get(id);
    if (i >= 0 && slot !== undefined && this.slots[slot].ready) this.focusPlate(i);
    else this.pendingShow = id;
  }

  private async loadTicket(t: TicketSource, slot: number) {
    const pool = this.pool;
    try {
      const { ground, marks, owner, img } = await this.ticketLayers(t);
      // the slot's gone to another ticket meanwhile (or this one's image has changed)
      const at = this.ticketIndex.get(t.id);
      const current = at !== undefined ? this.ticketAt.get(at) : undefined;
      if (this.pool !== pool || this.slots[slot]?.id !== t.id || current?.url !== t.url || this.disposed) return img.close();
      const art = (this.ticketArt ??= this.newTicketArt());
      const { w, h } = POOLS[this.pool!];
      const px = this.composeTicket({ ground, marks, owner, img }, w, h);
      img.close();
      if (!this.plateMarks) {
        this.plateMarks = new THREE.Texture(marks);
        this.plateMarks.needsUpdate = true;
        this.card.setPlateMarks(this.plateMarks);
      }
      (art.image.data as Uint8Array).set(px, slot * w * h * 4);
      art.addLayerUpdate(slot);
      art.needsUpdate = true;
      this.card.setPlateArt(art);
      this.slots[slot].ready = true;
      this.plateTickets.forEach((id, p) => id === t.id && this.card.plateReady(p));
      if (this.pendingShow === t.id) {
        this.pendingShow = null;
        const p = this.plateTickets.indexOf(t.id);
        if (p >= 0) this.focusPlate(p);
      }
    } catch (err) {
      console.warn('[holocloth] ticket image failed; trying again shortly', t.url, err);
      // free the slot, and let its plates try again after a pause
      if (this.slots[slot].id === t.id) {
        this.slots[slot] = { id: null, ready: false, used: -1 };
        this.slotOf.delete(t.id);
      }
      this.ticketFailed.set(t.id, performance.now());
      this.plateTickets = this.plateTickets.map((id) => (id === t.id ? null : id));
      if (!this.tilesView) window.setTimeout(() => !this.disposed && this.assignPlates(), TICKET_RETRY_MS);
    }
  }

  /**
   * A ticket's layers laid one over another at w×h, upside down (texture
   * arrays can't be flipped on upload): the colour field, its linework (never
   * under the lettering), and the owner — cut right through — in the alpha.
   * The page's marks are the same on every ticket: the card has them once.
   */
  private composeTicket(l: { ground: CanvasImageSource; marks: CanvasImageSource; owner: CanvasImageSource; img: CanvasImageSource }, w: number, h: number) {
    const size = `${w}x${h}`;
    if (this.composeSize !== size) {
      this.composeSize = size;
      this.composeCtx = [newCanvas(w, h), newCanvas(w, h), newCanvas(w, h), newCanvas(w, h)];
    }
    const [ctx, mctx, octx, ictx] = this.composeCtx!;
    for (const c of [mctx, octx, ictx]) {
      c.setTransform(1, 0, 0, -1, 0, h);
      c.clearRect(0, 0, w, h);
    }
    mctx.drawImage(l.marks, 0, 0, w, h);
    octx.drawImage(l.owner, 0, 0, w, h);
    ictx.drawImage(l.img, 0, 0, w, h);
    ictx.setTransform(1, 0, 0, 1, 0, 0);
    ictx.globalCompositeOperation = 'destination-out';
    ictx.drawImage(mctx.canvas, 0, 0);
    ictx.drawImage(octx.canvas, 0, 0);
    ictx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, -1, 0, h);
    if (this.groundPrinted) ctx.drawImage(l.ground, 0, 0, w, h);
    else {
      // plain metal: the room gives it its colour
      ctx.fillStyle = PLAIN_GROUND;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(ictx.canvas, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const ownerPx = octx.getImageData(0, 0, w, h).data;
    for (let k = 3; k < px.length; k += 4) px[k] = 255 - ownerPx[k];
    return px;
  }

  /** a ticket's layers, fetched: the colour field, the page's marks, its owner, its linework */
  private ticketLayers(t: TicketSource) {
    return Promise.all([
      (this.ticketGroundImg ??= (this.gridField ??= fetchDataUrl('/artwork/field.png')).then((f) => svgImage(groundPage(f)))),
      (this.ticketMarksImg ??= svgImage(marksPage())),
      loadOwnerFont().then(() => svgImage(ownerPage({ username: t.owner, number: t.number }))),
      fetch(t.url).then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return createImageBitmap(await res.blob());
      }),
    ]).then(([ground, marks, owner, img]) => ({ ground, marks, owner, img }));
  }

  /**
   * The pulled-out card, drawn at full size: it fills the view, so its
   * artwork is drawn for that, not at the size it has on the wall.
   */
  private async focusArtFor(plate: number | null) {
    const job = ++this.focusJob;
    const id = plate === null ? null : this.plateTickets[plate];
    const at = id ? this.ticketIndex.get(id) : undefined;
    const t = at !== undefined ? this.ticketAt.get(at) : undefined;
    if (!t || plate === null) {
      this.card.setFocusArt(null, -1);
      return;
    }
    try {
      const layers = await this.ticketLayers(t);
      if (job !== this.focusJob || this.disposed) return layers.img.close();
      const { w, h } = FOCUS_ART;
      const px = this.composeTicket(layers, w, h);
      layers.img.close();
      this.focusArt?.dispose();
      this.focusArt = new THREE.DataTexture(new Uint8Array(px.buffer.slice(0)), w, h);
      this.focusArt.colorSpace = THREE.SRGBColorSpace;
      this.focusArt.minFilter = THREE.LinearMipmapLinearFilter;
      this.focusArt.magFilter = THREE.LinearFilter;
      this.focusArt.generateMipmaps = true;
      this.focusArt.anisotropy = 8;
      this.focusArt.needsUpdate = true;
      this.card.setFocusArt(this.focusArt, this.slotOf.get(t.id) ?? -1);
    } catch (err) {
      // the card just stays at the size it was: still shown, only softer
      console.warn('[holocloth] full-size card failed; keeping the smaller one', err);
    }
  }

  private newTicketArt() {
    const { w, h, count } = POOLS[this.pool!];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    this.ticketCtx = canvas.getContext('2d', { willReadFrequently: true })!;
    const art = new THREE.DataArrayTexture(new Uint8Array(w * h * 4 * count), w, h, count);
    art.colorSpace = THREE.SRGBColorSpace;
    art.minFilter = THREE.LinearMipmapLinearFilter;
    art.magFilter = THREE.LinearFilter;
    art.generateMipmaps = true;
    art.anisotropy = 8;
    return art;
  }

  /** the stack's settings, with its count set by the tickets when it's made of them */
  private applyStack() {
    const p = this.params;
    if (!p?.stack) return;
    // Tiles is an endless sheet: more plates than tickets, the tickets repeating
    const tiles = p.stack.shape === 'Tiles';
    this.card.setStack({
      ...p.stack,
      cards: this.ticketing ? 'One' : p.cards,
      // the wall is always full; every other formation has as many cards as the panel's Count
      count: tiles && this.ticketTotal ? TILE_COUNT : p.stack.count,
    });
    const tilesView = tiles && !this.ticketing && p.cards === 'Stack';
    // into (or out of) Tiles, or making a ticket, the camera eases round to suit
    const view = this.ticketing ? 'Front' : tilesView ? 'Tiles' : 'Helix';
    if (view !== this.view) this.frameView(view);
    this.view = view;
    const viewChanged = tilesView !== this.tilesView;
    this.tilesView = tilesView;
    // the Rolodex and the wall are dragged themselves, not orbited round
    // the Wheel spins on its spine the same way
    this.rolodexView = (p.stack.shape === 'Rolodex' || p.stack.shape === 'Wheel') && !this.ticketing && p.cards === 'Stack';
    this.controls.enabled = !tilesView && !this.rolodexView && !this.heroMode;
    // the wall is shaded as one smooth curve: light sweeps across it in one band
    this.card.setTileCurve(tilesView);
    if (viewChanged) this.useLighting();
    this.applyBloom();
    this.usePool(tilesView ? 'Tiles' : 'Helix');
    this.plateTickets = [];
    this.assignPlates();
  }

  private async generateGridArt(g: HoloParams['grid']) {
    const field = await (this.gridField ??= fetchDataUrl('/artwork/field.png'));
    if (g.pattern === 'Engine') {
      const linework = await engineLinework(g.engine ?? 'Random', Math.round(g.seed), {
        x: ASCII.x0, y: ASCII.y0, w: ASCII.x1 - ASCII.x0, h: ASCII.y1 - ASCII.y0,
      }, Math.round(g.layers ?? 3));
      return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pageWith(linework, field))}`);
    }
    if (g.pattern === 'Flower') {
      const src = this.flowerUpload ?? flowerSrc(g.flower ?? 'Tulip');
      const style = g.style ?? 'ASCII';
      let svg: string;
      if (style === 'ASCII') {
        const { cols, rows } = asciiGrid(g.type);
        svg = asciiSvg(await sampleLuminance(src, cols, rows), cols, rows, field, g.type);
      } else {
        const { cols, rows } = ditherGrid(g.type, style);
        svg = ditherSvg(await sampleLuminance(src, cols, rows, 1), cols, rows, field, style, g.type);
      }
      return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }
    const svg = g.pattern === 'Bars' ? barsSvg(field) : g.pattern === 'Growth'
      ? growthSvg({ rows: g.steps, guides: g.guides }, field)
      : gridSvg({
        rows: g.rows,
        depth: g.depth,
        fill: g.fill,
        endCircles: g.endCircles,
        guides: g.guides,
        seed: Math.round(g.seed),
      }, field);
    return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  }

  /**
   * Face mode: the webcam drives a collider the sheet lies on. Off again
   * releases the camera straight away.
   */
  private setFaceTracking(on: boolean) {
    if (on === !!this.faceTracker) return;
    if (on) {
      const tracker = new FaceTracker();
      tracker.onStatus = (s) => this.onFaceStatus?.(s);
      this.faceTracker = tracker;
      this.sim.setCollider(this.faceCollider);
      void tracker.start();
    } else {
      this.faceTracker?.stop();
      this.faceTracker = null;
      this.faceCollider.clear();
      this.sim.setCollider(null);
      this.onFaceStatus?.(null);
    }
  }

  /** Hands on: the webcam's hands hold the poster's top corners. */
  private setHandTracking(on: boolean) {
    if (on === !!this.handTracker) return;
    if (on) {
      const tracker = new HandTracker();
      tracker.onStatus = (s) => this.onHandStatus?.(s);
      this.handTracker = tracker;
      this.latestHands = null;
      void tracker.start();
    } else {
      this.handTracker?.stop();
      this.handTracker = null;
      this.latestHands = null;
      this.grips = [null, null];
      for (let k = 0; k < this.sim.pinCount; k++) this.sim.holdPin(k, null);
      this.onHandStatus?.(null);
    }
  }

  /**
   * Each hand holds the top corner on its side, at its thumb-index pinch.
   * Mirrored like the preview; how big the hand looks stands in for how
   * close it is, bringing that corner toward you. A corner whose hand is
   * gone eases back onto its wall pin.
   */
  private holdWithHands() {
    const tracker = this.handTracker!;
    const fresh = tracker.poll();
    if (fresh || tracker.lastStatus === 'searching') this.latestHands = fresh;
    if (this.sim.pinCount !== 2) return; // hands hold the poster's two corners

    const aspect = tracker.frameAspect;
    const targets: ({ x: number; y: number; z: number } | null)[] = [null, null];
    const held = (this.latestHands?.hands ?? []).map((h) => {
      const t = THREE.MathUtils.clamp((h.size - HAND_FAR) / (HAND_NEAR - HAND_FAR), 0, 1);
      return {
        x: -(h.grip.x - 0.5) * HOLD_SPAN,
        y: HOLD_CENTER_Y + (0.5 - h.grip.y) * (HOLD_SPAN / aspect),
        z: THREE.MathUtils.lerp(HOLD_Z_FAR, HOLD_Z_NEAR, t),
      };
    });
    if (held.length >= 2) {
      held.sort((a, b) => a.x - b.x);
      targets[0] = held[0];
      targets[1] = held[held.length - 1];
    } else if (held.length === 1) {
      targets[held[0].x < 0 ? 0 : 1] = held[0];
    }

    for (let k = 0; k < 2; k++) {
      const goal = targets[k] ?? this.sim.pinRestOf(k);
      const g = (this.grips[k] ??= { ...this.sim.pinRestOf(k) });
      const ease = targets[k] ? 0.35 : 0.06;
      g.x += (goal.x - g.x) * ease;
      g.y += (goal.y - g.y) * ease;
      g.z += (goal.z - g.z) * ease;
      this.sim.holdPin(k, g);
    }
  }

  /** Run the sim ahead without rendering, so a still opens on a flag already in the wind. */
  warmUp(seconds: number) {
    if (!this.params) return;
    for (let t = 0; t < seconds; t += 1 / 60) this.sim.step(1 / 60, this.params.physics);
    this.clothGeometry.attributes.position.needsUpdate = true;
    this.clothGeometry.computeVertexNormals();
  }

  /** Aim the camera at the cloth's centre (the default view leaves room for the panel). */
  frameCloth() {
    this.clothGeometry.computeBoundingBox();
    const box = this.clothGeometry.boundingBox;
    if (!box) return;
    box.getCenter(this.controls.target);
    this.controls.update();
  }

  /** Startup art just landed: put the chosen grid pattern over it, unless it's Original. */
  /** Set the Flower artwork from another photo (best: a subject lit on a black ground). */
  setFlowerImage(img: HTMLImageElement) {
    this.flowerUpload = img.src;
    this.flowerVersion++;
    if (this.params) this.updateGridArt(this.params.grid);
  }

  refreshGridArt() {
    if (!this.params) return;
    this.gridKey = '';
    this.updateGridArt(this.params.grid);
  }

  /** New artwork on the same cloth: keep the drape unless the shape changes. */
  private swapClothArt(img: HTMLImageElement) {
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const aspect = Math.min(3, Math.max(1 / 3, iw / ih));
    if (Math.abs(aspect - this.clothAspect) > 1e-3) {
      this.setClothImage(img);
      return;
    }
    this.surface.setClothImage(img);
    this.onImagesChanged?.();
  }

  resetCloth() {
    this.sim.reset();
    this.clothGeometry.attributes.position.needsUpdate = true;
    this.clothGeometry.computeVertexNormals();
  }

  poke() {
    this.sim.poke(1);
  }

  /** Peel every sticker off. */
  clearStickers() {
    for (const d of [...this.surface.decals]) if (d.sticker) this.surface.remove(d);
    this.slaps = [];
    this.onImagesChanged?.();
  }

  addDecal(img: HTMLImageElement) {
    const item = this.surface.addDecal(img);
    this.onDecalSelect?.(item.scale, item.rotation);
    this.onImagesChanged?.();
  }

  setClothImage(img: HTMLImageElement) {
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const aspect = Math.min(3, Math.max(1 / 3, iw / ih));
    this.surface.setClothImage(img);
    if (this.surface.setAspect(aspect)) this.rebindSurfaceTexture();
    this.buildCloth(aspect);
    this.onImagesChanged?.();
  }

  clearImages() {
    this.surface.clear();
    if (this.surface.setAspect(1)) this.rebindSurfaceTexture();
    this.buildCloth(1);
    this.onImagesChanged?.();
  }

  /** Drop only the cloth image (decals stay), back to the square cloth. */
  removeClothImage() {
    this.surface.setClothImage(null);
    if (this.surface.setAspect(1)) this.rebindSurfaceTexture();
    this.buildCloth(1);
    this.onImagesChanged?.();
  }

  get hasClothImage() {
    return this.surface.clothImage !== null;
  }

  /** the page the stack's set into draws its own LW and 16; the scene's are held back meanwhile */
  private titlesHeld = false;

  /** where on the canvas (px) the embedding page wants the scene drawn, as if the canvas were only that big */
  private pageFrame: { x: number; y: number; w: number; h: number } | null = null;

  /**
   * Draw the scene into part of the canvas, framed as if the canvas were that
   * rect: the page opening the stack makes the canvas full-window at once, then
   * eases this out to the whole window, so the cards come forward unclipped.
   */
  setPageFrame(frame: { x: number; y: number; w: number; h: number } | null) {
    this.pageFrame = frame && frame.w > 0 && frame.h > 0 ? frame : null;
    this.applyViewInset();
    if (this.revealed) this.composer.render();
  }

  /** set into a page's hero: drawn closer in, dragged to spin, and a click is the page's (to open it) */
  private heroMode = false;
  private heroZoom = 1;
  /** a click (not a drag) on the stack while it's in the page's hero */
  onPageTap?: () => void;

  /** In (or out of) the page's hero, drawn `zoom` times closer while there. */
  setHero(on: boolean, zoom = this.heroZoom) {
    this.heroMode = on;
    this.heroZoom = zoom;
    this.controls.enabled = !this.tilesView && !this.rolodexView && !on;
    this.applyViewInset();
    if (this.revealed) this.composer.render();
  }

  /** how wide (canvas px) the stack's plates reach across the screen as they are now, or null with none */
  stackSpan() {
    const mesh = this.card.stackSlab;
    if (!mesh?.count) return null;
    const { w, h } = this.card.dims;
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    let lo = Infinity, hi = -Infinity;
    mesh.updateMatrixWorld(true);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      m.premultiply(mesh.matrixWorld);
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        v.set((x * w) / 2, (y * h) / 2, 0).applyMatrix4(m).project(this.camera);
        lo = Math.min(lo, v.x);
        hi = Math.max(hi, v.x);
      }
    }
    return ((hi - lo) / 2) * this.host.clientWidth;
  }

  /** Hold the scene's titles back (the embedding page has its own), or let them show again. */
  holdTitles(held: boolean) {
    this.titlesHeld = held;
  }

  /** Show the cloth once the app's assets are in place. */
  reveal() {
    this.revealed = true;
    this.showMode();
  }

  /** Card mode swaps the cloth for the metal card; the cloth sim rests meanwhile. */
  private setCardMode(on: boolean) {
    if (on === this.cardMode) return;
    this.cardMode = on;
    this.showMode();
  }

  private showMode() {
    this.clothMesh.visible = this.revealed && !this.cardMode;
    this.card.group.visible = this.revealed && this.cardMode;
  }

  /**
   * The card's cinematic reel: hold a shot, drifting the card so light
   * sweeps the face, then cut — instantly — to the next. The camera is
   * driven while it runs and handed back where it was after.
   */
  private setCinematic(on: boolean, length: number) {
    this.shotLength = length;
    if (on === !!this.cine) return;
    if (on) {
      this.cine = {
        shot: null,
        cloth: null,
        plate: null,
        forCard: this.cardMode,
        t0: 0,
        saved: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      };
      this.controls.enabled = false;
      if (!this.rectLightsReady) {
        RectAreaLightUniformsLib.init();
        this.rectLightsReady = true;
      }
      this.cineLight = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
      this.scene.add(this.cineLight);
      this.cutToNextShot();
    } else {
      const { saved } = this.cine!;
      this.cine = null;
      this.card.setPose(null);
      if (this.cineLight) {
        this.scene.remove(this.cineLight);
        this.cineLight.dispose();
        this.cineLight = null;
      }
      this.camera.up.set(0, 1, 0);
      if (this.params) {
        const r = this.params.render;
        this.scene.environmentIntensity = r.environment;
        this.dofPass.enabled = r.dof;
        this.dofPass.setParams(r.dofAperture * 1e-2, r.dofBlur, r.dofRange * 0.5);
      }
      this.camera.position.copy(saved.position);
      this.controls.target.copy(saved.target);
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  /** Hard cut to a new shot: of the card in Card mode, otherwise of the cloth. */
  private cutToNextShot() {
    const c = this.cine!;
    c.t0 = this.elapsed;
    c.forCard = this.cardMode;
    const light = this.cineLight;
    c.plate = null;
    if (this.cardMode && this.card.stacked && this.rolodexView && Math.random() < ROLODEX_DETAIL) {
      // a detail: in tight on one card's face (its etch, its cut name), from where nothing's in the way
      this.card.setPose(null);
      c.shot = null;
      const { shot, plate } = this.stackShot(c.cloth ?? undefined, true);
      c.cloth = shot;
      c.plate = plate;
      this.placeCamera(shot.camFrom, shot.target, shot.up);
      if (light) {
        light.width = 0.45;
        light.height = 4;
      }
    } else if (this.cardMode && this.card.stacked && this.rolodexView) {
      // the Rolodex: shots of the whole fan, riding round its spine from outside the ring
      this.card.setPose(null);
      c.shot = null;
      this.card.group.updateWorldMatrix(true, false);
      const centre = new THREE.Vector3().setFromMatrixPosition(this.card.group.matrixWorld);
      const spine = (this.params?.stack?.shape === 'Wheel' ? WHEEL_SPINE : ROLODEX_SPINE).clone().transformDirection(this.card.group.matrixWorld);
      const { w } = this.card.dims;
      c.cloth = rolodexShot(centre, spine, w * 0.62 * 1.45, this.shotLength, c.cloth ?? undefined);
      this.placeCamera(c.cloth.camFrom, c.cloth.target, c.cloth.up);
      if (light) {
        light.width = 0.6;
        light.height = 3;
      }
    } else if (this.cardMode && this.card.stacked) {
      // a stack: shots of real plates, gliding like the cloth's, from
      // angles where nothing stands between the camera and the plate
      this.card.setPose(null);
      c.shot = null;
      const { shot, plate } = this.stackShot(c.cloth ?? undefined, this.tilesView && Math.random() < 0.4);
      c.cloth = shot;
      c.plate = plate;
      this.placeCamera(shot.camFrom, shot.target, shot.up);
      if (light) {
        light.width = 0.45;
        light.height = 4;
      }
    } else if (this.cardMode) {
      c.cloth = null;
      const { w, h } = this.card.dims;
      c.shot = nextShot(w, h, this.shotLength, c.shot ?? undefined);
      const { position, target, up } = shotCamera(c.shot);
      this.placeCamera(position, target, up);
      // the strip light where the face mirrors it into this camera mid-shot,
      // lying across the way the highlight travels
      if (light) {
        const l = shotLight(c.shot, position);
        light.position.copy(l.position);
        light.up.copy(l.up);
        light.lookAt(l.target);
        const across = c.shot.sweep === 'across';
        light.width = across ? 0.45 : 4;
        light.height = across ? 4 : 0.45;
      }
    } else {
      // card shots are for the card: release it if it was posed
      this.card.setPose(null);
      c.shot = null;
      const { point, normal } = this.clothSpot();
      c.cloth = nextClothShot(point, normal, this.shotLength, c.cloth ?? undefined);
      this.placeCamera(c.cloth.camFrom, c.cloth.target, c.cloth.up);
      if (light) {
        light.width = 0.45;
        light.height = 4;
      }
    }
    this.runCinematic();
  }

  /**
   * A shot of one plate of the stack. Picks a spot on a plate and a camera
   * move for it, and keeps it only if the plate is in clear view from both
   * ends of the move; after a few misses, a wider look at the whole stack.
   */
  private stackShot(prev?: ClothShot, detail = false) {
    const point = new THREE.Vector3(), normal = new THREE.Vector3();
    const n = this.card.plateCount;
    // on the wall, only cards that are in (their ticket loaded), away from the
    // rows that wrap at the top and bottom: never the gaps
    const tiles = this.tilesView;
    const candidates = tiles
      ? Array.from({ length: n }, (_, i) => i).filter((i) => {
          if (this.card.plateShown(i) < 1) return false;
          this.card.platePoint(i, 0, 0, point, normal);
          return Math.abs(point.y - this.controls.target.y) < TILE_CINE_ROWS * this.card.dims.h * 0.42 * 1.12;
        })
      : null;
    let fallback: { shot: ClothShot; plate: { i: number; u: number; v: number; start: THREE.Vector3 } } | null = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const i = candidates?.length ? candidates[Math.floor(Math.random() * candidates.length)] : Math.floor(Math.random() * n);
      const u = THREE.MathUtils.randFloat(-0.35, 0.35), v = THREE.MathUtils.randFloat(-0.35, 0.35);
      this.card.platePoint(i, u, v, point, normal);
      const shot = nextClothShot(point, normal, this.shotLength, prev, detail, tiles);
      const plate = { i, u, v, start: point.clone() };
      if (this.inClearView(shot.camFrom, point) && this.inClearView(shot.camTo, point)) return { shot, plate };
      // blocked: aim instead at whatever plate the camera does see that way
      fallback ??= this.retarget(shot);
    }
    if (fallback) return fallback;
    // nothing in that direction at all: aim at the first plate, from the front
    this.card.platePoint(0, 0, 0, point, normal);
    return { shot: nextClothShot(point, normal, this.shotLength, prev), plate: { i: 0, u: 0, v: 0, start: point.clone() } };
  }

  /** Re-aim a shot at the first plate surface its camera sees toward the target. */
  private retarget(shot: ClothShot) {
    const dir = shot.target.clone().sub(shot.camFrom).normalize();
    this.raycaster.set(shot.camFrom, dir);
    const hit = this.raycaster.intersectObject(this.card.solid, false)[0];
    if (!hit || hit.instanceId === undefined) return null;
    const { u, v } = this.card.plateUv(hit.instanceId, hit.point);
    // keep the move (a slide carries its aim with it), now on the visible spot
    shot.targetTo.add(hit.point).sub(shot.target);
    shot.target.copy(hit.point);
    return { shot, plate: { i: hit.instanceId, u, v, start: hit.point.clone() } };
  }

  /** Whether a straight line from the camera reaches this point before any other plate. */
  private inClearView(from: THREE.Vector3, point: THREE.Vector3) {
    const dir = point.clone().sub(from);
    const dist = dir.length();
    this.raycaster.set(from, dir.normalize());
    const hit = this.raycaster.intersectObject(this.card.solid, false)[0];
    return !hit || hit.distance > dist - 0.03;
  }

  private placeCamera(position: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3) {
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.camera.up.copy(up); // dutch tilt
    this.camera.lookAt(target);
  }

  /** A spot on the sheet to frame — away from the edges — and its surface normal. */
  private clothSpot() {
    const s = this.sim;
    const r = Math.floor(THREE.MathUtils.randFloat(0.15, 0.85) * (s.rows - 1));
    const col = Math.floor(THREE.MathUtils.randFloat(0.15, 0.85) * (s.cols - 1));
    const i = (r * s.cols + col) * 3;
    const p = s.positions;
    const n = this.clothGeometry.attributes.normal.array;
    return {
      point: new THREE.Vector3(p[i], p[i + 1], p[i + 2]),
      normal: new THREE.Vector3(n[i], n[i + 1], n[i + 2]).normalize(),
    };
  }

  private runCinematic() {
    const c = this.cine!;
    // switched between card and cloth mid-reel: cut to a shot of what's showing
    if (c.forCard !== this.cardMode) {
      this.cutToNextShot();
      return;
    }
    const duration = c.shot?.duration ?? c.cloth?.duration ?? 0;
    const t = this.elapsed - c.t0;
    if (t >= duration) {
      this.cutToNextShot();
      return;
    }
    const f = t / duration;
    let kind: string;
    if (c.shot) {
      const shot = c.shot;
      kind = shot.kind;
      shotPose(shot, shotProgress(shot, f), this.cinePose, this.cinePos);
      this.card.setPose(this.cinePose, this.cinePos);
      this.cineFocus.copy(shot.focus).applyEuler(this.cinePose).add(this.cinePos);
    } else {
      // the cloth moves by itself: glide the camera and carry the light across
      const shot = c.cloth!;
      kind = shot.kind;
      const ease = moveProgress(shot, f);
      // a plate of the stack drifts with its formation: camera and light go with it
      const shift = new THREE.Vector3();
      if (c.plate) {
        const now = new THREE.Vector3();
        this.card.platePoint(c.plate.i, c.plate.u, c.plate.v, now, new THREE.Vector3());
        shift.subVectors(now, c.plate.start);
      }
      const target = shot.target.clone().lerp(shot.targetTo, ease).add(shift);
      this.camera.position.lerpVectors(shot.camFrom, shot.camTo, ease).add(shift);
      this.camera.up.copy(shot.up).lerp(shot.upTo, ease).normalize();
      this.camera.lookAt(target);
      this.cineFocus.copy(target);
      const light = this.cineLight;
      if (light) {
        light.position.lerpVectors(shot.lightFrom, shot.lightTo, f).add(shift);
        light.up.copy(shot.lightUp);
        light.lookAt(target);
      }
    }
    // depth of field on the framed spot. The sharp zone scales with the shot
    // distance so it holds the spot and its surroundings; past it, blur
    // builds gradually (full only a quarter of the distance further out),
    // to a modest maximum — never a thin sharp strip with the rest smeared
    // focus on whatever is at the middle of the frame: in a stack that may
    // be a nearer plate than the one aimed at, or one behind a gap
    let focusDist = this.camera.position.distanceTo(this.cineFocus);
    if (this.cardMode) {
      const look = this.cineFocus.clone().sub(this.camera.position).normalize();
      this.raycaster.set(this.camera.position, look);
      const hit = this.raycaster.intersectObject(this.card.solid, false)[0];
      if (hit) focusDist = hit.distance;
    }
    // a cut snaps focus; within a shot it eases, like a focus puller
    this.cineFocusDist = t < 0.05 || this.cineFocusDist === 0
      ? focusDist
      : THREE.MathUtils.lerp(this.cineFocusDist, focusDist, 0.15);
    focusDist = this.cineFocusDist;
    const maxBlur = (0.01 + 0.02 * this.drama) * (kind === 'wide' ? 0.5 : 1);
    this.dofPass.enabled = true;
    this.dofPass.setParams(maxBlur / 0.25, maxBlur, focusDist * 0.15);
    this.dofPass.setFocus(focusDist);
    // drama: dim the room so the sweep is the star, and push the light
    if (this.params) {
      // (a stack keeps most of the room: its colour is the room's, and the reel shouldn't change it)
      const dim = this.cardMode && this.card.stacked ? 0.2 : 0.78;
      this.scene.environmentIntensity = this.params.render.environment * (1 - dim * this.drama);
    }
    // the stack's many faces each mirror the strip: kept gentler there, or it glares out the frame
    if (this.cineLight) this.cineLight.intensity = (this.cardMode && this.card.stacked ? 0.25 : 1) * (6 + 34 * this.drama);
  }

  /**
   * Pull a plate of the stack out and show it square-on, centred: by
   * moving the camera in to it, or — under Move camera, where the view is
   * yours — by bringing the plate to the camera. Null puts it back (and the
   * camera, if it moved, returns to where it was).
   */
  /**
   * A pulled-out plate comes to the view, the camera staying put — with Move
   * camera, and always inside the Tiles drum (flying the camera out to meet
   * it would leave the drum)
   */
  private get cardComesToView() {
    return this.params?.drag === 'Move camera' || this.tilesView;
  }

  private focusPlate(plate: number | null) {
    if (plate !== null && this.card.focusedPlate === null && this.plateCam.k === 0 && !this.cardComesToView) {
      this.plateCam.rest = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        up: this.camera.up.clone(),
      };
    }
    this.card.focusPlate(plate);
    this.focusArtFor(plate);
  }

  /** Ease the camera toward a pulled-out plate, or back to rest. */
  private updatePlateCamera(dt: number) {
    // the pulled-out plate leans a little toward the cursor, easing there
    const lean = this.card.focusedPlate !== null ? PLATE_LEAN : 0;
    const ease = 1 - Math.exp(-PLATE_LEAN_RATE * dt);
    this.plateLean.x += (this.pointerNdc.x * lean - this.plateLean.x) * ease;
    this.plateLean.y += (this.pointerNdc.y * lean - this.plateLean.y) * ease;
    this.card.tiltPlate(this.plateLean.x, this.plateLean.y);
    const c = this.plateCam;
    const focused = this.card.focusedPlate !== null;
    // anything that ends the stack, or the reel taking the camera, sends it back
    if (focused && (!this.cardMode || !this.card.stacked || this.cine)) this.card.focusPlate(null);
    // Move camera: the plate comes to the view — centred, square to it,
    // filling most of the height — and follows it if you orbit
    if (this.cardComesToView && !c.rest) {
      const { w, h } = this.card.dims;
      const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
      const fill = Math.max(h / 2, w / 2 / this.camera.aspect) / half / PLATE_FILL;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      // in front of the whole formation, so nothing passes over it: if it
      // has to come nearer than its framing distance, it's made smaller to
      // match, so it fills the same part of the view
      const centre = new THREE.Vector3();
      const reach = this.card.formationBounds(centre);
      const clear = centre.sub(this.camera.position).dot(dir) - reach - 0.15;
      const dist = THREE.MathUtils.clamp(clear, 0.4, fill);
      this.card.presentPlate(this.camera.position.clone().addScaledVector(dir, dist), this.camera.quaternion, dist / fill);
    } else {
      this.card.presentPlate(null);
    }
    const goal = this.card.focusedPlate !== null ? 1 : 0;
    // at rest there is nothing to do; held on a plate, keep following it as it floats
    if (!c.rest || (c.k === 0 && goal === 0)) return;
    c.k = THREE.MathUtils.clamp(c.k + (goal ? dt : -dt) / PLATE_CAM_TIME, 0, 1);
    const k = c.k < 0.5 ? 4 * c.k ** 3 : 1 - (-2 * c.k + 2) ** 3 / 2;
    // framed square-on, the plate filling most of the height
    const spot = new THREE.Vector3(), normal = new THREE.Vector3(), up = new THREE.Vector3();
    this.card.plateSpot(spot, normal, up);
    const { w, h } = this.card.dims;
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const dist = Math.max(h / 2, w / 2 / this.camera.aspect) / half / PLATE_FILL;
    const at = spot.clone().addScaledVector(normal, dist);
    this.camera.position.copy(c.rest.position).lerp(at, k);
    this.controls.target.copy(c.rest.target).lerp(spot, k);
    this.camera.up.copy(c.rest.up).lerp(up, k).normalize();
    this.camera.lookAt(this.controls.target);
    this.controls.enabled = c.k === 0;
    if (c.k === 0) c.rest = null;
  }

  /** Any part of the card under the pointer — for spinning it. */
  private raycastCard(): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    // raycasts see hidden meshes too: skip the plain card while the stack shows, and vice versa
    return this.raycaster.intersectObject(this.card.group, true).find((h) => h.object.visible) ?? null;
  }

  private startCardSpin(e: PointerEvent) {
    // Move camera: dragging the card orbits instead, and the view stays where it's left
    if (this.cardComesToView) return;
    if (!this.raycastCard()) return; // empty space: let OrbitControls orbit
    this.card.dragging = true;
    this.cardDragId = e.pointerId;
    this.cardLast = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  }

  /** Small data-URL preview of an image, cached per element. */
  private thumbnailOf(img: HTMLImageElement): string {
    let url = this.thumbCache.get(img);
    if (url) return url;
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const scale = 96 / Math.max(iw, ih);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    url = c.toDataURL('image/png');
    this.thumbCache.set(img, url);
    return url;
  }

  getClothThumbnail(): string | null {
    return this.surface.clothImage ? this.thumbnailOf(this.surface.clothImage) : null;
  }

  getDecalThumbnails(): string[] {
    return this.surface.decals.map((d) => this.thumbnailOf(d.img));
  }

  removeDecal(index: number) {
    const d = this.surface.decals[index];
    if (!d) return;
    this.surface.decals.splice(index, 1);
    if (this.surface.selected === d) this.surface.selected = null;
    this.surface.redraw();
    this.onImagesChanged?.();
  }

  /** Capture image state for the version manager. */
  snapshotImages(): ImagesState {
    return {
      clothImage: this.surface.clothImage,
      decals: this.surface.decals.map((d) => ({ ...d })),
    };
  }

  /** Restore a version's image state (cloth image + decals). */
  restoreImages(s: ImagesState) {
    this.surface.clothImage = s.clothImage;
    this.surface.decals = s.decals.map((d) => ({ ...d }));
    this.surface.selected = null;
    let aspect = 1;
    if (s.clothImage) {
      const iw = s.clothImage.naturalWidth || s.clothImage.width || 1;
      const ih = s.clothImage.naturalHeight || s.clothImage.height || 1;
      aspect = Math.min(3, Math.max(1 / 3, iw / ih));
    }
    if (this.surface.setAspect(aspect)) this.rebindSurfaceTexture();
    if (aspect !== this.clothAspect) this.buildCloth(aspect);
    this.onImagesChanged?.();
  }

  /**
   * Quality/performance trade-off: render scale, MSAA samples, and cloth
   * resolution. 'High' matches the original behavior.
   */
  private applyPerfProfile(profile: string) {
    this.perfProfile = profile;
    const dpr = window.devicePixelRatio;
    this.currentPR = profile === 'Low' ? 1 : profile === 'Medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    const samples = profile === 'Low' ? 0 : profile === 'Medium' ? 4 : 8;
    const segs = profile === 'Low' ? 28 : profile === 'Medium' ? 36 : 48;
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.currentPR);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.currentPR);
    // MSAA sample count lives on the composer's ping-pong targets; force
    // reallocation so the new count takes effect
    this.composer.renderTarget1.samples = samples;
    this.composer.renderTarget2.samples = samples;
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer.setSize(w, h);
    if (segs !== this.clothSegments) {
      this.clothSegments = segs;
      this.buildCloth(this.clothAspect);
    }
  }

  /** Swap the cloth's bump/normal map; null removes it entirely. */
  setBumpMap(img: HTMLImageElement | null) {
    const old = this.holoMaterial.normalMap;
    let tex: THREE.Texture | null = null;
    if (img) {
      tex = normalMapFromImage(img);
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const tiling = this.params?.material.bumpTiling ?? 3;
      tex.repeat.set(tiling, tiling);
    }
    this.bumpSource = img;
    this.holoMaterial.normalMap = tex;
    // map presence changes the shader program
    if (!!old !== !!tex) this.holoMaterial.needsUpdate = true;
    this.card.setDetail(tex, this.holoMaterial.roughnessMap);
    if (old) old.dispose();
    this.onImagesChanged?.();
  }

  get hasBumpMap() {
    return this.bumpSource !== null;
  }

  getBumpThumbnail(): string | null {
    return this.bumpSource ? this.thumbnailOf(this.bumpSource) : null;
  }

  /** After SurfaceLayer recreates its texture, point the shader at it. */
  private rebindSurfaceTexture() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.surface.texture.anisotropy = maxAniso;
    this.surface.stickerTexture.anisotropy = maxAniso;
    this.holoUniforms.uSurfaceMap.value = this.surface.texture;
    this.holoUniforms.uStickerMap.value = this.surface.stickerTexture;
    this.card.setTextures(this.surface.texture, this.surface.stickerTexture);
  }

  /**
   * The card, or the stack's plates, as outlines seen from this camera: an
   * SVG at the screen's size, one named path per plate, for Figma. It's
   * downloaded and copied, so it can be pasted straight onto a canvas.
   */
  exportOutlines() {
    if (!this.cardMode) {
      window.alert('Outlines export the card and its stacks: set Mode to Card.');
      return;
    }
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    const plates: { d: string; depth: number; i: number }[] = [];
    this.card.outlines().forEach((ring, i) => {
      let d = '';
      let depth = 0;
      for (const p of ring) {
        depth += p.distanceTo(this.camera.position) / ring.length;
        v.copy(p).project(this.camera);
        if (v.z < -1 || v.z > 1) return; // behind the camera: left out
        d += `${d ? 'L' : 'M'}${(((v.x + 1) / 2) * w).toFixed(2)} ${(((1 - v.y) / 2) * h).toFixed(2)}`;
      }
      plates.push({ d, depth, i });
    });
    // farthest first, each filled with the page, so nearer plates cover the
    // lines behind them as they do on screen
    plates.sort((a, b) => b.depth - a.depth);
    const paths = plates.map(({ d, i }) => `<path id="Plate ${i + 1}" d="${d}Z"/>`);
    const bg = `#${this.background.getHexString()}`;
    const ink = this.background.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5 ? '#ffffff' : '#111111';
    const stroke = this.params?.stack?.outlineWidth ?? 1;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect id="Background" width="${w}" height="${h}" fill="${bg}"/>
  <g id="Plates" fill="${bg}" stroke="${ink}" stroke-width="${stroke}" stroke-linejoin="round">
    ${paths.join('\n    ')}
  </g>
</svg>
`;
    navigator.clipboard?.writeText(svg).catch(() => {});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = `lw16-outlines-${new Date().toISOString().replace(/[:.]/g, '-')}.svg`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Render one frame at high resolution and download it as a PNG. */
  exportPNG(transparent = false) {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    const normalPR = this.currentPR;
    const exportPR = Math.min(4, Math.max(2, 3200 / Math.max(w, h)));
    if (transparent) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    }
    this.renderer.setPixelRatio(exportPR);
    this.composer.setPixelRatio(exportPR);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.render();
    const url = this.renderer.domElement.toDataURL('image/png');
    if (transparent) {
      this.scene.background = this.background;
      this.renderer.setClearColor(0x000000, 1);
    }
    this.renderer.setPixelRatio(normalPR);
    this.composer.setPixelRatio(normalPR);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const a = document.createElement('a');
    a.href = url;
    const tag = transparent ? 'holocloth-nobg' : 'holocloth';
    a.download = `${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
  }

  private updatePointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private raycastCloth(): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    if (this.cardMode) {
      // in Card mode the "surface" is the card's printed face
      const hit = this.raycaster.intersectObject(this.card.group, true)[0];
      return hit && this.card.isFace(hit.object) ? hit : null;
    }
    this.clothGeometry.computeBoundingSphere();
    const hits = this.raycaster.intersectObject(this.clothMesh, false);
    return hits.length > 0 ? hits[0] : null;
  }

  /** Cloth UV under a client-space point, or null when off the cloth. */
  uvAt(clientX: number, clientY: number): THREE.Vector2 | null {
    return this.clothHitAt(clientX, clientY)?.uv ?? null;
  }

  private clothHitAt(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    return this.raycastCloth();
  }

  /**
   * Slap a sticker onto the cloth under the pointer. Returns false when the
   * pointer is off the cloth — the sticker is discarded.
   */
  stickAt(clientX: number, clientY: number, img: HTMLImageElement, rotation: number): boolean {
    const hit = this.clothHitAt(clientX, clientY);
    if (!hit?.uv) return false;
    const item = this.surface.addSticker(img, hit.uv.x, hit.uv.y, STICKER_SCALE, rotation);
    item.pop = 1.3;
    this.slaps.push({ item, t0: this.elapsed });
    // the hand pushes the fabric back as the sticker lands
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.sim.impulse(hit.point, dir.multiplyScalar(0.02), this.sim.width * 0.22);
    this.onImagesChanged?.();
    return true;
  }

  endStickerDrag() {
    this.controls.enabled = true;
  }

  /** One-shot: next click on the cloth becomes the DOF focal point. */
  startPickFocus() {
    this.pickingFocus = true;
    this.renderer.domElement.style.cursor = 'crosshair';
  }

  /** Back to auto focus (orbit target). */
  clearPickFocus() {
    this.focusVertex = null;
  }

  /**
   * Hold Space + left-drag = pan (design-tool style). With a plate pulled
   * out, ← and → step to the previous and next plate (round the stack) and
   * Escape puts it back.
   */
  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const focused = this.card.focusedPlate;
    if (focused !== null && this.cardMode && this.card.stacked && !this.cine) {
      const n = this.card.plateCount;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        this.focusPlate((focused + (e.key === 'ArrowRight' ? 1 : -1) + n) % n);
        return;
      }
      if (e.key === 'Escape') {
        this.focusPlate(null);
        return;
      }
    }
    if (e.code !== 'Space' || e.repeat) return;
    e.preventDefault();
    this.spaceHeld = true;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    if (!this.grabbing && !this.draggingDecal && !this.pickingFocus) {
      this.renderer.domElement.style.cursor = 'grab';
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    this.spaceHeld = false;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  };

  private onWindowBlur = () => {
    // cmd-tab away mid-hold: never leave pan mode stuck on
    this.spaceHeld = false;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    // out of focus: no hover, and a lower frame rate
    this.focused = false;
    this.hovered = null;
    this.card.hoverPlate(null);
    this.runLoop();
  };

  private onWindowFocus = () => {
    this.focused = true;
    this.runLoop();
  };

  private onVisibility = () => {
    // restart the clock on return, so the time away never reaches the sim as one big step
    if (document.hidden) this.clock.stop();
    else this.clock.start();
    this.runLoop();
  };

  /**
   * Run the loop to suit the page: every display frame in focus, 30 a
   * second out of it (still moving, just cheaper), and not at all while the
   * tab is hidden.
   */
  private runLoop() {
    this.renderer.setAnimationLoop(null);
    if (this.slowLoop !== null) window.clearInterval(this.slowLoop);
    this.slowLoop = null;
    if (this.disposed || document.hidden) return;
    if (this.focused) this.renderer.setAnimationLoop(this.tick);
    else this.slowLoop = window.setInterval(this.tick, BLURRED_FRAME_MS);
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointerOver = true;
    if (e.button !== 0 || this.grabbing || this.draggingDecal) return;
    this.updatePointer(e);
    if (this.pickingFocus) {
      this.pickingFocus = false;
      this.renderer.domElement.style.cursor = 'default';
      const pick = this.raycastCloth();
      if (pick) {
        // nearest cloth vertex — the focal point rides the fabric
        const p = this.sim.positions;
        let best = 0;
        let bestD2 = Infinity;
        for (let i = 0; i < this.sim.count; i++) {
          const dx = p[i * 3] - pick.point.x;
          const dy = p[i * 3 + 1] - pick.point.y;
          const dz = p[i * 3 + 2] - pick.point.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = i; }
        }
        this.focusVertex = best;
      }
      // swallow this click so it neither grabs nor orbits
      this.pickReleaseId = e.pointerId;
      this.controls.enabled = false;
      return;
    }
    // Space held: step aside so OrbitControls pans with the left button
    if (this.spaceHeld) return;
    // the reel is running: a click cuts to the next shot
    if (this.cine) {
      this.cutToNextShot();
      return;
    }
    if (this.cardMode && this.card.stacked) {
      // a click on a plate pulls it out; a click anywhere else puts it back
      const plate = this.card.plateAt(this.raycastCard());
      this.plateClick = { id: e.pointerId, x: e.clientX, y: e.clientY, plate };
      if (this.card.focusedPlate !== null) return; // the camera is on it: no spinning or orbiting
      // Tiles: the sheet is dragged; the Rolodex is spun
      if (this.tilesView || this.rolodexView || this.heroMode) {
        this.tileDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 };
        this.card.holdTiles(true);
        this.renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }
    }
    const hit = this.raycastCloth();
    if (!hit) {
      if (this.cardMode) this.startCardSpin(e); // back or edge of the card
      return;
    }

    // stickers peel off on press, ahead of cloth grabbing
    const peeled = hit.uv ? this.surface.stickerAt(hit.uv.x, hit.uv.y) : null;
    if (peeled && this.onStickerPick) {
      this.surface.remove(peeled);
      this.slaps = this.slaps.filter((s) => s.item !== peeled);
      this.controls.enabled = false; // endStickerDrag() turns it back on
      this.onStickerPick(peeled, e);
      this.onImagesChanged?.();
      return;
    }

    if (this.cardMode) {
      this.startCardSpin(e);
      return;
    }

    if (this.editMode) {
      if (!hit.uv) return;
      const d = this.surface.hitTest(hit.uv.x, hit.uv.y);
      if (!d) return; // no decal under pointer: let OrbitControls rotate
      this.surface.selected = d;
      this.draggingDecal = true;
      this.decalGrabOffset.u = d.u - hit.uv.x;
      this.decalGrabOffset.v = d.v - hit.uv.y;
      this.grabPointerId = e.pointerId;
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.renderer.domElement.style.cursor = 'move';
      this.onDecalSelect?.(d.scale, d.rotation);
      return;
    }

    const radius = this.params?.physics.grabRadius ?? 0.45;
    if (!this.sim.startGrab(hit.point, radius)) return;
    this.grabbing = true;
    this.grabPointerId = e.pointerId;
    this.controls.enabled = false;
    // drag on a camera-facing plane through the grab point
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private onPointerMove = (e: PointerEvent) => {
    this.pointerOver = true;
    const drag = this.tileDrag;
    if (drag && e.pointerId === drag.id) {
      const now = performance.now();
      const dt = Math.max(1, now - drag.t) / 1000;
      // the wall moves with the pointer; the Rolodex turns, by an angle per pixel
      const u = this.tilesView ? this.tileUnitsPerPx() : ROLODEX_SPIN_PER_PX;
      // the hero's helix lies on its side: it rolls with the pointer, up and down or across
      const dx = this.heroMode && !this.tilesView
        ? (e.clientY - drag.y + (e.clientX - drag.x) * 0.5) * u
        : (e.clientX - drag.x) * u;
      const dy = this.tilesView ? (e.clientY - drag.y) * u : 0;
      this.card.scrollTiles(dx, dy);
      // the speed it's let go at, smoothed over the last few moves
      drag.vx = drag.vx * 0.6 + (dx / dt) * 0.4;
      drag.vy = drag.vy * 0.6 + (dy / dt) * 0.4;
      Object.assign(drag, { x: e.clientX, y: e.clientY, t: now });
      return;
    }
    if (this.cardDragId !== null) {
      if (e.pointerId !== this.cardDragId) return;
      const now = performance.now();
      const dt = Math.max(1, now - this.cardLast.t) / 1000;
      this.card.drag(e.clientX - this.cardLast.x, e.clientY - this.cardLast.y, dt);
      this.cardLast = { x: e.clientX, y: e.clientY, t: now };
      return;
    }
    const active = this.grabbing || this.draggingDecal;
    if (active && e.pointerId !== this.grabPointerId) return;
    this.updatePointer(e);
    if (this.draggingDecal) {
      const hit = this.raycastCloth();
      const sel = this.surface.selected;
      if (hit?.uv && sel) {
        sel.u = hit.uv.x + this.decalGrabOffset.u;
        sel.v = hit.uv.y + this.decalGrabOffset.v;
        this.surface.redraw();
      }
      return;
    }
    if (!this.grabbing) return;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const target = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, target)) {
      this.sim.moveGrab(target);
    }
  };

  /** off the canvas: nothing is hovered */
  private onPointerLeave = () => {
    this.pointerOver = false;
    this.hovered = null;
    this.card.hoverPlate(null);
  };

  /**
   * The hovered plate, held: popping out slides it from under the pointer,
   * and letting go then would make it flicker in and out. It stays until
   * the pointer reaches another plate or moves well away from where it last
   * touched this one.
   */
  private stickyHover(under: number | null) {
    const px = this.pointerNdc;
    if (under !== null) {
      this.hovered = under;
      this.hoverAt.copy(px);
    } else if (this.hovered !== null) {
      const { width, height } = this.renderer.domElement.getBoundingClientRect();
      const moved = Math.hypot(((px.x - this.hoverAt.x) * width) / 2, ((px.y - this.hoverAt.y) * height) / 2);
      const gone = !this.cardMode || !this.card.stacked || this.cine || this.card.dragging || this.hovered === this.card.focusedPlate;
      if (moved > HOVER_HOLD_PX || gone) this.hovered = null;
    }
    return this.hovered;
  }

  private onPointerUp = (e: PointerEvent) => {
    const drag = this.tileDrag;
    if (drag && e.pointerId === drag.id) {
      this.tileDrag = null;
      // a pause before letting go: no glide
      const still = performance.now() - drag.t > 80;
      // a flicked Rolodex glides on, but never faster than a turn or so a second
      const vx = this.tilesView ? drag.vx : THREE.MathUtils.clamp(drag.vx, -ROLODEX_MAX_SPIN, ROLODEX_MAX_SPIN);
      this.card.holdTiles(false, still ? 0 : vx, still ? 0 : drag.vy);
      if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
    }
    const click = this.plateClick;
    if (click && e.pointerId === click.id) {
      this.plateClick = null;
      if (this.heroMode && Math.hypot(e.clientX - click.x, e.clientY - click.y) < 6) {
        this.onPageTap?.();
      } else if (Math.hypot(e.clientX - click.x, e.clientY - click.y) < 6) {
        const out = this.card.focusedPlate;
        // with a card out, a click anywhere off it just puts it back — it
        // never swaps to another card (the arrow keys step between them)
        if (out !== null) {
          if (click.plate !== out) this.focusPlate(null);
        } else if (click.plate !== null) this.focusPlate(click.plate);
      }
    }
    if (this.cardDragId !== null && e.pointerId === this.cardDragId) {
      this.card.dragging = false;
      this.cardDragId = null;
      this.controls.enabled = true;
      if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      }
      this.renderer.domElement.style.cursor = this.hoverCursor;
      return;
    }
    if (e.pointerId === this.pickReleaseId) {
      this.pickReleaseId = null;
      this.controls.enabled = true;
      return;
    }
    const active = this.grabbing || this.draggingDecal;
    if (!active || e.pointerId !== this.grabPointerId) return;
    this.grabbing = false;
    this.draggingDecal = false;
    this.grabPointerId = null;
    this.sim.endGrab();
    this.controls.enabled = true;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    }
    this.renderer.domElement.style.cursor = this.hoverCursor;
  };

  private onWheel = (e: WheelEvent) => {
    // Tiles: the wheel (or trackpad) scrolls the sheet
    if (this.tilesView && this.card.focusedPlate === null) {
      e.preventDefault();
      const u = this.tileUnitsPerPx();
      this.card.scrollTiles(-e.deltaX * u, -e.deltaY * u);
      return;
    }
    if (!this.editMode) return;
    const sel = this.surface.selected;
    if (!sel) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    sel.scale = THREE.MathUtils.clamp(sel.scale * Math.exp(-e.deltaY * 0.0012), 0.02, 2.5);
    this.surface.redraw();
    this.onDecalSelect?.(sel.scale, sel.rotation);
  };

  /** Fade the Tiles wall behind a pulled-out tile: the veil, sized to the view just behind the tile. */
  private updateVeil(dt: number) {
    const v = this.veil;
    const m = v.material as THREE.MeshBasicMaterial;
    // follows whether a tile is out at all, not how far one is: going from
    // one tile to the next, the wall stays faded
    const goal = this.tilesView && this.card.focusedPlate !== null ? 1 : 0;
    this.veilK = THREE.MathUtils.clamp(this.veilK + (goal ? dt : -dt) / VEIL_TIME, 0, 1);
    const k = this.veilK * this.veilK * (3 - 2 * this.veilK);
    m.opacity = TILE_VEIL * k;
    v.visible = m.opacity > 0.001;
    if (!v.visible) return;
    if (!v.parent) {
      // the veil rides with the camera, so the camera joins the scene
      if (!this.camera.parent) this.scene.add(this.camera);
      this.camera.add(v);
    }
    m.color.copy(this.background);
    // just in front of the wall, so tiles on their way out or back stay in front of it
    const d = TILE_VEIL_DIST;
    const hgt = 2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * 1.2;
    v.position.set(0, 0, -d);
    v.scale.set(hgt * this.camera.aspect * 1.2, hgt, 1);
  }

  /** how far a screen pixel moves the Tiles wall, at the wall's distance from the middle */
  private tileUnitsPerPx() {
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    return (2 * TILE_RADIUS * half) / Math.max(1, this.host.clientHeight);
  }

  /**
   * Ease the camera to a view: the stack from low at three-quarters, Tiles
   * from inside its drum, Front square on to the card (making a ticket).
   */
  frameView(view: string) {
    const tiles = view === 'Tiles';
    const to = tiles ? TILES_VIEW : DEFAULT_VIEW;
    const camera = new THREE.Vector3(...to.camera), target = new THREE.Vector3(...to.target);
    if (view === 'Front') {
      // facing the card, which fills a little over half the height: room for the console below
      const half = Math.tan(THREE.MathUtils.degToRad(LENS_FOV) / 2);
      // a little to the right, so the engraver's monitor beside it is in view too
      camera.set(FRONT_SHIFT, 0, this.card.dims.h / 2 / half / FRONT_FILL);
      target.set(FRONT_SHIFT, 0, 0);
    }
    this.camMove = {
      from: [this.camera.position.clone(), this.controls.target.clone(), this.camera.fov],
      to: [camera, target, tiles ? TILES_VIEW.fov : LENS_FOV],
      k: 0,
    };
    // drop any orbit still gliding: it would wait out the move, then push the camera off the view
    const glide = this.controls as unknown as { _sphericalDelta?: THREE.Spherical; _panOffset?: THREE.Vector3 };
    glide._sphericalDelta?.set(0, 0, 0);
    glide._panOffset?.set(0, 0, 0);
  }

  private onResize() {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.applyViewInset(width, height);
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    // a resize clears the canvas: draw straight away, or a canvas resized
    // every frame (opened full screen from a page) shows blank between frames
    if (this.revealed) this.composer.render();
  }

  /**
   * Centre the view in the space the panel leaves: shift the projection by
   * half the panel's overlap, so the camera's aim lands mid-way across the
   * open canvas. Hidden or collapsed, the panel takes no room.
   */
  private applyViewInset(width = this.host.clientWidth, height = this.host.clientHeight) {
    const f = this.pageFrame;
    const z = this.heroMode ? this.heroZoom : 1;
    // still in its place in the page (the frame is its own size, zoomed), it's drawn as there
    const small = !f || (Math.abs(width * z - f.w) <= 2 && Math.abs(height * z - f.h) <= 2);
    if (f && !small) {
      // drawn as if into the page's frame: the canvas is bigger, and shows the scene there
      this.camera.aspect = f.w / f.h;
      this.camera.setViewOffset(f.w, f.h, -f.x, -f.y, width, height);
    } else if (z !== 1) {
      // in the page, closer in: the middle of a canvas z times the size
      this.camera.aspect = width / height;
      this.camera.setViewOffset(width * z, height * z, ((z - 1) * width) / 2, ((z - 1) * height) / 2, width, height);
    } else {
      this.camera.aspect = width / height;
      if (this.viewInset > 0) this.camera.setViewOffset(width, height, this.viewInset / 2, 0, width, height);
      else this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  private measurePanel() {
    const panel = document.querySelector('.dialkit-panel');
    const host = this.host.getBoundingClientRect();
    const rect = panel?.getBoundingClientRect();
    // a collapsed panel is a small pill in the corner: it doesn't count
    const open = rect && rect.height > host.height * 0.5;
    const inset = open ? Math.max(0, Math.round(host.right - rect.left)) : 0;
    if (inset === this.viewInset) return;
    this.viewInset = inset;
    this.applyViewInset();
  }

  /**
   * One frame — guarded: a fault in it is reported (once per kind) and the
   * next frame runs anyway, rather than the whole piece freezing on it.
   */
  private tick = () => {
    try {
      this.frame();
    } catch (err) {
      const key = String((err as Error)?.message ?? err);
      if (!this.frameFaults.has(key)) {
        this.frameFaults.add(key);
        console.error('[holocloth] a frame failed; carrying on', err);
      }
    }
  };
  private frameFaults = new Set<string>();

  private frame() {
    if (this.disposed) return;
    // a stalled frame (a long task, a throttled window) is taken as a short one, not a leap
    const dt = Math.min(this.clock.getDelta(), MAX_DT);
    this.elapsed += dt;
    this.panelCheck -= dt;
    if (this.panelCheck <= 0) {
      this.panelCheck = 0.25;
      this.measurePanel();
    }
    this.grainPass.uniforms.uTime.value = this.elapsed % 61.7;

    if (this.slaps.length > 0) {
      // damped overshoot: lands big, dips just under, settles at 1
      this.slaps = this.slaps.filter((s) => {
        const t = this.elapsed - s.t0;
        if (t >= 0.45) {
          s.item.pop = 1;
          return false;
        }
        s.item.pop = 1 + 0.3 * Math.exp(-9 * t) * Math.cos(14 * t);
        return true;
      });
      this.surface.redrawStickers();
    }

    if (this.cine) this.runCinematic();
    if (this.cardMode) this.card.update(dt, this.elapsed);
    // the titles stand either side of the stack, out of the way of a ticket, the wall or a card being shown
    this.titleInk.set(this.background.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5 ? '#e8e6e1' : '#1a1a1a');
    this.card.setOutlineInk(this.titleInk, this.background);
    // the reel shows the stack as it is: its cards in place at once, never flying in
    this.card.setInstantPlates(!!this.cine);
    // and on the wall it scrolls slowly on, so new cards keep coming in under the camera
    if (this.cine && this.tilesView) this.card.scrollTiles(0, TILE_CINE_SCROLL * dt);
    // the first time the stack's in view, it opens: outlines drawn in, then the cards over them
    if (!this.opened && this.revealed && this.cardMode && this.card.stacked && !this.ticketing) {
      this.opened = true;
      this.card.beginIntro();
    }
    this.titles.update(
      dt,
      this.camera,
      this.controls.target,
      this.revealed && !this.titlesHeld && this.cardMode && this.card.stacked && !this.ticketing && !this.tilesView && this.card.focusedPlate === null && !this.cine,
      this.titleInk,
    );
    if (this.camMove) {
      const m = this.camMove;
      m.k = Math.min(1, m.k + dt / 1.2);
      const e = m.k < 0.5 ? 4 * m.k ** 3 : 1 - (-2 * m.k + 2) ** 3 / 2;
      // round the formation, not through it: the direction from its middle
      // swings across while the distance eases, so the camera never cuts
      // through the cards on its way between views
      const r0 = m.from[0].length(), r1 = m.to[0].length();
      camQ.setFromUnitVectors(camU0.copy(m.from[0]).normalize(), camU1.copy(m.to[0]).normalize());
      camQe.slerpQuaternions(IDENTITY_Q, camQ, e);
      this.camera.position.copy(camU0).applyQuaternion(camQe).multiplyScalar(THREE.MathUtils.lerp(r0, r1, e));
      this.controls.target.lerpVectors(m.from[1], m.to[1], e);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.controls.target);
      this.camera.fov = THREE.MathUtils.lerp(m.from[2], m.to[2], e);
      this.camera.updateProjectionMatrix();
      // a plate pulled out mid-move (Print shows the new ticket while the view is
      // still easing home): the pose it goes back to is where this move is going,
      // not where the camera was when the plate came out
      const rest = this.plateCam.rest;
      if (rest) {
        rest.position.copy(this.camera.position);
        rest.target.copy(this.controls.target);
        rest.up.set(0, 1, 0);
      }
      if (m.k >= 1) this.camMove = null;
    }
    // the laser waits for the stack to fold down to the one card, then cuts a pass per stage
    if (this.etch !== null) {
      const plan = this.etchPlan!;
      if (this.cardMode && !this.card.stacked) this.etch = Math.min(1, this.etch + dt / plan.seconds);
      if (this.etch < 1) {
        const head = headAt(plan, this.etch);
        this.card.setLaser(this.etch, head, this.elapsed);
        this.showOnMonitor();
        if (this.elapsed - this.laserReported > 0.07) {
          this.laserReported = this.elapsed;
          this.onLaser?.({ pass: this.etchPass, passes: this.etchPasses, progress: this.etch, u: head.u, v: head.v, firing: head.firing });
        }
      } else {
        // the name cut: the owner's letters open right through the card
        if (this.etchPass === LETTER_PASSES - 1) {
          this.setLettering(true, true);
          this.lettersCut = true;
        }
        if (this.etchPass + 1 < this.etchPasses && !(this.letterOnly && this.etchPass === LETTER_PASSES - 1)) {
          this.etchPass++;
          this.startPass();
        } else {
          this.finishEtch();
        }
      }
    }
    if (this.params && !this.cardMode) {
      const face = this.faceTracker?.poll();
      if (face) this.faceCollider.update(face);
      if (this.handTracker) this.holdWithHands();
      this.sim.step(dt, this.params.physics);
      this.clothGeometry.attributes.position.needsUpdate = true;
      this.clothGeometry.computeVertexNormals();
    }

    if (this.params?.render.occlusion && !this.cardMode) {
      this.sim.computeCavity(
        this.clothGeometry.attributes.normal.array,
        this.cavityAttr.array as Float32Array,
      );
      this.cavityAttr.needsUpdate = true;
    }
    if (this.params?.render.dof) {
      // picked focal point rides the fabric; otherwise focus the orbit target
      let focusDist: number;
      if (this.focusVertex !== null && this.focusVertex < this.sim.count) {
        const p = this.sim.positions;
        const i = this.focusVertex * 3;
        this.focusTmp.set(p[i], p[i + 1], p[i + 2]);
        focusDist = this.camera.position.distanceTo(this.focusTmp);
      } else {
        focusDist = this.camera.position.distanceTo(this.controls.target);
      }
      this.dofPass.setFocus(focusDist);
    }

    // hover cursor feedback (skip while dragging/picking/panning, with the
    // pointer off the canvas or the window out of focus; off on Low)
    if (!this.grabbing && !this.draggingDecal && !this.pickingFocus && !this.spaceHeld &&
        this.pointerOver && this.focused && this.perfProfile !== 'Low') {
      const hit = this.cardMode ? this.raycastCard() : this.raycastCloth();
      // a plate of the stack under the pointer pops out a little, and can be clicked
      // (the pulled-out plate is already as far out as it goes)
      const plate = this.cardMode && this.card.stacked && !this.cine && !this.card.dragging ? this.card.plateAt(hit) : null;
      const hovered = this.stickyHover(plate !== null && plate !== this.card.focusedPlate ? plate : null);
      this.card.hoverPlate(hovered);
      let cursor = 'default';
      if (hovered !== null) cursor = 'pointer';
      else if (hit) {
        cursor = this.editMode
          ? hit.uv && this.surface.hitTest(hit.uv.x, hit.uv.y) ? 'move' : 'default'
          : 'grab';
      }
      if (cursor !== this.hoverCursor) {
        this.hoverCursor = cursor;
        this.renderer.domElement.style.cursor = cursor;
      }
    }

    this.updatePlateCamera(dt);
    // the reel places the camera itself; damped controls would ease its cuts
    // Tiles is dragged and scrolled, never orbited: whatever else turned the
    // controls back on this frame, they stay off
    if (this.tilesView) {
      this.controls.enabled = false;
      // the wall's rows come and go as it scrolls: their tickets with them
      this.assignPlates();
    } else if (this.params?.stack?.shape === 'Helix' && this.card.stacked && !this.ticketing) {
      // the endless Helix: cards coming back round take the next tickets
      this.assignPlates();
    }
    this.updateVeil(dt);
    // a card out of the Helix: the rest of it steps aside, to the viewer's left
    if (this.card.focusedPlate !== null) {
      asideDir.setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(-HELIX_ASIDE);
      this.card.setAside(asideDir);
    }
    // Tiles is lit up, easing in and out with the view
    this.viewLight += ((this.tilesView ? TILES_LIGHT : 1) - this.viewLight) * (1 - Math.exp(-3 * dt));
    if (this.params && !this.cine) {
      // turned up on the wall — but a Field room already lights it brightly,
      // and its colour should read the same on the wall as on the stack
      const lift = isFieldRoom(this.lighting.current) ? 1 : this.viewLight;
      this.renderer.toneMappingExposure = this.params.render.exposure * lift;
      this.scene.environmentIntensity = this.params.render.environment * lift;
      // and its light comes from higher: the room tipped so the bright band
      // the wall reflects rides up toward its top, not across its middle
      const k = (this.viewLight - 1) / (TILES_LIGHT - 1);
      const tip = k * TILES_LIGHT_TIP;
      this.scene.environmentRotation.x = tip;
      this.lightRig.rotation.x = tip;
      // and turned round for the wall: the angle the Light Angle slider sets, plus the wall's own
      const turn = THREE.MathUtils.degToRad(this.params.render.lightAngle ?? 0) + k * TILES_LIGHT_TURN;
      this.scene.environmentRotation.y = turn;
      this.lightRig.rotation.y = turn;

    }
    if (!this.cine && this.plateCam.k === 0 && !this.camMove) this.controls.update();
    this.composer.render();
  }

  dispose() {
    this.disposed = true;
    if (this.cameraUrlTimer !== null) window.clearTimeout(this.cameraUrlTimer);
    this.ticketArt?.dispose();
    this.ticketGround?.dispose();
    this.lighting.dispose();
    this.faceTracker?.stop();
    this.handTracker?.stop();
    this.runLoop(); // disposed: stops it
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('focus', this.onWindowFocus);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controls.dispose();
    this.dofPass.dispose();
    this.composer.dispose();
    this.clothGeometry.dispose();
    this.holoMaterial.dispose();
    this.surface.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== this.clothGeometry) mesh.geometry.dispose();
    });
    this.renderer.dispose();
    canvas.remove();
  }
}
