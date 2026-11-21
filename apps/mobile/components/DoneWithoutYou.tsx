import type { Agent, AgentRun } from '@ghostaff/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { firstLine, whenLabel } from '@/lib/format';

// «Hecho sin ti» (app-design.md #11): one folded line on Hoy with what the
// agents did on their own in the last day; open, one plain row per run (not a
// card: nothing here waits for you, decision 24). A row opens the agent.

export function DoneWithoutYou({ runs, agents }: { runs: AgentRun[]; agents: Agent[] }) {
  const [open, setOpen] = useState(false);
  if (runs.length === 0) return null;
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  return (
    <View className="mt-6">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Hecho sin ti: ${runs.length}. ${open ? 'Plegar' : 'Desplegar'}`}
        onPress={() => setOpen((o) => !o)}
        testID="done-without-you"
        className="flex-row items-center py-2"
      >
        <Text className="font-display text-lg text-ink">Hecho sin ti</Text>
        <Text className="ml-2 text-base text-muted">{runs.length}</Text>
        <Text className="ml-auto text-base text-muted">{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open ? (
        <View className="overflow-hidden rounded-2xl border border-line bg-card">
          {runs.map((r, i) => {
            const agent = byId[r.agentId];
            return (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                onPress={() => agent && router.push(`/agente/${agent.id}`)}
                className={`px-4 py-3 ${i > 0 ? 'border-t border-line' : ''}`}
              >
                <View className="flex-row items-center">
                  <Text className="text-sm font-semibold text-ink">{agent?.name ?? 'Un agente'}</Text>
                  <Text className="ml-auto text-xs text-muted">{whenLabel(r.finishedAt ?? r.startedAt)}</Text>
                </View>
                <Text className="mt-0.5 text-sm text-muted" numberOfLines={2}>
                  {firstLine(r.summary)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
