import { Stack } from 'expo-router';
import { headerFor } from '@/lib/header';
import { usePalette } from '@/lib/theme';

// Conexiones opens as a sheet with its own stack, so a connection's page
// slides in inside the sheet instead of covering it.

export default function ConnectionsLayout() {
  const header = headerFor(usePalette());
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title: 'Conexiones' }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen name="ia/[provider]" options={{ title: '' }} />
    </Stack>
  );
}
