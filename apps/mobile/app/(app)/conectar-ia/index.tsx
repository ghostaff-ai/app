import { router } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { Buildings, SignOut } from '@/components/icons';
import { ListRow, ListSection, RowIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { PROVIDERS, RUNS_AGENTS } from '@/lib/connections';
import { DESKTOP_PAGE, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// Before the team starts: the owner connects the AI account its agents run on
// (Álvaro, 2026-11-22). There is no skipping it; the way out is another
// organisation or signing out. Only the accounts the engine runs agents on
// today are offered; the rest are in Conexiones.

export default function ConnectAi() {
  const { organizations, active, choose } = useActiveOrg();
  const { session, signOut } = useAuth();
  const desktop = useIsDesktop();
  const others = organizations.filter((o) => o.id !== active?.id);

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <ScrollView contentContainerClassName="px-6 py-10" contentContainerStyle={desktop ? DESKTOP_PAGE : undefined}>
        <Text accessibilityRole="header" className="font-display text-title text-ink">
          Conecta la IA de tu equipo
        </Text>
        <Text className="mt-2 text-base leading-[22px] text-muted">
          Los agentes de {active?.name} trabajan con una cuenta de IA de tu empresa, y su factura llega a tu nombre. Elige con cuál
          empiezan; luego puedes cambiarla en Conexiones.
        </Text>

        <ListSection>
          {RUNS_AGENTS.map((p) => (
            <ListRow
              key={p}
              testID={`connect-ai-${p}`}
              leading={<ConnectorLogo id={`ai-${p}`} name={PROVIDERS[p].name} size={36} />}
              title={PROVIDERS[p].name}
              subtitle={PROVIDERS[p].short}
              chevron
              onPress={() => router.push(`/conectar-ia/${p}`)}
            />
          ))}
        </ListSection>

        {others.length > 0 ? (
          <ListSection header="O cambia de organización">
            {others.map((o) => (
              <ListRow key={o.id} leading={<RowIcon icon={Buildings} />} title={o.name} chevron onPress={() => choose(o.id)} />
            ))}
          </ListSection>
        ) : null}

        <ListSection footer={session?.user.email ? `Has entrado como ${session.user.email}` : undefined}>
          <ListRow leading={<RowIcon icon={SignOut} tone="danger" />} title="Cerrar sesión" tone="danger" onPress={() => void signOut()} />
        </ListSection>
      </ScrollView>
    </SafeAreaView>
  );
}
