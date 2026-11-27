import type { DocumentPart } from '@ghostaff/shared';
import { fileUrl } from '@ghostaff/shared/services';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, Text, View } from 'react-native';
import { Icon, X } from '@/components/icons';
import { extensionOf, sizeLabel } from '@/lib/attach';
import { supabase } from '@/lib/supabase';
import { useColorVars, usePalette } from '@/lib/theme';

// A file in its bubble, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md,
// phase 3): a photo drawn in the bubble, full screen on a tap; any other file
// a card with its kind, name and size that opens it. Through short-lived links
// the bucket's policy only gives to people who may read the chat.

const isPhoto = (p: DocumentPart) => /^image\/(jpeg|png|webp|gif)$/.test(p.mediaType);

/** A link to the file, asked once per bubble. */
function useLink(path: string, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fileUrl(supabase, path)
      .then((u) => alive && setUrl(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path, enabled]);
  return url;
}

/** Opens a file in the browser on the web, in the phone's own viewer on a phone. */
async function open(part: DocumentPart) {
  const url = await fileUrl(supabase, part.path, part.name);
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
  else await WebBrowser.openBrowserAsync(url);
}

export function FileBubble({ part, mine }: { part: DocumentPart; mine: boolean }) {
  return isPhoto(part) ? <Photo part={part} /> : <DocumentCard part={part} mine={mine} />;
}

function Photo({ part }: { part: DocumentPart }) {
  const c = usePalette();
  const url = useLink(part.path, true);
  const [full, setFull] = useState(false);
  const themed = useColorVars();
  const ratio = part.width && part.height ? part.width / part.height : 4 / 3;
  const width = 240;
  const height = Math.max(120, Math.min(320, width / ratio));
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Foto ${part.name}, ver en grande`} onPress={() => setFull(true)} className="mb-1 overflow-hidden rounded-xl bg-sunk" style={{ width, height }}>
        {url ? <Image source={{ uri: url }} style={{ width, height }} resizeMode="cover" /> : <ActivityIndicator style={{ flex: 1 }} color={c.muted} />}
      </Pressable>
      <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
        <View style={themed} className="flex-1 bg-black">
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar la foto" onPress={() => setFull(false)} className="absolute right-4 top-12 z-10 h-11 w-11 items-center justify-center rounded-full bg-black/60">
            <Icon icon={X} size={22} color="#ffffff" />
          </Pressable>
          {url ? <Image source={{ uri: url }} style={{ flex: 1 }} resizeMode="contain" accessibilityLabel={part.name} /> : null}
        </View>
      </Modal>
    </>
  );
}

function DocumentCard({ part, mine }: { part: DocumentPart; mine: boolean }) {
  const [busy, setBusy] = useState(false);
  const c = usePalette();
  const ext = extensionOf(part.name);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${part.name}, ${sizeLabel(part.size)}`}
      onPress={() => {
        setBusy(true);
        void open(part).finally(() => setBusy(false));
      }}
      className="mb-1 flex-row items-center overflow-hidden rounded-xl px-2 py-2"
      style={{ minWidth: 220, backgroundColor: mine ? c.mineSunk : c.sunk }}
    >
      <View className="h-11 w-9 items-center justify-center rounded-md" style={{ backgroundColor: ext === 'PDF' ? '#E24B4A' : ext.startsWith('XLS') || ext === 'CSV' ? '#1D9E75' : ext.startsWith('DOC') ? '#378ADD' : '#888780' }}>
        <Text className="text-[9px] font-bold text-white">{ext.slice(0, 4)}</Text>
      </View>
      <View className="ml-2.5 flex-1">
        <Text className={`text-[15px] text-ink`} numberOfLines={2}>
          {part.name}
        </Text>
        <Text className={`text-caption ${mine ? 'text-mine-muted' : 'text-muted opacity-80'}`}>
          {ext} · {sizeLabel(part.size)}
        </Text>
      </View>
      {busy ? <ActivityIndicator color={mine ? c.mineMuted : c.muted} /> : null}
    </Pressable>
  );
}
