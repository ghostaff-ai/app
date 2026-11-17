import '../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading, Notice } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext';
import { ActiveOrgProvider } from '@/lib/org/ActiveOrgContext';
import { ProfileProvider } from '@/lib/profile/ProfileContext';
import { isConfigured } from '@/lib/supabase';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {isConfigured ? (
        <AuthProvider>
          <ProfileProvider>
            <ActiveOrgProvider>
              <Routes />
            </ActiveOrgProvider>
          </ProfileProvider>
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
      {/* SDK 58 sends a guarded route to the navigator's first open one, which for
          (auth) is "/(auth)", a path with no screen: say where to go instead. */}
      <Stack.Protected guard={!!session} redirectTo="/entrar">
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!session} redirectTo="/">
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
