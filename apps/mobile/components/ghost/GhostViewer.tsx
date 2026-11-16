import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, View } from 'react-native';
import { GhostCanvas } from './GhostCanvas';
import { type Agent, GhostScene, type Look, type SpinState } from './GhostScene';
import { type Tone, TripoScene, type TripoModel } from './TripoScene';

// The ghost on screen: drag sideways to spin it, tap it to make it hop.
// `active` pauses drawing (and the battery cost) when the screen is not shown.

const RADIANS_PER_PIXEL = 0.012;
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

// The camera's distance follows the zoom (1: the whole ghost, 6: six times closer).
function CameraZoom({ zoom }: { zoom: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.z = 6.2 / zoom;
    camera.updateProjectionMatrix();
  }, [camera, zoom]);
  return null;
}

// `tripo` shows Tripo's model of that ghost instead of ours.
export function GhostViewer({
  active = true,
  agent = 'base',
  look,
  tripo = null,
  tone,
  swapped,
  zoom = 1,
}: {
  zoom?: number;
  active?: boolean;
  agent?: Agent;
  look?: Look;
  tripo?: TripoModel | null;
  tone?: Tone;
  swapped?: boolean;
}) {
  // On the web the mouse wheel zooms, starting from the `zoom` given (?zoom= in the URL).
  const [zoomNow, setZoomNow] = useState(zoom);
  useEffect(() => setZoomNow(zoom), [zoom]);
  const box = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = box.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoomNow((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * Math.exp(-e.deltaY * 0.0015))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const spin = useRef<SpinState>({ yaw: 0, velocity: 0, dragging: false, hopAt: null });
  const startYaw = useRef(0);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          spin.current.dragging = true;
          spin.current.velocity = 0;
          startYaw.current = spin.current.yaw;
        },
        onPanResponderMove: (_, g) => {
          spin.current.yaw = startYaw.current + g.dx * RADIANS_PER_PIXEL;
        },
        onPanResponderRelease: (_, g) => {
          spin.current.dragging = false;
          if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) {
            spin.current.hopAt = 'now';
          } else {
            spin.current.velocity = g.vx * 1000 * RADIANS_PER_PIXEL;
          }
        },
        onPanResponderTerminate: () => {
          spin.current.dragging = false;
        },
      }),
    [],
  );

  return (
    <View ref={box} style={{ flex: 1 }}>
      <GhostCanvas
        frameloop={active ? 'always' : 'never'}
        camera={{ position: [0, 0.15, 6.2 / zoom], fov: 40 }}
      >
        <CameraZoom zoom={zoomNow} />
        {tripo ? <TripoScene spin={spin} model={tripo} tone={tone} swapped={swapped} /> : <GhostScene spin={spin} agent={agent} look={look} />}
      </GhostCanvas>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} {...responder.panHandlers} />
    </View>
  );
}
