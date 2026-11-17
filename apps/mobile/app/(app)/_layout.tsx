import { Link, Stack } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { Button, Loading, Notice } from '@/components/ui';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useProfile } from '@/lib/profile/ProfileContext';

// Signed in. The way in has three steps, each a guard: a profile first
// (bienvenida), then an organisation (empezar: create one or join one), then
// the inbox. Creating and joining stay reachable later, from Organizaciones.

const header = {
  headerShadowVisible: false,
  headerStyle: { backgroundColor: '#F7F6F3' },
  headerTintColor: '#1C1B19',
  headerBackTitle: 'Atrás',
} as const;

export default function AppLayout() {
  const org = useActiveOrg();
  const me = useProfile();

  if (org.loading || me.loading) return <Loading />;
  const error = me.error ?? org.error;
  if (error)
    return (
      <Notice
        title="No hemos podido cargar tu cuenta"
        body={error}
        action={<Button label="Reintentar" onPress={() => { me.reload(); org.reload(); }} />}
      />
    );

  const hasProfile = !!me.profile;
  const inOrg = hasProfile && !!org.active;

  return (
    <Stack screenOptions={header}>
      <Stack.Protected guard={inOrg}>
        <Stack.Screen
          name="index"
          options={{
            title: org.active?.name ?? '',
            headerLeft: () => (
              <Link href="/equipo" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel="Ver el equipo" hitSlop={12}>
                  <Text className="text-base text-accent">Equipo</Text>
                </Pressable>
              </Link>
            ),
            headerRight: () => (
              <Link href="/organizaciones" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel="Cambiar de organización" hitSlop={12}>
                  <Text className="text-base text-accent">Cambiar</Text>
                </Pressable>
              </Link>
            ),
          }}
        />
        <Stack.Screen name="decision/[id]" options={{ title: 'Decisión' }} />
        <Stack.Screen name="equipo" options={{ title: 'Equipo' }} />
        <Stack.Screen name="agente/[id]" options={{ title: '' }} />
        <Stack.Screen name="nuevo-agente" options={{ title: 'Nuevo agente', presentation: 'modal' }} />
        <Stack.Screen name="organizaciones" options={{ title: 'Organizaciones', presentation: 'modal' }} />
        <Stack.Screen name="invitar" options={{ title: 'Invitar', presentation: 'modal' }} />
        <Stack.Screen name="conexiones" options={{ title: 'Conexiones', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!hasProfile}>
        <Stack.Screen name="bienvenida" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={hasProfile && !org.active}>
        <Stack.Screen name="empezar" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={hasProfile}>
        <Stack.Screen name="crear-empresa" options={{ title: 'Crear una empresa', presentation: 'modal' }} />
        <Stack.Screen name="unirme" options={{ title: 'Unirme a una empresa', presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}
