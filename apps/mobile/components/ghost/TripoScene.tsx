import { useFrame } from '@react-three/fiber';
import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STAGE, type SpinState, StudioLight } from './GhostScene';

// A ghost made by Tripo from one of Álvaro's pictures (design/tripo/, made light
// by design/blender/tripo.py): one solid model with its own colours, so it
// spins, floats and hops as a whole, and the hem ripples (in the shader, like
// ours); arms and eyes do not move on their own yet.

// Tone: Tripo's colours as they come, or darker. Most of the colour is the
// studio room reflected, so a tone dims the reflections as well as the paint.
export type Tone = 'original' | 'dark' | 'darker';
const TONES: Record<Tone, { paint: number; room: number; lights: number }> = {
  original: { paint: 1, room: 1, lights: 1 },
  dark: { paint: 0.6, room: 0.45, lights: 0.7 },
  darker: { paint: 0.4, room: 0.25, lights: 0.5 },
};

// The hem: below HEM (the model is 1 unit tall) a wave travels round the skirt,
// growing to the edge. One time uniform shared by every Tripo material.
const HEM = 0.32;
const time = { value: 0 };
function ripple(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float w = pow(clamp((${HEM.toFixed(2)} - position.y) / ${HEM.toFixed(2)}, 0.0, 1.0), 2.2);
        float a = atan(position.z, position.x);
        transformed.y += 0.017 * sin(a * 6.0 + uTime * 2.4) * w;
        transformed.xz *= 1.0 + 0.025 * sin(a * 6.0 + uTime * 2.4 + 1.2) * w;`,
      );
  };
}

export type TripoModel = 'base' | 'secretaria' | 'redes' | 'incorporacion' | 'finanzas' | 'productor';

// Each agent put together from Tripo's parts by design/blender/assemble.py: the
// same body and arms, plus its objects; nodes arm_L and arm_R turn at the shoulder.
const FILES: Record<TripoModel, number> = {
  base: require('../../../../design/tripo/agents/base.glb'),
  secretaria: require('../../../../design/tripo/agents/secretaria.glb'),
  redes: require('../../../../design/tripo/agents/redes.glb'),
  incorporacion: require('../../../../design/tripo/agents/incorporacion.glb'),
  finanzas: require('../../../../design/tripo/agents/finanzas.glb'),
  productor: require('../../../../design/tripo/agents/productor.glb'),
};

// How much each arm swings (radians) and whether it flings up on a hop: an arm
// holding something up to the head or out in front barely moves.
const SWING: Record<TripoModel, [number, number]> = {
  base: [0.12, 0.12],
  secretaria: [0.03, 0.02],
  redes: [0.04, 0.03],
  incorporacion: [0.05, 0.18],
  finanzas: [0.03, 0.03],
  productor: [0.03, 0.03],
};

// The models are 1 unit tall, standing on 0; ours stands on -1.04 and is about 2 tall.
const HEIGHT = 2.0;
const FLOOR = -1.04;

// The models' geometry is Draco-compressed (design/blender/tripo.py); three.js's
// decoder is served from apps/mobile/public/draco/.
const draco = new DRACOLoader().setDecoderPath('/draco/');
const loader = new GLTFLoader().setDRACOLoader(draco);

const AXIS_Z = new THREE.Vector3(0, 0, 1);
const swing = new THREE.Quaternion();

const cache = new Map<TripoModel, Promise<THREE.Group>>();
function load(model: TripoModel) {
  let p = cache.get(model);
  if (!p) {
    p = (async () => {
      const asset = Asset.fromModule(FILES[model]);
      await asset.downloadAsync();
      const gltf = await loader.loadAsync(asset.localUri ?? asset.uri);
      gltf.scene.traverse((o) => {
        // Only the body's hem ripples; objects and arms keep their shape.
        if (o instanceof THREE.Mesh && o.name === 'body') ripple(o.material as THREE.MeshStandardMaterial);
      });
      return gltf.scene;
    })();
    cache.set(model, p);
    p.catch(() => cache.delete(model));
  }
  return p;
}

export function TripoScene({
  spin,
  model,
  tone = 'dark',
}: {
  spin: React.RefObject<SpinState>;
  model: TripoModel;
  tone?: Tone;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const arms = useRef<{ node: THREE.Object3D; rest: THREE.Quaternion; side: number }[]>([]);

  useEffect(() => {
    let live = true;
    setScene(null);
    load(model).then(
      (s) => live && setScene(s),
      (e) => console.warn('[tripo] could not load', model, e),
    );
    return () => {
      live = false;
    };
  }, [model]);

  useEffect(() => {
    arms.current = [];
    for (const [name, side] of [
      ['arm_L', 1],
      ['arm_R', -1],
    ] as const) {
      const node = scene?.getObjectByName(name);
      if (node) arms.current.push({ node, rest: node.quaternion.clone(), side });
    }
  }, [scene]);

  useEffect(() => {
    scene?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshStandardMaterial;
      m.color.setScalar(TONES[tone].paint);
      m.envMapIntensity = TONES[tone].room;
    });
  }, [scene, tone]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    time.value = t;
    const s = spin.current;
    if (!s || !root.current || !body.current || !shadow.current) return;
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
    let hop = 0;
    if (s.hopAt === 'now') s.hopAt = t;
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
    // Arms sway a beat behind the body, round the shoulder, from their pose.
    arms.current.forEach((a, i) => {
      const amount = SWING[model][i]!;
      const sway = Math.sin(t * 1.6 - 0.9 + i * 1.3) * amount + hop * 3 * amount;
      swing.setFromAxisAngle(AXIS_Z, a.side * sway);
      a.node.quaternion.copy(a.rest).multiply(swing);
    });
    const k = 1 - (float + hop) * 0.6;
    shadow.current.scale.set(k, k, k);
    (shadow.current.material as THREE.MeshBasicMaterial).opacity = 0.14 * k;
  });

  return (
    <>
      <color attach="background" args={[STAGE]} />
      <StudioLight />
      <hemisphereLight args={['#FFFFFF', '#C9C2E8', 0.6 * TONES[tone].lights]} />
      <directionalLight position={[-2.5, 4, 3]} intensity={1.2 * TONES[tone].lights} />
      <mesh ref={shadow} rotation-x={-Math.PI / 2} position-y={FLOOR}>
        <circleGeometry args={[0.95, 48]} />
        <meshBasicMaterial color="#5B4A9A" transparent opacity={0.14} depthWrite={false} />
      </mesh>
      <group ref={root}>
        <group ref={body}>
          {scene && <primitive object={scene} scale={HEIGHT} position-y={FLOOR + 0.04} />}
        </group>
      </group>
    </>
  );
}
