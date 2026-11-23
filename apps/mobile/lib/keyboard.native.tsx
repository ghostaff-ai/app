import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
  KeyboardController,
  KeyboardProvider,
  KeyboardStickyView,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

/** Space between the keyboard and the footer, and between the footer and the field being typed in. */
const GAP = 12;

/**
 * A page that scrolls, with fields in it and its buttons pinned to the bottom (a
 * decision and its note). The buttons ride on top of the keyboard and the field
 * being typed in, caret included, scrolls into sight above them. A column
 * (KeyboardColumn) can't do this: it only shrinks, and a field near the end of a
 * long page stays below the fold, under the keyboard.
 */
export function KeyboardForm({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(0);
  // Under the buttons: the home indicator's safe area, or the keyboard once it is up.
  const bottom = Math.max(insets.bottom, GAP);
  const lift = bottom - GAP;
  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        // The buttons stand between the keyboard and the field, and cover the
        // bottom of the page by their height less the safe area they drop.
        bottomOffset={footer ? footerHeight - lift + GAP : GAP}
        extraKeyboardSpace={footer ? -lift : 0}
      >
        {children}
      </KeyboardAwareScrollView>
      {footer ? (
        <KeyboardStickyView offset={{ opened: lift }}>
          <View className="bg-surface" style={{ paddingBottom: bottom }} onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}>
            {footer}
          </View>
        </KeyboardStickyView>
      ) : null}
    </View>
  );
}
