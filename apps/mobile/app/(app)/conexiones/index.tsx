import { type AiProvider, CONNECTOR_AREAS, type ConnectorArea } from '@ghostaff/shared';
import { router } from 'expo-router';
import { type ReactElement, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { LockSimple, MagnifyingGlass, Icon } from '@/components/icons';
import { Chip, EmptyState, ListRow, ListSection, ScreenTitle, SearchField } from '@/components/ui';
import { AI_ORDER, connectorSections, connectorWhat, PROVIDERS } from '@/lib/connections';
import { useConnections } from '@/lib/hooks/useConnections';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { usePalette } from '@/lib/theme';

// The organisation's connections: its accounts on outside services, grouped
// by area with each service's logo, and its own AI account. A row opens the
// connection's page (conexiones/[id], conexiones/ia/[provider]), where it is connected,
// checked or removed. The engine keeps every token and key in the vault; this
// screen only ever sees an account's email or a key's last 4 characters.
// On a desktop it is a page of the sidebar (docs/plans/ideas/desktop-web.md):
// its own title, and each section's connections in a grid of three.

type Filter = 'all' | 'connected' | ConnectorArea;

export default function Connections() {
  const c = usePalette();
  const { active } = useActiveOrg();
  const { items } = useConnections(active?.id ?? null);
  const desktop = useIsDesktop();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const connected = useMemo(() => new Set(items.filter((i) => i.kind === 'account').map((i) => i.provider)), [items]);
  const sections = useMemo(() => connectorSections(connected, search), [connected, search]);
  if (!active) return null;

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
      contentContainerStyle={desktop ? { maxWidth: DESKTOP_CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' } : undefined}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="px-5 pt-3">
        {desktop ? <ScreenTitle>Conexiones</ScreenTitle> : null}
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
        {sections.length === 0 ? (
          <EmptyState
            icon={MagnifyingGlass}
            title={`Aún no conectamos con «${search.trim()}»`}
            body="Prueba con lo que hace (facturas, citas, reseñas) o escríbenos y la añadimos."
          />
        ) : null}
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

        {!search && (filter === 'all' || filter === 'connected') ? (
          <Group desktop={desktop} header="IA" footer="Si no conectas nada, Ghostaff pone la IA. Conecta la tuya si quieres su factura a tu nombre.">
            {AI_ORDER.filter((p) => filter === 'all' || items.some((i) => i.kind === 'ai' && i.provider === p)).map((p: AiProvider) => {
              const conn = items.find((i) => i.kind === 'ai' && i.provider === p);
              return (
                <ListRow
                  key={p}
                  leading={<ConnectorLogo id={`ai-${p}`} name={PROVIDERS[p].name} size={36} />}
                  title={PROVIDERS[p].name}
                  subtitle={PROVIDERS[p].short}
                  trailing={conn ? <Text className="text-footnote text-muted">Conectada</Text> : undefined}
                  chevron
                  onPress={() => router.push(`/conexiones/ia/${p}`)}
                />
              );
            })}
          </Group>
        ) : null}
      </View>
    </ScrollView>
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
