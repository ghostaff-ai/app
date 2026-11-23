import type { MyOrganization } from '@ghostaff/shared';
import { Text, View } from 'react-native';
import { Icon, User } from '@/components/icons';
import { usePalette } from '@/lib/theme';

// A space at a glance (welcome-and-spaces.md): a person for your personal
// space, the first letter of a company's name otherwise.

export function SpaceAvatar({ space, size = 28 }: { space: Pick<MyOrganization, 'name' | 'kind'>; size?: number }) {
  const c = usePalette();
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center rounded-full bg-ink">
      {space.kind === 'personal' ? (
        <Icon icon={User} size={size * 0.55} color={c.surface} weight="bold" />
      ) : (
        <Text style={{ fontSize: size * 0.45 }} className="font-display text-surface">
          {space.name.trim()[0]?.toUpperCase() ?? '?'}
        </Text>
      )}
    </View>
  );
}
