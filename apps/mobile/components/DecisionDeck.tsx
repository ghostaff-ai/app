import { type Decision, RULE_KIND } from '@ghostaff/shared';
import { router } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, type LayoutChangeEvent, PanResponder, Platform, Pressable, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { StakesReveal } from '@/components/StakesReveal';
import { answeredLabel, canSwipe, type Choice, choicesOf, decisionHref, nextFold, pickLabel, SWIPE_DISTANCE } from '@/lib/deck';
import { dueLabel, shortDate } from '@/lib/format';
import { selection, success } from '@/lib/haptics';
import type { DeckMove } from '@/lib/hooks/useDecisions';
import { GHOSTS, askerOf } from '@/lib/team';
import { usePalette } from '@/lib/theme';

// The decision deck (docs/plans/ongoing/three-tabs.md, decision 7; Álvaro
// picked version A of the drawn cards, 2026-11-24): one card on top of the
// others. Three buttons always there: «Más tarde», «No» and the agent's pick,
// named. Swipe right takes the pick, left leaves it for tomorrow; never «no»,
// since a swipe reads as throwing away. A rule can't be swiped: it is signed
// on its own screen. A tap on the card opens all of it, with «Preguntar».
// A decision with options shows each as a button, the pick the main one; a
// high-stakes one takes no swipe and shows the pick only after you choose
// (docs/plans/ready/decision-model.md, decisions 2 and 3). An agent's action
// waiting for an OK is a card too: «Aprobar» runs it at once, so it takes no
// swipe and no «Deshacer», and a tap opens its conversation.

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

/**
 * One card's face: who asks and when, the question, one quoted line, «Con el sí
 * / Con el no» and the pick. On a short card (a small phone, larger text) it
 * folds what doesn't fit (lib/deck.ts, nextFold), measured rather than guessed,
 * and shows itself once it fits.
 */
