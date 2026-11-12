import { inviteMember, revokeInvitation } from '@ghostaff/shared/services';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Field } from '@/components/ui';
import { usePendingInvitations } from '@/lib/hooks/useInvitations';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// An owner invites someone by email. The person sees the invitation when they
// sign in to Ghostaff with that email; we send no mail of our own yet.

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function Invite() {
  const { active } = useActiveOrg();
  const { items, reload } = usePendingInvitations(active?.id ?? null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!active) return null;

  const invite = async () => {
    setBusy(true);
    setError(null);
    try {
      await inviteMember(supabase, active.id, email);
      setSentTo(email.trim().toLowerCase());
      setEmail('');
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/already a member/.test(msg) ? 'Esa persona ya está en la empresa.' : msg);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeInvitation(supabase, id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-6 pt-2 pb-16" keyboardShouldPersistTaps="handled">
      <Field
        label={`Invitar a ${active.name}`}
        hint="Al entrar en Ghostaff con este correo verá la invitación."
        placeholder="nombre@correo.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
        value={email}
        onChangeText={setEmail}
      />
      <View className="mt-4">
        <Button label="Invitar" disabled={!looksLikeEmail(email)} busy={busy} onPress={() => void invite()} />
      </View>
      {sentTo ? <Text className="mt-3 text-sm text-ok">Invitación lista. Avisa a {sentTo} de que entre en Ghostaff.</Text> : null}
      <ErrorText>{error}</ErrorText>

      {items.length > 0 ? (
        <View className="mt-10">
          <Text className="mb-3 text-sm font-semibold text-ink">Invitaciones pendientes</Text>
          {items.map((i) => (
            <View key={i.id} className="mb-2 flex-row items-center justify-between rounded-xl border border-line bg-card px-4 py-3">
              <Text className="flex-1 text-base text-ink">{i.email}</Text>
              <Button label="Quitar" tone="plain" onPress={() => void revoke(i.id)} />
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
