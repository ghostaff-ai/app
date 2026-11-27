import type { ChatFile } from '@ghostaff/shared/services';
import { fileUrl, listFiles } from '@ghostaff/shared/services';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { FileBubble } from '@/components/chat/FileBubble';
import { FolderSimple } from '@/components/icons';
import { EmptyState, ErrorText, Loading } from '@/components/ui';
import { shortTime } from '@/lib/chat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// The files of a chat, or of every chat the person may read (Empresa ›
// Archivos), as WhatsApp's «Archivos, enlaces y documentos»
// (docs/plans/ready/chat-like-whatsapp.md, phase 3, decision 2): photos in a
// grid, documents as a list, newest first. Row-level security decides what
// comes back.

const isPhoto = (f: ChatFile) => /^image\/(jpeg|png|webp|gif)$/.test(f.part.mediaType);

function Thumb({ file }: { file: ChatFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fileUrl(supabase, file.part.path)
      .then((u) => alive && setUrl(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [file.part.path]);
  return (
    <View className="m-0.5 overflow-hidden rounded-md bg-sunk" style={{ width: 104, height: 104 }}>
      {url ? <Image source={{ uri: url }} style={{ width: 104, height: 104 }} resizeMode="cover" accessibilityLabel={file.part.name} /> : null}
    </View>
  );
}

export default function Archivos() {
  const { thread } = useLocalSearchParams<{ thread?: string }>();
  const { active } = useActiveOrg();
  const [files, setFiles] = useState<ChatFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ChatFile | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    listFiles(supabase, active.id, thread)
      .then((f) => alive && setFiles(f))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [active, thread]);

  const title = thread ? (files?.[0]?.threadTitle ? `Archivos de ${files[0].threadTitle}` : 'Archivos') : 'Archivos de la empresa';
  if (!files && !error) return <Loading />;
  const photos = (files ?? []).filter(isPhoto);
  const docs = (files ?? []).filter((f) => !isPhoto(f));

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Stack.Screen options={{ title }} />
      <ErrorText>{error}</ErrorText>
      {files && files.length === 0 ? (
        <EmptyState icon={FolderSimple} title="Aún no hay archivos" body="Lo que mandéis en el chat (fotos, documentos) aparece aquí." />
      ) : null}
      {photos.length ? (
        <>
          <Text className="mb-2 text-footnote font-semibold text-muted">Fotos</Text>
          <View className="mb-5 flex-row flex-wrap">
            {photos.map((f) => (
              <Pressable key={f.part.path} accessibilityRole="imagebutton" accessibilityLabel={`${f.part.name}, de ${f.authorName}`} onPress={() => setOpen(open?.part.path === f.part.path ? null : f)}>
                <Thumb file={f} />
              </Pressable>
            ))}
          </View>
          {open ? (
            <View className="mb-5">
              <FileBubble part={open.part} mine={false} />
              <Text className="text-caption text-muted">
                {open.authorName} · {open.threadTitle} · {shortTime(open.createdAt)}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
      {docs.length ? (
        <>
          <Text className="mb-2 text-footnote font-semibold text-muted">Documentos</Text>
          {docs.map((f) => (
            <View key={f.part.path} className="mb-3">
              <FileBubble part={f.part} mine={false} />
              <Text className="text-caption text-muted">
                {f.authorName}
                {thread ? '' : ` · ${f.threadTitle}`} · {shortTime(f.createdAt)}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
