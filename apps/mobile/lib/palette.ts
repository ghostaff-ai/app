// The app's colours and faces as plain values, read by Tailwind's config (in
// Node) and by lib/theme.ts (in the app).
// docs/plans/ongoing/app-design.md, decisions 21–22: by day a calm desk, ink
// and greys tinted toward the ghost's violet; after dark a night studio, deep
// ink with the ghost glowing. The app follows the phone. Orange only for what
// waits for you, green only for earned autonomy, red only for errors.

export type Palette = {
  surface: string;
  card: string;
  sunk: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  /** Text and spinners on an accent background. */
  onAccent: string;
  ok: string;
  no: string;
  waiting: string;
};

export const LIGHT: Palette = {
  surface: '#F3F3F7',
  card: '#FFFFFF',
  sunk: '#E9E8F0',
  ink: '#16151E',
  muted: '#6A687A',
  line: '#E1E0E9',
  accent: '#16151E',
  onAccent: '#FFFFFF',
  ok: '#2F7D4F',
  no: '#A23B2C',
  waiting: '#D9622B',
};

export const DARK: Palette = {
  surface: '#0C0D13',
  card: '#171922',
  sunk: '#23252F',
  ink: '#ECEDF3',
  muted: '#8C8FA0',
  line: '#262833',
  accent: '#ECEDF3',
  onAccent: '#0C0D13',
  ok: '#3A9A62',
  no: '#C4503F',
  waiting: '#FF8A4C',
};

export type Scheme = 'light' | 'dark';

export const PALETTES: Record<Scheme, Palette> = { light: LIGHT, dark: DARK };

// Tailwind's colour names (bg-surface, text-on-accent …) read these CSS
// variables; the root view sets them for the current scheme (app/_layout.tsx).
export const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const COLOR_NAMES = Object.keys(LIGHT).map(kebab);

/** Headings: Rubik, loaded in app/_layout.tsx. Body text stays the phone's own face. */
export const FONTS = {
  display: 'Rubik_600SemiBold',
  displayMedium: 'Rubik_500Medium',
} as const;
