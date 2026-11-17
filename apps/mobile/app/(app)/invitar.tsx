import type { AgentLevel } from '@ghostaff/shared';
import { inviteMember, revokeInvitation } from '@ghostaff/shared/services';
import { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Field, LevelPicker } from '@/components/ui';
import { useAgents } from '@/lib/hooks/useAgents';
import { usePendingInvitations } from '@/lib/hooks/useInvitations';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { GHOSTS } from '@/lib/team';

// An owner invites someone by email, choosing what they may do with each agent
// (team-chat.md, decision 6): each starts at the agent's usual level (Hablar
// for Secretaría, Ver for the rest) and only the changed ones are sent. The
// person sees the invitation when they sign in to Ghostaff with that email; we
// send no mail of our own yet.

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function Invite() {
  const { active } = useActiveOrg();
  const { items, reload } = usePendingInvitations(active?.id ?? null);
  const agents = useAgents(active?.id ?? null);
  // Only the levels the owner changed from each agent's usual one.
  const [levels, setLevels] = useState<Record<string, AgentLevel>>({});
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!active) return null;

  const invite = async () => {
    setBusy(true);
    setError(null);
    try {
      await inviteMember(supabase, active.id, email, 'member', levels);
      setSentTo(email.trim().toLowerCase());
      setEmail('');
      setLevels({});
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
      {agents.items.length > 0 ? (
        <View className="mt-6">
          <Text className="text-sm font-semibold text-ink">Qué puede hacer con cada agente</Text>
          <Text className="mt-1 text-sm text-muted">Con «Ver» lee sus conversaciones; con «Hablar» además le pide trabajo. Lo cambias cuando quieras en la página del agente.</Text>
          <View className="mt-2 overflow-hidden rounded-2xl border border-line bg-card">
            {agents.items.map((a, i) => (
              <View key={a.id} className={`flex-row items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
                <Image source={GHOSTS[a.ghost].picture} className="h-8 w-8" resizeMode="contain" accessibilityIgnoresInvertColors />
                <Text className="flex-1 text-base text-ink" numberOfLines={1}>{a.name}</Text>
                <LevelPicker
                  label={a.name}
                  value={levels[a.id] ?? a.memberDefault}
                  onChange={(l) =>
                    setLevels(({ [a.id]: _, ...rest }) => (l === a.memberDefault ? rest : { ...rest, [a.id]: l }))
                  }
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}
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
