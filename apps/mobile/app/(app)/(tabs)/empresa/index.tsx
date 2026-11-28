import { MAIN_AGENT_NAME } from '@ghostaff/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Avatar } from '@/components/chat/Message';
import { Brain, Buildings, Camera, CaretDown, FolderSimple, Handshake, Icon, LinkSimple, SignOut, Trash, Tray, UserPlus } from '@/components/icons';
import { SpaceAvatar } from '@/components/SpaceAvatar';
import { ListRow, ListSection, RowIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useAvatars } from '@/lib/avatars';
import { changeMyPhoto, removeMyPhoto } from '@/lib/myPhoto';
import { useProfile } from '@/lib/profile/ProfileContext';
import { useMembers } from '@/lib/hooks/useChat';
import { useConnections, useEngine } from '@/lib/hooks/useConnections';
import { useExternalParties } from '@/lib/hooks/useExternalParties';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useTabScreenTop } from '@/lib/tabs';
import { usePalette } from '@/lib/theme';

// Empresa, the third tab (three-tabs.md, decision 11), called Perfil in a
// personal space, which is otherwise the same page (spaces.ts): the organisation
// itself. Its name on top opens the switcher; then Conexiones, first and one
// tap away; the people in it and inviting more; who it works with outside
// (external-parties.md, decision 5); its memory, what the main agent filed
// (business-brain.md); Registro, what it decided;
// and at the end, switching and signing out.

export default function Empresa() {
  const c = usePalette();
  const top = useTabScreenTop();
  const desktop = useIsDesktop();
  const { active, organizations } = useActiveOrg();
  const { session, signOut } = useAuth();
  const { profile, reload: reloadProfile } = useProfile();
  const avatars = useAvatars();
  const engine = useEngine();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const changePhoto = async (source: 'library' | 'camera') => {
    if (!engine || photoBusy) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const done = await changeMyPhoto(engine, source);
      if (done === 'denied') setPhotoError('Ghostaff no tiene permiso para usar la cámara.');
      else if (done) {
        reloadProfile();
        avatars.reload();
      }
    } catch {
      setPhotoError('No se ha podido subir la foto. Inténtalo otra vez.');
    } finally {
      setPhotoBusy(false);
    }
  };
  const removePhoto = async () => {
    if (!engine) return;
    try {
      await removeMyPhoto(engine);
      reloadProfile();
      avatars.reload();
    } catch {
      setPhotoError('No se ha podido quitar la foto.');
    }
  };
  const orgId = active?.id ?? null;
  const connections = useConnections(orgId);
  const { members, reload: reloadMembers } = useMembers(orgId);
  const externals = useExternalParties(orgId);
  const { reload: reloadConnections } = connections;
  useFocusEffect(
    useCallback(() => {
      void reloadConnections();
      void reloadMembers();
    }, [reloadConnections, reloadMembers]),
  );
  if (!active) return null;
  const owner = active.role === 'owner';
  const count = connections.items.length;
  const others = organizations.length > 1;

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
      <Pressable
        testID="org-name"
        accessibilityRole="button"
        accessibilityLabel={`${active.name}. Cambiar de espacio`}
        onPress={() => router.push('/organizaciones')}
        hitSlop={8}
        className="min-h-11 flex-row items-center self-start active:opacity-60"
      >
        <View className="mr-2.5">
          <SpaceAvatar space={active} size={34} />
        </View>
        <Text accessibilityRole="header" className="shrink font-display text-title text-ink" numberOfLines={1}>
          {active.name}
        </Text>
        <View className="ml-2 mt-1">
          <Icon icon={CaretDown} size={18} color={c.muted} weight="bold" />
        </View>
      </Pressable>
      <Text className="mt-1 text-base text-muted">
        Firmas como {active.displayName}
      </Text>

      <ListSection>
        <ListRow
          testID="open-connections"
          leading={<RowIcon icon={LinkSimple} />}
          title="Conexiones"
          subtitle="Tu IA y tus cuentas"
          value={connections.loaded ? (count === 1 ? '1 conectada' : `${count} conectadas`) : undefined}
          chevron
          onPress={() => router.push('/empresa/conexiones')}
        />
      </ListSection>

      <ListSection header="Tu foto">
        <ListRow
          testID="my-photo"
          leading={<Avatar name={profile?.fullName ?? active.displayName} id={session?.user.id ?? ''} size={40} path={profile?.avatarPath ?? null} />}
          title={profile?.avatarPath ? 'Cambiar tu foto de perfil' : 'Poner una foto de perfil'}
          subtitle={photoBusy ? 'Subiendo…' : photoError ?? 'La ven quienes trabajan contigo'}
          chevron
          onPress={() => void changePhoto('library')}
        />
        <ListRow leading={<RowIcon icon={Camera} />} title="Hacer una foto" onPress={() => void changePhoto('camera')} />
        {profile?.avatarPath ? <ListRow leading={<RowIcon icon={Trash} tone="danger" />} title="Quitar la foto" tone="danger" onPress={() => void removePhoto()} /> : null}
      </ListSection>

      <ListSection header="Personas">
        {members.map((m) => (
          <ListRow
            key={m.userId}
            leading={<Avatar name={m.displayName} id={m.userId} size={32} />}
            title={m.userId === session?.user.id ? `${m.displayName} (tú)` : m.displayName}
            value={m.role === 'owner' ? 'Propietario' : undefined}
          />
        ))}
        {/* Nobody is invited to a personal space (welcome-and-spaces.md): the database refuses it too. */}
        {owner && active.kind === 'company' ? <ListRow leading={<RowIcon icon={UserPlus} />} title="Invitar a alguien" chevron onPress={() => router.push('/invitar')} /> : null}
      </ListSection>

      <ListSection>
        <ListRow
          testID="open-externals"
          leading={<RowIcon icon={Handshake} />}
          title="Con quién trabajáis"
          subtitle="Personas, empresas y servicios de fuera"
          value={externals.loaded && externals.items.length ? String(externals.items.length) : undefined}
          chevron
          onPress={() => router.push('/empresa/externos')}
        />
      </ListSection>

      <ListSection>
        <ListRow
          testID="open-memory"
          leading={<RowIcon icon={Brain} />}
          title="Memoria de la empresa"
          subtitle={`Lo que ${MAIN_AGENT_NAME} ha guardado`}
          chevron
          onPress={() => router.push('/empresa/memoria')}
        />
        <ListRow leading={<RowIcon icon={Tray} />} title="Registro" subtitle="Lo decidido, lo último primero" chevron onPress={() => router.push('/empresa/registro')} />
        <ListRow testID="files" leading={<RowIcon icon={FolderSimple} />} title="Archivos" subtitle="Fotos y documentos de los chats" chevron onPress={() => router.push('/archivos')} />
      </ListSection>

      <ListSection footer={session?.user.email ? `Has entrado como ${session.user.email}` : undefined}>
        <ListRow
          leading={<RowIcon icon={Buildings} />}
          title={others ? 'Cambiar de espacio' : 'Otra empresa'}
          subtitle={others ? undefined : 'Crear una o unirte a otra'}
          chevron
          onPress={() => router.push('/organizaciones')}
        />
        <ListRow leading={<RowIcon icon={SignOut} tone="danger" />} title="Cerrar sesión" tone="danger" onPress={() => void signOut()} />
      </ListSection>
      <View className="h-2" />
    </ScrollView>
  );
}
