import { type AiProvider, type Connection, summarizeUsage, VERTEX_EU_REGIONS } from '@ghostaff/shared';
import {
  type ClaudeSignIn,
  connectAi,
  connectClaudeSubscription,
  disconnectAi,
  getCloudAccount,
  renameAiConnection,
  setAiOrder,
} from '@ghostaff/shared/services';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import { LimitBars, UsageDetail } from '@/components/connections/AiUsage';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { Icon, WarningCircle } from '@/components/icons';
import { Button, Chips, ErrorText, Field, ListRow, ListSection, Notice } from '@/components/ui';
import {
  AI_ORDER,
  aiAccountAhead,
  aiAccountName,
  aiOrderWithFirst,
  claudeSignInMessage,
  connectErrorMessage,
  failingText,
  PROVIDERS,
  REGION_NAMES,
} from '@/lib/connections';
import { shortDate } from '@/lib/format';
import { success } from '@/lib/haptics';
import { useAgents } from '@/lib/hooks/useAgents';
import { useAiUsage, useConnections, useEngine } from '@/lib/hooks/useConnections';
import { supabase } from '@/lib/supabase';
import { DESKTOP_PAGE, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { usePalette } from '@/lib/theme';

// One of the organisation's AI accounts (`?id=`), or a new one of a kind (no
// id). A key is sent once to the engine, which checks it and keeps it in the
// vault; this screen never sees it again, only its last 4 characters. Vertex
// needs no key: the organisation lets its own Google Cloud account (one per
// organisation, made by the engine) into its own project. A Claude subscription is connected by signing in
// through Claude Code, which the engine runs: this screen only relays
// Anthropic's link and the code pasted back. An organisation may have several
// accounts, even two sign-ins to one subscription; each has its name, its usage
// and its place in the order (set in Conexiones). A new account goes last, as a
// spare: while it is not first, its page says which account the agents use
// before it and lets an owner put it first (Jaime, 2026-11-23).

const regionLabels = VERTEX_EU_REGIONS.map((r) => REGION_NAMES[r] ?? r);
const regionFromLabel = (label: string | null) => VERTEX_EU_REGIONS.find((r) => (REGION_NAMES[r] ?? r) === label) ?? null;
const isProvider = (p: string | undefined): p is AiProvider => !!p && (AI_ORDER as readonly string[]).includes(p);
export default function AiPage() {
  const { provider, id } = useLocalSearchParams<{ provider: string; id?: string }>();
  const { active } = useActiveOrg();
  const { items, loaded, reload } = useConnections(active?.id ?? null);
  const usage = useAiUsage(active?.id ?? null);
  const agents = useAgents(active?.id ?? null);
  const desktop = useIsDesktop();
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!active || !isProvider(provider)) return <Notice title="No encontramos esta conexión" />;
  const copy = PROVIDERS[provider];
  const connection = id ? (items.find((i) => i.kind === 'ai' && i.id === id) ?? null) : null;
  if (id && loaded && !connection) return <Notice title="Esta cuenta de IA ya no está conectada" />;
  const canEdit = active.role === 'owner';
  const sameKind = items.filter((i) => i.kind === 'ai' && i.provider === provider);
  const ahead = connection ? aiAccountAhead(items, connection.id) : null;
  // The new account's own page from now on: its name, its usage, its place.
  const done = async (made: Connection) => {
    success();
    await reload();
    router.setParams({ id: made.id });
  };

  const useFirst = async () => {
    if (!connection) return;
    setMoving(true);
    setMoveError(null);
    try {
      await setAiOrder(supabase, active.id, aiOrderWithFirst(items, connection.id));
      success();
    } catch {
      setMoveError('No hemos podido cambiar el orden. Inténtalo de nuevo.');
    } finally {
      await reload();
      setMoving(false);
    }
  };

  const remove = async () => {
    if (!engine || !connection) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectAi(engine, active.id, connection.id);
      await reload();
      if (router.canGoBack()) router.back();
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
      <Stack.Screen options={{ title: connection ? aiAccountName(connection) : copy.name }} />
      <View className="items-center pt-6">
        <ConnectorLogo id={`ai-${provider}`} name={copy.name} size={72} />
        <Text accessibilityRole="header" className="mt-4 text-center font-display text-title2 text-ink">
          {connection?.label ?? copy.title}
        </Text>
        <Text className="mt-2 text-center text-base leading-[22px] text-muted">{copy.dataNote}</Text>
      </View>

      {connection?.status === 'failing' ? <Warning text={failingText(connection.statusReason)} /> : null}
      {copy.warning && !connection ? <Warning text={copy.warning} more={copy.limit} /> : null}
      {!connection && sameKind.length > 0 ? (
        <Text className="mt-6 px-1 text-footnote text-muted">
          {provider === 'claude'
            ? 'Ya tienes una suscripción conectada. Puedes añadir otra, de otra persona o la misma: si es la misma, comparten sus límites.'
            : 'Ya tienes una conectada. Esta se añade como otra cuenta, al final del orden.'}
        </Text>
      ) : null}

      {ahead ? (
        <View className="mt-6">
          <Text testID="ai-used-before" className="px-1 text-base leading-[22px] text-ink">
            {`Tus agentes usan antes «${aiAccountName(ahead)}». Esta solo entra si las de delante fallan o llegan a su límite.`}
          </Text>
          {canEdit ? (
            <View className="mt-3">
              <Button testID="ai-use-first" label="Usar esta primero" variant="secondary" busy={moving} onPress={() => void useFirst()} />
              <ErrorText>{moveError}</ErrorText>
            </View>
          ) : null}
        </View>
      ) : null}

      {connection && canEdit ? <NameForm connection={connection} onSaved={reload} /> : null}
      {connection?.provider === 'claude' ? <LimitBars connection={connection} /> : null}

      {connection ? (
        <ListSection header="Conectada">
          <ListRow title="Lugar en el orden" value={`${items.filter((i) => i.kind === 'ai').findIndex((i) => i.id === connection.id) + 1}.º`} />
          {connection.method === 'api_key' ? <ListRow title="Clave" value={`…${connection.hint}`} /> : null}
          {connection.method === 'subscription' ? <ListRow title="Acceso" value={`…${connection.hint}`} /> : null}
          {connection.method === 'cloud_project' ? <ListRow title="Proyecto" value={connection.hint} /> : null}
          {connection.method === 'cloud_project' ? (
            <ListRow title="Región" value={REGION_NAMES[connection.settings.region ?? ''] ?? connection.settings.region ?? ''} />
          ) : null}
          <ListRow title="La conectó" value={`${connection.connectedByName}, ${shortDate(connection.updatedAt)}`} />
        </ListSection>
      ) : null}

      {connection ? (
        <UsageDetail connection={connection} usage={summarizeUsage(usage.rows, connection.id)} agents={agents.items} />
      ) : null}

      {canEdit && !connection && !id ? (
        provider === 'vertex' ? (
          <VertexForm orgId={active.id} initial={null} onDone={done} />
        ) : provider === 'claude' ? (
          <ClaudeForm orgId={active.id} onDone={done} />
        ) : (
          <KeyForm orgId={active.id} provider={provider} onDone={done} />
        )
      ) : null}

      {canEdit && connection ? (
        <ListSection footer="Para cambiar la clave o volver a entrar, añade la cuenta otra vez y quita esta.">
          <ListRow title={busy ? 'Quitando…' : 'Quitar esta cuenta'} tone="danger" onPress={busy ? undefined : () => void remove()} />
        </ListSection>
      ) : null}
      {!canEdit ? <Text className="mt-6 px-1 text-footnote text-muted">Solo quien es propietario de la empresa puede cambiarla.</Text> : null}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}

/** An owner names the account («Claude de Jaime»); empty gives back its kind's name. */
function NameForm({ connection, onSaved }: { connection: Connection; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(connection.label ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(connection.label ?? ''), [connection.label]);
  const changed = name.trim() !== (connection.label ?? '');
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await renameAiConnection(supabase, connection.id, name);
      await onSaved();
    } catch {
      setError('No hemos podido guardar el nombre. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="mt-2">
      <Field
        label="Nombre"
        hint="Para reconocerla en la lista, por ejemplo «Claude de Jaime»."
        placeholder={PROVIDERS[connection.provider as AiProvider]?.name}
        maxLength={60}
        value={name}
        onChangeText={setName}
      />
      {changed ? (
        <View className="mt-3">
          <Button label="Guardar el nombre" variant="secondary" busy={busy} onPress={() => void save()} />
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
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
  onDone: (made: Connection) => Promise<void>;
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
      const made = await connectAi(engine, { orgId, provider, apiKey: key });
      setKey('');
      await onDone(made);
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
  onDone: (made: Connection) => Promise<void>;
  onCancel?: () => void;
}) {
  const engine = useEngine();
  const [account, setAccount] = useState<string | null>(null);
  const [project, setProject] = useState(initial?.settings.project ?? '');
  const [region, setRegion] = useState<string>(initial?.settings.region ?? VERTEX_EU_REGIONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The organisation's own account, made the first time: only this organisation's agents act as it.
  useEffect(() => {
    if (!engine) return;
    getCloudAccount(engine, orgId)
      .then((a) => setAccount(a.email))
      .catch((e) => setError(connectErrorMessage(e, 'vertex')));
  }, [engine, orgId]);

  const save = async () => {
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      const made = await connectAi(engine, { orgId, provider: 'vertex', project: project.trim(), region });
      await onDone(made);
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
function ClaudeForm({ orgId, onDone, onCancel }: { orgId: string; onDone: (made: Connection) => Promise<void>; onCancel?: () => void }) {
  const engine = useEngine();
  const [phase, setPhase] = useState<'idle' | 'starting' | 'url' | 'working'>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const signIn = useRef<ClaudeSignIn | null>(null);

  useEffect(() => () => signIn.current?.cancel(), []);

  // The phone drops the socket while the person signs in at Anthropic: coming
  // back to the app picks the sign-in up again, so the code goes straight in.
  useEffect(() => {
    if (phase !== 'url') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') signIn.current?.reconnect(engine ?? undefined);
    });
    return () => sub.remove();
  }, [phase, engine]);

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
        void onDone(e.connection);
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
        <Step n={2}>Al terminar, Anthropic te enseña un código. Cópialo, vuelve aquí y pégalo debajo.</Step>
      </ListSection>
      <Text className="mt-2 px-1 text-footnote text-muted">
        Puedes salir de Ghostaff para entrar en Anthropic: el inicio de sesión te espera aquí unos minutos.
      </Text>
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
        <Button label="Conectar" disabled={code.trim().length < 10} busy={phase === 'working'} onPress={() => signIn.current?.sendCode(code, engine ?? undefined)} />
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
