import { RULE_KIND } from '@ghostaff/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { Button, ErrorText, Loading, Notice } from '@/components/ui';
import { answerLabel, shortDate } from '@/lib/format';
import { useDecision } from '@/lib/hooks/useDecisions';

// One decision with its evidence, and OK or no. A rule is signed with its
// wording, which the person may edit before saying OK.

export default function DecisionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { decision, loading, error, answer } = useDecision(id);
  const [note, setNote] = useState('');
  const [signed, setSigned] = useState('');
  const [busy, setBusy] = useState<'ok' | 'no' | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);

  useEffect(() => {
    if (decision?.ruleProposal) setSigned(decision.ruleProposal);
  }, [decision?.ruleProposal]);

  if (loading) return <Loading />;
  if (error || !decision) return <Notice title="No encontramos esta decisión" body={error ?? 'Puede que ya esté cerrada.'} />;

  const isRule = decision.kind === RULE_KIND;

  const send = async (a: 'ok' | 'no') => {
    setBusy(a);
    setAnswerError(null);
    try {
      await answer({ answer: a, note, ...(isRule && a === 'ok' ? { signedText: signed } : {}) });
    } catch (e) {
      setAnswerError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="p-5 pb-16" keyboardShouldPersistTaps="handled">
      <Text className="text-xs uppercase tracking-wide text-muted">
        {decision.proposedBy} · {decision.area} · {shortDate(decision.createdOn)}
      </Text>
      <Text className="mt-2 text-xl font-bold text-ink">{decision.question}</Text>
      <Text className="mt-4 text-base leading-6 text-ink" selectable>
        {decision.context}
      </Text>

      {decision.answer ? (
        <View className="mt-6 rounded-2xl border border-line bg-card p-4">
          <Text className="text-base font-semibold text-ink">{answerLabel(decision.answer)}</Text>
          {decision.answer.note ? <Text className="mt-2 text-base text-muted">{decision.answer.note}</Text> : null}
          {decision.answer.signedText ? <Text className="mt-2 text-base text-ink">«{decision.answer.signedText}»</Text> : null}
        </View>
      ) : (
        <View className="mt-6">
          {isRule ? (
            <>
              <Text className="mb-2 text-sm font-semibold text-ink">La regla que firmas</Text>
              <TextInput
                accessibilityLabel="Texto de la regla"
                multiline
                className="min-h-24 rounded-xl border border-line bg-card px-4 py-3 text-base text-ink"
                value={signed}
                onChangeText={setSigned}
              />
            </>
          ) : null}
          <Text className="mb-2 mt-4 text-sm font-semibold text-ink">Nota para el agente (opcional)</Text>
          <TextInput
            accessibilityLabel="Nota"
            multiline
            maxLength={2000}
            className="min-h-20 rounded-xl border border-line bg-card px-4 py-3 text-base text-ink"
            value={note}
            onChangeText={setNote}
          />
          <View className="mt-6 flex-row gap-3">
            <View className="flex-1">
              <Button label="No" tone="no" busy={busy === 'no'} disabled={!!busy} onPress={() => void send('no')} />
            </View>
            <View className="flex-1">
              <Button
                label="OK"
                tone="ok"
                busy={busy === 'ok'}
                disabled={!!busy || (isRule && !signed.trim())}
                onPress={() => void send('ok')}
              />
            </View>
          </View>
          <ErrorText>{answerError}</ErrorText>
        </View>
      )}
    </ScrollView>
  );
}
