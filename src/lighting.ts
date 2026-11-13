import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Lighting setups. Each is an environment (what the metal reflects and is
 * lit by: a room of glowing panels, rendered once into a PMREM) and up to
 * three direct lights for crisp specular. Studio is the original: the
 * neutral room with a cool rim, a warm rim and a white key.
 *
 * The camera looks down -z at the card, so panels toward +z (behind the
 * camera) are what a face-on card mirrors; panels to the sides catch it
 * as it turns.
 */
export const LIGHTING = ['Field', 'Field Green', 'Field Supabase', 'Field Studio', 'Studio', 'Softbox', 'Strips', 'Window', 'Neon', 'Ring', 'Sunset', 'Supabase', 'Aurora', 'Green Neon'] as const;

/** a room painted with the page's colour field (Field and its variants) */
export const isFieldRoom = (name: string) => name.startsWith('Field');

/** Supabase green, #3ECF8E, as linear-ish light colour */
const GREEN: [number, number, number] = [0.24, 0.81, 0.56];

type DirLight = { color: THREE.ColorRepresentation; intensity: number; position: [number, number, number] };

/** the direct lights per setup; missing ones are off */
const LIGHTS: Record<string, DirLight[]> = {
  // the page's colour field as the room; one soft key from above for the glints
  Field: [{ color: 0xffffff, intensity: 0.6, position: [0.5, 5, 3] }],
  // the field in Supabase greens
  'Field Green': [
    { color: 0xf0fff8, intensity: 0.9, position: [0.5, 5, 3] },
    { color: 0x8af0c4, intensity: 0.4, position: [-4, 1, 2] },
  ],
  // the field room, lit as Supabase is: a green key low at the side, a teal fill
  'Field Supabase': [
    { color: 0x3ecf8e, intensity: 1.3, position: [-5, 0.6, 3] },
    { color: 0x1b6b8f, intensity: 0.4, position: [4, 3, 1] },
  ],
  // the field room, lit as Studio is: a cool rim, a warm rim and a white key
  'Field Studio': [
    { color: 0x7fd4ff, intensity: 1.0, position: [-4, 2.5, -3] },
    { color: 0xff9ad5, intensity: 0.8, position: [4.5, -1.5, -2.5] },
    { color: 0xffffff, intensity: 0.6, position: [1.5, 3, 4] },
  ],
  Studio: [
    { color: 0x7fd4ff, intensity: 1.1, position: [-4, 2.5, -3] },
    { color: 0xff9ad5, intensity: 0.9, position: [4.5, -1.5, -2.5] },
    { color: 0xffffff, intensity: 0.7, position: [1.5, 3, 4] },
  ],
  Softbox: [
    { color: 0xffffff, intensity: 1.2, position: [0.5, 5, 3] },
    { color: 0xf2f4ff, intensity: 0.3, position: [-3, 0, 4] },
  ],
  Strips: [
    { color: 0xffffff, intensity: 1.4, position: [-4, 1, -3] },
    { color: 0xffffff, intensity: 1.4, position: [4, 1, -3] },
    { color: 0xffffff, intensity: 0.25, position: [0, 2, 5] },
  ],
  Window: [
    { color: 0xffe9cc, intensity: 1.4, position: [-5, 2, 2.5] },
    { color: 0xcfe0ff, intensity: 0.25, position: [4, 0, 3] },
  ],
  Neon: [
    { color: 0xff2fa8, intensity: 1.6, position: [-4, 1, -2] },
    { color: 0x22d6ff, intensity: 1.6, position: [4, -0.5, -2] },
  ],
  Ring: [{ color: 0xffffff, intensity: 0.9, position: [0, 0.5, 5] }],
  Sunset: [
    { color: 0xff9a4d, intensity: 1.6, position: [-5, 0.6, 3] },
    { color: 0x5c7cff, intensity: 0.4, position: [4, 3, 1] },
  ],
  Supabase: [
    { color: 0x3ecf8e, intensity: 1.6, position: [-5, 0.6, 3] },
    { color: 0x1b6b8f, intensity: 0.4, position: [4, 3, 1] },
  ],
  Aurora: [
    { color: 0x6dffc0, intensity: 1.1, position: [-2, 5, 2] },
    { color: 0x2bb3c0, intensity: 0.8, position: [4, 2, -2] },
  ],
  'Green Neon': [
    { color: 0x3ecf8e, intensity: 1.6, position: [-4, 1, -2] },
    { color: 0xb6ff5c, intensity: 1.2, position: [4, -0.5, -2] },
  ],
};

/**
 * A sky: a colour overhead, a glowing horizon, dark ground, and a low sun
 * off to the front left.
 */
function sky(scene: THREE.Scene, top: THREE.Color, horizon: THREE.Color, ground: THREE.Color, sunColor: THREE.Color) {
  const dome = new THREE.SphereGeometry(15, 48, 24);
  const colors: number[] = [];
  const pos = dome.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 15;
    if (y >= 0) c.copy(horizon).lerp(top, Math.pow(y, 0.45));
    else c.copy(horizon).lerp(ground, Math.min(1, -y * 4));
    colors.push(c.r, c.g, c.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 12), new THREE.MeshBasicMaterial({ color: sunColor }));
  sun.position.set(-8, 1, 7);
  scene.add(sun);
}

