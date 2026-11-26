import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Handshake, Plus, WarningCircle } from '@/components/icons';
import { Button, EmptyState, ListRow, ListSection, Loading, Notice, RowIcon, ScreenTitle } from '@/components/ui';
import { KIND_ICONS, partyLine } from '@/lib/externalParties';
import { useExternalParties } from '@/lib/hooks/useExternalParties';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useTabScreenTop } from '@/lib/tabs';

// «Con quién trabajáis», in Empresa (external-parties.md, decision 5): the
// people, companies and services the organisation works with outside, each
// with what it does for it. Every member sees it; an owner adds and changes
// them (decision 6), and the agents propose the ones they see in mail and
// invoices as cards an owner approves.

export default function Externos() {
  const { active } = useActiveOrg();
  const top = useTabScreenTop();
  const desktop = useIsDesktop();
  const { items, loading, loaded, error, reload } = useExternalParties(active?.id ?? null);
  if (!active) return null;
  const owner = active.role === 'owner';

  if (!loaded && loading) return <Loading />;
  if (error && !loaded) {
    return <Notice icon={WarningCircle} title="No hemos podido cargar la lista" body={error} action={<Button label="Reintentar" variant="secondary" onPress={() => void reload()} />} />;
  }

  const add = () => router.push('/empresa/externos/nuevo');

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{
        paddingHorizontal: desktop ? 40 : 20,
        paddingBottom: 64,
        paddingTop: (desktop ? 40 : 12) + top,
        maxWidth: DESKTOP_CONTENT_MAX_WIDTH,
        width: '100%',
        alignSelf: 'center',
      }}
      contentInsetAdjustmentBehavior="automatic"
    >
      <ScreenTitle subtitle="Personas, empresas y servicios de fuera, y qué hace cada uno.">Con quién trabajáis</ScreenTitle>
      {items.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="Aún no hay nadie"
          body="Aquí aparecerán las personas, empresas y servicios con los que trabajáis, y qué hace cada uno. Los agentes te propondrán los que vean en correos y facturas."
          action={owner ? <Button testID="external-add-first" label="Añadir" onPress={add} /> : undefined}
        />
      ) : (
        <ListSection>
          {items.map((p) => (
            <ListRow
              key={p.id}
              testID={`external-${p.name}`}
              leading={<RowIcon icon={KIND_ICONS[p.kind]} />}
              title={p.name}
              subtitle={partyLine(p)}
              chevron
              onPress={() => router.push(`/empresa/externos/${p.id}`)}
            />
          ))}
          {owner ? <ListRow testID="external-add" leading={<RowIcon icon={Plus} />} title="Añadir" onPress={add} /> : null}
        </ListSection>
      )}
      <View className="h-2" />
    </ScrollView>
  );
}
