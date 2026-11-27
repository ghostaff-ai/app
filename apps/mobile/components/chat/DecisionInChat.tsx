import { type DecisionPart, type DecisionQuotePart, RULE_KIND } from '@ghostaff/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Button, ErrorText } from '@/components/ui';
import { type Choice, choicesOf } from '@/lib/deck';
import { answerLabel } from '@/lib/format';
import { success } from '@/lib/haptics';
import { useDecision } from '@/lib/hooks/useDecisions';
import { askerOf } from '@/lib/team';

// A decision an agent asked for in its message (docs/plans/ready/decision-model.md,
// decision 5): the same row as the card in Decisiones, so answering here answers
// there. Its choices are buttons; a rule or a high-stakes decision opens on its
// own screen, where it is signed or chosen with the pick hidden.

export function DecisionInChat({ part, writing }: { part: DecisionPart; writing: boolean }) {
  const { decision, loading, answer } = useDecision(part.decisionId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = () => router.push(`/decision/${part.decisionId}`);

  const choose = async (c: Choice) => {
    setBusy(c.option ?? c.answer);
    setError(null);
    try {
      await answer(c.option ? { option: c.option } : { answer: c.answer });
      success();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onItsScreen = !!decision && (decision.kind === RULE_KIND || decision.highStakes);
  return (
    <View testID="chat-decision" className="mt-2.5 rounded-2xl border border-line bg-card p-4">
      <Pressable accessibilityRole="button" accessibilityHint="Abre la decisión entera" onPress={open} className="active:opacity-70">
        <Text className="text-caption font-semibold text-muted">Decisión</Text>
        <Text className="mt-1 text-base font-semibold leading-[21px] text-ink">{decision?.question ?? part.question}</Text>
      </Pressable>
      {loading ? (
        <ActivityIndicator className="mt-3 self-start" />
      ) : !decision ? (
        <Text className="mt-2 text-footnote text-muted">Ya no está abierta.</Text>
      ) : decision.answer ? (
        <Text testID="chat-decision-answered" className="mt-2 text-footnote text-muted">
          {answerLabel(decision.answer, askerOf(decision).name, decision.options)}
        </Text>
      ) : decision.closedAt ? (
        <Text className="mt-2 text-footnote text-muted">Cerrada sin respuesta.</Text>
      ) : writing ? null : onItsScreen ? (
        <View className="mt-3">
          <Button label={decision.kind === RULE_KIND ? 'Revisar la regla' : 'Elegir'} variant="secondary" size="small" onPress={open} />
        </View>
      ) : (
        <View className="mt-3 gap-2">
          {choicesOf(decision).map((c) => (
            <Button
              key={c.option ?? c.answer}
              testID={`chat-choice-${c.option ?? c.answer}`}
              label={c.label}
              variant={c.pick ? 'primary' : 'secondary'}
              busy={busy === (c.option ?? c.answer)}
              disabled={!!busy}
              onPress={() => void choose(c)}
            />
          ))}
        </View>
      )}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/** The decision a person asked their agent about, above their words. */
export function DecisionQuote({ part, mine }: { part: DecisionQuotePart; mine?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sobre la decisión: ${part.question}`}
      onPress={() => router.push(`/decision/${part.decisionId}`)}
      className={`mb-1.5 border-l-2 pl-2 ${mine ? 'border-mine-muted' : 'border-line'}`}
    >
      <Text className={`text-caption ${mine ? 'text-mine-muted' : 'text-muted'}`}>Sobre la decisión</Text>
      <Text className="text-footnote font-semibold text-ink" numberOfLines={2}>
        {part.question}
      </Text>
    </Pressable>
  );
}
