import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// A placeholder ghost built in code (no model file): a lathed body whose hem
// waves, eyes that blink, and an idle float. Spike only, to judge live 3D on a
// phone before commissioning the real character.

export type SpinState = {
  yaw: number; // radians, the turn the finger gave it
  velocity: number; // radians per second, kept after release for inertia
  dragging: boolean;
  hopAt: number | 'now' | null; // when the last tap's hop started; a tap sets 'now'
};

const BODY = '#F3F0FF';
const INK = '#2A2540';
const BLUSH = '#FFB3C7';

const DOME_HEIGHT = 0.95;
const RADIUS = 0.75;
const SKIRT = 0.6;

function bodyRadiusAt(y: number) {
  return RADIUS * Math.sqrt(Math.max(0, 1 - (y / DOME_HEIGHT) ** 2));
}

function bodyProfile() {
  const points: THREE.Vector2[] = [];
  // Hem first (bottom, slightly flared), up the skirt, then over the dome.
  for (let i = 0; i <= 12; i++) {
    const y = -SKIRT + (SKIRT * i) / 12;
    const flare = 0.06 * (1 - i / 12) ** 2;
    points.push(new THREE.Vector2(RADIUS + flare, y));
  }
  for (let i = 1; i <= 28; i++) {
    const a = (Math.PI / 2) * (i / 28);
    points.push(new THREE.Vector2(Math.max(0.0001, RADIUS * Math.cos(a)), DOME_HEIGHT * Math.sin(a)));
  }
  return points;
}

export function GhostScene({ spin }: { spin: React.RefObject<SpinState> }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => new THREE.LatheGeometry(bodyProfile(), 72), []);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const base = useMemo(() => Float32Array.from(position.array), [position]);
  const nextBlink = useRef(2);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const s = spin.current;
    if (!s || !root.current || !body.current || !eyes.current || !shadow.current) return;

    // Hem: a travelling wave that grows towards the bottom edge.
    const pos = position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]!;
      const y = base[i * 3 + 1]!;
      const z = base[i * 3 + 2]!;
      if (y > 0) continue;
      const w = (-y / SKIRT) ** 2;
      const angle = Math.atan2(z, x);
      const wave = Math.sin(angle * 6 + t * 3) * 0.07 * w;
      pos.setY(i, y + wave);
      const push = 1 + Math.sin(angle * 6 + t * 3 + 1.2) * 0.04 * w;
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

    // Tap: a little hop with a full turn.
    let hop = 0;
    let hopTurn = 0;
    if (s.hopAt === 'now') s.hopAt = t;
    if (s.hopAt !== null) {
      const p = (t - s.hopAt) / 0.7;
      if (p >= 1) s.hopAt = null;
      else {
        hop = Math.sin(Math.PI * p) * 0.45;
        hopTurn = Math.PI * 2 * (1 - (1 - p) ** 3);
      }
    }

    const float = Math.sin(t * 1.6) * 0.09;
    root.current.rotation.y = s.yaw + hopTurn;
    body.current.position.y = float + hop;
    body.current.rotation.z = Math.sin(t * 1.1) * 0.05;
    body.current.rotation.x = Math.sin(t * 0.8) * 0.04;

    const lift = float + hop;
    const k = 1 - lift * 0.6;
    shadow.current.scale.set(k, k, k);
    (shadow.current.material as THREE.MeshBasicMaterial).opacity = 0.12 * k;

    // Blink every few seconds.
    if (t > nextBlink.current + 0.14) nextBlink.current = t + 2.5 + Math.random() * 2.5;
    eyes.current.scale.y = t > nextBlink.current ? 0.12 : 1;
  });

  const eyeY = 0.28;
  const eyeX = 0.22;
  const eyeZ = Math.sqrt(bodyRadiusAt(eyeY) ** 2 - eyeX ** 2) - 0.02;
  const cheekY = 0.1;
  const cheekX = 0.4;
  const cheekZ = Math.sqrt(bodyRadiusAt(cheekY) ** 2 - cheekX ** 2) + 0.005;
  const cheekTilt = Math.atan2(cheekX, cheekZ);

  return (
    <>
      <color attach="background" args={['#F7F6F3']} />
      <hemisphereLight args={['#FFFFFF', '#C9C2E8', 1.6]} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.8} />
      <directionalLight position={[-3, 1, -2]} intensity={0.5} color="#B8C7FF" />

      <mesh ref={shadow} rotation-x={-Math.PI / 2} position-y={-0.95}>
        <circleGeometry args={[0.6, 48]} />
        <meshBasicMaterial color={INK} transparent opacity={0.12} depthWrite={false} />
      </mesh>

      <group ref={root}>
        <group ref={body}>
          {/* The lathe's seam starts facing the camera; turn it to the back. */}
          <mesh geometry={geometry} rotation-y={Math.PI}>
            <meshStandardMaterial color={BODY} roughness={0.75} metalness={0} side={THREE.DoubleSide} />
          </mesh>

          <group ref={eyes} position={[0, eyeY, 0]}>
            {[-eyeX, eyeX].map((x) => (
              <mesh key={x} position={[x, 0, eyeZ]} scale={[1, 1.35, 0.6]}>
                <sphereGeometry args={[0.075, 24, 24]} />
                <meshStandardMaterial color={INK} roughness={0.3} />
              </mesh>
            ))}
          </group>

          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * cheekX, cheekY, cheekZ]} rotation-y={side * cheekTilt}>
              <circleGeometry args={[0.07, 24]} />
              <meshBasicMaterial color={BLUSH} transparent opacity={0.8} />
            </mesh>
          ))}

          <mesh position={[0, 0.12, bodyRadiusAt(0.12) - 0.01]} scale={[1, 0.8, 0.5]}>
            <sphereGeometry args={[0.04, 16, 16]} />
            <meshStandardMaterial color={INK} roughness={0.4} />
          </mesh>
        </group>
      </group>
    </>
  );
}
