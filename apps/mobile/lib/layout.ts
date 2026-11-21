import { Platform, useWindowDimensions } from 'react-native';

// The app on a computer (docs/plans/ideas/desktop-web.md): same screens and
// brand, a desktop structure (a sidebar instead of the three tabs, lists and
// their detail side by side) from this width up. Only on the web: a tablet in
// landscape keeps the phone's native tabs.

export const DESKTOP_MIN_WIDTH = 1024;

/** The widest a screen's content grows on a desktop, so lines stay readable. */
export const DESKTOP_CONTENT_MAX_WIDTH = 1120;

export const isDesktopWidth = (os: string, width: number) => os === 'web' && width >= DESKTOP_MIN_WIDTH;

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return isDesktopWidth(Platform.OS, width);
}

/** A list's column when its detail opens beside it (Hoy, Equipo). */
export const DESKTOP_LIST_WIDTH = 440;
