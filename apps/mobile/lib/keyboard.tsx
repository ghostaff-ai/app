import type { ReactNode } from 'react';
import { View } from 'react-native';

// The web's twin of keyboard.native.tsx: no on-screen keyboard to follow.

export function KeyboardRoot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function KeyboardColumn({ children }: { children: ReactNode; offset?: number }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}
