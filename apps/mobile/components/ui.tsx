import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';

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

const inputClass = 'rounded-xl border border-line bg-card px-4 py-3 text-base text-ink';

/** A labelled text box. `hint` sits under the label. */
export function Field({
  label,
  hint,
  multiline,
  ...input
}: { label: string; hint?: string } & TextInputProps) {
  return (
    <View className="mt-5">
      <Text className="text-sm font-semibold text-ink">{label}</Text>
      {hint ? <Text className="mt-1 text-sm text-muted">{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#6B6862"
        className={`mt-2 ${inputClass} ${multiline ? 'min-h-24' : ''}`}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : undefined}
        {...input}
      />
    </View>
  );
}

/** One choice of several; tap again to clear. */
export function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <View className="mt-5">
      <Text className="text-sm font-semibold text-ink">{label}</Text>
      <View className="mt-2 flex-row flex-wrap gap-2">
        {options.map((o) => {
          const on = o === value;
          return (
            <Pressable
              key={o}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(on ? null : o)}
              className={`rounded-full border px-4 py-2 ${on ? 'border-accent bg-accent' : 'border-line bg-card'}`}
            >
              <Text className={`text-sm ${on ? 'text-white' : 'text-ink'}`}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A big tappable card: a title and a line under it. */
export function Choice({ title, body, onPress }: { title: string; body: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="mb-3 rounded-2xl border border-line bg-card p-5">
      <Text className="text-lg font-semibold text-ink">{title}</Text>
      <Text className="mt-1 text-base text-muted">{body}</Text>
    </Pressable>
  );
}