/** an emissive panel, brightness above 1 so it reads as a light source */
function panel(scene: THREE.Scene, w: number, h: number, color: [number, number, number], at: [number, number, number]) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(...color), side: THREE.DoubleSide }),
  );
  mesh.position.set(...at);
  mesh.lookAt(0, 0, 0);
  scene.add(mesh);
  return mesh;
}

/** the room itself: a box, its walls a flat dim tone */
function room(scene: THREE.Scene, tone: number) {
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(30, 30, 30),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(tone, tone, tone), side: THREE.BackSide }),
  ));
}

const s = (k: number, rgb: [number, number, number]): [number, number, number] => [rgb[0] * k, rgb[1] * k, rgb[2] * k];

/** The scene each setup's environment is rendered from. */
/**
 * A room painted with the colour field: a sphere all round, the field
 * mirrored twice about it so it meets itself without a seam, and a soft
 * bright patch overhead where the key light is.
 */
function fieldScene(field: HTMLImageElement, green = false, panels = true): THREE.Scene {
  const scene = new THREE.Scene();
  const c = document.createElement('canvas');
  c.width = field.naturalWidth || 32;
  c.height = field.naturalHeight || 48;
  const g = c.getContext('2d')!;
  if (green) {
    // the field's light and shade, in Supabase greens (the field is pastel:
    // its light and shade pulled darker first, so the greens run deep)
    g.filter = 'grayscale(1) contrast(2.2) brightness(0.7)';
    g.drawImage(field, 0, 0, c.width, c.height);
    g.filter = 'none';
    // one green, #3ECF8E, throughout — only its light and shade vary — so a
    // card shows the same green whichever way it faces, on the stack or the wall
    g.globalCompositeOperation = 'color';
    g.fillStyle = '#3ecf8e';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
  } else {
    // the field, richer: its greens and peaches carry as light, not just its blue
    g.filter = 'saturate(1.9) contrast(1.15)';
    g.drawImage(field, 0, 0, c.width, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // round the room three times, mirrored to meet itself, so the wall's
  // columns, each facing a little differently, catch a different part of it;
  // and top to bottom squeezed into the band round the horizon the cards
  // mostly see, so its pinks, greens and peaches reach them, not only its blue
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.repeat.set(6, 2);
  tex.offset.set(0, 0.5);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(10, 64, 32),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, color: new THREE.Color().setScalar(0.95) }),
  );
  scene.add(room);
  if (!panels) return scene;
  if (green) {
    // bright sources to catch: a soft box overhead and two tall pale-mint
    // strips at the sides, so the stack's metal glints (and glows) as it turns
    panel(scene, 5, 4, s(2.2, [1, 1, 1]), [0, 8, 1]);
    panel(scene, 0.8, 7, s(1.8, [0.75, 1, 0.88]), [-7, 0.5, 3]);
    panel(scene, 0.8, 7, s(1.8, [0.75, 1, 0.88]), [7, 0.5, 3]);
    // a low strip behind the viewer, just above eye line: a card shown
    // square to the view mirrors this side, and leaning up toward the
    // cursor sweeps it into the glint
    panel(scene, 6, 1.6, s(1.6, [1, 1, 1]), [0, 1.8, 8]);
  } else {
    panel(scene, 5, 5, s(1.6, [1, 1, 1]), [0, 8, 1]);
  }
  return scene;
}

