import { FONTS, type Palette } from './palette';

// The native stack's header, the same on every stack: no line under it, the
// page's own ground, and its title in Rubik.
export const headerFor = (c: Palette) =>
  ({
    headerShadowVisible: false,
    headerStyle: { backgroundColor: c.surface },
    headerTintColor: c.ink,
    headerTitleStyle: { fontFamily: FONTS.display },
    headerBackTitle: 'Atrás',
  }) as const;
