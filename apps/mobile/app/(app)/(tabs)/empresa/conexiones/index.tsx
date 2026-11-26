import { ConnectionsList } from '@/components/connections/ConnectionsList';
import { LinkSimple } from '@/components/icons';
import { Notice } from '@/components/ui';
import { useIsDesktop } from '@/lib/layout';

// Conexiones, a page of Empresa (three-tabs.md): the list of the organisation's
// connections (components/connections/ConnectionsList.tsx). On a desktop that
// list is the column beside this screen (components/DesktopListColumn.tsx), so
// the screen is the empty place where a connection opens.

export default function Connections() {
  const desktop = useIsDesktop();
  if (desktop) return <Notice icon={LinkSimple} title="Elige una conexión" body="Ábrela para ver qué pueden hacer tus agentes con ella." />;
  return <ConnectionsList />;
}
