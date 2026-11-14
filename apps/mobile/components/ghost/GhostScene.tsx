import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import model from './models/base.json';
import redes from './models/redes.json';
import secretaria from './models/secretaria.json';

// The ghost, modelled in Blender by design/blender/ghost.py, in the glowing look
// Álvaro picked (2026-11-13): an iridescent body, cyan and violet at the top, deep
// blue in the middle, orange and pink at the dripping hem; hollow dark eyes whose
// shape is the expression; stubby arms. Spike only, to judge the look live on a
// phone.

export type SpinState = {
  yaw: number; // radians, the turn the finger gave it
  velocity: number; // radians per second, kept after release for inertia
  dragging: boolean;
  hopAt: number | 'now' | null; // when the last tap's hop started; a tap sets 'now'
};

const STAGE = '#EEEEF2';
const EYE = '#0B0B26';
const EYE_RIM = '#9FE4FF';

// The model's top and the depth where its skirt starts to wave (see
// design/blender/ghost.py, which builds it).
const DOME_HEIGHT = 1.0;
const SKIRT = 0.72;

type Part = { position: number[]; normal: number[]; index: number[] };

function partGeometry(part: Part) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(part.position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(part.normal, 3));
  g.setIndex(part.index);
  return g;
}

// The body at rest (eyes are wrapped onto it) and the arm, shared by every ghost.
const BODY_REST = partGeometry(model.body);
const ARM = partGeometry(model.arm);
const SECRETARIA_PARTS = {
  bun: partGeometry(secretaria.bun),
  scarf: partGeometry(secretaria.scarf),
  phone: partGeometry(secretaria.phone),
  paper: partGeometry(secretaria.paper),
  spiral: partGeometry(secretaria.spiral),
  ink: partGeometry(secretaria.ink),
  pen: partGeometry(secretaria.pen),
};
const REDES_PARTS = {
  beret: partGeometry(redes.beret),
  handset: partGeometry(redes.handset),
  lenses: partGeometry(redes.lenses),
  screen: partGeometry(redes.screen),
  peace: partGeometry(redes.peace), // in the arm's own frame: drawn inside the arm
};

// --- The glowing material -------------------------------------------------

