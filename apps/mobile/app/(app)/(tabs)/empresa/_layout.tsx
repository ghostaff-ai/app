import { Stack } from 'expo-router';
import { spaceLook } from '@ghostaff/shared';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { headerFor } from '@/lib/header';
import { useIsDesktop } from '@/lib/layout';
import { usePalette } from '@/lib/theme';

// Empresa (Perfil in a personal space) is a tab with its own stack (three-tabs.md, decision 11), so
// Conexiones, Registro, «Añadir conexión» and a connection's page slide in
// over it and the tab bar stays. Each page carries its own title; the header
// above it holds only the way back.
// On a desktop Conexiones' list stands beside its pages (components/
// DesktopListColumn.tsx) and is the way back, so they have no header there.

export default function EmpresaLayout() {
  const header = headerFor(usePalette());
  const { active } = useActiveOrg();
  const beside = { headerShown: !useIsDesktop() };
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title: spaceLook(active?.kind).tab, headerShown: false }} />
      <Stack.Screen name="conexiones/index" options={{ ...beside, title: '' }} />
      <Stack.Screen name="conexiones/anadir" options={{ title: '' }} />
      <Stack.Screen name="conexiones/[id]" options={{ ...beside, title: '' }} />
      <Stack.Screen name="conexiones/ia/[provider]" options={{ ...beside, title: '' }} />
      <Stack.Screen name="registro" options={{ title: '' }} />
    </Stack>
  );
}
