import type { Agent } from '@ghostaff/shared';
import { connectorFor, type AccountProvider } from '@ghostaff/shared';
import { getAgent, setAgentAccounts } from '@ghostaff/shared/services';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Switch } from 'react-native';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { Button, ErrorText, ListRow, ListSection, Loading, Notice } from '@/components/ui';
import { useConnections } from '@/lib/hooks/useConnections';
import { supabase } from '@/lib/supabase';

// Which of the organisation's connected accounts one agent may use
// (agent-settings.md). Owners only. Every account is on until an owner turns
// one off; with all on again, the agent also gets the ones connected later.
// The main agent can propose the same change in a conversation, through the
// same set_agent_accounts.

export default function Herramientas() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const { items, loading } = useConnections(agent?.orgId ?? null);
  const accounts = items.filter((c) => c.kind === 'account');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setAgent(await getAgent(supabase, id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAgent(null);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (agent === undefined || (agent && loading && accounts.length === 0)) return <Loading />;
  if (!agent) return <Notice title="No encontramos este agente" body={error ?? undefined} />;

  const uses = (provider: string) => agent.accounts === null || agent.accounts.includes(provider);

  const toggle = async (provider: string, on: boolean) => {
    const before = agent;
    const chosen = accounts.map((a) => a.provider).filter((p) => (p === provider ? on : uses(p)));
    // All on is «every account», including the ones connected later.
    const tools = chosen.length === accounts.length ? null : chosen;
    setAgent({ ...agent, accounts: tools });
    setError(null);
    try {
      await setAgentAccounts(supabase, agent.id, tools);
    } catch (e) {
      setAgent(before);
      setError(`No se ha guardado. ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-16">
      <Stack.Screen options={{ title: 'Herramientas' }} />
      {accounts.length === 0 ? (
        <Notice
          title="Aún no hay cuentas conectadas"
          body={`Conecta las cuentas de la empresa y elige aquí cuáles usa ${agent.name}.`}
          action={<Button label="Ir a Conexiones" onPress={() => router.push('/conexiones')} />}
        />
      ) : (
        <ListSection
          footer={
            agent.accounts === null
              ? `${agent.name} usa todas, también las que conectéis más adelante.`
              : `${agent.name} usa solo las marcadas. Las que conectéis más adelante no, hasta que las marques.`
          }
        >
          {accounts.map((a) => {
            const name = connectorFor(a.provider as AccountProvider).name;
            return (
              <ListRow
                key={a.id}
                leading={<ConnectorLogo id={a.provider} name={name} size={36} />}
                title={name}
                subtitle={a.hint}
                trailing={
                  <Switch
                    accessibilityLabel={`${agent.name} usa ${name}`}
                    value={uses(a.provider)}
                    onValueChange={(on) => void toggle(a.provider, on)}
                  />
                }
              />
            );
          })}
        </ListSection>
      )}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
