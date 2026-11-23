import { type AiProvider, CONNECTOR_AREAS, type ConnectorArea } from '@ghostaff/shared';
import { listConnectorRequests, requestConnector, type ConnectorRequest } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { AskForConnector } from '@/components/connections/AskForConnector';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { Group } from '@/components/connections/Group';
import { Chip, ListRow, ScreenTitle, SearchField } from '@/components/ui';
import { AI_ORDER, connectorSections, connectorWhat, PROVIDERS } from '@/lib/connections';
import { useConnections } from '@/lib/hooks/useConnections';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// Everything an organisation can connect, opened from «Añadir conexión» on
// Conexiones (Álvaro, 2026-11-22: the tab shows only what is connected). The AI
// accounts first, since without one the agents cannot answer, then every
// outside service by area, searchable; one already connected says so. A row
// opens its page (conexiones/[id], conexiones/ia/[provider]), where it is connected.

type Filter = 'all' | 'ai' | ConnectorArea;

export default function AddConnection() {
  const { active } = useActiveOrg();
  const { items } = useConnections(active?.id ?? null);
  const desktop = useIsDesktop();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Every service in its area, connected or not.
  const sections = useMemo(() => connectorSections(new Set(), search), [search]);
  const connected = useMemo(() => new Set(items.filter((i) => i.kind === 'account').map((i) => i.provider)), [items]);
  const hasAi = items.some((i) => i.kind === 'ai');
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

  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'ai', label: 'IA' },
    ...CONNECTOR_AREAS.map((a) => ({ value: a, label: a })),
  ];
  const shown = search ? sections : sections.filter((s) => filter === 'all' || s.title === filter);

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerClassName={desktop ? 'px-5 pb-16 pt-8' : 'pb-16'}
      contentContainerStyle={desktop ? { maxWidth: DESKTOP_CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' } : undefined}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="px-5 pt-3">
        <ScreenTitle>Añadir conexión</ScreenTitle>
        <SearchField value={search} onChangeText={setSearch} placeholder="Instagram, facturas, citas…" label="Buscar una conexión" />
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
        {!search && (filter === 'all' || filter === 'ai') ? (
          <Group
            desktop={desktop}
            header="IA"
            footer={
              hasAi
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

        {sections.length === 0 ? <AskForConnector searched={search} asked={asked} onAsk={ask} /> : null}
        {filter !== 'ai' || search
          ? shown.map((section) => (
              <Group key={section.title} desktop={desktop} header={section.title}>
                {section.connectors.map((connector) => (
                  <ListRow
                    key={connector.id}
                    testID={`connector-${connector.id}`}
                    leading={<ConnectorLogo id={connector.id} name={connector.name} size={36} />}
                    title={connector.name}
                    subtitle={connectorWhat(connector)}
                    trailing={connected.has(connector.id) ? <Text className="text-footnote text-muted">Conectada</Text> : undefined}
                    chevron
                    onPress={() => router.push(`/conexiones/${connector.id}`)}
                  />
                ))}
              </Group>
            ))
          : null}
        {sections.length > 0 && filter !== 'ai' ? <AskForConnector searched="" asked={asked} onAsk={ask} /> : null}
      </View>
    </ScrollView>
  );
}
