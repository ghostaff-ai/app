import { type CatalogueConnector, type Connection, CONNECTORS, summarizeUsage } from '@ghostaff/shared';
import { setAiOrder } from '@ghostaff/shared/services';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { guidedRows } from '@/components/connections/GuidedAccesses';
import { PendingGuides } from '@/components/connections/PendingGuides';
import { ArrowDown, ArrowUp, LockSimple, Icon, Plus } from '@/components/icons';
import { Button, ListRow, ListSection, ScreenTitle } from '@/components/ui';
import { aiAccountName, aiUsageLine } from '@/lib/connections';
import { useAgents } from '@/lib/hooks/useAgents';
import { useAiUsage, useConnections, useEngine } from '@/lib/hooks/useConnections';
import { usePendingGuides } from '@/lib/hooks/usePendingGuides';
import { desktopSection, useIsDesktop, useReplacesBeside } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { useTabScreenTop } from '@/lib/tabs';
import { usePalette } from '@/lib/theme';

// The organisation's connections: only what it has connected (Álvaro,
// 2026-11-22), its AI accounts and then its accounts on outside services.
// «Añadir conexión» opens everything it could connect (conexiones/anadir). A
// row opens the connection's page (conexiones/[id], conexiones/ia/[provider]?id=),
// where it is checked or removed. The AI accounts are listed in the order the
// agents try them, each with its usage, and an owner moves them up and down
// (multiple-ai-accounts.md). The engine keeps every token and key in the vault;
// this screen only ever sees an account's email or a key's last 4 characters.
// «Accesos de tus agentes» lists the guided accesses (an agent's own user or key in
// an app, given through a guide) with «Quitar» for owners (guided-access.md), and
// «Pendientes de aprobar», first and for owners only, the guides members did that
// wait for an owner.
// On a phone it is Empresa's Conexiones page; on a desktop the column beside
// the open connection (docs/plans/ongoing/desktop-web.md), with its row marked.

