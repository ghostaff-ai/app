import { type AiProvider, type Connection, VERTEX_EU_REGIONS } from '@ghostaff/shared';
import { connectAi, disconnectAi, getEngineIdentity } from '@ghostaff/shared/services';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Chips, ErrorText, Field } from '@/components/ui';
import { connectErrorMessage, PROVIDERS, REGION_NAMES } from '@/lib/connections';
import { shortDate } from '@/lib/format';
import { useConnections, useEngine } from '@/lib/hooks/useConnections';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// The organisation's connections to outside accounts. Today: its own AI
// account. A key is sent once to the engine, which checks it and keeps it in
// the vault; this screen never sees it again, only its last 4 characters.

const ORDER: AiProvider[] = ['vertex', 'anthropic', 'openai'];
const regionLabels = VERTEX_EU_REGIONS.map((r) => REGION_NAMES[r] ?? r);
const regionFromLabel = (label: string | null) => VERTEX_EU_REGIONS.find((r) => (REGION_NAMES[r] ?? r) === label) ?? null;

export default function Connections() {
  const { active } = useActiveOrg();
  const { items, reload } = useConnections(active?.id ?? null);
  if (!active) return null;
  const isOwner = active.role === 'owner';

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pt-2 pb-16" keyboardShouldPersistTaps="handled">
      <Text className="text-lg font-semibold text-ink">IA</Text>
      <Text className="mt-1 text-sm text-muted">
        Si no conectas nada, Ghostaff pone la IA. Conecta tu propia cuenta si quieres la factura de la IA a tu nombre.
        {isOwner ? '' : ' Solo quien es propietario de la empresa puede cambiarlo.'}
      </Text>
      {ORDER.map((p) => (
        <ProviderCard
          key={p}
          orgId={active.id}
          provider={p}
          connection={items.find((c) => c.provider === p) ?? null}
          canEdit={isOwner}
          onChanged={reload}
        />
      ))}
    </ScrollView>
  );
}

function ProviderCard({
  orgId,
  provider,
  connection,
  canEdit,
  onChanged,
}: {
  orgId: string;
  provider: AiProvider;
  connection: Connection | null;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const engine = useEngine();
  const copy = PROVIDERS[provider];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectAi(engine, orgId, provider);
      await onChanged();
    } catch (e) {
      setError(connectErrorMessage(e, provider));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-4 rounded-2xl border border-line bg-card p-4">
      <Text className="text-base font-semibold text-ink">{copy.title}</Text>
      <Text className="mt-1 text-sm text-muted">{copy.dataNote}</Text>
      {connection ? (
        <Text className="mt-3 text-sm text-ok">
          {connection.method === 'api_key'
            ? `Conectada · clave terminada en ${connection.hint}`
            : `Conectado · ${connection.hint}, ${REGION_NAMES[connection.settings.region ?? ''] ?? connection.settings.region}`}
          {` · ${connection.connectedByName}, ${shortDate(connection.updatedAt)}`}
        </Text>
      ) : null}

      {canEdit && !open ? (
        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Button label={connection ? 'Cambiar' : 'Conectar'} tone="plain" onPress={() => setOpen(true)} />
          </View>
          {connection ? (
            <View className="flex-1">
              <Button label="Quitar" tone="plain" busy={busy} onPress={() => void remove()} />
            </View>
          ) : null}
        </View>
      ) : null}

      {canEdit && open ? (
        provider === 'vertex' ? (
          <VertexForm orgId={orgId} initial={connection} onDone={async () => { setOpen(false); await onChanged(); }} onCancel={() => setOpen(false)} />
        ) : (
          <KeyForm orgId={orgId} provider={provider} onDone={async () => { setOpen(false); await onChanged(); }} onCancel={() => setOpen(false)} />
        )
      ) : null}
      <ErrorText>{error}</ErrorText>
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
  onCancel: () => void;
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
    <View>
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
      <View className="mt-4 flex-row gap-3">
        <View className="flex-1">
          <Button label="Cancelar" tone="plain" onPress={onCancel} />
        </View>
        <View className="flex-1">
          <Button label="Comprobar y guardar" disabled={key.trim().length < 20} busy={busy} onPress={() => void save()} />
        </View>
      </View>
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
  onCancel: () => void;
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
      <Text className="mt-4 text-sm text-ink">En console.cloud.google.com, con tu proyecto abierto:</Text>
      <Text className="mt-2 text-sm text-ink">1. En Vertex AI, Model Garden, activa los modelos de Claude.</Text>
      <Text className="mt-1 text-sm text-ink">2. En IAM, «Conceder acceso», añade esta cuenta con el rol «Usuario de Vertex AI»:</Text>
      <Text selectable className="mt-2 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink">
        {account ?? '…'}
      </Text>
      <Text className="mt-2 text-sm text-ink">3. Escribe aquí el ID del proyecto.</Text>
      <Field
        label="ID del proyecto"
        placeholder="mi-empresa-ia"
        autoCapitalize="none"
        autoCorrect={false}
        value={project}
        onChangeText={setProject}
      />
      <Chips
        label="Región"
        options={regionLabels}
        value={REGION_NAMES[region] ?? region}
        onChange={(label) => setRegion(regionFromLabel(label) ?? region)}
      />
      <View className="mt-4 flex-row gap-3">
        <View className="flex-1">
          <Button label="Cancelar" tone="plain" onPress={onCancel} />
        </View>
        <View className="flex-1">
          <Button label="Comprobar y guardar" disabled={project.trim().length < 6} busy={busy} onPress={() => void save()} />
        </View>
      </View>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
