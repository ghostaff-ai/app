import { useFrame } from '@react-three/fiber';
import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import eyesJson from '@/assets/ghosts/eyes.json';
import { GHOSTS, type GhostId } from '@/lib/team';
import { type SpinState, STAGE, StudioLight } from './stage';

// One ghost, live: a solid model made by Tripo from Álvaro's pictures
// (assets/ghosts/, made light in the design pipeline). Being one piece, it comes
// alive as a whole, all in the shader: it sways like jelly (the top more than the
// hem, so what it holds sways with it), the hem ripples, the chest breathes, it
// squashes and stretches as it hops, and its painted eyes blink (found in the
// texture by the pipeline, eyes.json).

// Below HEM (the model is 1 unit tall) a wave travels round the skirt, growing to
// the edge. One time and one breath shared by every ghost; each has its own blink.
const HEM = 0.32;
const time = { value: 0 };
const breath = { value: 0 };
const DARK = 0.03; // a texel darker than this (linear) inside an eye's box is the eye

type Eye = { center: [number, number, number]; radius: [number, number]; lid: [number, number, number] };
const EYES = eyesJson as unknown as Record<GhostId, Eye[] | undefined>;
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function alive(material: THREE.MeshStandardMaterial, eyes: Eye[], blink: { value: number }) {
  const [a, b] = [eyes[0], eyes[1]];
  const v3 = (e: Eye | undefined, k: 'center' | 'lid') =>
    e ? new THREE.Vector3(...(k === 'lid' ? (e.lid.map(toLinear) as [number, number, number]) : e.center)) : new THREE.Vector3(0, -9, 0);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uBreath = breath;
    shader.uniforms.uBlink = blink;
    shader.uniforms.uEyeC = { value: [v3(a, 'center'), v3(b, 'center')] };
    shader.uniforms.uEyeR = { value: [new THREE.Vector2(...(a?.radius ?? [0, 0])), new THREE.Vector2(...(b?.radius ?? [0, 0]))] };
    shader.uniforms.uLid = { value: [v3(a, 'lid'), v3(b, 'lid')] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uBreath;\nvarying vec3 vObj;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float bw = smoothstep(0.15, 0.4, position.y) * (1.0 - smoothstep(0.55, 0.8, position.y));
        transformed.xz *= 1.0 + uBreath * bw;
        vObj = position;
        float w = pow(clamp((${HEM.toFixed(2)} - position.y) / ${HEM.toFixed(2)}, 0.0, 1.0), 2.2);
        float a = atan(position.z, position.x);
        transformed.y += 0.017 * sin(a * 6.0 + uTime * 2.4) * w;
        transformed.xz *= 1.0 + 0.025 * sin(a * 6.0 + uTime * 2.4 + 1.2) * w;
        float h = clamp(position.y, 0.0, 1.0);
        h *= h;
        transformed.x += 0.035 * h * sin(uTime * 1.3);
        transformed.z += 0.02 * h * sin(uTime * 1.05 + 1.0);
        transformed.y -= 0.01 * h * (0.5 + 0.5 * sin(uTime * 2.6));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uBlink;
        uniform vec3 uEyeC[2];
        uniform vec2 uEyeR[2];
        uniform vec3 uLid[2];
        varying vec3 vObj;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
        if (uBlink > 0.0) {
          vec3 tex = texture2D(map, vMapUv).rgb;
          for (int i = 0; i < 2; i++) {
            vec2 d = (vObj.xy - uEyeC[i].xy) / uEyeR[i];
            // The lid comes down from the top of the eye; closed, a sliver stays.
            float edge = 1.0 - 1.75 * uBlink;
            if (abs(d.x) < 1.35 && d.y > edge - 0.3 * (1.0 - min(d.x * d.x, 1.0)) && d.y < 1.4 && vObj.z > uEyeC[i].z - 0.08
                && dot(tex, vec3(0.3, 0.59, 0.11)) < ${DARK}) {
              diffuseColor.rgb = uLid[i] * diffuse;
            }
          }
        }
        #endif`,
      );
  };
}

const blinks = new Map<GhostId, { value: number }>();
const blinkOf = (g: GhostId) => blinks.get(g) ?? blinks.set(g, { value: 0 }).get(g)!;

// The models are 1 unit tall, standing on 0; on stage they are 2 tall, on FLOOR.
const HEIGHT = 2.0;
const FLOOR = -1.04;

// The models' geometry is Draco-compressed; three.js's decoder is served from
// public/draco/.
const draco = new DRACOLoader().setDecoderPath('/draco/');
const loader = new GLTFLoader().setDRACOLoader(draco);

const cache = new Map<GhostId, Promise<THREE.Group>>();
function load(ghost: GhostId) {
  let p = cache.get(ghost);
  if (!p) {
    p = (async () => {
      const asset = Asset.fromModule(GHOSTS[ghost].model);
      await asset.downloadAsync();
      const gltf = await loader.loadAsync(asset.localUri ?? asset.uri);
      // Every mesh in the model's own space, so the chest swells the same on the
      // body and on what is pinned to it.
      gltf.scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      const group = new THREE.Group();
      for (const o of meshes) {
        o.geometry.applyMatrix4(o.matrixWorld);
        o.position.set(0, 0, 0);
        o.quaternion.identity();
        o.scale.set(1, 1, 1);
        group.add(o);
        alive(o.material as THREE.MeshStandardMaterial, EYES[ghost] ?? [], blinkOf(ghost));
      }
      return group;
    })();
    cache.set(ghost, p);
    p.catch(() => cache.delete(ghost));
  }
  return p;
}

export function GhostScene({ spin, ghost }: { spin: React.RefObject<SpinState>; ghost: GhostId }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const stretch = useRef<THREE.Group>(null);
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const blinkAt = useRef(-9);
  const nextBlink = useRef(1.5);

  useEffect(() => {
    let live = true;
    setScene(null);
    load(ghost).then(
      (s) => live && setScene(s),
      (e) => console.warn('[ghost] could not load', ghost, e),
    );
    return () => {
      live = false;
    };
  }, [ghost]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    time.value = t;
    breath.value = 0.022 * Math.sin(t * 1.5);
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
    // A hop: crouch, spring up stretched, land squashed (scaled from the floor).
    let hop = 0;
    let squash = 0;
    if (s.hopAt === 'now') s.hopAt = t;
    if (s.hopAt !== null) {
      const p = (t - s.hopAt) / 0.75;
      if (p >= 1) s.hopAt = null;
      else if (p < 0.18) squash = -0.09 * Math.sin((Math.PI * p) / 0.18);
      else if (p < 0.82) {
        const q = (p - 0.18) / 0.64;
        hop = Math.sin(Math.PI * q) * 0.32;
        squash = 0.07 * Math.cos(Math.PI * q);
      } else squash = -0.06 * Math.sin((Math.PI * (p - 0.82)) / 0.18);
    }
    // A slight bob, and a blink every few seconds (sometimes two).
    squash += Math.sin(t * 2.6) * 0.012;
    if (t > nextBlink.current) {
      blinkAt.current = t;
      nextBlink.current = t + (Math.random() < 0.2 ? 0.3 : 2.2 + Math.random() * 3);
    }
    const q = (t - blinkAt.current) / 0.18;
    blinkOf(ghost).value = q >= 0 && q < 1 ? Math.sin(Math.PI * q) : 0;
    if (stretch.current) stretch.current.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
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
          <group ref={stretch} position-y={FLOOR}>
            {scene && <primitive object={scene} scale={HEIGHT} position-y={0.04} />}
          </group>
        </group>
      </group>
    </>
  );
}
