import { acceptInvitation } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { ArrowsClockwise, EnvelopeSimple } from '@/components/icons';
import { Button, ErrorText, Loading, EmptyState } from '@/components/ui';
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
        <EmptyState
          icon={EnvelopeSimple}
          title="Aún no tienes invitaciones"
          body={`Pide a alguien de tu empresa que te invite desde Ghostaff con este correo: ${session?.user.email ?? ''}. La invitación aparecerá aquí.`}
          action={<Button label="Volver a mirar" variant="secondary" icon={ArrowsClockwise} onPress={() => void reload()} />}
        />
      ) : (
        items.map((i) => (
          <View key={i.id} className="mb-3 rounded-2xl bg-card p-5">
            <Text className="font-display text-title3 text-ink">{i.orgName}</Text>
            <Text className="mt-1 text-base text-muted">Te invitó {i.invitedByName}.</Text>
            <View className="mt-5">
              <Button label="Unirme" busy={busy === i.id} disabled={!!busy && busy !== i.id} onPress={() => void join(i.id)} />
            </View>
          </View>
        ))
      )}
      <ErrorText>{error ?? joinError}</ErrorText>
    </ScrollView>
  );
}
