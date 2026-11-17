import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useWaitingCounts } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// A sheet over Hoy, opened from the organisation's name (app-design.md,
// decision 3): each organisation with how many decisions wait in it.

export default function Organizations() {
  const { organizations, active, choose } = useActiveOrg();
  const { session, signOut } = useAuth();
  const waiting = useWaitingCounts(organizations.map((o) => o.id));

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="p-5 pb-12">
      <Text className="mb-4 font-display text-xl text-ink">Organizaciones</Text>
      {organizations.map((o) => (
        <Pressable
          key={o.id}
          accessibilityRole="button"
          accessibilityState={{ selected: o.id === active?.id }}
          onPress={() => {
            choose(o.id);
            router.back();
          }}
          className={`mb-3 rounded-2xl border bg-card p-4 ${o.id === active?.id ? 'border-accent' : 'border-line'}`}
        >
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 text-base font-semibold text-ink">{o.name}</Text>
            {waiting[o.id] ? (
              <View className="ml-2 rounded-full bg-waiting px-2 py-0.5">
                <Text className="text-xs font-semibold text-white">{waiting[o.id] === 1 ? '1 te espera' : `${waiting[o.id]} te esperan`}</Text>
              </View>
            ) : null}
          </View>
          <Text className="mt-1 text-sm text-muted">Firmas como {o.displayName}</Text>
        </Pressable>
      ))}
      <View className="mt-6 gap-3">
        {active ? <Button label={`Conexiones de ${active.name}`} tone="plain" onPress={() => router.push('/conexiones')} /> : null}
        {active?.role === 'owner' ? <Button label={`Invitar a ${active.name}`} tone="plain" onPress={() => router.push('/invitar')} /> : null}
        <Button label="Crear otra empresa" tone="plain" onPress={() => router.push('/crear-empresa')} />
        <Button label="Unirme a otra empresa" tone="plain" onPress={() => router.push('/unirme')} />
      </View>
      <View className="mt-10">
        <Text className="mb-3 text-center text-sm text-muted">{session?.user.email}</Text>
        <Button label="Salir" tone="plain" onPress={() => void signOut()} />
      </View>
    </ScrollView>
  );
}
