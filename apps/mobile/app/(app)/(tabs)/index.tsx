import { ChatsCircle } from '@/components/icons';
import { TeamBoard } from '@/components/team/TeamBoard';
import { Notice } from '@/components/ui';
import { useIsDesktop } from '@/lib/layout';

// Equipo, the first tab (three-tabs.md). On a phone, the board of ghosts
// (components/team/TeamBoard.tsx, team-board.md). On a desktop the list of
// chats is the column beside this screen (components/DesktopListColumn.tsx),
// so the screen is the empty place where a chat opens.

export default function Equipo() {
  const desktop = useIsDesktop();
  if (desktop) return <Notice icon={ChatsCircle} title="Elige con quién hablar" body="Abre una conversación de la lista." />;
  return <TeamBoard />;
}
