import { acceptInvitation } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useMyInvitations } from '@/lib/hooks/useInvitations';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// Join an organisation: only one that invited your email. There is no search,
// so nobody finds an organisation that did not ask for them.

export default function Join() {
  const { session } = useAuth();
  const { enter } = useActiveOrg();
  const { items, loading, error, reload } = useMyInvitations();
  const [busy, setBusy] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const join = async (id: string) => {
    setBusy(id);
    setJoinError(null);
    try {
      const org = await acceptInvitation(supabase, id);
      await enter(org.id);
      // After the layout has re-rendered with the new organisation, so the inbox route exists.
      requestAnimationFrame(() => router.replace('/'));
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  if (loading && items.length === 0) return <Loading />;

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerClassName="px-6 pt-4 pb-16"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
    >
      {items.length === 0 ? (
        <View className="py-6">
          <Text className="text-lg font-semibold text-ink">Aún no tienes invitaciones</Text>
          <Text className="mt-2 text-base text-muted">
            Pide a alguien de tu empresa que te invite desde Ghostaff con este correo: {session?.user.email}. La invitación aparecerá aquí.
          </Text>
          <View className="mt-6">
            <Button label="Volver a mirar" tone="plain" onPress={() => void reload()} />
          </View>
        </View>
      ) : (
        items.map((i) => (
          <View key={i.id} className="mb-3 rounded-2xl border border-line bg-card p-5">
            <Text className="text-lg font-semibold text-ink">{i.orgName}</Text>
            <Text className="mt-1 text-base text-muted">Te invitó {i.invitedByName}.</Text>
            <View className="mt-4">
              <Button label="Unirme" busy={busy === i.id} disabled={!!busy && busy !== i.id} onPress={() => void join(i.id)} />
            </View>
          </View>
        ))
      )}
      <ErrorText>{error ?? joinError}</ErrorText>
    </ScrollView>
  );
}
