import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Choice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useMyInvitations } from '@/lib/hooks/useInvitations';
import { useProfile } from '@/lib/profile/ProfileContext';

// With a profile and no organisation yet: create one, or join one that
// invited you. An invitation waiting for you is shown first.

export default function Start() {
  const { profile } = useProfile();
  const { session, signOut } = useAuth();
  const { items: invitations } = useMyInvitations();
  const firstName = profile?.fullName.split(/\s+/)[0] ?? '';

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <ScrollView contentContainerClassName="px-6 py-10">
        <Text className="text-3xl font-bold text-ink">Hola, {firstName}</Text>
        <Text className="mt-2 mb-8 text-base text-muted">¿Cómo quieres empezar?</Text>

        {invitations.length > 0 ? (
          <Choice
            title={invitations.length === 1 ? `Te han invitado a ${invitations[0]!.orgName}` : `Tienes ${invitations.length} invitaciones`}
            body="Toca para verla y unirte."
            onPress={() => router.push('/unirme')}
          />
        ) : null}

        <Choice
          title="Crear una empresa"
          body="Monta el equipo de agentes de tu empresa u organización."
          onPress={() => router.push('/crear-empresa')}
        />
        <Choice
          title="Unirme a una empresa"
          body="Si alguien de tu empresa ya usa Ghostaff."
          onPress={() => router.push('/unirme')}
        />

        <View className="mt-10">
          <Text className="mb-3 text-center text-sm text-muted">{session?.user.email}</Text>
          <Button label="Salir" tone="plain" onPress={() => void signOut()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
