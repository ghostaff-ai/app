import { useMemo, useRef } from 'react';
import { PanResponder, View } from 'react-native';
import { GhostCanvas } from './GhostCanvas';
import { GhostScene, type SpinState } from './GhostScene';

// The ghost on screen: drag sideways to spin it, tap it to make it hop.
// `active` pauses drawing (and the battery cost) when the screen is not shown.

const RADIANS_PER_PIXEL = 0.012;

export function GhostViewer({ active = true }: { active?: boolean }) {
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
    <View style={{ flex: 1 }}>
      <GhostCanvas
        frameloop={active ? 'always' : 'never'}
        camera={{ position: [0, 0.15, 6.2], fov: 40 }}
      >
        <GhostScene spin={spin} />
      </GhostCanvas>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} {...responder.panHandlers} />
    </View>
  );
}
