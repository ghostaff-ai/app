import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CaretDown, Icon } from '@/components/icons';
import { SpaceAvatar } from '@/components/SpaceAvatar';
import { useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { usePalette } from '@/lib/theme';

// Where you are, on top of every tab on a phone (welcome-and-spaces.md): the
// space's avatar and name; a tap opens «Tus espacios». On a desktop the
// sidebar does this, so nothing is drawn.

export function SpaceSwitcher({ right }: { right?: ReactNode }) {
  const c = usePalette();
  const desktop = useIsDesktop();
  const { active } = useActiveOrg();
  if (desktop || !active) return null;
  return (
    <View className="min-h-11 flex-row items-center justify-between">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${active.name}. Cambiar de espacio`}
        onPress={() => router.push('/organizaciones')}
        hitSlop={10}
        className="flex-1 flex-row items-center self-start pr-3 active:opacity-60"
      >
        <SpaceAvatar space={active} />
        <Text className="ml-2 shrink font-display text-[17px] text-ink" numberOfLines={1}>
          {active.name}
        </Text>
        <View className="ml-1.5 mt-0.5">
          <Icon icon={CaretDown} size={14} color={c.muted} weight="bold" />
        </View>
      </Pressable>
      {right ?? null}
    </View>
  );
}
