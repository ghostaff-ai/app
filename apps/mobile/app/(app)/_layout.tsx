import { Link, Stack } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { Button, Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

export default function AppLayout() {
  const { active, loading, error, reload } = useActiveOrg();
  const { signOut } = useAuth();

  if (loading) return <Loading />;
  if (error) return <Notice title="No hemos podido cargar tus organizaciones" body={error} action={<Button label="Reintentar" onPress={reload} />} />;
  if (!active)
    return (
      <Notice
        title="Aún no estás en ninguna organización"
        body="Pide a quien lleva la tuya que te añada, y vuelve a entrar."
        action={<Button label="Salir" tone="plain" onPress={() => void signOut()} />}
      />
    );

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: '#F7F6F3' },
        headerTintColor: '#1C1B19',
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: active.name,
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
      <Stack.Screen name="organizaciones" options={{ title: 'Organizaciones', presentation: 'modal' }} />
    </Stack>
  );
}
