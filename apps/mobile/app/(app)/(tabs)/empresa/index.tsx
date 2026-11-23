import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Buildings, CaretDown, Icon, LinkSimple, SignOut, Tray, User, UserPlus } from '@/components/icons';
import { ListRow, ListSection, RowIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useMembers } from '@/lib/hooks/useChat';
import { useConnections } from '@/lib/hooks/useConnections';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useTabScreenTop } from '@/lib/tabs';
import { usePalette } from '@/lib/theme';

// Empresa, the third tab (three-tabs.md, decision 11), called Perfil in a
// personal space, which is otherwise the same page (spaces.ts): the organisation
// itself. Its name on top opens the switcher; then Conexiones, first and one
// tap away; the people in it and inviting more; Registro, what it decided;
// and at the end, switching and signing out.

export default function Empresa() {
  const c = usePalette();
  const top = useTabScreenTop();
  const desktop = useIsDesktop();
  const { active, organizations } = useActiveOrg();
  const { session, signOut } = useAuth();
  const orgId = active?.id ?? null;
  const connections = useConnections(orgId);
  const { members, reload: reloadMembers } = useMembers(orgId);
  const { reload: reloadConnections } = connections;
  useFocusEffect(
    useCallback(() => {
      void reloadConnections();
      void reloadMembers();
    }, [reloadConnections, reloadMembers]),
  );
  if (!active) return null;
  const owner = active.role === 'owner';
  const count = connections.items.length;
  const others = organizations.length > 1;

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{
        paddingHorizontal: desktop ? 40 : 20,
        paddingBottom: 64,
        paddingTop: (desktop ? 40 : 12) + top,
        maxWidth: DESKTOP_CONTENT_MAX_WIDTH,
        width: '100%',
        alignSelf: 'center',
      }}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Pressable
        testID="org-name"
        accessibilityRole="button"
        accessibilityLabel={`${active.name}. Cambiar de organización`}
        onPress={() => router.push('/organizaciones')}
        hitSlop={8}
        className="min-h-11 flex-row items-center self-start active:opacity-60"
      >
        <Text accessibilityRole="header" className="shrink font-display text-title text-ink" numberOfLines={1}>
          {active.name}
        </Text>
        <View className="ml-2 mt-1">
          <Icon icon={CaretDown} size={18} color={c.muted} weight="bold" />
        </View>
      </Pressable>
      <Text className="mt-1 text-base text-muted">
        Firmas como {active.displayName}
      </Text>

      <ListSection>
        <ListRow
          testID="open-connections"
          leading={<RowIcon icon={LinkSimple} />}
          title="Conexiones"
          subtitle="Tu IA y tus cuentas"
          value={connections.loaded ? (count === 1 ? '1 conectada' : `${count} conectadas`) : undefined}
          chevron
          onPress={() => router.push('/empresa/conexiones')}
        />
      </ListSection>

      <ListSection header="Personas">
        {members.map((m) => (
          <ListRow
            key={m.userId}
            leading={<RowIcon icon={User} />}
            title={m.userId === session?.user.id ? `${m.displayName} (tú)` : m.displayName}
            value={m.role === 'owner' ? 'Propietario' : undefined}
          />
        ))}
        {owner ? <ListRow leading={<RowIcon icon={UserPlus} />} title="Invitar a alguien" chevron onPress={() => router.push('/invitar')} /> : null}
      </ListSection>

      <ListSection>
        <ListRow leading={<RowIcon icon={Tray} />} title="Registro" subtitle="Lo decidido, lo último primero" chevron onPress={() => router.push('/empresa/registro')} />
      </ListSection>

      <ListSection footer={session?.user.email ? `Has entrado como ${session.user.email}` : undefined}>
        <ListRow
          leading={<RowIcon icon={Buildings} />}
          title={others ? 'Cambiar de organización' : 'Otra empresa'}
          subtitle={others ? undefined : 'Crear una o unirte a otra'}
          chevron
          onPress={() => router.push('/organizaciones')}
        />
        <ListRow leading={<RowIcon icon={SignOut} tone="danger" />} title="Cerrar sesión" tone="danger" onPress={() => void signOut()} />
      </ListSection>
      <View className="h-2" />
    </ScrollView>
  );
}
