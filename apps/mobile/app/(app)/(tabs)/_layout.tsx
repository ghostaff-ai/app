import { Slot, usePathname } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useInbox } from '@/lib/hooks/useDecisions';
import { useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { usePalette } from '@/lib/theme';

// The three tabs (three-tabs.md, Álvaro 2026-11-23): Equipo, one row per agent
// opening its chat; Decisiones, what waits for you; Empresa, the organisation
// with its Conexiones and Registro. Drawn by the phone itself (app-design.md,
// decision 25): the floating Liquid Glass bar on iOS 26, Material 3 on
// Android, light and dark, with the system's own symbols (decision 30).
// Everything else (a chat, a decision, an agent's page, the sheets) opens over
// the tabs, from the stack in ../_layout.tsx.

export default function TabsLayout() {
  const c = usePalette();
  const { active } = useActiveOrg();
  const inbox = useInbox(active?.id ?? null);
  const { reload } = inbox;
  const path = usePathname();
  // A decision is answered on another screen: count again on every move.
  useEffect(() => void reload(), [path, reload]);
  const waiting = inbox.decisions.filter((d) => !d.answer).length;
  const desktop = useIsDesktop();
  // On a desktop the sidebar (../_layout.tsx) is the navigation: no tab bar.
  if (desktop) return <Slot />;
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
        <NativeTabs.Trigger.Icon sf={{ default: 'person.3', selected: 'person.3.fill' }} md="groups" />
        <NativeTabs.Trigger.Label>Equipo</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="decisiones">
        <NativeTabs.Trigger.Icon sf={{ default: 'checkmark.seal', selected: 'checkmark.seal.fill' }} md="approval" />
        <NativeTabs.Trigger.Label>Decisiones</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={waiting === 0}>{String(waiting)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="empresa">
        <NativeTabs.Trigger.Icon sf={{ default: 'building.2', selected: 'building.2.fill' }} md="business" />
        <NativeTabs.Trigger.Label>Empresa</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
