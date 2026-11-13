import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// A placeholder ghost built in code (no model file), in the glowing look Álvaro
// picked (2026-11-13): an iridescent body that fades from cyan and violet at the
// top to peach at the wavy hem, hollow dark eyes whose shape is the expression,
// and stubby arms. Props share the body's glow. Spike only, to judge the look
// live on a phone.

export type SpinState = {
  yaw: number; // radians, the turn the finger gave it
  velocity: number; // radians per second, kept after release for inertia
  dragging: boolean;
  hopAt: number | 'now' | null; // when the last tap's hop started; a tap sets 'now'
};

const STAGE = '#EEEEF2';
const EYE = '#160B2E';
const EYE_RIM = '#A8ECFF';

const DOME_HEIGHT = 1.0;
const RADIUS = 0.7;
const SKIRT = 0.72;
const HEM_FLARE = 0.16;

// A squarer-than-round dome, like the pictures' tall rounded body.
const DOME_POWER = 2.4;
function bodyRadiusAt(y: number) {
  if (y <= 0) return RADIUS;
  const k = Math.max(0, 1 - (y / DOME_HEIGHT) ** DOME_POWER);
  return RADIUS * k ** (1 / DOME_POWER);
}

function bodyProfile() {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const y = -SKIRT + (SKIRT * i) / 16;
    const flare = HEM_FLARE * (1 - i / 16) ** 2.2;
    points.push(new THREE.Vector2(RADIUS + flare, y));
  }
  for (let i = 1; i <= 32; i++) {
    const y = DOME_HEIGHT * (i / 32);
    points.push(new THREE.Vector2(Math.max(0.0001, bodyRadiusAt(y)), y));
  }
  return points;
}

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
  varying float vY;
  void main() {
    // Height in the body's frame, so arms and props pick up the same gradient.
    vY = (modelMatrix * vec4(position, 1.0)).y - uBaseY;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uYBottom;
  uniform float uYTop;
  uniform vec3 uCyan;
  uniform vec3 uViolet;
  uniform vec3 uMid;
  uniform vec3 uPeach;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;

  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(vView);
    float h = clamp((vY - uYBottom) / (uYTop - uYBottom), 0.0, 1.0);

    // Top: cyan on the left, violet on the right; then blue-violet; then peach.
    vec3 top = mix(uCyan, uViolet, smoothstep(-0.6, 0.6, N.x));
    vec3 base = mix(uPeach, uMid, smoothstep(0.05, 0.45, h));
    base = mix(base, top, smoothstep(0.45, 0.9, h));

    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.2);

    // Oil-film shimmer at grazing angles, drifting slowly.
    vec3 irid = 0.55 + 0.45 * cos(6.2831 * (fres * 0.9 + h * 0.35 + uTime * 0.04 + vec3(0.0, 0.33, 0.67)));
    vec3 col = mix(base, irid, fres * 0.5);

    // Lit from the upper left, with a glow from inside so it never goes dark.
    vec3 L = normalize(vec3(-0.45, 0.75, 0.5));
    float diff = 0.78 + 0.22 * dot(N, L);
    col *= diff;
    col += base * 0.18 * (1.0 - fres);
    float spec = pow(max(dot(reflect(-L, N), V), 0.0), 70.0);
    col += spec * 0.85;
    col += fres * 0.4 * vec3(1.0, 0.94, 1.0);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function glowMaterial(yBottom: number, yTop: number) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uBaseY: { value: 0 },
      uYBottom: { value: yBottom },
      uYTop: { value: yTop },
      uCyan: { value: srgb('#3CCBF2') },
      uViolet: { value: srgb('#9A6BF7') },
      uMid: { value: srgb('#6A63F2') },
      uPeach: { value: srgb('#FFAA6E') },
    },
  });
}

// --- Eyes: the expression is the shape of the hole --------------------------

export const EXPRESSIONS = ['neutral', 'happy', 'surprised', 'focused', 'sleepy'] as const;
// 'closed' is never an expression of its own: it is the blink, and the moment
// between two expressions.
type Shape = (typeof EXPRESSIONS)[number] | 'closed';
const SHAPES: Shape[] = [...EXPRESSIONS, 'closed'];

const EYE_RX = 0.095;
const EYE_RY = 0.14;
const EYE_X = 0.22;
const EYE_Y = 0.38;

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

// A flat eye shape wrapped onto the dome, so it sits on the curved surface.
function eyeGeometry(kind: Shape, side: -1 | 1, grow: number, lift: number) {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(eyeOutline(kind, grow)), 1);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = side * EYE_X + pos.getX(i);
    const y = EYE_Y + pos.getY(i);
    const r = bodyRadiusAt(y);
    pos.setXYZ(i, x, y, Math.sqrt(Math.max(0, r * r - x * x)) + lift);
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
      rim: [eyeGeometry(kind, -1, 1.14, 0.014), eyeGeometry(kind, 1, 1.14, 0.014)],
    };
  }
  return set;
}

// --- The scene ---------------------------------------------------------------

const SWAP_TIME = 0.16; // seconds the eyes stay shut between two expressions
const BLINK_TIME = 0.12;

export type Agent = 'base' | 'secretaria';

