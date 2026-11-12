import type { Decision } from '@ghostaff/shared';
import { Pressable, Text, View } from 'react-native';
import { answerLabel, shortDate } from '@/lib/format';

export function DecisionCard({ decision, onPress }: { decision: Decision; onPress: () => void }) {
  const waiting = !decision.answer;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={decision.question}
      onPress={onPress}
      className="mb-3 rounded-2xl border border-line bg-card p-4"
    >
      <View className="flex-row items-center">
        {waiting ? <View testID="waiting-dot" className="mr-2 h-2.5 w-2.5 rounded-full bg-waiting" /> : null}
        <Text className="text-xs uppercase tracking-wide text-muted">
          {decision.proposedBy} · {decision.area} · {shortDate(decision.createdOn)}
        </Text>
      </View>
      <Text className="mt-2 text-base font-semibold text-ink">{decision.question}</Text>
      {decision.answer ? <Text className="mt-2 text-sm text-muted">{answerLabel(decision.answer)}</Text> : null}
    </Pressable>
  );
}
