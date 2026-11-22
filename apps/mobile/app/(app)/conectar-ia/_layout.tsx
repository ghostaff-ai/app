import { Stack } from 'expo-router';
import { headerFor } from '@/lib/header';
import { usePalette } from '@/lib/theme';

// The step before the tabs for an owner whose organisation has no AI account
// its agents can run on: the choice, then that account's page, in one stack.
// Once one is connected the layout's guard opens the tabs by itself.

export default function ConnectAiLayout() {
  const header = headerFor(usePalette());
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[provider]" options={{ title: '' }} />
    </Stack>
  );
}