// Each arm hangs from a shoulder inside the body: `angle` swings it out from the
// side (radians, 0 = straight down), `forward` brings it towards the camera.
type ArmPose = { angle: number; forward: number; swing: number };
const POSES: Record<Agent, [ArmPose, ArmPose]> = {
  base: [
    { angle: 0.95, forward: 0.2, swing: 0.1 },
    { angle: 0.95, forward: 0.2, swing: 0.1 },
  ],
  secretaria: [
    { angle: 0.75, forward: 0.9, swing: 0.05 }, // left: holds the notepad in front
    { angle: 2.3, forward: 0.45, swing: 0.03 }, // right: phone to the ear
  ],
};
const SHOULDER_X = 0.62;
const SHOULDER_Y = -0.02;
const ARM_RADIUS = 0.1;
const ARM_LENGTH = 0.24;

export function GhostScene({ spin, agent = 'base' }: { spin: React.RefObject<SpinState>; agent?: Agent }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const holes = useRef<(THREE.Mesh | null)[]>([]);
  const rims = useRef<(THREE.Mesh | null)[]>([]);
  const arms = useRef<(THREE.Group | null)[]>([]);
  const shadow = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => new THREE.LatheGeometry(bodyProfile(), 96), []);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const base = useMemo(() => Float32Array.from(position.array), [position]);
  const bodyMaterial = useMemo(() => glowMaterial(-SKIRT - 0.1, DOME_HEIGHT), []);
  const eyeSet = useMemo(buildEyes, []);

  const nextBlink = useRef(2);
  const expression = useRef(0);
  const swapAt = useRef<number | null>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const s = spin.current;
    if (!s || !root.current || !body.current || !shadow.current) return;
    bodyMaterial.uniforms.uTime!.value = t;

    // Hem: six soft lobes, with a travelling wave on top, growing to the edge.
    const pos = position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]!;
      const y = base[i * 3 + 1]!;
      const z = base[i * 3 + 2]!;
      if (y > 0) continue;
      const w = (-y / SKIRT) ** 2.2;
      const angle = Math.atan2(z, x);
      const lobe = Math.cos(angle * 6);
      const wave = Math.sin(angle * 6 + t * 2.4);
      pos.setY(i, y + (-0.07 * (0.5 + 0.5 * lobe) + 0.04 * wave) * w);
      const push = 1 + (0.06 * lobe + 0.03 * Math.sin(angle * 6 + t * 2.4 + 1.2)) * w;
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

    bodyMaterial.uniforms.uBaseY!.value = body.current.position.y;

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

      <mesh ref={shadow} rotation-x={-Math.PI / 2} position-y={-1.02}>
        <circleGeometry args={[0.75, 48]} />
        <meshBasicMaterial color="#5B4A9A" transparent opacity={0.14} depthWrite={false} />
      </mesh>

      <group ref={root}>
        <group ref={body}>
          {/* The lathe's seam starts facing the camera; turn it to the back. */}
          <mesh geometry={geometry} material={bodyMaterial} rotation-y={Math.PI} />

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
              <mesh material={bodyMaterial} position-y={-ARM_LENGTH / 2 - 0.08}>
                <capsuleGeometry args={[ARM_RADIUS, ARM_LENGTH, 8, 20]} />
              </mesh>
              {agent === 'secretaria' && i === 0 && (
                <mesh material={bodyMaterial} position={[0.02, -0.42, 0.08]} rotation={[1.1, 0, 0.5]}>
                  <boxGeometry args={[0.22, 0.28, 0.035]} />
                </mesh>
              )}
            </group>
          ))}

          {agent === 'secretaria' && <SecretariaProps material={bodyMaterial} />}
        </group>
      </group>
    </>
  );
}

// The Secretaría: a bun on top, a scarf with a knot, and an old phone handset
// at the right side of the head. All in the body's own glow.
function SecretariaProps({ material }: { material: THREE.Material }) {
  const neckY = 0.12;
  const neckR = bodyRadiusAt(neckY) + 0.02;
  return (
    <>
      <mesh material={material} position={[0, DOME_HEIGHT + 0.1, -0.06]}>
        <sphereGeometry args={[0.22, 32, 24]} />
      </mesh>
      <mesh material={material} position={[0, DOME_HEIGHT - 0.02, -0.05]} rotation-x={Math.PI / 2 - 0.25}>
        <torusGeometry args={[0.16, 0.045, 12, 32]} />
      </mesh>

      <mesh material={material} position-y={neckY} rotation-x={Math.PI / 2}>
        <torusGeometry args={[neckR, 0.08, 16, 72]} />
      </mesh>
      <mesh material={material} position={[0.18, neckY - 0.02, neckR * 0.95 + 0.04]} scale={[1, 0.8, 0.7]}>
        <sphereGeometry args={[0.11, 20, 16]} />
      </mesh>
      {[-0.35, 0.3].map((tilt) => (
        <mesh key={tilt} material={material} position={[0.19 + tilt * 0.2, neckY - 0.2, neckR + 0.05]} rotation-z={tilt}>
          <capsuleGeometry args={[0.055, 0.2, 6, 12]} />
        </mesh>
      ))}

      <group position={[0.66, 0.46, 0.34]} rotation={[0, -0.5, 0.2]}>
        <mesh material={material}>
          <capsuleGeometry args={[0.07, 0.3, 6, 16]} />
        </mesh>
        {[0.2, -0.2].map((y) => (
          <mesh key={y} material={material} position={[-0.05, y, 0]} scale={[0.8, 0.6, 1]}>
            <sphereGeometry args={[0.12, 20, 16]} />
          </mesh>
        ))}
      </group>
    </>
  );
}
