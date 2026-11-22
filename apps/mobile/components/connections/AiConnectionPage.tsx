import { type AiProvider, type Connection, VERTEX_EU_REGIONS } from '@ghostaff/shared';
import { type ClaudeSignIn, connectAi, connectClaudeSubscription, disconnectAi, getEngineIdentity } from '@ghostaff/shared/services';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { Icon, WarningCircle } from '@/components/icons';
import { Button, Chips, ErrorText, Field, ListRow, ListSection, Notice } from '@/components/ui';
import { AI_ORDER, claudeSignInMessage, connectErrorMessage, PROVIDERS, REGION_NAMES } from '@/lib/connections';
import { shortDate } from '@/lib/format';
import { success } from '@/lib/haptics';
import { useConnections, useEngine } from '@/lib/hooks/useConnections';
import { DESKTOP_PAGE, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { usePalette } from '@/lib/theme';

// The organisation's own AI account, one provider. A key is sent once to the
// engine, which checks it and keeps it in the vault; this screen never sees it
// again, only its last 4 characters. Vertex needs no key: the organisation
// lets our engine's service account into its own Google Cloud project. A Claude
// subscription is connected by signing in through Claude Code, which the engine
// runs: this screen only relays Anthropic's link and the code pasted back.

const regionLabels = VERTEX_EU_REGIONS.map((r) => REGION_NAMES[r] ?? r);
const regionFromLabel = (label: string | null) => VERTEX_EU_REGIONS.find((r) => (REGION_NAMES[r] ?? r) === label) ?? null;
const isProvider = (p: string | undefined): p is AiProvider => !!p && (AI_ORDER as readonly string[]).includes(p);
const CHANGE: Record<AiProvider, string> = {
  vertex: 'Cambiar el proyecto',
  claude: 'Volver a conectar',
  anthropic: 'Cambiar la clave',
  openai: 'Cambiar la clave',
};

export default function AiPage() {
  const { provider } = useLocalSearchParams<{ provider: string }>();
  const { active } = useActiveOrg();
  const { items, reload } = useConnections(active?.id ?? null);
  const desktop = useIsDesktop();
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
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerClassName="px-5 pb-16"
      contentContainerStyle={desktop ? DESKTOP_PAGE : undefined}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen options={{ title: copy.name }} />
      <View className="items-center pt-6">
        <ConnectorLogo id={`ai-${provider}`} name={copy.name} size={72} />
        <Text accessibilityRole="header" className="mt-4 text-center font-display text-title2 text-ink">
          {copy.title}
        </Text>
        <Text className="mt-2 text-center text-base leading-[22px] text-muted">{copy.dataNote}</Text>
      </View>

      {copy.warning ? <Warning text={copy.warning} more={copy.limit} /> : null}

      {connection ? (
        <ListSection header="Conectada">
          {connection.method === 'api_key' ? <ListRow title="Clave" value={`…${connection.hint}`} /> : null}
          {connection.method === 'cloud_project' ? <ListRow title="Proyecto" value={connection.hint} /> : null}
          {connection.method === 'cloud_project' ? (
            <ListRow title="Región" value={REGION_NAMES[connection.settings.region ?? ''] ?? connection.settings.region ?? ''} />
          ) : null}
          <ListRow title="La conectó" value={`${connection.connectedByName}, ${shortDate(connection.updatedAt)}`} />
        </ListSection>
      ) : null}

      {canEdit && (editing || !connection) ? (
        provider === 'vertex' ? (
          <VertexForm orgId={active.id} initial={connection} onDone={done} onCancel={connection ? () => setEditing(false) : undefined} />
        ) : provider === 'claude' ? (
          <ClaudeForm orgId={active.id} onDone={done} onCancel={connection ? () => setEditing(false) : undefined} />
        ) : (
          <KeyForm orgId={active.id} provider={provider} onDone={done} onCancel={connection ? () => setEditing(false) : undefined} />
        )
      ) : null}

      {canEdit && connection && !editing ? (
        <>
          <View className="mt-6">
            <Button label={CHANGE[provider]} variant="secondary" onPress={() => setEditing(true)} />
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

/**
 * Signing in with the organisation's Claude plan. «Conectar» opens the sign-in
 * at the engine: it sends Anthropic's link, the person signs in there, copies
 * the code Anthropic shows and pastes it here; the engine hands it to Claude
 * Code and keeps the token. Leaving the page ends the sign-in.
 */
function ClaudeForm({ orgId, onDone, onCancel }: { orgId: string; onDone: () => Promise<void>; onCancel?: () => void }) {
  const engine = useEngine();
  const [phase, setPhase] = useState<'idle' | 'starting' | 'url' | 'working'>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const signIn = useRef<ClaudeSignIn | null>(null);

  useEffect(() => () => signIn.current?.cancel(), []);

  const reset = () => {
    signIn.current = null;
    setPhase('idle');
    setUrl(null);
    setCode('');
  };

  const start = () => {
    if (!engine) return;
    setError(null);
    setPhase('starting');
    signIn.current = connectClaudeSubscription(engine, orgId, (e) => {
      if (e.type === 'url') {
        setUrl(e.url);
        setPhase('url');
      } else if (e.type === 'working') {
        setPhase('working');
      } else if (e.type === 'done') {
        reset();
        void onDone();
      } else {
        reset();
        setError(claudeSignInMessage(e.code));
      }
    });
  };

  const cancel = () => {
    signIn.current?.cancel();
    reset();
  };

  if (phase === 'idle')
    return (
      <View className="mt-6 gap-2">
        <Button label="Conectar con Claude" onPress={start} />
        {onCancel ? <Button label="Cancelar" variant="plain" onPress={onCancel} /> : null}
        <ErrorText>{error}</ErrorText>
      </View>
    );

  if (phase === 'starting')
    return (
      <View className="mt-6 gap-2">
        <Text className="px-1 text-footnote text-muted">Preparando el inicio de sesión de Claude…</Text>
        <Button label="Cancelar" variant="plain" onPress={cancel} />
      </View>
    );

  return (
    <View>
      <ListSection header="En la web de Anthropic">
        <Step n={1}>Abre Anthropic y entra con la cuenta de Claude de la empresa.</Step>
        <Step n={2}>Al terminar, Anthropic te enseña un código. Cópialo y pégalo aquí debajo.</Step>
      </ListSection>
      <View className="mt-4">
        <Button label="Abrir Anthropic" variant="secondary" onPress={() => url && void WebBrowser.openBrowserAsync(url)} />
      </View>
      <Field
        label="Código"
        placeholder="Pega aquí el código de Anthropic"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        value={code}
        onChangeText={setCode}
        editable={phase === 'url'}
      />
      {phase === 'working' ? <Text className="mt-3 px-1 text-footnote text-muted">Comprobando el código con Anthropic…</Text> : null}
      <View className="mt-6 gap-2">
        <Button label="Conectar" disabled={code.trim().length < 10} busy={phase === 'working'} onPress={() => signIn.current?.sendCode(code)} />
        <Button label="Cancelar" variant="plain" onPress={cancel} />
      </View>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/** What someone risks with this option, said before they connect. */
function Warning({ text, more }: { text: string; more?: string }) {
  const c = usePalette();
  return (
    <View className="mt-6 rounded-2xl bg-card px-4 py-3.5">
      <View className="flex-row items-start">
        <View className="mt-0.5">
          <Icon icon={WarningCircle} size={20} color={c.waiting} />
        </View>
        <Text className="ml-2.5 flex-1 text-base leading-[22px] text-ink">{text}</Text>
      </View>
      {more ? <Text className="mt-2 text-footnote text-muted">{more}</Text> : null}
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
