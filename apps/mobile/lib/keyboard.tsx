import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The web's twin of keyboard.native.tsx: no on-screen keyboard to follow.

export function KeyboardRoot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function KeyboardColumn({ children }: { children: ReactNode; offset?: number }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}

/** Nothing to close on the web. */
export async function dismissKeyboard(): Promise<void> {}

export function KeyboardForm({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      {footer ? (
        <View className="bg-surface" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}