// The shader writes its colour straight to the screen, so it gets the hex values
// as they are (sRGB), not converted to linear.
function srgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const vertexShader = /* glsl */ `
  uniform float uBaseY;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  varying float vY;
  void main() {
    // Height in the body's frame, so arms and props pick up the same gradient.
    vY = (modelMatrix * vec4(position, 1.0)).y - uBaseY;
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

// The look of the reference pictures: saturated cyan, blue and violet above,
// orange and pink at the hem, mottled like an oil film, very glossy (a soft studio
// window reflected on top, sharp highlights), and a bright iridescent rim.
const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uYBottom;
  uniform float uYTop;
  uniform float uStripes; // 1 for the silk scarf's print
  uniform float uSilver;  // 0..1, towards a pale chrome (the phone)
  uniform vec3 uCyan;
  uniform vec3 uBlue;
  uniform vec3 uViolet;
  uniform vec3 uOrange;
  uniform vec3 uPink;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  varying float vY;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  vec3 film(float t) {
    return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67)));
  }

  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(vView);
    float h = clamp((vY - uYBottom) / (uYTop - uYBottom), 0.0, 1.0);
    float n = noise(vLocal * 2.2 + vec3(0.0, uTime * 0.06, 0.0)) * 0.65 + noise(vLocal * 5.0) * 0.35;

    // Body colour: cyan on the lit side, violet on the other, deep blue in the
    // middle, orange to pink at the hem; the noise breaks the bands into patches.
    float side = smoothstep(-0.75, 0.75, N.x + (n - 0.5) * 0.9);
    vec3 top = mix(uCyan, uViolet, side);
    vec3 mid = mix(uBlue, uViolet, smoothstep(0.35, 1.0, side));
    vec3 low = mix(uOrange, uPink, smoothstep(0.3, 0.8, n + 0.35 * N.x));
    vec3 base = mix(low, mid, smoothstep(0.1, 0.38, h + (n - 0.5) * 0.14));
    base = mix(base, top, smoothstep(0.52, 0.85, h + (n - 0.5) * 0.12));

    if (uStripes > 0.5) {
      // A loose silk print: soft diagonal bands of the body's own colours.
      float s = sin((vLocal.x * 1.3 + vLocal.y * 1.0 + vLocal.z * 0.6) * 22.0 + n * 7.0);
      vec3 print = mix(mix(uCyan, uViolet, n), mix(uOrange, uPink, n), smoothstep(-0.3, 0.3, s));
      base = mix(base, print, 0.55);
    }
    base = mix(base, vec3(0.82, 0.85, 0.95), uSilver);

    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.0);
    vec3 col = mix(base, film(fres * 0.8 + n * 0.5 + h * 0.3 + uTime * 0.03), fres * 0.55 + 0.06);

    // Soft key light from the upper left, never dark: it glows from within.
    vec3 L = normalize(vec3(-0.5, 0.7, 0.55));
    col *= 0.7 + 0.3 * max(dot(N, L), 0.0);
    col += base * 0.1;

    // Gloss: a studio window reflected on top, and a sharp highlight.
    vec3 R = reflect(-V, N);
    // Only the head and shoulders face up enough to catch the window; the flared
    // skirt would otherwise mirror it as a white blaze.
    float window = smoothstep(0.7, 0.92, R.y) * smoothstep(-0.6, 0.1, -R.x) * smoothstep(0.35, 0.7, h);
    col += window * (0.28 + 0.3 * uSilver);
    // The flared skirt faces up into the key light too: keep its highlight small.
    col += pow(max(dot(R, L), 0.0), 90.0) * mix(0.15, 0.9, smoothstep(0.3, 0.55, h));

    // A bright rainbow rim where the surface turns away.
    col += pow(fres, 2.6) * 0.65 * film(n + 0.55);

    // Roll bright values off softly, so highlights stay coloured, not flat white.
    col = col / (1.0 + max(col - 0.85, 0.0) * 1.2);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

function glowMaterial(yBottom: number, yTop: number, { stripes = false, silver = 0 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uBaseY: { value: 0 },
      uYBottom: { value: yBottom },
      uYTop: { value: yTop },
      uStripes: { value: stripes ? 1 : 0 },
      uSilver: { value: silver },
      uCyan: { value: srgb('#22C8F5') },
      uBlue: { value: srgb('#2E5FE4') },
      uViolet: { value: srgb('#A34CF5') },
      uOrange: { value: srgb('#FF8C3A') },
      uPink: { value: srgb('#F35BC6') },
    },
  });
}

// --- Eyes: the expression is the shape of the hole --------------------------

export const EXPRESSIONS = ['neutral', 'happy', 'surprised', 'focused', 'sleepy'] as const;
// 'closed' is never an expression of its own: it is the blink, and the moment
// between two expressions.
type Shape = (typeof EXPRESSIONS)[number] | 'closed';
const SHAPES: Shape[] = [...EXPRESSIONS, 'closed'];

const EYE_RX = 0.105;
const EYE_RY = 0.16;
const EYE_X = 0.2;
const EYE_Y = 0.46;

function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, n = 24) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    pts.push(new THREE.Vector2(cx + rx * Math.cos(a), cy + ry * Math.sin(a)));
  }
  return pts;
}

function eyeOutline(kind: Shape, grow: number): THREE.Vector2[] {
  const rx = EYE_RX * grow;
  const ry = EYE_RY * grow;
  switch (kind) {
    case 'neutral':
      return arc(0, 0, rx, ry, 0, Math.PI * 2, 40);
    case 'surprised':
      return arc(0, 0.01, rx * 1.3, ry * 1.02, 0, Math.PI * 2, 40);
    case 'closed':
      return arc(0, -0.03, rx * 1.1, ry * 0.1, 0, Math.PI * 2, 32);
    case 'focused':
      return arc(0, -0.02, rx * 1.15, ry * 0.3, 0, Math.PI * 2, 40);
    case 'sleepy':
      // The lower half of the oval: an eyelid lowered over the top.
      return arc(0, -0.01, rx * 1.05, ry * 0.9, Math.PI, Math.PI * 2, 24);
    case 'happy': {
      // An upturned crescent, like ^ drawn thick.
      const outer = arc(0, -0.04, rx * 1.15, ry * 0.95, 0, Math.PI, 24);
      const inner = arc(0, -0.04, rx * 1.15 * 0.58, ry * 0.95 * 0.45, Math.PI, 0, 24);
      return [...outer, ...inner];
    }
  }
}

// Where the body's front surface is, found by a ray from in front of it.
const surface = new THREE.Mesh(BODY_REST, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
const ray = new THREE.Raycaster();
const AHEAD = new THREE.Vector3();
const BACK = new THREE.Vector3(0, 0, -1);
function surfaceZ(x: number, y: number) {
  ray.set(AHEAD.set(x, y, 5), BACK);
  return ray.intersectObject(surface, false)[0]?.point.z ?? 0;
}

// A flat eye shape wrapped onto the body, so it sits on the curved surface.
function eyeGeometry(kind: Shape, side: -1 | 1, grow: number, lift: number) {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(eyeOutline(kind, grow)), 1);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = side * EYE_X + pos.getX(i);
    const y = EYE_Y + pos.getY(i);
    pos.setXYZ(i, x, y, surfaceZ(x, y) + lift);
  }
  pos.needsUpdate = true;
  return geo;
}

type EyeSet = Record<Shape, { hole: THREE.BufferGeometry[]; rim: THREE.BufferGeometry[] }>;

function buildEyes(): EyeSet {
  const set = {} as EyeSet;
  for (const kind of SHAPES) {
    set[kind] = {
      hole: [eyeGeometry(kind, -1, 1, 0.022), eyeGeometry(kind, 1, 1, 0.022)],
      rim: [eyeGeometry(kind, -1, 1.09, 0.014), eyeGeometry(kind, 1, 1.09, 0.014)],
    };
  }
  return set;
}

// --- The scene ---------------------------------------------------------------

const SWAP_TIME = 0.16; // seconds the eyes stay shut between two expressions
const BLINK_TIME = 0.12;

export type Agent = 'base' | 'secretaria' | 'redes';

// Each arm hangs from a shoulder inside the body: `angle` swings it out from the
// side (radians, 0 = straight down), `forward` brings it towards the camera.
type ArmPose = { angle: number; forward: number; swing: number };
const POSES: Record<Agent, [ArmPose, ArmPose]> = {
  base: [
    { angle: 0.95, forward: 0.2, swing: 0.1 },
    { angle: 0.95, forward: 0.2, swing: 0.1 },
  ],
  // Kept in step with posed_arm() in design/blender/ghost.py, whose props sit at
  // these hands.
  secretaria: [
    { angle: 2.3, forward: -0.45, swing: 0.03 }, // her right, the viewer's left: phone to the ear
    { angle: 0.4, forward: 0.35, swing: 0.05 }, // by the notepad
  ],
  // Kept in step with REDES_ARMS in design/blender/ghost.py.
  redes: [
    { angle: 2.35, forward: -0.25, swing: 0.03 }, // her right, the viewer's left: the phone up for a selfie
    { angle: 2.45, forward: 0.2, swing: 0.06 }, // the peace sign
  ],
};
const SHOULDER_X = 0.56;
const SHOULDER_Y = -0.02;

export function GhostScene({ spin, agent = 'base' }: { spin: React.RefObject<SpinState>; agent?: Agent }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const holes = useRef<(THREE.Mesh | null)[]>([]);
  const rims = useRef<(THREE.Mesh | null)[]>([]);
  const arms = useRef<(THREE.Group | null)[]>([]);
  const shadow = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => BODY_REST.clone(), []);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const base = useMemo(() => Float32Array.from(position.array), [position]);
  const bodyMaterial = useMemo(() => glowMaterial(-SKIRT - 0.1, DOME_HEIGHT), []);
  const scarfMaterial = useMemo(() => glowMaterial(-SKIRT - 0.1, DOME_HEIGHT, { stripes: true }), []);
  const phoneMaterial = useMemo(() => glowMaterial(-SKIRT - 0.1, DOME_HEIGHT, { silver: 0.45 }), []);
  const glows = [bodyMaterial, scarfMaterial, phoneMaterial];
  const eyeSet = useMemo(buildEyes, []);

  const nextBlink = useRef(2);
  const expression = useRef(0);
  const swapAt = useRef<number | null>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const s = spin.current;
    if (!s || !root.current || !body.current || !shadow.current) return;
    for (const m of glows) m.uniforms.uTime!.value = t;

    // Hem: a wave travels round the lobes the model already has, growing to the edge.
    const pos = position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]!;
      const y = base[i * 3 + 1]!;
      const z = base[i * 3 + 2]!;
      if (y > 0) continue;
      const w = (-y / SKIRT) ** 2.2;
      const angle = Math.atan2(z, x);
      const wave = Math.sin(angle * 6 + t * 2.4);
      pos.setY(i, y + 0.035 * wave * w);
      const push = 1 + 0.025 * Math.sin(angle * 6 + t * 2.4 + 1.2) * w;
      pos.setX(i, x * push);
      pos.setZ(i, z * push);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    // Spin: follow the finger, coast after release, then drift back to face us.
    if (!s.dragging) {
      if (Math.abs(s.velocity) > 0.3) {
        s.yaw += s.velocity * delta;
        s.velocity *= Math.exp(-2.5 * delta);
      } else {
        s.velocity = 0;
        const home = Math.round(s.yaw / (Math.PI * 2)) * Math.PI * 2 + Math.sin(t * 0.5) * 0.18;
        s.yaw += (home - s.yaw) * (1 - Math.exp(-2.2 * delta));
      }
    }

    // Tap: a little hop, and the next expression.
    let hop = 0;
    if (s.hopAt === 'now') {
      s.hopAt = t;
      swapAt.current = t;
      expression.current = (expression.current + 1) % EXPRESSIONS.length;
    }
    if (s.hopAt !== null) {
      const p = (t - s.hopAt) / 0.6;
      if (p >= 1) s.hopAt = null;
      else hop = Math.sin(Math.PI * p) * 0.3;
    }

    const float = Math.sin(t * 1.6) * 0.08;
    root.current.rotation.y = s.yaw;
    body.current.position.y = float + hop;
    body.current.rotation.z = Math.sin(t * 1.1) * 0.04;
    body.current.rotation.x = Math.sin(t * 0.8) * 0.03;

    for (const m of glows) m.uniforms.uBaseY!.value = body.current.position.y;

    // Arms sway a beat behind the body and fling up a little on a hop.
    arms.current.forEach((arm, i) => {
      if (!arm) return;
      const side = i === 0 ? -1 : 1;
      const pose = POSES[agent][i]!;
      const sway = Math.sin(t * 1.6 - 0.9 + i * 1.3) * pose.swing;
      arm.rotation.z = side * (pose.angle + sway + hop * 0.8);
      arm.rotation.x = -pose.forward;
    });

    const lift = float + hop;
    const k = 1 - lift * 0.6;
    shadow.current.scale.set(k, k, k);
    (shadow.current.material as THREE.MeshBasicMaterial).opacity = 0.14 * k;

    // Eyes: a tap shuts them briefly and they reopen in the next expression.
    // Round eyes also blink now and then. Shapes are swapped, never squashed,
    // so they stay on the curved surface.
    let kind: Shape = EXPRESSIONS[expression.current]!;
    if (swapAt.current !== null) {
      if (t - swapAt.current < SWAP_TIME) kind = 'closed';
      else swapAt.current = null;
    }
    if (kind === 'neutral' || kind === 'surprised') {
      if (t > nextBlink.current + BLINK_TIME) nextBlink.current = t + 2.5 + Math.random() * 2.5;
      if (t > nextBlink.current) kind = 'closed';
    }
    for (let i = 0; i < 2; i++) {
      const hole = holes.current[i];
      const rim = rims.current[i];
      if (hole) hole.geometry = eyeSet[kind].hole[i]!;
      if (rim) rim.geometry = eyeSet[kind].rim[i]!;
    }
  });

  return (
    <>
      <color attach="background" args={[STAGE]} />
      {/* Only the paper, the spiral and the pen use scene lights; the glow lights itself. */}
      <hemisphereLight args={['#FFFFFF', '#C9C2E8', 1.8]} />
      <directionalLight position={[-2.5, 4, 3]} intensity={1.6} />

      <mesh ref={shadow} rotation-x={-Math.PI / 2} position-y={-1.04}>
        <circleGeometry args={[0.95, 48]} />
        <meshBasicMaterial color="#5B4A9A" transparent opacity={0.14} depthWrite={false} />
      </mesh>

      <group ref={root}>
        <group ref={body}>
          <mesh geometry={geometry} material={bodyMaterial} />

          <group>
            {[0, 1].map((i) => (
              <group key={i}>
                <mesh ref={(m) => void (rims.current[i] = m)} geometry={eyeSet.neutral.rim[i]}>
                  <meshBasicMaterial color={EYE_RIM} transparent opacity={0.7} />
                </mesh>
                <mesh ref={(m) => void (holes.current[i] = m)} geometry={eyeSet.neutral.hole[i]}>
                  <meshBasicMaterial color={EYE} />
                </mesh>
              </group>
            ))}
          </group>

          {[0, 1].map((i) => (
            <group
              key={i}
              ref={(g) => void (arms.current[i] = g)}
              position={[(i === 0 ? -1 : 1) * SHOULDER_X, SHOULDER_Y, 0.08]}
            >
              <mesh geometry={ARM} material={bodyMaterial} />
              {agent === 'redes' && i === 1 && <mesh geometry={REDES_PARTS.peace} material={bodyMaterial} />}
            </group>
          ))}

          {agent === 'secretaria' && (
            <>
              <mesh geometry={SECRETARIA_PARTS.bun} material={bodyMaterial} />
              <mesh geometry={SECRETARIA_PARTS.scarf} material={scarfMaterial} />
              <mesh geometry={SECRETARIA_PARTS.phone} material={phoneMaterial} />
              <mesh geometry={SECRETARIA_PARTS.paper}>
                <meshStandardMaterial color="#FBFAFF" roughness={0.55} />
              </mesh>
              <mesh geometry={SECRETARIA_PARTS.spiral}>
                <meshStandardMaterial color="#E9B7A6" metalness={0.8} roughness={0.25} />
              </mesh>
              <mesh geometry={SECRETARIA_PARTS.ink}>
                <meshBasicMaterial color="#3B3E9E" />
              </mesh>
              <mesh geometry={SECRETARIA_PARTS.pen}>
                <meshStandardMaterial color="#3A3F9C" metalness={0.4} roughness={0.3} />
              </mesh>
            </>
          )}

          {agent === 'redes' && (
            <>
              <mesh geometry={REDES_PARTS.beret}>
                <meshStandardMaterial color="#2B2F95" roughness={0.55} />
              </mesh>
              <mesh geometry={REDES_PARTS.handset} material={phoneMaterial} />
              <mesh geometry={REDES_PARTS.lenses}>
                <meshStandardMaterial color="#15152E" metalness={0.6} roughness={0.15} />
              </mesh>
              <mesh geometry={REDES_PARTS.screen}>
                <meshBasicMaterial color="#CFE0FF" />
              </mesh>
            </>
          )}
        </group>
      </group>
    </>
  );
}

