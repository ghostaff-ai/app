import type { ReactNode } from 'react';
import { KeyboardAvoidingView, KeyboardController, KeyboardProvider } from 'react-native-keyboard-controller';

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

/**
 * Closes the keyboard and waits until it is gone, before moving on to another
 * screen. A KeyboardColumn that mounts while the keyboard is still closing can
 * miss its last event and keep the keyboard's padding after it has gone (the
 * library reads the starting state from the JS thread, which can lag the UI
 * thread; react-native-keyboard-controller 1.22.7 to 1.24.0): the next screen
 * stays squeezed into the top half. Never waits more than a second.
 */
export async function dismissKeyboard(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 1000);
  });
  try {
    await Promise.race([KeyboardController.dismiss(), giveUp]);
  } finally {
    clearTimeout(timer);
  }
}
