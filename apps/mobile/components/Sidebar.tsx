import { Link, router, usePathname, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { spaceLook } from '@ghostaff/shared';
import { Buildings, CaretDown, Icon, LinkSimple, SealCheck, Tray, User, UsersThree, type IconComponent } from '@/components/icons';
import { SpaceAvatar } from '@/components/SpaceAvatar';
import { useInbox } from '@/lib/hooks/useDecisions';
import { desktopSection, type DesktopNav } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useProfile } from '@/lib/profile/ProfileContext';
import { usePalette } from '@/lib/theme';

// The desktop's navigation (docs/plans/ongoing/desktop-web.md, decision 4): the
// phone's three tabs (three-tabs.md), and under the space's own page
// (Empresa, or Perfil in a personal space) its Conexiones and Registro, one
// click away because a desk is where things are set up. The space's name on
// top opens the switcher, as on top of every tab on a phone.

type Item = { nav: DesktopNav; href: Href; label: string; icon: IconComponent; under?: boolean };

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
  const look = spaceLook(active?.kind);
  const current = desktopSection(path).nav;

  const items: Item[] = [
    { nav: 'equipo', href: '/', label: 'Equipo', icon: UsersThree },
    { nav: 'decisiones', href: '/decisiones', label: 'Decisiones', icon: SealCheck },
    { nav: 'empresa', href: '/empresa', label: look.tab, icon: look.icon === 'person' ? User : Buildings },
    { nav: 'conexiones', href: '/empresa/conexiones', label: 'Conexiones', icon: LinkSimple, under: true },
    { nav: 'registro', href: '/empresa/registro', label: 'Registro', icon: Tray, under: true },
  ];

  return (
    <View accessibilityRole="navigation" className="w-60 border-r border-line bg-surface px-4 py-5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${active?.name ?? ''}. Cambiar de espacio`}
        onPress={() => router.push('/organizaciones')}
        className="mb-4 min-h-11 flex-row items-center rounded-xl border border-line bg-card px-3 py-2.5 hover:bg-sunk"
      >
        {active ? <SpaceAvatar space={active} /> : null}
        <Text className="ml-2.5 flex-1 font-display text-base text-ink" numberOfLines={1}>
          {active?.name}
        </Text>
        <Icon icon={CaretDown} size={14} color={c.muted} weight="bold" />
      </Pressable>

      {items.map((item) => {
        const on = item.nav === current;
        const badge = item.nav === 'decisiones' ? waiting : 0;
        return (
          <Link key={item.nav} href={item.href} asChild>
            <Pressable
              testID={`sidebar-${item.nav}`}
              accessibilityRole="link"
              aria-current={on ? 'page' : undefined}
              className={`mb-1 min-h-11 flex-row items-center rounded-xl px-3 py-2 ${item.under ? 'ml-5' : ''} ${on ? 'bg-sunk' : 'hover:bg-sunk'}`}
            >
              <Icon icon={item.icon} size={18} color={on ? c.ink : c.muted} weight={on ? 'regular' : 'light'} />
              <Text className={`ml-2.5 flex-1 text-sm text-ink ${on ? 'font-semibold' : ''}`} numberOfLines={1}>
                {item.label}
              </Text>
              {badge > 0 ? (
                <View accessibilityLabel={`${badge} te esperan`} className="min-w-5 items-center rounded-full bg-waiting px-1.5 py-0.5">
                  <Text className="text-xs font-semibold text-white">{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          </Link>
        );
      })}

      <View className="flex-1" />

      {profile ? (
        <View className="mt-4 flex-row items-center px-1">
          <View className="h-7 w-7 items-center justify-center rounded-full bg-sunk">
            <Text className="text-xs font-semibold text-ink">{initials(profile.fullName)}</Text>
          </View>
          <Text className="ml-2.5 flex-1 text-sm text-muted" numberOfLines={1}>
            {profile.fullName}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
