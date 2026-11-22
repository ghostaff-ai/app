import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// The app's three haptics (app-design.md, decision 25), so every screen uses
// the same one for the same thing. The web has none; a phone that refuses one
// stays quiet.

const native = Platform.OS !== 'web';

/** A choice changed: a chip, a segment, a level. */
export function selection() {
  if (native) void Haptics.selectionAsync().catch(() => {});
}

/** Something landed: an answer given, an account connected. */
export function success() {
  if (native) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** A message sent. */
export function tap() {
  if (native) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
