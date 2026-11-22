import { Slot } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { Platform } from 'react-native';
import { useIsDesktop } from '@/lib/layout';
import { usePalette } from '@/lib/theme';

// The three tabs (app-design.md, decision 1), drawn by the phone itself
// (decision 25): the floating Liquid Glass bar on iOS 26, Material 3 on
// Android, light and dark. Icons are the system's own symbols here (decision 30).
// Everything else (a decision, an agent, the sheets) opens over the tabs, from
// the stack in ../_layout.tsx.

export default function TabsLayout() {
  const c = usePalette();
  // On a desktop the sidebar (../_layout.tsx) is the navigation: no tab bar.
  if (useIsDesktop()) return <Slot />;
  // On the web there is no system bar to borrow: the floating pill takes the page's colours.
  const web = Platform.OS === 'web';
  return (
    <NativeTabs
      tintColor={c.ink}
      iconColor={{ default: c.muted, selected: c.ink }}
      labelStyle={{ default: { color: c.muted }, selected: { color: c.ink } }}
      backgroundColor={web ? c.card : undefined}
      indicatorColor={web ? c.sunk : undefined}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'sun.max', selected: 'sun.max.fill' }} md="wb_sunny" />
        <NativeTabs.Trigger.Label>Hoy</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="equipo">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.3', selected: 'person.3.fill' }} md="groups" />
        <NativeTabs.Trigger.Label>Equipo</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="registro">
        <NativeTabs.Trigger.Icon sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }} md="menu_book" />
        <NativeTabs.Trigger.Label>Registro</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