function environmentScene(name: string): THREE.Scene {
  if (name === 'Studio') return new RoomEnvironment();
  const scene = new THREE.Scene();
  switch (name) {
    case 'Softbox': {
      // product photography: a big soft box in front, one overhead, two tall strips at the sides
      room(scene, 0.06);
      panel(scene, 7, 5, s(3, [1, 1, 1]), [0, 1.5, 7]);
      panel(scene, 9, 9, s(4, [1, 1, 1]), [0, 7, 1]);
      panel(scene, 1.4, 7, s(4, [1, 1, 1]), [-5, 0.5, 3]);
      panel(scene, 1.4, 7, s(4, [1, 1, 1]), [5, 0.5, 3]);
      break;
    }
    case 'Strips': {
      // a dark studio and hard strips: clean lines of light slide over the metal
      room(scene, 0.01);
      panel(scene, 0.5, 12, s(14, [1, 1, 1]), [-1.6, 0, 7]);
      panel(scene, 0.5, 12, s(14, [1, 1, 1]), [1.6, 0, 7]);
      panel(scene, 0.35, 12, s(10, [1, 1, 1]), [-5, 0, 3]);
      panel(scene, 0.35, 12, s(10, [1, 1, 1]), [5, 0, 3]);
      panel(scene, 10, 0.3, s(8, [1, 1, 1]), [0, 5, 4]);
      break;
    }
    case 'Window': {
      // one big daylight window, front left; a white bounce card to the right
      room(scene, 0.18);
      panel(scene, 6, 8, s(4.5, [1, 0.94, 0.86]), [-4.5, 1.5, 6]);
      panel(scene, 3, 4, s(0.9, [1, 1, 1]), [5, -0.5, 4]);
      break;
    }
    case 'Neon': {
      // a black room with coloured tubes: magenta and cyan in front, violet overhead
      room(scene, 0.01);
      panel(scene, 0.4, 10, s(10, [1, 0.1, 0.6]), [-2.2, 0, 6.5]);
      panel(scene, 0.4, 10, s(10, [0.1, 0.8, 1]), [2.2, 0, 6.5]);
      panel(scene, 0.3, 10, s(6, [1, 0.1, 0.6]), [-5, 0, 2]);
      panel(scene, 0.3, 10, s(6, [0.1, 0.8, 1]), [5, 0, 2]);
      panel(scene, 8, 0.3, s(7, [0.55, 0.3, 1]), [0, 5, 3]);
      break;
    }
    case 'Ring': {
      // a ring light behind the camera: a halo in every polished face
      room(scene, 0.05);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.2, 0.22, 16, 96),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 9, 9) }),
      );
      ring.position.set(0, 0, 7);
      ring.lookAt(0, 0, 0);
      scene.add(ring);
      break;
    }
    case 'Sunset': {
      // deep blue overhead, an orange horizon, a low sun
      sky(scene, new THREE.Color(0.04, 0.07, 0.2), new THREE.Color(2.4, 1.0, 0.35), new THREE.Color(0.03, 0.025, 0.03), new THREE.Color(30, 16, 6));
      break;
    }
    case 'Supabase': {
      // the sunset in Supabase green: dark teal overhead, a green horizon, a pale mint sun
      sky(scene, new THREE.Color(0.01, 0.05, 0.06), new THREE.Color(...s(3, GREEN)), new THREE.Color(0.01, 0.025, 0.02), new THREE.Color(14, 30, 20));
      break;
    }
    case 'Aurora': {
      // a dark room under curtains of green and teal light
      room(scene, 0.01);
      panel(scene, 14, 1.4, s(5, GREEN), [0, 6, 4]);
      panel(scene, 12, 0.9, s(4, [0.43, 1, 0.75]), [-1, 5, 7]);
      panel(scene, 10, 0.7, s(3.5, [0.17, 0.7, 0.75]), [1, 4, 1]);
      panel(scene, 6, 4, s(1.2, GREEN), [0, 0, 7.5]);
      break;
    }
    case 'Green Neon': {
      // tubes in Supabase green, mint and lime
      room(scene, 0.01);
      panel(scene, 0.4, 10, s(10, GREEN), [-2.2, 0, 6.5]);
      panel(scene, 0.4, 10, s(9, [0.71, 1, 0.36]), [2.2, 0, 6.5]);
      panel(scene, 0.3, 10, s(7, [0.43, 1, 0.75]), [-5, 0, 2]);
      panel(scene, 0.3, 10, s(7, GREEN), [5, 0, 2]);
      panel(scene, 8, 0.3, s(6, [0.43, 1, 0.75]), [0, 5, 3]);
      break;
    }
  }
  return scene;
}

/**
 * Builds and keeps each setup's environment (made once, on first use), and
 * points the direct lights for it.
 */
export class Lighting {
  private envs = new Map<string, THREE.Texture>();
  readonly lights: THREE.DirectionalLight[] = [0, 1, 2].map(() => new THREE.DirectionalLight());
  current = '';

  constructor(private renderer: THREE.WebGLRenderer) {}

  /**
   * Field's room is painted with the page's colour field: the gradient the
   * cards used to print, now the light they reflect. Give it the field
   * image before using Field (until then Field falls back to Studio).
   */
  setField(field: HTMLImageElement) {
    this.field = field;
    for (const [key, env] of this.envs) {
      if (!isFieldRoom(key)) continue;
      env.dispose();
      this.envs.delete(key);
    }
  }
  private field: HTMLImageElement | null = null;

  /**
   * set up `name`; returns its environment for scene.environment. Smooth:
   * a Field room without its bright panels — on a wall of flat cards, a
   * panel catches one card and skips the next, so light jumps about rather
   * than carrying across it
   */
  use(name: string, smooth = false): THREE.Texture {
    const setup = LIGHTS[name] && (!isFieldRoom(name) || this.field) ? name : 'Studio';
    this.current = setup;
    const plain = smooth && isFieldRoom(setup);
    const key = plain ? `${setup}|smooth` : setup;
    let env = this.envs.get(key);
    if (!env) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const scene = isFieldRoom(setup) ? fieldScene(this.field!, setup === 'Field Green', !plain) : environmentScene(setup);
      env = pmrem.fromScene(scene, 0.04).texture;
      pmrem.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
      this.envs.set(key, env);
    }
    this.lights.forEach((light, i) => {
      const d = LIGHTS[setup][i];
      light.visible = !!d;
      if (!d) return;
      light.color.set(d.color);
      light.intensity = d.intensity;
      light.position.set(...d.position);
    });
    return env;
  }

  dispose() {
    for (const env of this.envs.values()) env.dispose();
    this.envs.clear();
  }
}
