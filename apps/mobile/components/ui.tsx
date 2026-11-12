import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

// The few building blocks every screen uses. Grow this before adding a
// one-off style to a screen.

export function Centered({ children }: { children: ReactNode }) {
  return <View className="flex-1 items-center justify-center bg-surface px-6">{children}</View>;
}

export function Loading() {
  return (
    <Centered>
      <ActivityIndicator />
    </Centered>
  );
}

export function Notice({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Centered>
      <Text className="text-center text-lg font-semibold text-ink">{title}</Text>
      {body ? <Text className="mt-2 text-center text-base text-muted">{body}</Text> : null}
      {action ? <View className="mt-6">{action}</View> : null}
    </Centered>
  );
}

type Tone = 'primary' | 'ok' | 'no' | 'plain';

const toneClass: Record<Tone, string> = {
  primary: 'bg-accent',
  ok: 'bg-ok',
  no: 'bg-no',
  plain: 'bg-card border border-line',
};

export function Button({
  label,
  onPress,
  tone = 'primary',
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  busy?: boolean;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      className={`min-h-12 flex-row items-center justify-center rounded-xl px-5 py-3 ${toneClass[tone]} ${off ? 'opacity-50' : ''}`}
    >
      {busy ? <ActivityIndicator color={tone === 'plain' ? undefined : '#fff'} /> : null}
      <Text className={`text-base font-semibold ${tone === 'plain' ? 'text-ink' : 'text-white'} ${busy ? 'ml-2' : ''}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text className="mt-3 text-sm text-no">{children}</Text>;
}
