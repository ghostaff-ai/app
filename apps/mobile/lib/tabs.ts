import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsDesktop } from './layout';

// On the phone the tab bar is the system's, at the bottom (expo-router's
// NativeTabs). On iOS 26 it floats over the screen; on Android each screen is
// laid out above it. On a narrow web window it floats over the top of the
// page, so the tab screens leave it room. On a desktop there is no tab bar:
// the sidebar sits beside the screen (lib/layout.ts).
//
// What clears the bars for a tab screen, by platform:
// - iOS: NativeTabs turns on automatic content insets for the first scroll
//   view in each tab, top (status bar) and bottom (tab bar). A screen that
//   doesn't scroll (Decisiones' deck) gets neither and must leave the room
//   itself: `useTabScreenTop({ scrolls: false })` and `useTabBarSpace()`.
// - Android: NativeTabs wraps every tab screen in a safe-area view that keeps
//   it above the tab bar; the status bar at the top is the screen's to clear.
export const TAB_SCREEN_TOP = Platform.OS === 'web' ? 72 : 0;

type Insets = { top: number; bottom: number };

/** How far down a tab screen's content starts (see above). */
export function tabScreenTop(os: string, desktop: boolean, insets: Insets, scrolls: boolean): number {
  if (desktop) return 24;
  const systemClearsIt = os === 'ios' && scrolls;
  return TAB_SCREEN_TOP + (os === 'web' || systemClearsIt ? 0 : insets.top);
}

/**
 * How much room a tab screen that doesn't scroll leaves at the bottom so the
 * tab bar doesn't cover it. Only iOS needs any: there each tab screen gets its
 * own safe-area provider from NativeTabs, measured by UIKit, so its bottom
 * inset is the floating bar plus the home indicator, the bar's real height on
 * any phone and text size. Android already lays the screen out above the bar,
 * the web's bar is at the top and a desktop has none.
 */
export function tabBarSpace(os: string, desktop: boolean, insets: Insets): number {
  return os === 'ios' && !desktop ? insets.bottom : 0;
}

export function useTabScreenTop({ scrolls = true }: { scrolls?: boolean } = {}): number {
  const insets = useSafeAreaInsets();
  const desktop = useIsDesktop();
  return tabScreenTop(Platform.OS, desktop, insets, scrolls);
}

export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  const desktop = useIsDesktop();
  return tabBarSpace(Platform.OS, desktop, insets);
}
