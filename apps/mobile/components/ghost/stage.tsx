import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// What every ghost scene shares: the backdrop, the studio light it reflects, and
// how the finger has spun it.

export const STAGE = '#F7F6F3'; // the app's surface colour, so the ghost sits on the page

export type SpinState = {
  yaw: number; // radians, the turn the finger gave it
  velocity: number; // radians per second, kept after release for inertia
  dragging: boolean;
  hopAt: number | 'now' | null; // when the last tap's hop started; a tap sets 'now'
};

// A studio room for the glossy ghosts to reflect, built in code (no file to load,
// so it works the same on phones). `blur`: how soft its reflections are.
export function StudioLight({ blur = 0.25 }: { blur?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    try {
      const pmrem = new THREE.PMREMGenerator(gl);
      const env = pmrem.fromScene(new RoomEnvironment(), blur).texture;
      scene.environment = env;
      pmrem.dispose();
      return () => {
        scene.environment = null;
        env.dispose();
      };
    } catch {
      return undefined; // no reflections on a phone that can't build them
    }
  }, [gl, scene, blur]);
  return null;
}
