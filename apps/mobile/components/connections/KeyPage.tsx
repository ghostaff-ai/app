import { type KeyRow, keyRows, type OrgSecret, secretLabelFromName } from '@ghostaff/shared';
import { decideOrgSecret, removeOrgSecret, replaceOrgSecret, storeOrgSecret } from '@ghostaff/shared/services';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { KeyLogo } from '@/components/connections/ConnectorLogo';
import { Icon, WarningCircle } from '@/components/icons';
import { Button, ErrorText, Field, ListRow, ListSection, Notice } from '@/components/ui';
import { shortDate } from '@/lib/format';
import { success } from '@/lib/haptics';
import { useAgents } from '@/lib/hooks/useAgents';
import { useEngine } from '@/lib/hooks/useConnections';
import { useOrgSecrets } from '@/lib/hooks/useOrgSecrets';
import { keyErrorMessage, namesList } from '@/lib/keys';
import { DESKTOP_PAGE, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { usePalette } from '@/lib/theme';

// One of the organisation's keys or passwords (docs/plans/ongoing/secrets-from-the-app.md), opened from
// Conexiones › Claves: `?name=` names it; without one, a new key. The value is typed once into a secure
// field and goes to the engine, which keeps it in the vault: this screen never sees it again. A key's page
// says which agents get it, who stored it and when a run last used it. An owner replaces, approves a
// member's value and removes (asking first, naming the agents that lose it); a member stores or proposes a
// new value, which waits for an owner. A key an agent needs and nobody stored opens with the name the agent
// asks for, so the agent gets it on its next run.

const SECURE = { autoCapitalize: 'none', autoCorrect: false, autoComplete: 'off', secureTextEntry: true, textContentType: 'password' } as const;

export default function KeyPage() {
  const { name } = useLocalSearchParams<{ name?: string }>();
  const { active } = useActiveOrg();
  const secrets = useOrgSecrets(active?.id ?? null);
  const agents = useAgents(active?.id ?? null);
  const desktop = useIsDesktop();

  if (!active) return null;
  const row: KeyRow | null = name ? (keyRows(secrets.items, agents.items).find((r) => r.name === name) ?? null) : null;
  const owner = active.role === 'owner';
  if (name && secrets.loaded && !agents.loading && !row) return <Notice title="Esta clave ya no está" body="La quitaron. Vuelve a Conexiones para ver las que hay." />;

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerClassName="px-5 pb-16"
      contentContainerStyle={desktop ? DESKTOP_PAGE : undefined}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      {row?.secret ? (
        <StoredKey orgId={active.id} secret={row.secret} users={row.agents.map((a) => a.name)} owner={owner} reload={secrets.reload} />
      ) : (
        <NewKey orgId={active.id} name={name ?? null} users={row?.agents.map((a) => a.name) ?? []} owner={owner} reload={secrets.reload} />
      )}
    </ScrollView>
  );
}

function Header({ title, maker, body }: { title: string; maker: string | null; body?: string }) {
  return (
    <View className="items-center pt-6">
      <Stack.Screen options={{ title }} />
      <KeyLogo maker={maker} name={title} size={72} />
      <Text accessibilityRole="header" className="mt-4 text-center font-display text-title2 text-ink">
        {title}
      </Text>
      {body ? <Text className="mt-2 text-center text-base leading-[22px] text-muted">{body}</Text> : null}
    </View>
  );
}

/** A key nobody stored yet: blank, or one an agent already asks for by its name. */
function NewKey({ orgId, name, users, owner, reload }: { orgId: string; name: string | null; users: string[]; owner: boolean; reload: () => Promise<void> }) {
  const engine = useEngine();
  const [label, setLabel] = useState(name ? secretLabelFromName(name) : '');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      const made = await storeOrgSecret(engine, { orgId, label: label.trim(), value, ...(name ? { name } : {}) });
      setValue('');
      success();
      await reload();
      // The key's own page from now on.
      router.setParams({ name: made.name });
    } catch (e) {
      setError(keyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header
        title={name ? label || secretLabelFromName(name) : 'Añadir clave'}
        maker={null}
        body={
          users.length
            ? `La necesita ${namesList(users)} para trabajar.`
            : 'Una clave o contraseña de un servicio sin botón para entrar: un correo por IMAP, ElevenLabs, un token de Meta…'
        }
      />
      <Field label="Nombre" hint="Para reconocerla: «Contraseña de info@tuempresa.com»." value={label} onChangeText={setLabel} maxLength={80} />
      <Field
        label="Clave o contraseña"
        hint={
          owner
            ? 'Se guarda cifrada; no volverás a verla aquí.'
            : 'Se guarda cifrada; no volverás a verla aquí. Un propietario tiene que aprobarla antes de que la use un agente.'
        }
        value={value}
        onChangeText={setValue}
        {...SECURE}
      />
      <View className="mt-5">
        <Button label="Guardar" disabled={!label.trim() || !value} busy={busy} onPress={() => void save()} />
      </View>
      <ErrorText>{error}</ErrorText>
    </>
  );
}

