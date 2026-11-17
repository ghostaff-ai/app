import '../global.css';
import { Rubik_500Medium, Rubik_600SemiBold, useFonts } from '@expo-google-fonts/rubik';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading, Notice } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext';
import { ActiveOrgProvider } from '@/lib/org/ActiveOrgContext';
import { ProfileProvider } from '@/lib/profile/ProfileContext';
import { isConfigured } from '@/lib/supabase';

export default function RootLayout() {
  // Headings are Rubik; until it loads (or if it fails) nothing is drawn, so
  // no screen jumps from the phone's face to Rubik.
  const [fontsLoaded, fontError] = useFonts({ Rubik_500Medium, Rubik_600SemiBold });
  if (!fontsLoaded && !fontError) return null;
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
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
