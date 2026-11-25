import { Text, View } from 'react-native';
import { Button } from '@/components/ui';
import type { Choice } from '@/lib/deck';

// A high-stakes decision hides the agent's pick until the person has chosen
// (docs/plans/ready/decision-model.md, decision 3): your pick first, then the
// agent's, then keep yours or switch. Only shown when the two differ.

export function StakesReveal({
  chosen,
  pick,
  agent,
  busy,
  onKeep,
  onSwitch,
}: {
  chosen: Choice;
  pick: Choice;
  agent: string;
  busy?: boolean;
  onKeep: () => void;
  onSwitch: () => void;
}) {
  return (
    <View testID="stakes-reveal" accessibilityLiveRegion="polite">
      <Text className="text-center text-[15px] leading-[22px] text-ink">
        Elegiste <Text className="font-semibold">{chosen.label}</Text>. {agent} recomendaba{' '}
        <Text className="font-semibold">{pick.label}</Text>
        {pick.if ? `: ${pick.if}` : '.'}
      </Text>
      <View className="mt-3 gap-2.5">
        <Button testID="stakes-keep" label={`Quedarme con «${chosen.label}»`} busy={busy} onPress={onKeep} />
        <Button testID="stakes-switch" label={`Cambiar a «${pick.label}»`} variant="secondary" disabled={busy} onPress={onSwitch} />
      </View>
    </View>
  );
}
