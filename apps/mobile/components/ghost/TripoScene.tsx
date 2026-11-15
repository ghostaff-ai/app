import { useFrame } from '@react-three/fiber';
import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import eyesJson from '../../../../design/tripo/eyes.json';
import { STAGE, type SpinState, StudioLight } from './GhostScene';

// A ghost made by Tripo from one of Álvaro's pictures (design/tripo/, made light
// by design/blender/tripo.py): one solid model with its own colours and objects.
// Being one piece, it comes alive as a whole, all in the shader: it sways like
// jelly (the top more than the hem, so what it holds sways with it), the hem
// ripples, it squashes and stretches as it hops, and its painted eyes blink
// (design/blender/eyes.py finds them in the texture).

// Tone: Tripo's colours as they come, or darker. Most of the colour is the
// studio room reflected, so a tone dims the reflections as well as the paint.
export type Tone = 'original' | 'dark' | 'darker';
const TONES: Record<Tone, { paint: number; room: number; lights: number }> = {
  original: { paint: 1, room: 1, lights: 1 },
  dark: { paint: 0.6, room: 0.45, lights: 0.7 },
  darker: { paint: 0.4, room: 0.25, lights: 0.5 },
};

// The hem: below HEM (the model is 1 unit tall) a wave travels round the skirt,
// growing to the edge. Above it the body sways like jelly, more the higher up.
// One time uniform shared by every Tripo material; each model has its own blink.
const HEM = 0.32;
const time = { value: 0 };
const DARK = 0.03; // a texel darker than this (linear) inside an eye's box is the eye

type Eye = { center: [number, number, number]; radius: [number, number]; lid: [number, number, number] };
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function alive(material: THREE.MeshStandardMaterial, eyes: Eye[], blink: { value: number }, sway: boolean) {
  const [a, b] = [eyes[0], eyes[1]];
  const v3 = (e: Eye | undefined, k: 'center' | 'lid') =>
    e ? new THREE.Vector3(...(k === 'lid' ? (e.lid.map(toLinear) as [number, number, number]) : e.center)) : new THREE.Vector3(0, -9, 0);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uBlink = blink;
    shader.uniforms.uEyeC = { value: [v3(a, 'center'), v3(b, 'center')] };
    shader.uniforms.uEyeR = { value: [new THREE.Vector2(...(a?.radius ?? [0, 0])), new THREE.Vector2(...(b?.radius ?? [0, 0]))] };
    shader.uniforms.uLid = { value: [v3(a, 'lid'), v3(b, 'lid')] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vObj;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vObj = position;
        float w = pow(clamp((${HEM.toFixed(2)} - position.y) / ${HEM.toFixed(2)}, 0.0, 1.0), 2.2);
        float a = atan(position.z, position.x);
        transformed.y += 0.017 * sin(a * 6.0 + uTime * 2.4) * w;
        transformed.xz *= 1.0 + 0.025 * sin(a * 6.0 + uTime * 2.4 + 1.2) * w;
        ${
          sway
            ? `float h = clamp(position.y, 0.0, 1.0);
        h *= h;
        transformed.x += 0.035 * h * sin(uTime * 1.3);
        transformed.z += 0.02 * h * sin(uTime * 1.05 + 1.0);
        transformed.y -= 0.01 * h * (0.5 + 0.5 * sin(uTime * 2.6));`
            : ''
        }`,
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

export type TripoModel = 'base' | 'secretaria' | 'redes' | 'incorporacion' | 'finanzas' | 'productor';

// Each agent as Tripo made it, one whole model (design/tripo/<agent>.glb).
// Productor has no whole model yet, so it is the one put together from Tripo's
// parts by design/blender/assemble.py (nodes arm_L and arm_R turn at the shoulder).
const FILES: Record<TripoModel, { file: number; whole: boolean }> = {
  base: { file: require('../../../../design/tripo/base.glb'), whole: true },
  secretaria: { file: require('../../../../design/tripo/secretaria.glb'), whole: true },
  redes: { file: require('../../../../design/tripo/redes.glb'), whole: true },
  incorporacion: { file: require('../../../../design/tripo/incorporacion.glb'), whole: true },
  finanzas: { file: require('../../../../design/tripo/finanzas.glb'), whole: true },
  productor: { file: require('../../../../design/tripo/agents/productor.glb'), whole: false },
};
const EYES = eyesJson as unknown as Partial<Record<TripoModel, Eye[]>>;
const blinks = new Map<TripoModel, { value: number }>();
const blinkOf = (m: TripoModel) => blinks.get(m) ?? blinks.set(m, { value: 0 }).get(m)!;

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
      const { file, whole } = FILES[model];
      const asset = Asset.fromModule(file);
      await asset.downloadAsync();
      const gltf = await loader.loadAsync(asset.localUri ?? asset.uri);
      gltf.scene.traverse((o) => {
        // A whole model sways and blinks; an assembled one ripples its body only.
        if (!(o instanceof THREE.Mesh)) return;
        if (whole) alive(o.material as THREE.MeshStandardMaterial, EYES[model] ?? [], blinkOf(model), true);
        else if (o.name === 'body') alive(o.material as THREE.MeshStandardMaterial, [], blinkOf(model), false);
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
  const stretch = useRef<THREE.Group>(null);
  const blinkAt = useRef(-9);
  const nextBlink = useRef(1.5);
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
    // Breathing, and a blink every few seconds (sometimes two).
    squash += Math.sin(t * 2.6) * 0.012;
    if (t > nextBlink.current) {
      blinkAt.current = t;
      nextBlink.current = t + (Math.random() < 0.2 ? 0.3 : 2.2 + Math.random() * 3);
    }
    const q = (t - blinkAt.current) / 0.18;
    blinkOf(model).value = q >= 0 && q < 1 ? Math.sin(Math.PI * q) : 0;
    if (stretch.current) stretch.current.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
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
          <group ref={stretch} position-y={FLOOR}>
            {scene && <primitive object={scene} scale={HEIGHT} position-y={0.04} />}
          </group>
        </group>
      </group>
    </>
  );
}