function Face({ d, asked }: { d: Decision; asked: boolean }) {
  const due = d.dueOn ? dueLabel(d.dueOn) : null;
  const asker = askerOf(d);
  const quote = (d.action && d.context) || d.quote;
  const ifs = !d.options.length && (d.ifYes || d.ifNo);
  // Each part's height as last drawn. A folded part counts as nothing, so
  // folding one more step never waits for a new measurement.
  const [fold, setFold] = useState(0);
  const [room, setRoom] = useState(0);
  const [core, setCore] = useState(0);
  const [quoteHeight, setQuoteHeight] = useState(0);
  const [ifsHeight, setIfsHeight] = useState(0);
  const [foot, setFoot] = useState(0);
  const need = core + (fold < 2 ? quoteHeight : 0) + (fold < 1 ? ifsHeight : 0) + foot;
  const measured = room > 0 && core > 0 && foot > 0;
  const next = measured ? nextFold(fold, need, room) : fold;
  useEffect(() => {
    if (next !== fold) setFold(next);
  }, [next, fold]);
  const height = (set: (h: number) => void) => (e: LayoutChangeEvent) => set(Math.ceil(e.nativeEvent.layout.height));
  return (
    <View className="flex-1" onLayout={height(setRoom)} style={{ opacity: measured && next === fold ? 1 : 0 }}>
      <View onLayout={height(setCore)}>
        <View className="flex-row items-center">
          <Image source={GHOSTS[asker.ghost].picture} style={{ width: 44, height: 44 }} resizeMode="contain" />
          <View className="ml-2.5">
            <Text className="text-[15px] font-semibold text-ink">{asker.name}</Text>
            <Text className={`text-footnote ${due?.urgent ? 'font-semibold text-waiting' : 'text-muted'}`}>{due ? due.text : shortDate(d.createdOn)}</Text>
          </View>
        </View>
        <Text className="mt-4 font-display-medium text-[24px] leading-[30px] text-ink" numberOfLines={fold >= 3 ? 3 : 5}>
          {d.question}
        </Text>
      </View>
      {quote && fold < 2 ? (
        <View onLayout={height(setQuoteHeight)}>
          {d.action && d.context ? (
            <Text className="mt-3 rounded-2xl bg-surface p-3 text-[14px] leading-[19px] text-muted" numberOfLines={7}>
              {d.context}
            </Text>
          ) : null}
          {d.quote ? (
            <Text className="mt-3 text-[15px] leading-[22px] text-muted" numberOfLines={3}>
              «{d.quote}»
            </Text>
          ) : null}
        </View>
      ) : null}
      {/* With options, what each does is on its own screen: the buttons already take the card's room. */}
      {ifs && fold < 1 ? (
        <View onLayout={height(setIfsHeight)} className="mt-4 flex-row gap-2.5">
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
      <View onLayout={height(setFoot)}>
        {d.highStakes ? (
          <Text className="text-footnote font-semibold text-ink">Importante: elige tú primero</Text>
        ) : !d.action && (d.recommendation || d.options.length) ? (
          <Text className="text-footnote text-muted">
            Te recomiendo <Text className="font-semibold text-ink">{pickLabel(d)}</Text>
          </Text>
        ) : null}
        <Text className="mt-1 text-footnote text-muted">
          {d.action ? 'Toca para ver la conversación' : asked ? `Preguntaste a ${asker.name} · toca para verlo todo` : 'Toca para ver todo y preguntar'}
        </Text>
      </View>
    </View>
  );
}

export function DecisionDeck({
  cards,
  asked,
  onMove,
  toast,
}: {
  cards: Decision[];
  /** The cards the person asked their agent about: «Preguntaste». */
  asked?: ReadonlySet<string>;
  onMove: (d: Decision, kind: DeckMove['kind'], option?: string) => void;
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
  // A high-stakes choice that differs from the pick, waiting to be kept or switched.
  const [held, setHeld] = useState<Choice | null>(null);

  // A new top card starts in the middle.
  useEffect(() => {
    pan.setValue({ x: 0, y: 0 });
    setBusy(false);
    setHeld(null);
  }, [top?.id, pan]);

  const go = (kind: DeckMove['kind'], option?: string) => {
    const d = topRef.current;
    if (!d || busy) return;
    if (kind === 'ok' && d.kind === RULE_KIND) {
      router.push(`/decision/${d.id}`);
      return;
    }
    // «ok» from a swipe takes the pick; with options, that is the pick's id.
    const opt = option ?? (kind === 'ok' && d.recommendedOption ? d.recommendedOption : undefined);
    setBusy(true);
    if (kind === 'later') selection();
    else success();
    const done = () => onMove(d, kind, opt);
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
  const pick = pickLabel(top);
  const choices = choicesOf(top);
  const pickChoice = choices.find((x) => x.pick);
  const choose = (x: Choice) => {
    if (top.highStakes && pickChoice && !x.pick) setHeld(x);
    else go(x.answer, x.option);
  };
  const choiceButton = (x: Choice, primary: boolean) => (
    <Button
      key={x.option ?? x.answer}
      testID={x.option ? `deck-option-${x.option}` : `deck-${x.answer}`}
      label={x.label}
      variant={primary ? 'primary' : 'secondary'}
      onPress={() => choose(x)}
    />
  );
  const later = <Button testID="deck-later" label="Más tarde" variant="secondary" onPress={() => go('later')} />;
  // Yes-or-no and not high-stakes: version A's three buttons. Otherwise each choice is a button.
  const plain = top.kind === RULE_KIND || (!top.options.length && !top.highStakes);

  return (
    <View className="flex-1">
      <View className="flex-1" style={{ minHeight: 200 }}>
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
            accessibilityLabel={`${askerOf(top).name} pregunta: ${top.question}`}
            accessibilityHint={top.action ? 'Abre la conversación' : 'Abre la decisión entera'}
            onPress={() => router.push(decisionHref(top))}
            className="flex-1 rounded-[28px] bg-card p-6"
            style={{ shadowColor: '#16151E', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 3 }}
          >
            <Face d={top} asked={!!asked?.has(top.id)} />
          </Pressable>
          <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 96, left: 24, opacity: okHint, backgroundColor: c.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text className="text-footnote font-semibold text-on-accent">{pick}</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 96, right: 24, opacity: laterHint, backgroundColor: c.sunk, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text className="text-footnote font-semibold text-ink">Más tarde</Text>
          </Animated.View>
        </Animated.View>
      </View>

      {held && pickChoice ? (
        <View className="mt-2 shrink-0">
          <StakesReveal
            chosen={held}
            pick={pickChoice}
            agent={askerOf(top).name}
            busy={busy}
            onKeep={() => go(held.answer, held.option)}
            onSwitch={() => go(pickChoice.answer, pickChoice.option)}
          />
        </View>
      ) : plain ? (
        <>
          <View className="mt-2 shrink-0 flex-row gap-2.5">
            <View className="flex-1">{later}</View>
            <View className="flex-1">
              <Button testID="deck-no" label="No" variant="secondary" onPress={() => go('no')} />
            </View>
          </View>
          <View className="mt-2.5 shrink-0">
            <Button testID="deck-ok" label={pick} onPress={() => go('ok')} />
          </View>
        </>
      ) : top.options.length ? (
        <View className="mt-2 shrink-0 gap-2.5">
          {choices.map((x) => choiceButton(x, x.pick && !top.highStakes))}
          {later}
        </View>
      ) : (
        <>
          <View className="mt-2 shrink-0 flex-row gap-2.5">
            {choices.map((x) => (
              <View key={x.answer} className="flex-1">
                {choiceButton(x, false)}
              </View>
            ))}
          </View>
          <View className="mt-2.5 shrink-0">{later}</View>
        </>
      )}
      {toast ?? (
        <Text className="mt-3 min-h-11 shrink-0 text-center text-footnote text-muted">
          {top.action
            ? 'Al aprobarlo se hace enseguida y no se puede deshacer'
            : top.kind === RULE_KIND
            ? 'Una regla se firma con sus palabras: tócala para revisarla'
            : top.highStakes
              ? 'Es importante: elige tú, y luego verás qué recomendaba'
              : 'Desliza a la derecha para aceptar, a la izquierda para más tarde'}
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
  // An action approved or turned down has run: it cannot be undone.
  const final = !!move.decision.action && move.kind !== 'later';
  const what =
    move.kind === 'later'
      ? 'Para mañana'
      : move.decision.action
        ? move.kind === 'ok'
          ? 'Aprobado: se está haciendo'
          : 'Rechazado'
        : `Respondida: ${answeredLabel(move.decision, { answer: move.kind, option: move.option })}`;
  return (
    <View accessibilityLiveRegion="polite" className="mt-3 shrink-0 flex-row items-center rounded-2xl bg-accent py-1 pl-4 pr-1">
      <Text className="flex-1 text-[15px] text-on-accent" numberOfLines={1}>
        {what}
      </Text>
      {final ? (
        <View className="min-h-11" />
      ) : (
        <Pressable testID="deck-undo" accessibilityRole="button" onPress={onUndo} hitSlop={6} className="min-h-11 justify-center px-3 active:opacity-60">
          <Text className="text-[15px] font-semibold text-on-accent">Deshacer</Text>
        </Pressable>
      )}
    </View>
  );
}
