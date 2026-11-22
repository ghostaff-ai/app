import type { Config } from 'tailwindcss';
import { COLOR_NAMES, FONTS } from './lib/palette';

// The palette and heading face live in lib/palette.ts (docs/plans/ongoing/app-design.md).
// Each colour name reads a CSS variable that the root view sets for the phone's
// light or dark setting (app/_layout.tsx), so `bg-surface` is right in both.
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 'class', not the default 'media': on web NativeWind sets the colour scheme
  // itself once its stylesheet loads, and throws under 'media'. Light and dark
  // come from the variables above, so no screen uses `dark:` and nothing ever
  // adds the `dark` class.
  darkMode: 'class',
  theme: {
    extend: {
      colors: Object.fromEntries(COLOR_NAMES.map((n) => [n, `var(--c-${n})`])),
      // The type scale (app-design.md, «The look»): Rubik for titles, the phone's
      // own face for the rest. Sentence case everywhere; no all-caps labels.
      fontSize: {
        title: ['30px', { lineHeight: '36px', letterSpacing: '-0.6px' }],
        title2: ['22px', { lineHeight: '28px', letterSpacing: '-0.3px' }],
        title3: ['18px', { lineHeight: '24px', letterSpacing: '-0.2px' }],
        footnote: ['13px', { lineHeight: '18px' }],
        caption: ['12px', { lineHeight: '16px' }],
      },
      fontFamily: {
        display: [FONTS.display],
        'display-medium': [FONTS.displayMedium],
      },
    },
  },
  plugins: [],
} satisfies Config;
