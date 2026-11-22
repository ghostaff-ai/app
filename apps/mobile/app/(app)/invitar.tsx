import type { AgentLevel } from '@ghostaff/shared';
import { inviteMember, revokeInvitation } from '@ghostaff/shared/services';
import { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { CheckCircle, EnvelopeSimple, Icon, UserPlus } from '@/components/icons';
import { Button, ErrorText, Field, LevelPicker, ListRow, ListSection, RowIcon } from '@/components/ui';
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
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pt-2 pb-16" keyboardShouldPersistTaps="handled">
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
        <ListSection
          header="Qué puede hacer con cada agente"
          footer="Con «Ver» lee sus conversaciones; con «Hablar» además le pide trabajo. Lo cambias cuando quieras en la página del agente."
        >
          {agents.items.map((a) => (
            <ListRow
              key={a.id}
              leading={<Image source={GHOSTS[a.ghost].picture} className="h-9 w-9" resizeMode="contain" accessibilityIgnoresInvertColors />}
              title={a.name}
              trailing={
                <LevelPicker
                  label={a.name}
                  value={levels[a.id] ?? a.memberDefault}
                  onChange={(l) => setLevels(({ [a.id]: _, ...rest }) => (l === a.memberDefault ? rest : { ...rest, [a.id]: l }))}
                />
              }
            />
          ))}
        </ListSection>
      ) : null}
      <View className="mt-6">
        <Button label="Invitar" icon={UserPlus} disabled={!looksLikeEmail(email)} busy={busy} onPress={() => void invite()} />
      </View>
      {sentTo ? (
        <View className="mt-4 flex-row items-start rounded-2xl bg-card px-4 py-3.5">
          <Icon icon={CheckCircle} size={20} />
          <Text className="ml-2.5 flex-1 text-base text-ink">Invitación lista. Avisa a {sentTo} de que entre en Ghostaff.</Text>
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>

      {items.length > 0 ? (
        <ListSection header="Invitaciones pendientes">
          {items.map((i) => (
            <ListRow
              key={i.id}
              leading={<RowIcon icon={EnvelopeSimple} />}
              title={i.email}
              trailing={<Button label="Quitar" size="small" variant="plain" onPress={() => void revoke(i.id)} />}
            />
          ))}
        </ListSection>
      ) : null}
    </ScrollView>
  );
}
