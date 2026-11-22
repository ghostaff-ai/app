import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Buildings, Check, Icon, Plus, SignOut, UserPlus, UsersThree } from '@/components/icons';
import { Badge, ListRow, ListSection, RowIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useWaitingCounts } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// A sheet over Hoy, opened from the organisation's name (app-design.md,
// decision 3): each organisation with how many decisions wait in it, then what
// belongs to the one you're in, then other ways in, then you.

// iOS presents a screen from a sheet only once the sheet is gone, so a link
// here closes the sheet first and then opens where it points.
function go(path: '/invitar' | '/crear-empresa' | '/unirme') {
  router.back();
  router.push(path);
}

export default function Organizations() {
  const { organizations, active, choose } = useActiveOrg();
  const { session, signOut } = useAuth();
  const waiting = useWaitingCounts(organizations.map((o) => o.id));

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pt-6 pb-12">
      <Text accessibilityRole="header" className="px-1 font-display text-title2 text-ink">
        Organizaciones
      </Text>

      <ListSection>
        {organizations.map((o) => {
          const here = o.id === active?.id;
          const count = waiting[o.id] ?? 0;
          return (
            <ListRow
              key={o.id}
              leading={<RowIcon icon={Buildings} />}
              title={o.name}
              subtitle={`Firmas como ${o.displayName}`}
              accessibilityLabel={`${o.name}${count ? `, ${count === 1 ? '1 te espera' : `${count} te esperan`}` : ''}${here ? ', la que tienes abierta' : ''}`}
              trailing={
                <View className="flex-row items-center gap-2">
                  <Badge count={count} />
                  {here ? <Icon icon={Check} size={18} weight="bold" /> : null}
                </View>
              }
              onPress={() => {
                choose(o.id);
                router.back();
              }}
            />
          );
        })}
      </ListSection>

      {active?.role === 'owner' ? (
        <ListSection header={active.name}>
          <ListRow leading={<RowIcon icon={UserPlus} />} title="Invitar a alguien" chevron onPress={() => go('/invitar')} />
        </ListSection>
      ) : null}

      <ListSection>
        <ListRow leading={<RowIcon icon={Plus} />} title="Crear otra empresa" chevron onPress={() => go('/crear-empresa')} />
        <ListRow leading={<RowIcon icon={UsersThree} />} title="Unirme a otra empresa" chevron onPress={() => go('/unirme')} />
      </ListSection>

      <ListSection footer={session?.user.email ? `Has entrado como ${session.user.email}` : undefined}>
        <ListRow leading={<RowIcon icon={SignOut} tone="danger" />} title="Cerrar sesión" tone="danger" onPress={() => void signOut()} />
      </ListSection>
    </ScrollView>
  );
}
