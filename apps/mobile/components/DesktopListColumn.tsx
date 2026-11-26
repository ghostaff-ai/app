import { usePathname } from 'expo-router';
import { View } from 'react-native';
import { ConnectionsList } from '@/components/connections/ConnectionsList';
import { TeamList } from '@/components/team/TeamList';
import { DESKTOP_LIST_WIDTH, desktopSection } from '@/lib/layout';

// On a desktop, Equipo and Conexiones keep their list beside the item it opened
// (docs/plans/ongoing/desktop-web.md, decision 5): this column stands between
// the sidebar and the screen, outside the stack, so the list stays put (its
// scroll too) while the chat or the connection beside it changes. The list's
// own screen then shows only what to do with the empty space.

export function DesktopListColumn() {
  const { list } = desktopSection(usePathname());
  if (!list) return null;
  return (
    <View
      accessibilityLabel={list === 'team' ? 'Equipo' : 'Conexiones'}
      className="border-r border-line bg-surface"
      style={{ width: DESKTOP_LIST_WIDTH }}
    >
      {list === 'team' ? <TeamList /> : <ConnectionsList />}
    </View>
  );
}