function StoredKey({ orgId, secret, users, owner, reload }: { orgId: string; secret: OrgSecret; users: string[]; owner: boolean; reload: () => Promise<void> }) {
  const c = usePalette();
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const live = secret.storedAt !== null;

  return (
    <>
      <Header title={secret.label} maker={secret.maker} />
      {secret.pendingAt ? <Pending orgId={orgId} secret={secret} owner={owner} reload={reload} /> : null}
      {secret.status === 'missing' && live ? (
        <View className="mt-6 flex-row items-start rounded-2xl bg-card px-4 py-3.5">
          <View className="mt-0.5">
            <Icon icon={WarningCircle} size={20} color={c.waiting} />
          </View>
          <Text className="ml-2.5 flex-1 text-base leading-[22px] text-ink">
            El último trabajo que la necesitaba no la encontró. Vuelve a guardarla con «Cambiar la clave».
          </Text>
        </View>
      ) : null}

      <ListSection>
        <ListRow title="La usan" value={users.length ? namesList(users) : 'Ningún agente'} />
        {live ? <ListRow title="La guardó" value={`${secret.storedByName}, ${shortDate(secret.storedAt!)}`} /> : null}
        {live ? <ListRow title="Último uso" value={secret.lastUsedAt ? shortDate(secret.lastUsedAt) : 'Todavía no'} /> : null}
      </ListSection>

      {replacing ? (
        <ReplaceForm orgId={orgId} secret={secret} owner={owner} reload={reload} onDone={() => setReplacing(false)} />
      ) : (
        <View className="mt-6">
          <Button label="Cambiar la clave" variant="secondary" onPress={() => setReplacing(true)} />
        </View>
      )}

      {owner ? (
        removing ? (
          <RemoveConfirm orgId={orgId} secret={secret} users={users} reload={reload} onCancel={() => setRemoving(false)} />
        ) : (
          <ListSection>
            <ListRow title="Quitar clave" tone="danger" onPress={() => setRemoving(true)} />
          </ListSection>
        )
      ) : null}
    </>
  );
}

/** A member's value waiting: an owner approves or rejects it; anyone else is told it waits. */
function Pending({ orgId, secret, owner, reload }: { orgId: string; secret: OrgSecret; owner: boolean; reload: () => Promise<void> }) {
  const engine = useEngine();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One decision at a time: a second tap before the first re-renders is dropped.
  const running = useRef(false);
  const when = shortDate(secret.pendingAt!);
  const decide = async (d: 'approve' | 'reject') => {
    if (!engine || running.current) return;
    running.current = true;
    setBusy(d);
    setError(null);
    try {
      await decideOrgSecret(engine, orgId, secret.name, d);
      if (d === 'approve') success();
      await reload();
    } catch (e) {
      setError(keyErrorMessage(e));
      await reload();
    } finally {
      running.current = false;
      setBusy(null);
    }
  };
  if (!owner) {
    return (
      <Text className="mt-6 px-1 text-base leading-[22px] text-ink">
        {`Tiene un valor nuevo de ${secret.pendingByName}, del ${when}, que espera a que un propietario lo apruebe.`}
      </Text>
    );
  }
  return (
    <View className="mt-6">
      <Text className="px-1 text-base leading-[22px] text-ink">
        {`${secret.pendingByName} guardó un valor nuevo el ${when}. ${
          secret.storedAt ? 'Tus agentes siguen con el anterior hasta que lo apruebes.' : 'Ningún agente la usa hasta que lo apruebes.'
        }`}
      </Text>
      <View className="mt-3 flex-row gap-2">
        <Button label="Aprobar" size="small" busy={busy === 'approve'} disabled={busy !== null} onPress={() => void decide('approve')} />
        <Button label="Rechazar" variant="secondary" size="small" busy={busy === 'reject'} disabled={busy !== null} onPress={() => void decide('reject')} />
      </View>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

function ReplaceForm({ orgId, secret, owner, reload, onDone }: { orgId: string; secret: OrgSecret; owner: boolean; reload: () => Promise<void>; onDone: () => void }) {
  const engine = useEngine();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      await replaceOrgSecret(engine, orgId, secret.name, value);
      setValue('');
      success();
      await reload();
      onDone();
    } catch (e) {
      setError(keyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="mt-2">
      <Field
        label="Clave o contraseña"
        hint={
          owner
            ? 'La nueva sustituye a la anterior desde el próximo trabajo de tus agentes. No volverás a verla aquí.'
            : 'Un propietario tiene que aprobarla; hasta entonces tus agentes siguen con la anterior.'
        }
        value={value}
        onChangeText={setValue}
        autoFocus
        {...SECURE}
      />
      <View className="mt-5 gap-2">
        <Button label="Guardar" disabled={!value} busy={busy} onPress={() => void save()} />
        <Button label="Cancelar" variant="plain" disabled={busy} onPress={onDone} />
      </View>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/** «Quitar clave» asks first, naming the agents that lose it at their next run. */
function RemoveConfirm({ orgId, secret, users, reload, onCancel }: { orgId: string; secret: OrgSecret; users: string[]; reload: () => Promise<void>; onCancel: () => void }) {
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      await removeOrgSecret(engine, orgId, secret.name);
      await reload();
      if (router.canGoBack()) router.back();
    } catch (e) {
      setError(keyErrorMessage(e));
      setBusy(false);
    }
  };
  const consequence =
    users.length === 0
      ? 'Ningún agente la usa. Se borra y no se puede recuperar.'
      : `${namesList(users)} ${users.length === 1 ? 'dejará' : 'dejarán'} de tenerla en su próximo trabajo.`;
  return (
    <View className="mt-7 rounded-2xl bg-card px-4 py-4" testID="key-remove-confirm">
      <Text className="text-base leading-[22px] text-ink">{consequence}</Text>
      <View className="mt-3 flex-row gap-2">
        <Button label="Quitar" variant="danger" size="small" busy={busy} onPress={() => void remove()} />
        <Button label="Cancelar" variant="secondary" size="small" disabled={busy} onPress={onCancel} />
      </View>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
