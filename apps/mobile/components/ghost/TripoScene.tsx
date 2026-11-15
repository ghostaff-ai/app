import { useFrame } from '@react-three/fiber';
import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STAGE, type SpinState, StudioLight } from './GhostScene';

// A ghost made by Tripo from one of Álvaro's pictures (design/tripo/, made light
// by design/blender/tripo.py): one solid model with its own colours, so it
// spins, floats and hops as a whole; arms and eyes do not move on their own.

export type TripoModel = 'base' | 'secretaria' | 'redes' | 'incorporacion' | 'finanzas';

const FILES: Record<TripoModel, number> = {
  base: require('../../../../design/tripo/base.glb'),
  secretaria: require('../../../../design/tripo/secretaria.glb'),
  redes: require('../../../../design/tripo/redes.glb'),
  incorporacion: require('../../../../design/tripo/incorporacion.glb'),
  finanzas: require('../../../../design/tripo/finanzas.glb'),
};

// The models are 1 unit tall, standing on 0; ours stands on -1.04 and is about 2 tall.
const HEIGHT = 2.0;
const FLOOR = -1.04;

const cache = new Map<TripoModel, Promise<THREE.Group>>();
function load(model: TripoModel) {
  let p = cache.get(model);
  if (!p) {
    p = (async () => {
      const asset = Asset.fromModule(FILES[model]);
      await asset.downloadAsync();
      const gltf = await new GLTFLoader().loadAsync(asset.localUri ?? asset.uri);
      return gltf.scene;
    })();
    cache.set(model, p);
    p.catch(() => cache.delete(model));
  }
  return p;
}

export function TripoScene({ spin, model }: { spin: React.RefObject<SpinState>; model: TripoModel }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const [scene, setScene] = useState<THREE.Group | null>(null);

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

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
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
    const k = 1 - (float + hop) * 0.6;
    shadow.current.scale.set(k, k, k);
    (shadow.current.material as THREE.MeshBasicMaterial).opacity = 0.14 * k;
  });

  return (
    <>
      <color attach="background" args={[STAGE]} />
      <StudioLight />
      <hemisphereLight args={['#FFFFFF', '#C9C2E8', 0.6]} />
      <directionalLight position={[-2.5, 4, 3]} intensity={1.2} />
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
