import type { AudioPart } from '@ghostaff/shared';
import { Text, View } from 'react-native';
import { AudioClip } from '@/components/chat/AudioClip';

// An audio an agent made in its run (agent-audio.md): La Mesa's episode, a
// Productor draft. Its title over the voice notes' player, on a card.

export function AgentAudio({ part }: { part: AudioPart }) {
  return (
    <View className="mt-1.5 rounded-2xl border border-line bg-card px-3.5 py-2.5" style={{ maxWidth: 420 }}>
      <Text className="mb-1.5 text-footnote font-semibold text-ink" numberOfLines={2}>
        {part.title}
      </Text>
      <AudioClip
        path={part.path}
        durationMs={part.durationMs}
        tone="card"
        labels={{ play: `Escuchar «${part.title}»`, pause: `Pausar «${part.title}»`, position: 'Posición en el audio' }}
      />
    </View>
  );
}
