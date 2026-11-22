import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable } from 'react-native';
import { Icon, Microphone } from '@/components/icons';
import { talkTarget } from '@/lib/chat';
import { useAgents } from '@/lib/hooks/useAgents';
import { useMyLevels } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { usePalette } from '@/lib/theme';

// The button that is always there (app-design.md #1 and #2): it opens a new
// thread with Secretaría, or with the first agent the person may talk to. It
// only opens the thread: dictating is the chat's own box (Composer), which
// has its own round mic beside send.

/** Who the mic talks to (Secretaría, or the first agent the person may talk to), and how to open that thread. */
export function useTalkTarget() {
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
  return target ? { name: target.name, talk: () => router.push(`/conversacion/nueva?agent=${target.id}`) } : null;
}

/** The mic on an accent ground (the desktop sidebar's «Hablar con…»). */
export function MicGlyph({ size = 18 }: { size?: number }) {
  const c = usePalette();
  return <Icon icon={Microphone} size={size} color={c.onAccent} weight="regular" />;
}

export function MicButton() {
  const target = useTalkTarget();
  if (!target) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Hablar con ${target.name}`}
      hitSlop={8}
      onPress={target.talk}
      className="h-11 w-11 items-center justify-center rounded-full bg-card active:opacity-70"
    >
      <Icon icon={Microphone} size={22} weight="regular" />
    </Pressable>
  );
}
