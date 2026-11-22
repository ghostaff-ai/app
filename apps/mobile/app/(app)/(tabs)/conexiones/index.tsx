import { type AiProvider, type Connection, CONNECTOR_AREAS, type ConnectorArea, summarizeUsage } from '@ghostaff/shared';
import { listConnectorRequests, requestConnector, setAiOrder, type ConnectorRequest } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AskForConnector } from '@/components/connections/AskForConnector';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { ArrowDown, ArrowUp, LockSimple, Icon } from '@/components/icons';
import { Chip, ListRow, ListSection, ScreenTitle, SearchField } from '@/components/ui';
import { AI_ORDER, aiAccountName, aiUsageLine, connectorSections, connectorWhat, PROVIDERS } from '@/lib/connections';
import { useAiUsage, useConnections } from '@/lib/hooks/useConnections';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { useTabScreenTop } from '@/lib/tabs';
import { usePalette } from '@/lib/theme';

// The organisation's connections: its accounts on outside services, grouped
// by area with each service's logo, and its AI accounts. A row opens the
// connection's page (conexiones/[id], conexiones/ia/[provider]?id=), where it is connected,
// checked or removed. The AI accounts are listed in the order the agents try
// them, each with its usage, and an owner moves them up and down; under them,
// a row per kind adds another (multiple-ai-accounts.md). The engine keeps every token and key in the vault; this
// screen only ever sees an account's email or a key's last 4 characters.
// It is the fourth tab on a phone; on a desktop a page of the sidebar
// (docs/plans/ideas/desktop-web.md), with each section's connections in a grid of three.

type Filter = 'all' | 'connected' | ConnectorArea;

