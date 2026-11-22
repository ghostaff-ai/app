import { Stack } from 'expo-router';
import { headerFor } from '@/lib/header';
import { usePalette } from '@/lib/theme';

// Conexiones is a tab with its own stack, so a connection's page slides in
// over the list and the tab bar stays. The list carries its own title, like the
// other tabs, with no header above it; on a desktop it is a page of the sidebar.

export default function ConnectionsLayout() {
  const header = headerFor(usePalette());
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title: 'Conexiones', headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen name="ia/[provider]" options={{ title: '' }} />
    </Stack>
  );
}
