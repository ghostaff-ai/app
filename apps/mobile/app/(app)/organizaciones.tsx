import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Buildings, Check, Icon, Plus, UsersThree } from '@/components/icons';
import { Badge, ListRow, ListSection, RowIcon } from '@/components/ui';
import { useWaitingCounts } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// The switcher, a sheet opened from the organisation's name in Empresa
// (three-tabs.md, decision 11) and the desktop sidebar: each organisation with
// how many decisions wait in it, then other ways in. What belongs to the one
// you're in, and signing out, are in Empresa.

// iOS presents a screen from a sheet only once the sheet is gone, so a link
// here closes the sheet first and then opens where it points.
function go(path: '/crear-empresa' | '/unirme') {
  router.back();
  router.push(path);
}

export default function Organizations() {
  const { organizations, active, choose } = useActiveOrg();
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

      <ListSection>
        <ListRow leading={<RowIcon icon={Plus} />} title="Crear otra empresa" chevron onPress={() => go('/crear-empresa')} />
        <ListRow leading={<RowIcon icon={UsersThree} />} title="Unirme a otra empresa" chevron onPress={() => go('/unirme')} />
      </ListSection>
    </ScrollView>
  );
}
