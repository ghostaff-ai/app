import type { Config } from 'tailwindcss';
import { COLORS, FONTS } from './lib/theme';

// The palette and heading face live in lib/theme.ts (docs/plans/ongoing/app-design.md).
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 'class', not the default 'media': on web NativeWind sets the colour scheme
  // itself once its stylesheet loads, and throws under 'media'. The app is
  // light only (app.config.ts), so nothing ever adds the `dark` class.
  darkMode: 'class',
  theme: {
    extend: {
      colors: { ...COLORS },
      fontFamily: {
        display: [FONTS.display],
        'display-medium': [FONTS.displayMedium],
      },
    },
  },
  plugins: [],
} satisfies Config;
