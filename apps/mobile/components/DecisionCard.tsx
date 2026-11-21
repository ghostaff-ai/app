import type { Decision } from '@ghostaff/shared';
import { Image, Pressable, Text, View } from 'react-native';
import { answerLabel, dueLabel, shortDate } from '@/lib/format';
import { GHOSTS, agentLabel, ghostFor } from '@/lib/team';

// A decision in the inbox: the ghost of the agent that asks, the question, and
// who asks with when it is due. The orange dot means it waits for you.

/** `selected`: the one open beside the list on a desktop's Hoy. */
export function DecisionCard({ decision, onPress, selected }: { decision: Decision; onPress: () => void; selected?: boolean }) {
  const waiting = !decision.answer;
  const due = waiting && decision.dueOn ? dueLabel(decision.dueOn) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={decision.question}
      accessibilityState={selected ? { selected: true } : undefined}
      onPress={onPress}
      className={`mb-2 flex-row items-center rounded-2xl border-2 bg-card p-3 ${selected ? 'border-ink' : 'border-transparent'}`}
    >
      <Image
        testID="agent-ghost"
        source={GHOSTS[ghostFor(decision.proposedBy)].picture}
        style={{ width: 48, height: 48, marginRight: 12 }}
        resizeMode="contain"
      />
      <View className="flex-1">
        <Text className={`text-base leading-5 ${waiting ? 'font-semibold text-ink' : 'text-muted'}`} numberOfLines={3}>
          {decision.question}
        </Text>
        <View className="mt-1 flex-row flex-wrap items-center">
          {waiting ? <View testID="waiting-dot" className="mr-1.5 h-2 w-2 rounded-full bg-waiting" /> : null}
          <Text className="text-sm text-muted">
            {agentLabel(decision.proposedBy)}
            {' · '}
          </Text>
          {due ? (
            <Text className={`text-sm ${due.urgent ? 'font-semibold text-waiting' : 'text-muted'}`}>{due.text}</Text>
          ) : (
            <Text className="text-sm text-muted">{shortDate(decision.createdOn)}</Text>
          )}
        </View>
        {decision.answer ? <Text className="mt-1 text-sm text-muted">{answerLabel(decision.answer)}</Text> : null}
      </View>
    </Pressable>
  );
}
