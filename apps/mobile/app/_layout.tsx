import '../global.css';
import { Slot, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading, Notice } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext';
import { ActiveOrgProvider } from '@/lib/org/ActiveOrgContext';
import { isConfigured } from '@/lib/supabase';

export default function RootLayout() {
  // Spike: the 3D ghost needs no server, so it opens even on a build without one.
  const path = usePathname();
  if (path === '/fantasma')
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Slot />
      </SafeAreaProvider>
    );
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {isConfigured ? (
        <AuthProvider>
          <ActiveOrgProvider>
            <Routes />
          </ActiveOrgProvider>
        </AuthProvider>
      ) : (
        <Notice
          title="Falta la configuración"
          body="Esta versión no sabe a qué servidor conectarse. Copia apps/mobile/.env.example a .env y rellénalo."
        />
      )}
    </SafeAreaProvider>
  );
}

function Routes() {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
