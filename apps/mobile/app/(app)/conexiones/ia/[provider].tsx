import { type AiProvider, type Connection, VERTEX_EU_REGIONS } from '@ghostaff/shared';
import { connectAi, disconnectAi, getEngineIdentity } from '@ghostaff/shared/services';
import { Stack, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { Button, Chips, ErrorText, Field, ListRow, ListSection, Notice } from '@/components/ui';
import { AI_ORDER, connectErrorMessage, PROVIDERS, REGION_NAMES } from '@/lib/connections';
import { shortDate } from '@/lib/format';
import { success } from '@/lib/haptics';
import { useConnections, useEngine } from '@/lib/hooks/useConnections';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// The organisation's own AI account, one provider. A key is sent once to the
// engine, which checks it and keeps it in the vault; this screen never sees it
// again, only its last 4 characters. Vertex needs no key: the organisation
// lets our engine's service account into its own Google Cloud project.

const regionLabels = VERTEX_EU_REGIONS.map((r) => REGION_NAMES[r] ?? r);
const regionFromLabel = (label: string | null) => VERTEX_EU_REGIONS.find((r) => (REGION_NAMES[r] ?? r) === label) ?? null;
const isProvider = (p: string | undefined): p is AiProvider => !!p && (AI_ORDER as readonly string[]).includes(p);

export default function AiPage() {
  const { provider } = useLocalSearchParams<{ provider: string }>();
  const { active } = useActiveOrg();
  const { items, reload } = useConnections(active?.id ?? null);
  const engine = useEngine();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!active || !isProvider(provider)) return <Notice title="No encontramos esta conexión" />;
  const copy = PROVIDERS[provider];
  const connection = items.find((i) => i.kind === 'ai' && i.provider === provider) ?? null;
  const canEdit = active.role === 'owner';
  const done = async () => {
    success();
    setEditing(false);
    await reload();
  };

  const remove = async () => {
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectAi(engine, active.id, provider);
      await reload();
    } catch (e) {
      setError(connectErrorMessage(e, provider));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-16" keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: copy.name }} />
      <View className="items-center pt-6">
        <ConnectorLogo id={`ai-${provider}`} name={copy.name} size={72} />
        <Text accessibilityRole="header" className="mt-4 text-center font-display text-title2 text-ink">
          {copy.title}
        </Text>
        <Text className="mt-2 text-center text-base leading-[22px] text-muted">{copy.dataNote}</Text>
      </View>

      {connection ? (
        <ListSection header="Conectada">
          {connection.method === 'api_key' ? <ListRow title="Clave" value={`…${connection.hint}`} /> : null}
          {connection.method === 'api_key' ? null : <ListRow title="Proyecto" value={connection.hint} />}
          {connection.method === 'api_key' ? null : (
            <ListRow title="Región" value={REGION_NAMES[connection.settings.region ?? ''] ?? connection.settings.region ?? ''} />
          )}
          <ListRow title="La conectó" value={`${connection.connectedByName}, ${shortDate(connection.updatedAt)}`} />
        </ListSection>
      ) : null}

      {canEdit && (editing || !connection) ? (
        provider === 'vertex' ? (
          <VertexForm orgId={active.id} initial={connection} onDone={done} onCancel={connection ? () => setEditing(false) : undefined} />
        ) : (
          <KeyForm orgId={active.id} provider={provider} onDone={done} onCancel={connection ? () => setEditing(false) : undefined} />
        )
      ) : null}

      {canEdit && connection && !editing ? (
        <>
          <View className="mt-6">
            <Button label={provider === 'vertex' ? 'Cambiar el proyecto' : 'Cambiar la clave'} variant="secondary" onPress={() => setEditing(true)} />
          </View>
          <ListSection>
            <ListRow title={busy ? 'Quitando…' : 'Quitar la conexión'} tone="danger" onPress={busy ? undefined : () => void remove()} />
          </ListSection>
        </>
      ) : null}
      {!canEdit ? <Text className="mt-6 px-1 text-footnote text-muted">Solo quien es propietario de la empresa puede cambiarla.</Text> : null}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}

function FormButtons({ ready, busy, onSave, onCancel }: { ready: boolean; busy: boolean; onSave: () => void; onCancel?: () => void }) {
  return (
    <View className="mt-6 gap-2">
      <Button label="Comprobar y guardar" disabled={!ready} busy={busy} onPress={onSave} />
      {onCancel ? <Button label="Cancelar" variant="plain" onPress={onCancel} /> : null}
    </View>
  );
}

function KeyForm({
  orgId,
  provider,
  onDone,
  onCancel,
}: {
  orgId: string;
  provider: 'anthropic' | 'openai';
  onDone: () => Promise<void>;
  onCancel?: () => void;
}) {
  const engine = useEngine();
  const copy = PROVIDERS[provider];
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      await connectAi(engine, { orgId, provider, apiKey: key });
      setKey('');
      await onDone();
    } catch (e) {
      setError(connectErrorMessage(e, provider));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-2">
      <Field
        label="Clave"
        hint={`${copy.keyHelp} La comprobamos y la guardamos cifrada; no volverás a verla aquí.`}
        placeholder={copy.keyPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        secureTextEntry
        value={key}
        onChangeText={setKey}
      />
      <FormButtons ready={key.trim().length >= 20} busy={busy} onSave={() => void save()} onCancel={onCancel} />
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

function VertexForm({
  orgId,
  initial,
  onDone,
  onCancel,
}: {
  orgId: string;
  initial: Connection | null;
  onDone: () => Promise<void>;
  onCancel?: () => void;
}) {
  const engine = useEngine();
  const [account, setAccount] = useState<string | null>(null);
  const [project, setProject] = useState(initial?.settings.project ?? '');
  const [region, setRegion] = useState<string>(initial?.settings.region ?? VERTEX_EU_REGIONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!engine) return;
    getEngineIdentity(engine)
      .then((i) => setAccount(i.serviceAccount || null))
      .catch((e) => setError(connectErrorMessage(e, 'vertex')));
  }, [engine]);

  const save = async () => {
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      await connectAi(engine, { orgId, provider: 'vertex', project: project.trim(), region });
      await onDone();
    } catch (e) {
      setError(connectErrorMessage(e, 'vertex'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <ListSection header="En console.cloud.google.com, con tu proyecto abierto">
        <Step n={1}>En Vertex AI, Model Garden, activa los modelos de Claude.</Step>
        <Step n={2}>
          En IAM, «Conceder acceso», añade esta cuenta con el rol «Usuario de Vertex AI»:{'\n'}
          <Text selectable className="font-mono text-footnote text-ink">
            {account ?? '…'}
          </Text>
        </Step>
        <Step n={3}>Escribe aquí debajo el ID del proyecto.</Step>
      </ListSection>
      <Field label="ID del proyecto" placeholder="mi-empresa-ia" autoCapitalize="none" autoCorrect={false} value={project} onChangeText={setProject} />
      <Chips label="Región" options={regionLabels} value={REGION_NAMES[region] ?? region} onChange={(label) => setRegion(regionFromLabel(label) ?? region)} />
      <FormButtons ready={project.trim().length >= 6} busy={busy} onSave={() => void save()} onCancel={onCancel} />
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/** One numbered step of a set-up done somewhere else. */
function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <View className="flex-row px-4 py-3">
      <View className="mr-3 mt-0.5 h-6 w-6 items-center justify-center rounded-full bg-sunk">
        <Text className="text-caption font-semibold text-ink">{n}</Text>
      </View>
      <Text className="flex-1 text-base leading-[22px] text-ink">{children}</Text>
    </View>
  );
}
