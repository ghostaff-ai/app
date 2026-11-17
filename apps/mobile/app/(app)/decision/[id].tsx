import { RULE_KIND, type DecisionSource } from '@ghostaff/shared';
import { AUTONOMY_STREAK } from '@ghostaff/shared/services';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorText, Loading, Notice } from '@/components/ui';
import { answerLabel, dueLabel, kindLabel, shortDate } from '@/lib/format';
import { useDecision } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { GHOSTS, agentLabel, ghostFor } from '@/lib/team';
import { COLORS } from '@/lib/theme';

// One decision, laid out so it can be decided in a minute (docs/plans/ongoing/
// app-design.md): who asks, the question, one quoted source, the sources, what
// happens with yes and with no, and the agent's recommendation as the main
// button. The full context stays one tap away. An answer given here can be
// taken back until the sync has handed it to the agent.

export default function DecisionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { decision, loading, error, answer, takeBack, streak } = useDecision(id);
  const { active } = useActiveOrg();
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [signed, setSigned] = useState('');
  const [busy, setBusy] = useState<'ok' | 'no' | 'back' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (decision?.ruleProposal) setSigned(decision.ruleProposal);
  }, [decision?.ruleProposal]);

  if (loading) return <Loading />;
  if (error || !decision) return <Notice title="No encontramos esta decisión" body={error ?? 'Puede que ya esté cerrada.'} />;

  const isRule = decision.kind === RULE_KIND;
  const hasParts = !!(decision.quote || decision.ifYes || decision.ifNo || decision.sources.length);
  const agent = agentLabel(decision.proposedBy);
  const due = decision.dueOn && !decision.answer ? dueLabel(decision.dueOn) : null;
  const mine = decision.answer?.byName === active?.displayName;
  const canTakeBack = !!decision.answer && decision.answer.source === 'app' && !decision.answer.writtenBackAt && !decision.closedAt && mine;

  const send = async (a: 'ok' | 'no') => {
    setBusy(a);
    setActionError(null);
    try {
      await answer({ answer: a, note, ...(isRule && a === 'ok' ? { signedText: signed } : {}) });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const undo = async () => {
    setBusy('back');
    setActionError(null);
    try {
      await takeBack();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const okLabel = isRule ? 'Firmar la regla' : decision.recommendation ?? 'OK';

  return (
    <View className="flex-1 bg-surface">
      <ScrollView contentContainerClassName="px-5 pb-10 pt-2" keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center">
          <Image
            testID="agent-ghost"
            source={GHOSTS[ghostFor(decision.proposedBy)].picture}
            style={{ width: 56, height: 56 }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <View className="ml-3 flex-1">
            <Text className="text-base font-semibold text-ink">{agent}</Text>
            <Text className="text-sm text-muted">
              {isRule ? 'Propone una regla' : kindLabel(decision.kind)} · {shortDate(decision.createdOn)}
            </Text>
          </View>
        </View>

        {due ? (
          <Text testID="due" className={`mt-4 text-sm font-semibold ${due.urgent ? 'text-waiting' : 'text-muted'}`}>
            {due.text}
          </Text>
        ) : null}
        <Text accessibilityRole="header" className="mt-2 font-display text-2xl leading-8 text-ink">
          {decision.question}
        </Text>

        {decision.quote ? (
          <View testID="quote" className="mt-4 rounded-r-xl border-l-4 border-line bg-card px-4 py-3">
            <Text className="text-base italic leading-6 text-muted" selectable>
              {decision.quote}
            </Text>
          </View>
        ) : null}

        {decision.sources.length ? (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {decision.sources.map((s, i) => (
              <SourceChip key={`${s.text}-${i}`} source={s} />
            ))}
          </View>
        ) : null}

        {decision.ifYes || decision.ifNo ? (
          <View className="mt-4 flex-row gap-3">
            <Outcome title={isRule ? 'Si la firmas' : 'Con el sí'} body={decision.ifYes} />
            <Outcome title="Con el no" body={decision.ifNo} />
          </View>
        ) : null}

        {isRule && !decision.answer ? (
          <View className="mt-5">
            <Text className="mb-2 text-sm font-semibold text-ink">La regla que firmas</Text>
            <TextInput
              accessibilityLabel="Texto de la regla"
              multiline
              textAlignVertical="top"
              className="min-h-24 rounded-xl border border-line bg-card px-4 py-3 text-base text-ink"
              value={signed}
              onChangeText={setSigned}
            />
          </View>
        ) : null}

        {hasParts ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: contextOpen }}
            onPress={() => setContextOpen((o) => !o)}
            className="mt-5 flex-row items-center"
            hitSlop={8}
          >
            <Text className="text-base font-semibold text-ink">{contextOpen ? 'Ocultar el contexto' : 'Todo el contexto'}</Text>
          </Pressable>
        ) : null}
        {!hasParts || contextOpen ? (
          <Text className="mt-3 text-base leading-6 text-ink" selectable>
            {decision.context}
          </Text>
        ) : null}

        {streak != null && streak > 0 && !isRule ? <Streak n={streak} agent={agent} /> : null}

        {decision.answer ? (
          <View testID="answered" className="mt-6 rounded-2xl bg-card p-4">
            <Text className="text-base font-semibold text-ink">{answerLabel(decision.answer)}</Text>
            {decision.answer.note ? <Text className="mt-2 text-base text-muted">{decision.answer.note}</Text> : null}
            {decision.answer.signedText ? <Text className="mt-2 text-base text-ink">«{decision.answer.signedText}»</Text> : null}
            {canTakeBack ? (
              <Pressable accessibilityRole="button" onPress={busy ? undefined : () => void undo()} className="mt-3 self-start" hitSlop={8}>
                {busy === 'back' ? (
                  <ActivityIndicator />
                ) : (
                  <Text className="text-base font-semibold text-ink underline">Cambiar la respuesta</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View className="mt-5">
            {noteOpen ? (
              <TextInput
                accessibilityLabel={`Nota para ${agent}`}
                placeholder={`Nota para ${agent}`}
                placeholderTextColor={COLORS.muted}
                multiline
                maxLength={2000}
                autoFocus
                textAlignVertical="top"
                className="min-h-20 rounded-xl border border-line bg-card px-4 py-3 text-base text-ink"
                value={note}
                onChangeText={setNote}
              />
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setNoteOpen(true)} hitSlop={8} className="self-start">
                <Text className="text-base text-muted">Añadir una nota para {agent}</Text>
              </Pressable>
            )}
          </View>
        )}
        <ErrorText>{actionError}</ErrorText>
      </ScrollView>

      {decision.answer ? null : (
        <View className="flex-row gap-3 border-t border-line bg-surface px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          <ActionButton label="No" tone="plain" busy={busy === 'no'} disabled={!!busy} onPress={() => void send('no')} />
          <ActionButton
            label={okLabel}
            tone="primary"
            grow
            busy={busy === 'ok'}
            disabled={!!busy || (isRule && !signed.trim())}
            onPress={() => void send('ok')}
          />
        </View>
      )}
    </View>
  );
}

function Outcome({ title, body }: { title: string; body: string | null }) {
  return (
    <View className="flex-1 rounded-2xl bg-card p-3">
      <Text className="text-sm font-semibold text-ink">{title}</Text>
      <Text className="mt-1 text-sm leading-5 text-muted">{body ?? '—'}</Text>
    </View>
  );
}

const isUrl = (s: string) => /^https?:\/\//i.test(s);

function SourceChip({ source }: { source: DecisionSource }) {
  const link = source.link && isUrl(source.link) ? source.link : null;
  const body = (
    <Text className={`text-sm ${link ? 'text-ink underline' : 'text-ink'}`} numberOfLines={1}>
      {source.text}
    </Text>
  );
  const cls = 'max-w-full rounded-full border border-line bg-card px-3 py-1.5';
  if (!link) return <View className={cls}>{body}</View>;
  return (
    <Pressable accessibilityRole="link" accessibilityHint="Abre la fuente" onPress={() => void Linking.openURL(link)} className={cls}>
      {body}
    </Pressable>
  );
}

/** OKs in a row for this kind of decision, toward the streak that lets the agent ask to do it alone. */
function Streak({ n, agent }: { n: number; agent: string }) {
  const shown = Math.min(n, AUTONOMY_STREAK);
  return (
    <View testID="streak" className="mt-6 flex-row items-center">
      <View className="flex-row gap-1" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: AUTONOMY_STREAK }, (_, i) => (
          <View key={i} className={`h-1.5 w-3 rounded-full ${i < shown ? 'bg-ok' : 'bg-line'}`} />
        ))}
      </View>
      <Text className="ml-3 flex-1 text-sm text-muted">
        {shown} de {AUTONOMY_STREAK} OK seguidos sin corregir a {agent} en esto.
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  tone,
  grow,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  tone: 'primary' | 'plain';
  grow?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const primary = tone === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      onPress={disabled ? undefined : onPress}
      className={`min-h-12 flex-row items-center justify-center rounded-full px-5 py-3 ${grow ? 'flex-1' : ''} ${
        primary ? 'bg-accent' : 'border border-line bg-card'
      } ${disabled && !busy ? 'opacity-50' : ''}`}
    >
      {busy ? <ActivityIndicator color={primary ? COLORS.card : COLORS.ink} /> : null}
      <Text numberOfLines={1} className={`text-base font-semibold ${primary ? 'text-white' : 'text-ink'} ${busy ? 'ml-2' : ''}`}>
        {label}
      </Text>
    </Pressable>
  );
}

