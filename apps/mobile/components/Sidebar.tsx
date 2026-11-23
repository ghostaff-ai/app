import { router, usePathname, type Href } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { spaceLook, type SpaceLook } from '@ghostaff/shared';
import { useInbox } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useProfile } from '@/lib/profile/ProfileContext';
import { usePalette } from '@/lib/theme';

// The desktop's navigation (docs/plans/ideas/desktop-web.md): it stands in for
// the phone's three tabs (three-tabs.md). The organisation's name on top opens
// the switcher, as in the space's own page (Empresa or Perfil).

type Item = { href: Href; label: string; icon: (color: string) => ReactNode; match: (path: string) => boolean };

const stroke = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ITEMS: Item[] = [
  {
    href: '/',
    label: 'Equipo',
    match: (p) => p === '/' || p.startsWith('/chat') || p.startsWith('/agente') || p.startsWith('/conversacion') || p.startsWith('/acceso') || p.startsWith('/anadir-agente'),
    icon: (c) => (
      <Svg width={18} height={18} viewBox="0 0 24 24" {...stroke} stroke={c}>
        <Circle cx={9} cy={8} r={3.5} />
        <Path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
        <Circle cx={17} cy={9} r={2.5} />
        <Path d="M17 14c2.3.2 3.9 1.9 4.5 4.5" />
      </Svg>
    ),
  },
  {
    href: '/decisiones',
    label: 'Decisiones',
    match: (p) => p.startsWith('/decisiones') || p.startsWith('/decision/'),
    icon: (c) => (
      <Svg width={18} height={18} viewBox="0 0 24 24" {...stroke} stroke={c}>
        <Circle cx={12} cy={12} r={9} />
        <Path d="M8 12.5l2.7 2.7L16 9.8" />
      </Svg>
    ),
  },
];

const SPACE_ICONS: Record<SpaceLook['icon'], (color: string) => ReactNode> = {
  building: (c) => (
    <Svg width={18} height={18} viewBox="0 0 24 24" {...stroke} stroke={c}>
      <Path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M2.5 21h19M8 8h3M8 12h3M8 16h3" />
    </Svg>
  ),
  person: (c) => (
    <Svg width={18} height={18} viewBox="0 0 24 24" {...stroke} stroke={c}>
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </Svg>
  ),
};

// The third item is the space's own page: «Perfil» or «Empresa» (spaces.ts).
const spaceItem = (look: SpaceLook): Item => ({
  href: '/empresa',
  label: look.tab,
  match: (p) => p.startsWith('/empresa') || p.startsWith('/herramientas'),
  icon: SPACE_ICONS[look.icon],
});

const initials = (name: string | null | undefined) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function Sidebar() {
  const c = usePalette();
  const path = usePathname();
  const { active } = useActiveOrg();
  const { profile } = useProfile();
  const inbox = useInbox(active?.id ?? null);
  const { reload } = inbox;
  // Answering a decision happens on another route: count again on every move.
  useEffect(() => void reload(), [path, reload]);
  const waiting = inbox.decisions.filter((d) => !d.answer).length;

  return (
    <View accessibilityRole="navigation" className="w-60 border-r border-line bg-surface px-4 py-5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${active?.name ?? ''}. Cambiar de organización`}
        onPress={() => router.push('/organizaciones')}
        className="mb-4 flex-row items-center rounded-xl border border-line bg-card px-3 py-2.5"
      >
        <View className="h-7 w-7 items-center justify-center rounded-lg bg-accent">
          <Text className="font-display text-sm text-on-accent">{(active?.name ?? '?')[0]}</Text>
        </View>
        <Text className="ml-2.5 flex-1 font-display text-base text-ink" numberOfLines={1}>
          {active?.name}
        </Text>
        <Text className="text-sm text-muted">▾</Text>
      </Pressable>

      {[...ITEMS, spaceItem(spaceLook(active?.kind))].map((item) => {
        const on = item.match(path);
        const badge = item.label === 'Decisiones' && waiting > 0 ? waiting : 0;
        return (
          <Pressable
            key={item.label}
            accessibilityRole="link"
            accessibilityState={{ selected: on }}
            onPress={() => router.navigate(item.href)}
            className={`mb-1 flex-row items-center rounded-xl px-3 py-2.5 ${on ? 'bg-sunk' : ''}`}
          >
            {item.icon(c.ink)}
            <Text className={`ml-2.5 flex-1 text-sm text-ink ${on ? 'font-semibold' : ''}`}>{item.label}</Text>
            {badge ? (
              <View accessibilityLabel={`${badge} te esperan`} className="min-w-5 items-center rounded-full bg-waiting px-1.5 py-0.5">
                <Text className="text-xs font-semibold text-white">{badge}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}

      <View className="flex-1" />

      {profile ? (
        <View className="mt-4 flex-row items-center px-1">
          <View className="h-7 w-7 items-center justify-center rounded-full bg-sunk">
            <Text className="text-xs font-semibold text-ink">{initials(profile.fullName)}</Text>
          </View>
          <Text className="ml-2.5 text-sm text-muted" numberOfLines={1}>
            {profile.fullName}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
