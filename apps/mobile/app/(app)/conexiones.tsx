import { type AiProvider, type CatalogueConnector, type Connection, VERTEX_EU_REGIONS } from '@ghostaff/shared';
import {
  type ClaudeSignIn,
  connectAi,
  connectClaudeSubscription,
  disconnectAccount,
  disconnectAi,
  finishAccountConnect,
  getEngineIdentity,
  startAccountConnect,
} from '@ghostaff/shared/services';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Chips, ErrorText, Field } from '@/components/ui';
import {
  accountErrorMessage,
  accountResultMessage,
  claudeSignInMessage,
  connectErrorMessage,
  connectorSections,
  PROVIDERS,
  REGION_NAMES,
} from '@/lib/connections';
import { shortDate } from '@/lib/format';
import { useConnections, useEngine } from '@/lib/hooks/useConnections';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// The organisation's connections. Its accounts on outside services (Google…),
// connected by signing in there: the engine keeps the token in the vault and
// this screen only ever sees the account's email. And its own AI account: a key
// is sent once to the engine, which checks it and keeps it in the vault; this
// screen never sees it again, only its last 4 characters. A Claude subscription
// is connected by signing in through Claude Code, which the engine runs: this
// screen only relays Anthropic's link and the code the person pastes back.

const ORDER: AiProvider[] = ['vertex', 'claude', 'anthropic', 'openai'];
const regionLabels = VERTEX_EU_REGIONS.map((r) => REGION_NAMES[r] ?? r);
const regionFromLabel = (label: string | null) => VERTEX_EU_REGIONS.find((r) => (REGION_NAMES[r] ?? r) === label) ?? null;

export default function Connections() {
  const { active } = useActiveOrg();
  const { items, reload } = useConnections(active?.id ?? null);
  const [search, setSearch] = useState('');
  const sections = useMemo(
    () => connectorSections(new Set(items.filter((c) => c.kind === 'account').map((c) => c.provider)), search),
    [items, search],
  );
  if (!active) return null;
  const isOwner = active.role === 'owner';

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pt-2 pb-16" keyboardShouldPersistTaps="handled">
      <Text className="text-lg font-semibold text-ink">Cuentas</Text>
      <Text className="mt-1 text-sm text-muted">
        Conecta las cuentas que ya usas para que tus agentes trabajen con ellas. Entras en tu cuenta y aceptas; nunca nos das tu contraseña.
        {isOwner ? '' : ' Solo quien es propietario de la empresa puede cambiarlas.'}
      </Text>
      <Field
        label="Buscar"
        placeholder="Instagram, facturas, citas…"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {sections.length === 0 ? (
        <Text className="mt-4 text-sm text-muted">Aún no tenemos esa. Escríbenos y la añadimos.</Text>
      ) : null}
      {sections.map((section) => (
        <View key={section.title}>
          <Text className="mt-6 text-sm font-semibold uppercase text-muted">{section.title}</Text>
          {section.connectors.map((connector) => (
            <AccountCard
              key={connector.id}
              orgId={active.id}
              connector={connector}
              connection={items.find((c) => c.kind === 'account' && c.provider === connector.id) ?? null}
              canEdit={isOwner}
              onChanged={reload}
            />
          ))}
        </View>
      ))}

      <Text className="mt-8 text-lg font-semibold text-ink">IA</Text>
      <Text className="mt-1 text-sm text-muted">
        Si no conectas nada, Ghostaff pone la IA. Conecta tu propia cuenta si quieres la factura de la IA a tu nombre.
        {isOwner ? '' : ' Solo quien es propietario de la empresa puede cambiarlo.'}
      </Text>
      {ORDER.map((p) =>
        p === 'claude' ? (
          <ClaudeCard
            key={p}
            orgId={active.id}
            connection={items.find((c) => c.kind === 'ai' && c.provider === p) ?? null}
            canEdit={isOwner}
            onChanged={reload}
          />
        ) : (
          <ProviderCard
            key={p}
            orgId={active.id}
            provider={p}
            connection={items.find((c) => c.kind === 'ai' && c.provider === p) ?? null}
            canEdit={isOwner}
            onChanged={reload}
          />
        ),
      )}
    </ScrollView>
  );
}

