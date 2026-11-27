import { type LinkPreview, linkPreview } from '@ghostaff/shared/services';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import { useEngine } from '@/lib/hooks/useConnections';

// A link's preview in its bubble, as in WhatsApp (docs/plans/ready/
// chat-like-whatsapp.md, phase 4): its image, title, a line and the site, read
// by the engine from the page; nothing when the page can't be read.

const seen = new Map<string, LinkPreview | null>();

export function LinkCard({ url, mine }: { url: string; mine: boolean }) {
  const engine = useEngine();
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(seen.get(url));
  useEffect(() => {
    if (!engine || seen.has(url)) return;
    let alive = true;
    void linkPreview(engine, url)
      .catch(() => null)
      .then((p) => {
        seen.set(url, p);
        if (alive) setPreview(p);
      });
    return () => {
      alive = false;
    };
  }, [engine, url]);
  if (!preview || (!preview.title && !preview.description)) return null;
  const open = () => (Platform.OS === 'web' ? window.open(url, '_blank', 'noopener') : void WebBrowser.openBrowserAsync(url));
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${preview.title ?? preview.site}, ${preview.site}`}
      onPress={open}
      className="mb-1 overflow-hidden rounded-lg"
      style={{ backgroundColor: mine ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.05)', maxWidth: 280 }}
    >
      {preview.image ? <Image source={{ uri: preview.image }} style={{ width: '100%', height: 140 }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      <View className="px-2.5 py-2">
        {preview.title ? (
          <Text className={`text-footnote font-semibold ${mine ? 'text-on-accent' : 'text-ink'}`} numberOfLines={2}>
            {preview.title}
          </Text>
        ) : null}
        {preview.description ? (
          <Text className={`text-caption ${mine ? 'text-on-accent' : 'text-muted'} opacity-80`} numberOfLines={2}>
            {preview.description}
          </Text>
        ) : null}
        <Text className={`mt-0.5 text-caption ${mine ? 'text-on-accent' : 'text-muted'} opacity-70`} numberOfLines={1}>
          {preview.site}
        </Text>
      </View>
    </Pressable>
  );
}
