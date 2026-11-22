import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { Icon, X } from '@/components/icons';

// The way out of every sheet and modal (welcome-and-spaces.md), on the phone
// and on the web, where a sheet is a page with no swipe to dismiss it. Opened
// cold (a link typed on the web), there is nothing to go back to: Hoy.

export function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function CloseButton({ onPress = close }: { onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Cerrar"
      hitSlop={8}
      onPress={onPress}
      className="h-8 w-8 items-center justify-center rounded-full bg-sunk active:opacity-60"
    >
      <Icon icon={X} size={16} weight="bold" />
    </Pressable>
  );
}
