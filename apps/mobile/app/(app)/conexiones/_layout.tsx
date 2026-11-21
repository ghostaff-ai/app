import { Stack } from 'expo-router';
import { headerFor } from '@/lib/header';
import { useIsDesktop } from '@/lib/layout';
import { usePalette } from '@/lib/theme';

// Conexiones opens as a sheet with its own stack, so a connection's page
// slides in inside the sheet instead of covering it. On a desktop it is a page
// of the sidebar: the list carries its own title, with no header above it.

export default function ConnectionsLayout() {
  const header = headerFor(usePalette());
  const desktop = useIsDesktop();
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title: 'Conexiones', headerShown: !desktop }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen name="ia/[provider]" options={{ title: '' }} />
    </Stack>
  );
}
