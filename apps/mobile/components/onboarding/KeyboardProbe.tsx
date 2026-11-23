// TEMPORARY diagnostic probe (flaky onboarding layout). Never lands.
// Mirrors what react-native-keyboard-controller's KeyboardAvoidingView does on
// mount (snapshot the provider in a layout effect, then register a handler,
// which Reanimated applies later on the UI thread), and shows it next to the
// provider's own values, which are fed by a handler registered once at launch.
import { useLayoutEffect, useState } from 'react';
import { Text } from 'react-native';
import { useKeyboardHandler, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import { runOnUI, scheduleOnRN } from 'react-native-worklets';

const f = (n: number) => n.toFixed(2);

export function KeyboardProbe() {
  const provider = useReanimatedKeyboardAnimation();
  const snap = useSharedValue(-1);
  const local = useSharedValue(-1);
  const log = useSharedValue('');
  const moves = useSharedValue(0);
  const [text, setText] = useState('');

  useLayoutEffect(() => {
    snap.value = provider.progress.value;
    local.value = provider.progress.value;
  }, []);

  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';
        log.value += ` S${f(e.progress)}/${Math.round(e.height)}`;
      },
      onMove: (e) => {
        'worklet';
        local.value = e.progress;
        moves.value += 1;
      },
      onEnd: (e) => {
        'worklet';
        local.value = e.progress;
        log.value += ` E${f(e.progress)}/${Math.round(e.height)}`;
      },
    },
    [],
  );

  // Queued on the UI thread right after the handler's registration: marks when it took effect.
  useLayoutEffect(() => {
    runOnUI(() => {
      'worklet';
      log.value += ` R(prov=${f(provider.progress.value)})`;
    })();
  }, []);

  useAnimatedReaction(
    () =>
      `prov=${f(provider.progress.value)}/${Math.round(-provider.height.value)} snap=${f(snap.value)} local=${f(local.value)} m=${moves.value}${log.value}`,
    (s) => scheduleOnRN(setText, s),
  );

  return (
    <Text testID="kb-probe" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, fontSize: 9, color: 'red', zIndex: 99 }}>
      {text}
    </Text>
  );
}
