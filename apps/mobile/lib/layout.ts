import { usePathname } from 'expo-router';
import { Platform, useWindowDimensions } from 'react-native';

// The app on a computer (docs/plans/ongoing/desktop-web.md): same screens and
// brand, a desktop structure (a sidebar instead of the three tabs; Equipo and
// Conexiones with their list beside the open item) from this width up. Only on
// the web: a tablet in landscape keeps the phone's native tabs.

export const DESKTOP_MIN_WIDTH = 1024;

/** The widest a screen's content grows on a desktop, so lines stay readable. */
export const DESKTOP_CONTENT_MAX_WIDTH = 1120;

export const isDesktopWidth = (os: string, width: number) => os === 'web' && width >= DESKTOP_MIN_WIDTH;

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return isDesktopWidth(Platform.OS, width);
}

/** A page that is one thing to read and act on (a connection): a phone's measure, centred. */
export const DESKTOP_PAGE = { maxWidth: 640, width: '100%', alignSelf: 'center' } as const;

/** The list column between the sidebar and the open item (Equipo, Conexiones). */
export const DESKTOP_LIST_WIDTH = 340;

/** The sidebar's entries: the three tabs, and Empresa's pages a desk uses most. */
export type DesktopNav = 'equipo' | 'decisiones' | 'empresa' | 'conexiones' | 'memoria' | 'registro';

/** A list that stays beside the item it opened. */
export type DesktopList = 'team' | 'connections';

/** Where the list's own screen is: what shows when nothing in it is open. */
export const LIST_HOME: Record<DesktopList, string> = { team: '/', connections: '/empresa/conexiones' };

// An agent's chat and every page about the agent or a conversation: they open
// from Equipo's list and keep it beside them.
const TEAM_DETAILS = new Set([
  'chat',
  'conversacion',
  'agente',
  'acceso',
  'herramientas',
  'rutinas',
  'rutina',
  'nueva-conversacion',
  'conversaciones',
  'visibilidad',
]);
// Equipo's, but wide pages of their own: the jobs to hire for.
const TEAM_PAGES = new Set(['anadir-agente', 'nuevo-agente', 'contratar']);

/**
 * Which sidebar entry a path is under, and which list (if any) stands beside
 * it. `open` is the id in the path of the item open beside the list: an agent
 * or a conversation in Equipo, a connector in Conexiones.
 */
export function desktopSection(path: string): { nav: DesktopNav | null; list: DesktopList | null; open: string | null } {
  const [first, second, third] = path.split('/').filter(Boolean);
  if (!first) return { nav: 'equipo', list: 'team', open: null };
  if (TEAM_DETAILS.has(first)) return { nav: 'equipo', list: 'team', open: second ?? null };
  if (TEAM_PAGES.has(first)) return { nav: 'equipo', list: null, open: null };
  if (first === 'decisiones' || first === 'decision') return { nav: 'decisiones', list: null, open: null };
  // A file of the memory opens from the memory's list or from a reply's link (business-brain.md).
  if (first === 'memoria') return { nav: 'memoria', list: null, open: null };
  if (first === 'empresa') {
    if (second === 'registro') return { nav: 'registro', list: null, open: null };
    if (second === 'memoria') return { nav: 'memoria', list: null, open: null };
    if (second === 'conexiones') {
      // «Añadir conexión» is the whole catalogue, a page of its own.
      if (third === 'anadir') return { nav: 'conexiones', list: null, open: null };
      return { nav: 'conexiones', list: 'connections', open: third ?? null };
    }
    return { nav: 'empresa', list: null, open: null };
  }
  if (first === 'invitar') return { nav: 'empresa', list: null, open: null };
  return { nav: null, list: null, open: null };
}

/**
 * Whether opening an item of a list takes the open item's place. On a
 * desktop, with the list beside it, a second item replaces the first instead
 * of piling up behind it: the list is the way back. On a phone, it is a push,
 * as everywhere.
 */
export function useReplacesBeside(): boolean {
  const desktop = useIsDesktop();
  const path = usePathname();
  const { list } = desktopSection(path);
  return desktop && !!list && path !== LIST_HOME[list];
}
