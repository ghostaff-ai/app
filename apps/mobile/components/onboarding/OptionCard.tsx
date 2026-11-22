import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon, type IconComponent } from '@/components/icons';

// One answer to a step's question, picked with a tap (welcome-and-spaces.md):
// the chosen one gets an ink border, the button under the step does the rest.

export function OptionCard({
  title,
  body,
  icon,
  leading,
  selected,
  onPress,
  testID,
}: {
  title: string;
  body: string;
  icon?: IconComponent;
  /** In place of an icon: a logo. */
  leading?: ReactNode;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`mb-3 flex-row items-center rounded-2xl border-2 bg-card p-4 active:opacity-80 ${selected ? 'border-ink' : 'border-transparent'}`}
    >
      <View className="mr-4 h-11 w-11 items-center justify-center rounded-xl bg-sunk">
        {leading ?? (icon ? <Icon icon={icon} size={24} /> : null)}
      </View>
      <View className="flex-1">
        <Text className="font-display-medium text-[17px] text-ink">{title}</Text>
        <Text className="mt-0.5 text-footnote text-muted">{body}</Text>
      </View>
    </Pressable>
  );
}
