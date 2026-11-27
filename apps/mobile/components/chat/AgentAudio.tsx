import type { AudioPart } from '@ghostaff/shared';
import { Text, View } from 'react-native';
import { AudioClip } from '@/components/chat/AudioClip';

// An audio an agent made in its run (agent-audio.md): La Mesa's episode, a
// Productor draft. Its title over the chat's player, inside the agent's bubble
// (chat-like-whatsapp.md); a steady waveform, since it carries no levels.

export function AgentAudio({ part }: { part: AudioPart }) {
  return (
    <View className="mt-1.5" style={{ minWidth: 240, maxWidth: 420 }}>
      <Text className="mb-1 text-footnote font-semibold text-ink" numberOfLines={2}>
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
