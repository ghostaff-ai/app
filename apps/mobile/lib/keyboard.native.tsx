import type { ReactNode } from 'react';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';

// The phone's keyboard, followed frame by frame (react-native-keyboard-controller,
// team-chat.md decision 1). The web has no on-screen keyboard to follow:
// keyboard.tsx is its plain twin.

export function KeyboardRoot({ children }: { children: ReactNode }) {
  return <KeyboardProvider>{children}</KeyboardProvider>;
}

/** A column whose bottom (a composer) rides on top of the keyboard. `offset`: the header's height above it. */
export function KeyboardColumn({ children, offset = 0 }: { children: ReactNode; offset?: number }) {
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={offset} style={{ flex: 1 }}>
      {children}
    </KeyboardAvoidingView>
  );
}
