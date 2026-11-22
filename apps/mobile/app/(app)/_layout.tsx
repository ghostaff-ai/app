import { Stack } from 'expo-router';
import { View } from 'react-native';
import { Sidebar } from '@/components/Sidebar';
import { Button, Loading, Notice } from '@/components/ui';
import { useIsDesktop } from '@/lib/layout';
import { headerFor } from '@/lib/header';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useProfile } from '@/lib/profile/ProfileContext';
import { usePalette } from '@/lib/theme';

// Signed in. The way in has three steps, each a guard: a profile first
// (bienvenida), then an organisation (empezar: create one or join one), then
// the three tabs (Hoy, Equipo, Registro). A decision, an agent and the sheets
// open over the tabs. Creating and joining stay reachable later, from
// Organizaciones, the sheet behind the organisation's name on Hoy.

export default function AppLayout() {
  const org = useActiveOrg();
  const me = useProfile();
  const header = headerFor(usePalette());
  const desktop = useIsDesktop();

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

  const stack = (
    <Stack screenOptions={header}>
      <Stack.Protected guard={inOrg} redirectTo={step}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: org.active?.name ?? '' }} />
        <Stack.Screen name="decision/[id]" options={{ title: 'Decisión' }} />
        <Stack.Screen name="agente/[id]" options={{ title: '' }} />
        <Stack.Screen name="acceso/[id]" options={{ title: 'Quién puede' }} />
        <Stack.Screen name="conversacion/[id]" options={{ title: '' }} />
        <Stack.Screen name="conversacion/nueva" options={{ title: 'Nueva conversación' }} />
        <Stack.Screen
          name="contratar"
          options={{ title: 'Incorporar', presentation: 'formSheet', sheetAllowedDetents: [0.65, 1], sheetGrabberVisible: true, headerShown: false }}
        />
        <Stack.Screen name="nuevo-agente" options={{ title: 'Nuevo agente', presentation: 'modal' }} />
        <Stack.Screen
          name="organizaciones"
          options={{ title: 'Organizaciones', presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true, headerShown: false }}
        />
        <Stack.Screen name="invitar" options={{ title: 'Invitar', presentation: 'modal' }} />
        {/* Conexiones has its own stack (conexiones/_layout). On a phone it opens as a
            sheet; on a desktop it is a page of its own, reached from the sidebar. */}
        <Stack.Screen name="conexiones" options={desktop ? { headerShown: false } : { presentation: 'modal', headerShown: false }} />
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

  // On a desktop, once inside an organisation, the sidebar stands beside every
  // screen (docs/plans/ideas/desktop-web.md); the way in keeps the whole window.
  if (!desktop || !inOrg) return stack;
  return (
    <View className="flex-1 flex-row bg-surface">
      <Sidebar />
      <View className="flex-1">{stack}</View>
    </View>
  );
}