function AccountCard({
  orgId,
  connector,
  connection,
  canEdit,
  onChanged,
}: {
  orgId: string;
  connector: CatalogueConnector;
  connection: Connection | null;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const engine = useEngine();
  const provider = connector.id;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  // The engine sends the browser back here with the provider's code, which we
  // hand back to finish the connect signed in; or with how it ended (?result=…).
  const connect = async () => {
    if (!engine) return;
    setBusy(true);
    setNote(null);
    try {
      const returnTo = Linking.createURL('conexiones');
      const { url } = await startAccountConnect(engine, { orgId, provider, returnTo });
      const res = await WebBrowser.openAuthSessionAsync(url, returnTo);
      if (res.type === 'success') {
        const q = Linking.parse(res.url).queryParams ?? {};
        const result =
          typeof q.state === 'string' && typeof q.code === 'string'
            ? await finishAccountConnect(engine, { provider, state: q.state, code: q.code })
            : q.result;
        setNote(accountResultMessage(typeof result === 'string' ? result : null));
      }
      await onChanged();
    } catch (e) {
      setNote({ text: accountErrorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!engine) return;
    setBusy(true);
    setNote(null);
    try {
      await disconnectAccount(engine, orgId, provider);
      await onChanged();
    } catch (e) {
      setNote({ text: accountErrorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const failing = connection?.status === 'failing';
  return (
    <View className="mt-4 rounded-2xl border border-line bg-card p-4">
      <Text className="text-base font-semibold text-ink">{connector.title}</Text>
      <Text className="mt-1 text-sm text-muted">{connector.reach}</Text>
      {connector.before && !connection ? <Text className="mt-1 text-sm text-muted">Antes: {connector.before}</Text> : null}
      {connection ? (
        <Text className={`mt-3 text-sm ${failing ? 'text-no' : 'text-ok'}`}>
          {failing ? 'Ya no nos da acceso: vuelve a conectarla' : 'Conectada'}
          {` · ${connection.hint} · ${connection.connectedByName}, ${shortDate(connection.updatedAt)}`}
        </Text>
      ) : null}
      {canEdit ? (
        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Button label={connection ? 'Volver a conectar' : 'Conectar'} tone={connection && !failing ? 'plain' : undefined} busy={busy} onPress={() => void connect()} />
          </View>
          {connection ? (
            <View className="flex-1">
              <Button label="Quitar" tone="plain" busy={busy} onPress={() => void remove()} />
            </View>
          ) : null}
        </View>
      ) : null}
      {note ? <Text className={`mt-3 text-sm ${note.ok ? 'text-ok' : 'text-no'}`}>{note.text}</Text> : null}
    </View>
  );
}

/**
 * «Claude · tu suscripción». Conectar opens the sign-in at the engine: it sends
 * Anthropic's link, the person signs in there, copies the code Anthropic shows
 * and pastes it here; the engine hands it to Claude Code and keeps the token.
 */
function ClaudeCard({
  orgId,
  connection,
  canEdit,
  onChanged,
}: {
  orgId: string;
  connection: Connection | null;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const engine = useEngine();
  const copy = PROVIDERS.claude;
  const [phase, setPhase] = useState<'idle' | 'starting' | 'url' | 'working'>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = useRef<ClaudeSignIn | null>(null);

  // Leaving the screen ends the sign-in: the engine stops Claude Code.
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
        void onChanged();
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

  const remove = async () => {
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectAi(engine, orgId, 'claude');
      await onChanged();
    } catch (e) {
      setError(connectErrorMessage(e, 'claude'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-4 rounded-2xl border border-line bg-card p-4">
      <Text className="text-base font-semibold text-ink">{copy.title}</Text>
      <Text className="mt-1 text-sm text-muted">{copy.dataNote}</Text>
      <Text className="mt-3 rounded-lg border border-line bg-sunk px-3 py-2 text-sm text-waiting">Aviso: {copy.warning}</Text>
      <Text className="mt-2 text-sm text-muted">{copy.limit}</Text>
      {connection ? (
        <Text className="mt-3 text-sm text-ok">
          {`Conectada · ${connection.connectedByName}, ${shortDate(connection.updatedAt)}`}
        </Text>
      ) : null}

      {canEdit && phase === 'idle' ? (
        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Button label={connection ? 'Volver a conectar' : 'Conectar'} tone="plain" onPress={start} />
          </View>
          {connection ? (
            <View className="flex-1">
              <Button label="Quitar" tone="plain" busy={busy} onPress={() => void remove()} />
            </View>
          ) : null}
        </View>
      ) : null}

      {canEdit && phase === 'starting' ? (
        <View className="mt-4">
          <Text className="text-sm text-muted">Preparando el inicio de sesión de Claude…</Text>
          <View className="mt-3">
            <Button label="Cancelar" tone="plain" onPress={cancel} />
          </View>
        </View>
      ) : null}

      {canEdit && (phase === 'url' || phase === 'working') ? (
        <View>
          <Text className="mt-4 text-sm text-ink">1. Abre Anthropic y entra con la cuenta de Claude de la empresa.</Text>
          <View className="mt-3">
            <Button label="Abrir Anthropic" tone="plain" onPress={() => url && void WebBrowser.openBrowserAsync(url)} />
          </View>
          <Text className="mt-4 text-sm text-ink">2. Al terminar, Anthropic te enseña un código. Cópialo y pégalo aquí.</Text>
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
          {phase === 'working' ? <Text className="mt-3 text-sm text-muted">Comprobando el código con Anthropic…</Text> : null}
          <View className="mt-4 flex-row gap-3">
            <View className="flex-1">
              <Button label="Cancelar" tone="plain" onPress={cancel} />
            </View>
            <View className="flex-1">
              <Button
                label="Conectar"
                disabled={code.trim().length < 10}
                busy={phase === 'working'}
                onPress={() => signIn.current?.sendCode(code)}
              />
            </View>
          </View>
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
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
  provider: Exclude<AiProvider, 'claude'>;
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
