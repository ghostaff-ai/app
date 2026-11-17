import '../global.css';
import { Rubik_500Medium, Rubik_600SemiBold, useFonts } from '@expo-google-fonts/rubik';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading, Notice } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext';
import { ActiveOrgProvider } from '@/lib/org/ActiveOrgContext';
import { ProfileProvider } from '@/lib/profile/ProfileContext';
import { isConfigured } from '@/lib/supabase';
import { colorVars, PALETTES, useScheme } from '@/lib/theme';

export default function RootLayout() {
  // Headings are Rubik; until it loads (or if it fails) nothing is drawn, so
  // no screen jumps from the phone's face to Rubik.
  const [fontsLoaded, fontError] = useFonts({ Rubik_500Medium, Rubik_600SemiBold });
  // Light or dark follows the phone (app-design.md, decision 22): the colour
  // variables every Tailwind class reads, and the navigators' own backgrounds.
  const scheme = useScheme();
  const c = PALETTES[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: c.ink, background: c.surface, card: c.surface, text: c.ink, border: c.line, notification: c.waiting },
  };
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <ThemeProvider value={navTheme}>
      <View style={[{ flex: 1, backgroundColor: c.surface }, colorVars(c)]}>
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
      </View>
      </ThemeProvider>
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
