import { vars } from 'nativewind';
import { useColorScheme } from 'react-native';
import { kebab, PALETTES, type Palette, type Scheme } from './palette';

// The colours for the phone's light or dark setting (lib/palette.ts holds the
// values). Screens use Tailwind classes; the few props that take a raw value
// (headers, placeholders, the 3D stage) use usePalette().

export * from './palette';

/** The phone's light or dark setting; light when it says neither. */
export function useScheme(): Scheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

export function usePalette(): Palette {
  return PALETTES[useScheme()];
}

/** The CSS variables Tailwind's colour names read, set once on the root view. */
export const colorVars = (p: Palette) =>
  vars(Object.fromEntries(Object.entries(p).map(([k, v]) => [`--c-${kebab(k)}`, v])));

/** The colour variables again, for what renders outside the root view (a Modal on the web is a portal). */
export function useColorVars() {
  return colorVars(usePalette());
}
