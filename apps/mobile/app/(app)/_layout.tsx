import { Stack } from 'expo-router';
import { useRef } from 'react';
import { View } from 'react-native';
import { CloseButton } from '@/components/CloseButton';
import { Sidebar } from '@/components/Sidebar';
import { Button, Loading, Notice } from '@/components/ui';
import { canRunAgents } from '@/lib/connections';
import { useConnections } from '@/lib/hooks/useConnections';
import { useIsDesktop } from '@/lib/layout';
import { headerFor } from '@/lib/header';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useProfile } from '@/lib/profile/ProfileContext';
import { usePalette } from '@/lib/theme';

// Signed in. The way in has four steps, each a guard: a profile first
// (bienvenida), then an organisation (empezar: create one or join one), then,
// for an owner, an AI account the agents can run on (conectar-ia), then the
// tabs (Equipo, Decisiones, Empresa: three-tabs.md). A chat, a decision, an
// agent and the sheets open over the tabs. Creating and joining stay reachable
// later, from Organizaciones, the sheet behind the organisation's name in
// Empresa. A member who isn't an owner can't connect one, so they get in and
// Equipo says what's missing.

export default function AppLayout() {
  const org = useActiveOrg();
  const me = useProfile();
  const header = headerFor(usePalette());
  // A modal's way out: an X on the right, not a back arrow (welcome-and-spaces.md).
  const modal = { presentation: 'modal', headerBackVisible: false, headerLeft: () => null, headerRight: () => <CloseButton /> } as const;
  const desktop = useIsDesktop();
  const connections = useConnections(org.active?.id ?? null);
  // Wait for the connections only on the way in: switching or creating an
  // organisation keeps the screens mounted and the gate follows once they're read.
  const seenConnections = useRef(false);
  if (connections.loaded) seenConnections.current = true;

  if (org.loading || me.loading || (org.active && !seenConnections.current)) return <Loading />;
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
  // An owner whose organisation has no AI account to run on connects one first.
  // If the connections can't be read, let them in: the engine still says what's missing.
  const needsAi =
    inOrg && org.active?.role === 'owner' && connections.loaded && !connections.error && !canRunAgents(connections.items);
  // Where each step sends someone who isn't there yet (or is past it).
  const step = !hasProfile ? '/bienvenida' : !org.active ? '/empezar' : needsAi ? '/conectar-ia' : '/';

  const stack = (
    <Stack screenOptions={header}>
      <Stack.Protected guard={inOrg && !needsAi} redirectTo={step}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: org.active?.name ?? '' }} />
        <Stack.Screen name="decision/[id]" options={{ title: 'Decisión' }} />
        <Stack.Screen name="agente/[id]" options={{ title: '' }} />
        <Stack.Screen name="acceso/[id]" options={{ title: 'Quién puede' }} />
        <Stack.Screen name="herramientas/[id]" options={{ title: 'Herramientas' }} />
        <Stack.Screen name="conversacion/[id]" options={{ title: '' }} />
        <Stack.Screen name="nueva-conversacion/[agent]" options={{ title: 'Nueva conversación' }} />
        <Stack.Screen name="visibilidad/[id]" options={{ title: 'Quién la ve', presentation: 'modal' }} />
        <Stack.Screen name="conversaciones/[id]" options={{ title: 'Conversaciones nuevas' }} />
        <Stack.Screen name="chat/[agent]" options={{ title: '' }} />
        <Stack.Screen name="anadir-agente" options={{ title: 'Añadir agente' }} />
        <Stack.Screen
          name="contratar"
          options={{ title: 'Incorporar', presentation: 'formSheet', sheetAllowedDetents: [0.65, 1], sheetGrabberVisible: true, headerShown: false }}
        />
        <Stack.Screen name="nuevo-agente" options={{ ...modal, title: 'Nuevo agente' }} />
        <Stack.Screen
          name="organizaciones"
          options={{ title: 'Organizaciones', presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true, headerShown: false }}
        />
        <Stack.Screen name="invitar" options={{ ...modal, title: 'Invitar' }} />
      </Stack.Protected>
      <Stack.Protected guard={needsAi} redirectTo={step}>
        <Stack.Screen name="conectar-ia" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!hasProfile} redirectTo={step}>
        <Stack.Screen name="bienvenida" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={hasProfile && !org.active} redirectTo={step}>
        <Stack.Screen name="empezar" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={hasProfile} redirectTo={step}>
        {/* A step of the way in before any space exists, a modal after (welcome-and-spaces.md). */}
        <Stack.Screen name="crear-empresa" options={{ headerShown: false, presentation: org.organizations.length ? 'modal' : 'card' }} />
        <Stack.Screen name="unirme" options={{ ...modal, title: 'Unirme a una empresa' }} />
      </Stack.Protected>
    </Stack>
  );

  // On a desktop, once inside an organisation, the sidebar stands beside every
  // screen (docs/plans/ideas/desktop-web.md); the way in keeps the whole window.
  if (!desktop || !inOrg || needsAi) return stack;
  return (
    <View className="flex-1 flex-row bg-surface">
      <Sidebar />
      <View className="flex-1">{stack}</View>
    </View>
  );
}
