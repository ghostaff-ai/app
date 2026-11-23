import { createPersonalSpace } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { close, CloseButton } from '@/components/CloseButton';
import { Check, Icon, Plus, User, UsersThree } from '@/components/icons';
import { SpaceAvatar } from '@/components/SpaceAvatar';
import { Badge, ErrorText, ListRow, ListSection, RowIcon } from '@/components/ui';
import { useWaitingCounts } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// «Tus espacios», the switcher (three-tabs.md, decision 11; welcome-and-spaces.md):
// a sheet opened from the space's name on top of every tab, Empresa's and the
// desktop sidebar's. Your spaces, personal first, each with how many decisions
// wait in it, one tap to switch; then your personal space if you have none,
// and creating or joining a company. What belongs to the one you're in, and
// signing out, are in Empresa.

// iOS presents a screen from a sheet only once the sheet is gone, so a link
// here closes the sheet first and then opens where it points.
function go(path: '/crear-empresa' | '/unirme') {
  router.back();
  router.push(path);
}

export default function Spaces() {
  const { organizations, active, choose, enter } = useActiveOrg();
  const waiting = useWaitingCounts(organizations.map((o) => o.id));
  const hasPersonal = organizations.some((o) => o.kind === 'personal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const makePersonal = async () => {
    setBusy(true);
    setError(null);
    try {
      const space = await createPersonalSpace(supabase);
      await enter(space.id);
      close();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/too many/.test(msg) ? 'Ya tienes demasiados espacios.' : 'No hemos podido crear tu espacio. Prueba otra vez.');
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pt-6 pb-12">
      <View className="flex-row items-center justify-between px-1">
        <Text accessibilityRole="header" className="font-display text-title2 text-ink">
          Tus espacios
        </Text>
        <CloseButton />
      </View>

      <ListSection>
        {organizations.map((o) => {
          const here = o.id === active?.id;
          const count = waiting[o.id] ?? 0;
          return (
            <ListRow
              key={o.id}
              testID={`space-${o.id}`}
              leading={<SpaceAvatar space={o} size={32} />}
              title={o.name}
              subtitle={o.kind === 'personal' ? 'Solo tú' : `Firmas como ${o.displayName}`}
              accessibilityLabel={`${o.name}${count ? `, ${count === 1 ? '1 te espera' : `${count} te esperan`}` : ''}${here ? ', el que tienes abierto' : ''}`}
              trailing={
                <View className="flex-row items-center gap-2">
                  <Badge count={count} />
                  {here ? <Icon icon={Check} size={18} weight="bold" /> : null}
                </View>
              }
              onPress={() => {
                choose(o.id);
                close();
              }}
            />
          );
        })}
      </ListSection>

      <ListSection>
        {hasPersonal ? null : (
          <ListRow
            leading={<RowIcon icon={User} />}
            title="Crear tu espacio personal"
            subtitle={busy ? 'Creándolo…' : undefined}
            chevron
            onPress={busy ? undefined : () => void makePersonal()}
          />
        )}
        <ListRow leading={<RowIcon icon={Plus} />} title="Crear una empresa" chevron onPress={() => go('/crear-empresa')} />
        <ListRow leading={<RowIcon icon={UsersThree} />} title="Unirme a una empresa" chevron onPress={() => go('/unirme')} />
      </ListSection>
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
