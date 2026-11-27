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
  /** What sits above a sunk track: the chosen segment of a segmented control. */
  raised: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  /** Text and spinners on an accent background. */
  onAccent: string;
  ok: string;
  no: string;
  waiting: string;
  /** The chat's background, behind the messages. */
  chat: string;
  /** The faint pattern drawn on the chat's background. */
  chatPattern: string;
  /** Your own message bubble. */
  mine: string;
  /** Secondary text inside your bubble. */
  mineMuted: string;
  /** A quote inside your bubble. */
  mineSunk: string;
  /** The other side's message bubble. */
  theirs: string;
  /** The chat's accent: links, the send button, the ghost's voice. */
  chatAccent: string;
  /** Text and icons on the chat's accent. */
  onChatAccent: string;
  /** Read receipts. */
  read: string;
  /** Floating pills: the day label, the unread divider. */
  chip: string;
};

export const LIGHT: Palette = {
  surface: '#F3F3F7',
  card: '#FFFFFF',
  sunk: '#E9E8F0',
  raised: '#FFFFFF',
  ink: '#16151E',
  muted: '#6A687A',
  line: '#E1E0E9',
  accent: '#16151E',
  onAccent: '#FFFFFF',
  ok: '#2F7D4F',
  no: '#A23B2C',
  waiting: '#D9622B',
  chat: '#ECEAF3',
  chatPattern: '#D6D2E6',
  mine: '#E4DFFB',
  mineMuted: '#6B6390',
  mineSunk: '#D6CFF6',
  theirs: '#FFFFFF',
  chatAccent: '#4B3FC7',
  onChatAccent: '#FFFFFF',
  read: '#3D7BF0',
  chip: 'rgba(255,255,255,0.78)',
};

export const DARK: Palette = {
  surface: '#0C0D13',
  card: '#171922',
  sunk: '#23252F',
  raised: '#3A3D4B',
  ink: '#ECEDF3',
  muted: '#8C8FA0',
  line: '#262833',
  accent: '#ECEDF3',
  onAccent: '#0C0D13',
  ok: '#3A9A62',
  no: '#C4503F',
  waiting: '#FF8A4C',
  chat: '#0E0F16',
  chatPattern: '#1C1E29',
  mine: '#352F63',
  mineMuted: '#A9A3D6',
  mineSunk: '#2A2550',
  theirs: '#1C1E29',
  chatAccent: '#8F84FF',
  onChatAccent: '#16151E',
  read: '#6AA8FF',
  chip: 'rgba(28,30,41,0.85)',
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
