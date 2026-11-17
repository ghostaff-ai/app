import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { talkTarget } from '@/lib/chat';
import { useAgents } from '@/lib/hooks/useAgents';
import { useMyLevels } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// The button that is always there (app-design.md #1 and #2): it opens a new
// thread with Secretaría, or with the first agent the person may talk to. For
// now speaking goes through the phone keyboard's own dictation; voice notes
// come with the engine.

export function MicButton() {
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const agents = useAgents(orgId);
  const mine = useMyLevels(orgId);
  const { reload: reloadAgents } = agents;
  const { reload: reloadLevels } = mine;
  useFocusEffect(
    useCallback(() => {
      void reloadAgents();
      void reloadLevels();
    }, [reloadAgents, reloadLevels]),
  );
  const target = talkTarget(agents.items, mine.levels);
  if (!target) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Hablar con ${target.name}`}
      hitSlop={8}
      onPress={() => router.push(`/conversacion/nueva?agent=${target.id}`)}
      className="h-11 w-11 items-center justify-center rounded-full bg-accent"
    >
      {/* A microphone: the capsule and its stand, drawn so no icon set is needed. */}
      <View className="items-center">
        <View className="h-3.5 w-2 rounded-full bg-on-accent" />
        <View className="mt-0.5 h-1.5 w-3.5 rounded-b-full border-x-2 border-b-2 border-on-accent" />
        <View className="h-1 w-0.5 bg-on-accent" />
      </View>
    </Pressable>
  );
}
