import { router, usePathname, type Href } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { MicGlyph, useTalkTarget } from '@/components/chat/MicButton';
import { useInbox } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useProfile } from '@/lib/profile/ProfileContext';
import { usePalette } from '@/lib/theme';

// The desktop's navigation (docs/plans/ideas/desktop-web.md): it stands in for
// the phone's three tabs and the mic, plus Conexiones, which on the phone is a
// sheet behind Organizaciones. The organisation's name on top opens the
// switcher, as on Hoy (app-design.md, decision 3).

type Item = { href: Href; label: string; icon: (color: string) => ReactNode; match: (path: string) => boolean };

const stroke = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ITEMS: Item[] = [
  {
    href: '/',
    label: 'Hoy',
    match: (p) => p === '/' || p.startsWith('/decision'),
    icon: (c) => (
      <Svg width={18} height={18} viewBox="0 0 24 24" {...stroke} stroke={c}>
        <Circle cx={12} cy={12} r={4} />
        <Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2" />
      </Svg>
    ),
  },
  {
    href: '/equipo',
    label: 'Equipo',
    match: (p) => p.startsWith('/equipo') || p.startsWith('/agente') || p.startsWith('/conversacion') || p.startsWith('/acceso'),
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
    href: '/registro',
    label: 'Registro',
    match: (p) => p.startsWith('/registro'),
    icon: (c) => (
      <Svg width={18} height={18} viewBox="0 0 24 24" {...stroke} stroke={c}>
        <Path d="M4 5h16M4 10h16M4 15h10M4 20h7" />
      </Svg>
    ),
  },
  {
    href: '/conexiones',
    label: 'Conexiones',
    match: (p) => p.startsWith('/conexiones'),
    icon: (c) => (
      <Svg width={18} height={18} viewBox="0 0 24 24" {...stroke} stroke={c}>
        <Path d="M9 7H6a4 4 0 0 0 0 8h3M15 7h3a4 4 0 0 1 0 8h-3M8 11h8" />
      </Svg>
    ),
  },
];

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
  const talk = useTalkTarget();

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

      {ITEMS.map((item) => {
        const on = item.match(path);
        const badge = item.label === 'Hoy' && waiting > 0 ? waiting : 0;
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

      {talk ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Hablar con ${talk.name}`}
          onPress={talk.talk}
          className="flex-row items-center justify-center rounded-full bg-accent px-4 py-3"
        >
          <MicGlyph />
          <Text className="ml-2.5 text-sm font-semibold text-on-accent">Hablar con {talk.name}</Text>
        </Pressable>
      ) : null}

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
