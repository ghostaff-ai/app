import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// On the phone the tab bar is the system's, at the bottom, and it moves scroll
// views clear of itself. On the web it floats over the top of the page, so the
// tab screens leave it room.
export const TAB_SCREEN_TOP = Platform.OS === 'web' ? 72 : 0;

/**
 * How far down a tab screen's content starts. iOS moves a scroll view clear of
 * the status bar by itself (contentInsetAdjustmentBehavior); Android draws edge
 * to edge and doesn't, so there the content starts below the status bar.
 */
export function useTabScreenTop(): number {
  const { top } = useSafeAreaInsets();
  return TAB_SCREEN_TOP + (Platform.OS === 'android' ? top : 0);
}
