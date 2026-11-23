import { Stack } from 'expo-router';
import { headerFor } from '@/lib/header';
import { usePalette } from '@/lib/theme';

// Empresa is a tab with its own stack (three-tabs.md, decision 11), so
// Conexiones, Registro, «Añadir conexión» and a connection's page slide in
// over it and the tab bar stays. Each page carries its own title; the header
// above it holds only the way back.

export default function EmpresaLayout() {
  const header = headerFor(usePalette());
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title: 'Empresa', headerShown: false }} />
      <Stack.Screen name="conexiones/index" options={{ title: '' }} />
      <Stack.Screen name="conexiones/anadir" options={{ title: '' }} />
      <Stack.Screen name="conexiones/[id]" options={{ title: '' }} />
      <Stack.Screen name="conexiones/ia/[provider]" options={{ title: '' }} />
      <Stack.Screen name="registro" options={{ title: '' }} />
    </Stack>
  );
}
