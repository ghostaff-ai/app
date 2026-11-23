import type { Decision } from '@ghostaff/shared';
import { router } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, PanResponder, Platform, Pressable, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { canSwipe, pickLabel, SWIPE_DISTANCE } from '@/lib/deck';
import { dueLabel, shortDate } from '@/lib/format';
import { selection, success } from '@/lib/haptics';
import type { DeckMove } from '@/lib/hooks/useDecisions';
import { GHOSTS, agentLabel, ghostFor } from '@/lib/team';
import { usePalette } from '@/lib/theme';

// The decision deck (docs/plans/ongoing/three-tabs.md, decision 7; Álvaro
// picked version A of the drawn cards, 2026-11-24): one card on top of the
// others. Three buttons always there: «Más tarde», «No» and the agent's pick,
// named. Swipe right takes the pick, left leaves it for tomorrow; never «no»,
// since a swipe reads as throwing away. A rule can't be swiped: it is signed
// on its own screen. A tap on the card opens all of it, with «Preguntar».

const native = Platform.OS !== 'web';

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** One card's face: who asks and when, the question, one quoted line, «Con el sí / Con el no» and the pick. */
function Face({ d }: { d: Decision }) {
  const due = d.dueOn ? dueLabel(d.dueOn) : null;
  return (
    <View className="flex-1">
      <View className="flex-row items-center">
        <Image source={GHOSTS[ghostFor(d.proposedBy)].picture} style={{ width: 44, height: 44 }} resizeMode="contain" />
        <View className="ml-2.5">
          <Text className="text-[15px] font-semibold text-ink">{agentLabel(d.proposedBy)}</Text>
          <Text className={`text-footnote ${due?.urgent ? 'font-semibold text-waiting' : 'text-muted'}`}>{due ? due.text : shortDate(d.createdOn)}</Text>
        </View>
      </View>
      <Text className="mt-4 font-display-medium text-[24px] leading-[30px] text-ink" numberOfLines={5}>
        {d.question}
      </Text>
      {d.quote ? (
        <Text className="mt-3 text-[15px] leading-[22px] text-muted" numberOfLines={3}>
          «{d.quote}»
        </Text>
      ) : null}
      {d.ifYes || d.ifNo ? (
        <View className="mt-4 flex-row gap-2.5">
          {d.ifYes ? (
            <View className="flex-1 rounded-2xl bg-surface p-3">
              <Text className="text-caption text-muted">Con el sí</Text>
              <Text className="mt-1 text-[14px] leading-[19px] text-ink" numberOfLines={4}>
                {d.ifYes}
              </Text>
            </View>
          ) : null}
          {d.ifNo ? (
            <View className="flex-1 rounded-2xl bg-surface p-3">
              <Text className="text-caption text-muted">Con el no</Text>
              <Text className="mt-1 text-[14px] leading-[19px] text-ink" numberOfLines={4}>
                {d.ifNo}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View className="flex-1" />
      {d.recommendation ? (
        <Text className="text-footnote text-muted">
          Te recomiendo <Text className="font-semibold text-ink">{d.recommendation}</Text>
        </Text>
      ) : null}
      <Text className="mt-1 text-footnote text-muted">Toca para ver todo y preguntar</Text>
    </View>
  );
}

export function DecisionDeck({
  cards,
  onMove,
  toast,
}: {
  cards: Decision[];
  onMove: (d: Decision, kind: DeckMove['kind']) => void;
  /** «Deshacer» after a move: it takes the hint's place under the buttons. */
  toast?: ReactNode;
}) {
  const top = cards[0];
  const c = usePalette();
  const reduced = useReducedMotion();
  const pan = useRef(new Animated.ValueXY()).current;
  const topRef = useRef(top);
  topRef.current = top;
  const [busy, setBusy] = useState(false);

  // A new top card starts in the middle.
  useEffect(() => {
    pan.setValue({ x: 0, y: 0 });
    setBusy(false);
  }, [top?.id, pan]);

  const go = (kind: DeckMove['kind']) => {
    const d = topRef.current;
    if (!d || busy) return;
    if (kind === 'ok' && !canSwipe(d)) {
      router.push(`/decision/${d.id}`);
      return;
    }
    setBusy(true);
    if (kind === 'later') selection();
    else success();
    const done = () => onMove(d, kind);
    if (reduced || kind === 'no') return done();
    Animated.timing(pan, { toValue: { x: kind === 'ok' ? 500 : -500, y: 40 }, duration: 220, useNativeDriver: native }).start(done);
  };
  const goRef = useRef(go);
  goRef.current = go;

  const responder = useMemo(
    () =>
      PanResponder.create({
        // A tap stays a tap: only a sideways drag moves the card.
        onMoveShouldSetPanResponder: (_, g) => !!topRef.current && canSwipe(topRef.current) && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_, g) => {
          if (g.dx > SWIPE_DISTANCE) goRef.current('ok');
          else if (g.dx < -SWIPE_DISTANCE) goRef.current('later');
          else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: native }).start();
        },
        onPanResponderTerminate: () => Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: native }).start(),
      }),
    [pan],
  );

  if (!top) return null;
  const rotate = pan.x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-8deg', '0deg', '8deg'] });
  const okHint = pan.x.interpolate({ inputRange: [0, SWIPE_DISTANCE], outputRange: [0, 1], extrapolate: 'clamp' });
  const laterHint = pan.x.interpolate({ inputRange: [-SWIPE_DISTANCE, 0], outputRange: [1, 0], extrapolate: 'clamp' });
  const swipe = canSwipe(top);
  const pick = pickLabel(top);

  return (
    <View className="flex-1">
      <View className="flex-1" style={{ minHeight: 300 }}>
        {cards.length > 2 ? <View className="absolute bottom-0 left-5 right-5 top-6 rounded-[28px] bg-card opacity-50" /> : null}
        {cards.length > 1 ? <View className="absolute bottom-1 left-2.5 right-2.5 top-3 rounded-[28px] bg-card opacity-75" /> : null}
        <Animated.View
          key={top.id}
          {...responder.panHandlers}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 8, transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] }}
        >
          <Pressable
            testID="deck-card"
            accessibilityRole="button"
            accessibilityLabel={`${agentLabel(top.proposedBy)} pregunta: ${top.question}`}
            accessibilityHint="Abre la decisión entera"
            onPress={() => router.push(`/decision/${top.id}`)}
            className="flex-1 rounded-[28px] bg-card p-6"
            style={{ shadowColor: '#16151E', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 3 }}
          >
            <Face d={top} />
          </Pressable>
          <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 96, left: 24, opacity: okHint, backgroundColor: c.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text className="text-footnote font-semibold text-on-accent">{pick}</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 96, right: 24, opacity: laterHint, backgroundColor: c.sunk, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text className="text-footnote font-semibold text-ink">Más tarde</Text>
          </Animated.View>
        </Animated.View>
      </View>

      <View className="mt-2 shrink-0 flex-row gap-2.5">
        <View className="flex-1">
          <Button testID="deck-later" label="Más tarde" variant="secondary" onPress={() => go('later')} />
        </View>
        <View className="flex-1">
          <Button testID="deck-no" label="No" variant="secondary" onPress={() => go('no')} />
        </View>
      </View>
      <View className="mt-2.5 shrink-0">
        <Button testID="deck-ok" label={pick} onPress={() => go('ok')} />
      </View>
      {toast ?? (
        <Text className="mt-3 min-h-11 shrink-0 text-center text-footnote text-muted">
          {swipe ? 'Desliza a la derecha para aceptar, a la izquierda para más tarde' : 'Una regla se firma con sus palabras: tócala para revisarla'}
        </Text>
      )}
    </View>
  );
}

/** After a move: what happened, and «Deshacer» for a few seconds. */
export function DeckToast({ move, onUndo, onClose }: { move: DeckMove; onUndo: () => void; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [move, onClose]);
  const what = move.kind === 'later' ? 'Para mañana' : move.kind === 'no' ? 'Respondida: no' : `Respondida: ${pickLabel(move.decision)}`;
  return (
    <View accessibilityLiveRegion="polite" className="mt-3 shrink-0 flex-row items-center rounded-2xl bg-accent py-1 pl-4 pr-1">
      <Text className="flex-1 text-[15px] text-on-accent" numberOfLines={1}>
        {what}
      </Text>
      <Pressable testID="deck-undo" accessibilityRole="button" onPress={onUndo} hitSlop={6} className="min-h-11 justify-center px-3 active:opacity-60">
        <Text className="text-[15px] font-semibold text-on-accent">Deshacer</Text>
      </Pressable>
    </View>
  );
}
