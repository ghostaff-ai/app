import { ChatsCircle } from '@/components/icons';
import { TeamList } from '@/components/team/TeamList';
import { Notice } from '@/components/ui';
import { useIsDesktop } from '@/lib/layout';

// Equipo, the first tab (three-tabs.md): the list of agents, one chat each
// (components/team/TeamList.tsx). On a desktop that list is the column beside
// this screen (components/DesktopListColumn.tsx), so the screen is the empty
// place where a chat opens.

export default function Equipo() {
  const desktop = useIsDesktop();
  if (desktop) return <Notice icon={ChatsCircle} title="Elige con quién hablar" body="Abre una conversación de la lista." />;
  return <TeamList />;
}