export default function Connections() {
  const c = usePalette();
  const { active } = useActiveOrg();
  const { items, reload } = useConnections(active?.id ?? null);
  const usage = useAiUsage(active?.id ?? null);
  const aiAccounts = useMemo(() => items.filter((i) => i.kind === 'ai'), [items]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const desktop = useIsDesktop();
  const top = useTabScreenTop();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const connected = useMemo(() => new Set(items.filter((i) => i.kind === 'account').map((i) => i.provider)), [items]);
  const sections = useMemo(() => connectorSections(connected, search), [connected, search]);
  const orgId = active?.id ?? null;
  const [asked, setAsked] = useState<ConnectorRequest[]>([]);
  const loadAsked = useCallback(async () => {
    if (!orgId) return;
    // What was asked is a nicety: if it cannot be read, the screen goes on without it.
    setAsked(await listConnectorRequests(supabase, orgId).catch(() => []));
  }, [orgId]);
  useEffect(() => {
    void loadAsked();
  }, [loadAsked]);
  const ask = async (name: string) => {
    if (!orgId) return;
    await requestConnector(supabase, orgId, name);
    await loadAsked();
  };
  if (!active) return null;
  const owner = active.role === 'owner';
  const move = async (from: number, to: number) => {
    const ids = aiAccounts.map((a) => a.id);
    const [moved] = ids.splice(from, 1);
    if (!moved || !orgId) return;
    ids.splice(to, 0, moved);
    setMoveError(null);
    try {
      await setAiOrder(supabase, orgId, ids);
    } catch {
      setMoveError('No hemos podido cambiar el orden. Inténtalo de nuevo.');
    }
    await reload();
  };

  const shown = sections.filter((s) => filter === 'all' || (filter === 'connected' ? s.title === 'Conectadas' : s.title === filter));
  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'Todas' },
    ...(connected.size > 0 ? [{ value: 'connected' as const, label: 'Conectadas' }] : []),
    ...CONNECTOR_AREAS.map((a) => ({ value: a, label: a })),
  ];

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerClassName={desktop ? 'px-5 pb-16 pt-8' : 'pb-16'}
      contentContainerStyle={desktop ? { maxWidth: DESKTOP_CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' } : { paddingTop: top }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="px-5 pt-3">
        <ScreenTitle>Conexiones</ScreenTitle>
        <View className="flex-row items-start">
          <View className="mt-0.5">
            <Icon icon={LockSimple} size={16} color={c.muted} weight="regular" />
          </View>
          <Text className="ml-2 flex-1 text-footnote text-muted">
            Tus agentes trabajan con las cuentas que ya usas. Entras tú y aceptas; nunca nos das tu contraseña.
          </Text>
        </View>
        <View className="mt-4">
          <SearchField value={search} onChangeText={setSearch} placeholder="Instagram, facturas, citas…" label="Buscar una conexión" />
        </View>
      </View>

      {!search ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="radiogroup"
          accessibilityLabel="Mostrar"
          contentContainerClassName="gap-2 px-5 pt-4"
        >
          {filters.map((f) => (
            <Chip key={f.value} label={f.label} on={filter === f.value} onPress={() => setFilter(f.value)} />
          ))}
        </ScrollView>
      ) : null}

      <View className="px-5">
        {sections.length === 0 ? <AskForConnector searched={search} asked={asked} onAsk={ask} /> : null}
        {(search ? sections : shown).map((section) => (
          <Group key={section.title} desktop={desktop} header={section.title}>
            {section.connectors.map((connector) => {
              const conn = items.find((i) => i.kind === 'account' && i.provider === connector.id);
              const failing = conn?.status === 'failing';
              return (
                <ListRow
                  key={connector.id}
                  testID={`connector-${connector.id}`}
                  leading={<ConnectorLogo id={connector.id} name={connector.name} size={36} />}
                  title={connector.name}
                  subtitle={conn ? conn.hint : connectorWhat(connector)}
                  trailing={
                    failing ? (
                      <Text className="text-footnote font-medium text-no">Revisar</Text>
                    ) : conn ? (
                      <Text className="text-footnote text-muted">Conectada</Text>
                    ) : undefined
                  }
                  chevron
                  onPress={() => router.push(`/conexiones/${connector.id}`)}
                />
              );
            })}
          </Group>
        ))}
        {sections.length > 0 ? <AskForConnector searched="" asked={asked} onAsk={ask} /> : null}

        {!search && (filter === 'all' || filter === 'connected') && aiAccounts.length > 0 ? (
          <Group
            desktop={desktop}
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
                chevron
                onPress={() => router.push(`/conexiones/ia/${conn.provider}?id=${conn.id}`)}
              />
            ))}
          </Group>
        ) : null}
        {!search && filter === 'all' ? (
          <Group
            desktop={desktop}
            header={aiAccounts.length ? 'Añadir otra cuenta de IA' : 'IA'}
            footer={
              aiAccounts.length
                ? 'Puedes tener varias, incluso la misma suscripción dos veces. Cada nueva va al final.'
                : 'Tus agentes trabajan con la cuenta de IA de tu empresa, y su factura llega a tu nombre. Sin una, no pueden contestar.'
            }
          >
            {AI_ORDER.map((p: AiProvider) => (
              <ListRow
                key={p}
                testID={`add-ai-${p}`}
                leading={<ConnectorLogo id={`ai-${p}`} name={PROVIDERS[p].name} size={36} />}
                title={PROVIDERS[p].name}
                subtitle={PROVIDERS[p].short}
                chevron
                onPress={() => router.push(`/conexiones/ia/${p}`)}
              />
            ))}
          </Group>
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

/** A section of rows: one grouped list on a phone, a grid of three cards on a desktop. */
function Group({ desktop, header, footer, children }: { desktop: boolean; header: string; footer?: string; children: ReactElement[] }) {
  if (!desktop)
    return (
      <ListSection header={header} footer={footer}>
        {children}
      </ListSection>
    );
  return (
    <View className="mt-7">
      <Text accessibilityRole="header" className="mb-2 px-4 text-footnote font-medium text-muted">
        {header}
      </Text>
      <View className="-mx-1.5 flex-row flex-wrap">
        {children.map((row) => (
          <View key={row.key} style={{ width: '33.333%' }} className="p-1.5">
            <View className="overflow-hidden rounded-2xl bg-card">{row}</View>
          </View>
        ))}
      </View>
      {footer ? <Text className="mt-2 px-4 text-footnote text-muted">{footer}</Text> : null}
    </View>
  );
}
