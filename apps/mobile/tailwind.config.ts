import type { Config } from 'tailwindcss';

// One small palette until there is a brand (the brand is parked in this phase,
// ghostaff-producto.md decision 8).
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
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
