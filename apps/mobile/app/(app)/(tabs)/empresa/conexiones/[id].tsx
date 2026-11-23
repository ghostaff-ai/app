import { type CatalogueConnector, CONNECTORS } from '@ghostaff/shared';
import { disconnectAccount } from '@ghostaff/shared/services';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { ArrowsClockwise, CheckCircle, Icon, LockSimple, WarningCircle } from '@/components/icons';
import { Button, ListRow, ListSection, Notice } from '@/components/ui';
import { accountErrorMessage, connectorWhat } from '@/lib/connections';
import { shortDate } from '@/lib/format';
import { useAccountConnect } from '@/lib/hooks/useAccountConnect';
import { useConnections, useEngine } from '@/lib/hooks/useConnections';
import { DESKTOP_PAGE, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { usePalette } from '@/lib/theme';

// One outside account (docs/plans/ongoing/connectors.md): what the agents may
// do with it, the step to take first, and connecting it by signing in there
// (useAccountConnect, the same as an agent's card in a chat).

export default function ConnectionPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const connector = (CONNECTORS as readonly CatalogueConnector[]).find((c) => c.id === id);
  const { active } = useActiveOrg();
  const { items, reload } = useConnections(active?.id ?? null);
  const desktop = useIsDesktop();
  const engine = useEngine();
  const c = usePalette();
  const { connect: connectAccount } = useAccountConnect(active?.id ?? null);
  const [busy, setBusy] = useState<'connect' | 'remove' | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  if (!active || !connector) return <Notice title="No encontramos esta conexión" />;
  const orgId = active.id;
  const provider = connector.id;
  const connection = items.find((i) => i.kind === 'account' && i.provider === provider) ?? null;
  const failing = connection?.status === 'failing';
  const canEdit = active.role === 'owner';

  const connect = async () => {
    setBusy('connect');
    setNote(null);
    const said = await connectAccount(provider, 'conexiones');
    if (said) setNote(said);
    setBusy(null);
  };

  const remove = async () => {
    if (!engine) return;
    setBusy('remove');
    setNote(null);
    try {
      await disconnectAccount(engine, orgId, provider);
      await reload();
    } catch (e) {
      setNote({ text: accountErrorMessage(e), ok: false });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerClassName="px-5 pb-16"
      contentContainerStyle={desktop ? DESKTOP_PAGE : undefined}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen options={{ title: connector.name }} />
      <View className="items-center pt-6">
        <ConnectorLogo id={connector.id} name={connector.name} size={72} />
        <Text accessibilityRole="header" className="mt-4 text-center font-display text-title2 text-ink">
          {connector.name}
        </Text>
        <Text className="mt-1 text-center text-base text-muted">{connectorWhat(connector)}</Text>
      </View>

      {connection ? (
        <ListSection header="Cuenta">
          <ListRow
            leading={<Icon icon={failing ? WarningCircle : CheckCircle} color={failing ? c.no : c.ink} />}
            title={failing ? 'Ya no nos da acceso' : 'Conectada'}
            subtitle={failing ? 'Vuelve a conectarla para que tus agentes sigan usándola.' : connection.hint}
          />
          <ListRow title="La conectó" value={`${connection.connectedByName}, ${shortDate(connection.updatedAt)}`} />
        </ListSection>
      ) : null}

      <ListSection header="Qué podrán hacer tus agentes">
        <View className="px-4 py-3.5">
          <Text className="text-base leading-[22px] text-ink">{connector.reach}</Text>
        </View>
      </ListSection>

      {connector.before && !connection ? (
        <ListSection header="Antes de conectar">
          <View className="px-4 py-3.5">
            <Text className="text-base leading-[22px] text-ink">{connector.before}</Text>
          </View>
        </ListSection>
      ) : null}

      <View className="mt-5 flex-row items-start px-1">
        <View className="mt-0.5">
          <Icon icon={LockSimple} size={16} color={c.muted} weight="regular" />
        </View>
        <Text className="ml-2 flex-1 text-footnote text-muted">
          Entras en {connector.name} y aceptas; nunca vemos tu contraseña. El acceso se guarda cifrado y lo quitas cuando quieras.
        </Text>
      </View>

      {note ? (
        <View className="mt-5 flex-row items-start rounded-2xl bg-card px-4 py-3.5">
          <Icon icon={note.ok ? CheckCircle : WarningCircle} color={note.ok ? c.ink : c.no} size={20} />
          <Text className={`ml-2.5 flex-1 text-base ${note.ok ? 'text-ink' : 'text-no'}`}>{note.text}</Text>
        </View>
      ) : null}

      {canEdit ? (
        <View className="mt-6 gap-2">
          {connection && !failing ? (
            <Button
              label="Volver a conectar"
              variant="secondary"
              icon={ArrowsClockwise}
              busy={busy === 'connect'}
              disabled={!!busy}
              onPress={() => void connect()}
            />
          ) : (
            <Button
              testID="connect"
              label={busy === 'connect' ? 'Conectando…' : connection ? 'Volver a conectar' : `Conectar ${connector.name}`}
              busy={busy === 'connect'}
              disabled={!!busy}
              onPress={() => void connect()}
            />
          )}
        </View>
      ) : (
        <Text className="mt-6 px-1 text-footnote text-muted">Solo quien es propietario de la empresa puede conectarla o quitarla.</Text>
      )}
      {canEdit && connection ? (
        // Red text, no fill, and no second question: connecting again is one tap.
        <ListSection>
          <ListRow title={busy === 'remove' ? 'Quitando…' : 'Quitar la conexión'} tone="danger" onPress={busy ? undefined : () => void remove()} />
        </ListSection>
      ) : null}
    </ScrollView>
  );
}
