import type { PendingGuide } from '@ghostaff/shared';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Group } from '@/components/connections/Group';
import { Button, ListRow } from '@/components/ui';
import { checkedWhen } from '@/lib/guide';

// «Pendientes de aprobar» in Conexiones (docs/plans/ongoing/guided-access.md, decision 2):
// the guides a member did, checked and waiting for an owner. Owners only. It is
// where an owner approves one done in a conversation they cannot see (a member's
// personal chat); the row opens the guide to read it first. Approving answers once
// the agent has gone on in the guide's conversation, so it can take a moment.

function PendingRow({ guide, decide }: { guide: PendingGuide; decide: (id: string, d: 'approve' | 'reject') => Promise<string | null> }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One decision at a time: a second tap before the first re-renders is dropped.
  const running = useRef(false);
  const run = async (d: 'approve' | 'reject') => {
    if (running.current) return;
    running.current = true;
    setBusy(d);
    setError(null);
    // On success the list has been read again and the row is gone.
    const problem = await decide(guide.id, d);
    running.current = false;
    setBusy(null);
    setError(problem);
  };
  return (
    <View testID={`pending-${guide.id}`}>
      <ListRow
        testID={`pending-${guide.id}-open`}
        title={guide.app}
        subtitle={`${guide.agentName} · hecho por ${guide.completedByName} ${checkedWhen(guide.checkedAt)}`.trim()}
        chevron
        onPress={() => router.push(`/guia/${guide.id}`)}
      />
      <View className="flex-row gap-2 px-4 pb-4">
        <Button label="Aprobar" size="small" busy={busy === 'approve'} disabled={busy !== null} onPress={() => void run('approve')} />
        <Button label="Rechazar" variant="secondary" size="small" busy={busy === 'reject'} disabled={busy !== null} onPress={() => void run('reject')} />
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" className="px-4 pb-4 text-footnote text-no">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** The section, or nothing when no guide waits. */
export function PendingGuides({
  desktop,
  items,
  failed,
  reload,
  decide,
}: {
  desktop: boolean;
  items: PendingGuide[];
  failed: boolean;
  reload: () => Promise<void>;
  decide: (id: string, d: 'approve' | 'reject') => Promise<string | null>;
}) {
  if (failed && items.length === 0) {
    return (
      <Group desktop={desktop} header="Pendientes de aprobar">
        {[
          <View key="failed" className="px-4 py-3">
            <Text className="text-footnote text-no">No hemos podido cargar lo pendiente de aprobar.</Text>
            <View className="mt-2 self-start">
              <Button label="Reintentar" variant="secondary" size="small" onPress={() => void reload()} />
            </View>
          </View>,
        ]}
      </Group>
    );
  }
  if (items.length === 0) return null;
  return (
    <Group desktop={desktop} header="Pendientes de aprobar" footer="Lo hizo alguien del equipo. Al aprobarlo, el agente tiene ese acceso y sigue con lo que le pidieron.">
      {items.map((g) => (
        <PendingRow key={g.id} guide={g} decide={decide} />
      ))}
    </Group>
  );
}
