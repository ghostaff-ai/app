// The app's colours and faces, in one place for Tailwind classes and for the
// few props that take a raw value (headers, placeholders, the 3D stage).
// «A calm desk» (docs/plans/ongoing/app-design.md): ink and cool greys, the
// ghost is the only colour; orange only for what waits for you, green only for
// earned autonomy, red only for errors.

export const COLORS = {
  surface: '#F3F4F6',
  card: '#FFFFFF',
  sunk: '#E9EBEF',
  ink: '#15161C',
  muted: '#686B77',
  line: '#E0E2E8',
  accent: '#15161C',
  ok: '#2F7D4F',
  no: '#A23B2C',
  waiting: '#D9622B',
} as const;

/** Headings: Rubik, loaded in app/_layout.tsx. Body text stays the phone's own face. */
export const FONTS = {
  display: 'Rubik_600SemiBold',
  displayMedium: 'Rubik_500Medium',
} as const;
