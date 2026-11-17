import { Stack } from 'expo-router';
import { Button, Loading, Notice } from '@/components/ui';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useProfile } from '@/lib/profile/ProfileContext';
import { FONTS, usePalette, type Palette } from '@/lib/theme';

// Signed in. The way in has three steps, each a guard: a profile first
// (bienvenida), then an organisation (empezar: create one or join one), then
// the three tabs (Hoy, Equipo, Registro). A decision, an agent and the sheets
// open over the tabs. Creating and joining stay reachable later, from
// Organizaciones, the sheet behind the organisation's name on Hoy.

const headerFor = (c: Palette) =>
  ({
    headerShadowVisible: false,
    headerStyle: { backgroundColor: c.surface },
    headerTintColor: c.ink,
    headerTitleStyle: { fontFamily: FONTS.display },
    headerBackTitle: 'Atrás',
  }) as const;

export default function AppLayout() {
  const org = useActiveOrg();
  const me = useProfile();
  const header = headerFor(usePalette());

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
  // Where each step sends someone who isn't there yet (or is past it).
  const step = !hasProfile ? '/bienvenida' : !org.active ? '/empezar' : '/';

  return (
    <Stack screenOptions={header}>
      <Stack.Protected guard={inOrg} redirectTo={step}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: org.active?.name ?? '' }} />
        <Stack.Screen name="decision/[id]" options={{ title: 'Decisión' }} />
        <Stack.Screen name="agente/[id]" options={{ title: '' }} />
        <Stack.Screen name="nuevo-agente" options={{ title: 'Nuevo agente', presentation: 'modal' }} />
        <Stack.Screen
          name="organizaciones"
          options={{ title: 'Organizaciones', presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true, headerShown: false }}
        />
        <Stack.Screen name="invitar" options={{ title: 'Invitar', presentation: 'modal' }} />
        <Stack.Screen name="conexiones" options={{ title: 'Conexiones', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!hasProfile} redirectTo={step}>
        <Stack.Screen name="bienvenida" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={hasProfile && !org.active} redirectTo={step}>
        <Stack.Screen name="empezar" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={hasProfile} redirectTo={step}>
        <Stack.Screen name="crear-empresa" options={{ title: 'Crear una empresa', presentation: 'modal' }} />
        <Stack.Screen name="unirme" options={{ title: 'Unirme a una empresa', presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}
