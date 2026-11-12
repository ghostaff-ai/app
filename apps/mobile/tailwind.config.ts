import type { Config } from 'tailwindcss';

// One small palette until there is a brand (the brand is parked in this phase,
// ghostaff-producto.md decision 8).
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 'class', not the default 'media': on web NativeWind sets the colour scheme
  // itself once its stylesheet loads, and throws under 'media'. The app is
  // light only (app.config.ts), so nothing ever adds the `dark` class.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#F7F6F3',
        card: '#FFFFFF',
        ink: '#1C1B19',
        muted: '#6B6862',
        line: '#E4E1DA',
        accent: '#2F5D50',
        ok: '#2F7D4F',
        no: '#A23B2C',
        waiting: '#C2410C',
      },
    },
  },
  plugins: [],
} satisfies Config;