export function ConnectionsList() {
  const c = usePalette();
  const { active } = useActiveOrg();
  const { items, reload } = useConnections(active?.id ?? null);
  const usage = useAiUsage(active?.id ?? null);
  const aiAccounts = useMemo(() => items.filter((i) => i.kind === 'ai'), [items]);
  const accounts = useMemo(
    () =>
      items
        .filter((i) => i.kind === 'account')
        .flatMap((conn) => {
          const connector = (CONNECTORS as readonly CatalogueConnector[]).find((x) => x.id === conn.provider);
          return connector ? [{ conn, connector }] : [];
        })
        .sort((a, b) => a.connector.name.localeCompare(b.connector.name, 'es')),
    [items],
  );
  const guided = useMemo(() => items.filter((i) => i.kind === 'guided'), [items]);
  const { items: agents, loading: agentsLoading } = useAgents(active?.id ?? null);
  const engine = useEngine();
  const pending = usePendingGuides(active?.id ?? null, active?.role === 'owner');
  const [moveError, setMoveError] = useState<string | null>(null);
  const desktop = useIsDesktop();
  const top = useTabScreenTop();
  const replace = useReplacesBeside();
  const path = usePathname();
  // `id` is the AI account's on its page (ia/[provider]?id=), the connector's on an account's.
  const params = useGlobalSearchParams<{ id?: string }>();
  if (!active) return null;
  const orgId = active.id;
  const owner = active.role === 'owner';
  const section = desktopSection(path);
  const open = desktop && section.list === 'connections' ? section.open : null;
  // A button, not a link like the other rows: its up and down buttons sit inside it.
  const openAi = (conn: Connection) => {
    const href = `/empresa/conexiones/ia/${conn.provider}?id=${conn.id}` as const;
    if (replace) router.replace(href);
    else router.push(href);
  };
  const move = async (from: number, to: number) => {
    const ids = aiAccounts.map((a) => a.id);
    const [moved] = ids.splice(from, 1);
    if (!moved) return;
    ids.splice(to, 0, moved);
    setMoveError(null);
    try {
      await setAiOrder(supabase, orgId, ids);
    } catch {
      setMoveError('No hemos podido cambiar el orden. Inténtalo de nuevo.');
    }
    await reload();
  };

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerClassName={desktop ? 'pb-10' : 'pb-16'}
      contentContainerStyle={{ paddingTop: top }}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className={desktop ? 'px-4' : 'px-5 pt-3'}>
        <ScreenTitle>Conexiones</ScreenTitle>
        <View className="flex-row items-start">
          <View className="mt-0.5">
            <Icon icon={LockSimple} size={16} color={c.muted} weight="regular" />
          </View>
          <Text className="ml-2 flex-1 text-footnote text-muted">
            Tus agentes trabajan con las cuentas que ya usas. Entras tú y aceptas; nunca nos das tu contraseña.
          </Text>
        </View>
        <View className={`mt-4 ${desktop ? 'self-start' : ''}`}>
          <Button testID="add-connection" label="Añadir conexión" icon={Plus} onPress={() => router.push('/empresa/conexiones/anadir')} />
        </View>
      </View>

      <View className={desktop ? 'px-4' : 'px-5'}>
        <PendingGuides
          items={pending.items}
          failed={pending.failed}
          reload={pending.reload}
          decide={async (id, d) => {
            const problem = await pending.decide(id, d);
            // An approval, here or by someone else first, writes the agent's access: «Accesos de tus agentes» shows it.
            await reload();
            return problem;
          }}
        />

        {aiAccounts.length > 0 ? (
          <ListSection
            header="IA"
            footer={
              moveError ??
              (aiAccounts.length > 1
                ? 'Tus agentes usan la primera. Si falla o llega a su límite, siguen con la siguiente.'
                : 'Tus agentes trabajan con esta cuenta, y su factura llega a tu nombre.')
            }
          >
            {aiAccounts.map((conn, i) => (
              <ListRow
                key={conn.id}
                testID={`ai-account-${i + 1}`}
                leading={<ConnectorLogo id={`ai-${conn.provider}`} name={aiAccountName(conn)} size={36} />}
                title={`${i + 1}. ${aiAccountName(conn)}`}
                subtitle={aiUsageLine(conn, summarizeUsage(usage.rows, conn.id))}
                trailing={
                  owner && aiAccounts.length > 1 ? (
                    <MoveButtons conn={conn} n={i + 1} first={i === 0} last={i === aiAccounts.length - 1} onMove={(by) => void move(i, i + by)} />
                  ) : conn.status === 'failing' ? (
                    <Text className="text-footnote font-medium text-no">Revisar</Text>
                  ) : undefined
                }
                chevron={!desktop}
                selected={desktop ? open === 'ia' && params.id === conn.id : undefined}
                onPress={() => openAi(conn)}
              />
            ))}
          </ListSection>
        ) : (
          <Text testID="no-ai" className="mt-6 px-1 text-base leading-[22px] text-muted">
            Aún no hay ninguna cuenta de IA, y sin una tus agentes no pueden contestar. Añádela con «Añadir conexión».
          </Text>
        )}

        {accounts.length > 0 ? (
          <ListSection header="Cuentas">
            {accounts.map(({ conn, connector }) => (
              <ListRow
                key={conn.id}
                testID={`connector-${connector.id}`}
                leading={<ConnectorLogo id={connector.id} name={connector.name} size={36} />}
                title={connector.name}
                subtitle={conn.hint}
                trailing={conn.status === 'failing' ? <Text className="text-footnote font-medium text-no">Revisar</Text> : undefined}
                chevron={!desktop}
                selected={desktop ? open === connector.id : undefined}
                href={`/empresa/conexiones/${connector.id}`}
                replace={replace}
              />
            ))}
          </ListSection>
        ) : null}

        {guided.length > 0 ? (
          <ListSection header="Accesos de tus agentes" footer="Cada uno es el usuario propio de un agente en una app tuya. Solo ese agente lo usa.">
            {guidedRows({ items: guided, agents, agentsLoading, owner, engine, onRemoved: () => void reload() })}
          </ListSection>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** Up and down for one AI account: its place in the order the agents try them. */
function MoveButtons({ conn, n, first, last, onMove }: { conn: Connection; n: number; first: boolean; last: boolean; onMove: (by: -1 | 1) => void }) {
  const c = usePalette();
  const name = aiAccountName(conn);
  const button = (by: -1 | 1, off: boolean) => (
    <Pressable
      testID={`ai-${by < 0 ? 'up' : 'down'}-${n}`}
      accessibilityRole="button"
      accessibilityLabel={by < 0 ? `Subir ${name}` : `Bajar ${name}`}
      accessibilityState={{ disabled: off }}
      disabled={off}
      hitSlop={6}
      onPress={() => onMove(by)}
      className="h-9 w-9 items-center justify-center rounded-full active:bg-sunk"
    >
      <Icon icon={by < 0 ? ArrowUp : ArrowDown} size={18} color={off ? c.line : c.muted} weight="regular" />
    </Pressable>
  );
  return (
    <View className="flex-row">
      {button(-1, first)}
      {button(1, last)}
    </View>
  );
}
