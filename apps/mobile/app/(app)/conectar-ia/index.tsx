import type { AiProvider } from '@ghostaff/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { Buildings } from '@/components/icons';
import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { OptionCard } from '@/components/onboarding/OptionCard';
import { Button, ListRow, ListSection, RowIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { PROVIDERS, RUNS_AGENTS } from '@/lib/connections';
import { stepsFor } from '@/lib/onboarding';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// Before the team starts: the owner connects the AI account its agents run on
// (Álvaro, 2026-11-22). There is no skipping it; the way out is another space
// or signing out. Only the accounts the engine runs agents on today are
// offered; the rest are in Conexiones. On the way in it is the last step
// (welcome-and-spaces.md); reached later (a second company) it has no dots.

export default function ConnectAi() {
  const { organizations, active, choose } = useActiveOrg();
  const { signOut } = useAuth();
  const [picked, setPicked] = useState<AiProvider>(RUNS_AGENTS[0]!);
  const others = organizations.filter((o) => o.id !== active?.id);
  const firstSpace = organizations.length === 1;
  const purpose = active?.kind ?? 'company';
  const whose = purpose === 'personal' ? 'Tus agentes' : `Los agentes de ${active?.name ?? 'tu empresa'}`;

  return (
    <OnboardingStep
      ghost="base"
      step={firstSpace ? stepsFor(purpose) : undefined}
      of={firstSpace ? stepsFor(purpose) : undefined}
      title="Conecta tu IA"
      line={`${whose} trabajan con tu cuenta de IA. Puedes cambiarla luego en Conexiones.`}
      topRight={<Button label="Salir" variant="plain" size="small" onPress={() => void signOut()} />}
      action={<Button label="Conectar" onPress={() => router.push(`/conectar-ia/${picked}`)} />}
    >
      {RUNS_AGENTS.map((p) => (
        <OptionCard
          key={p}
          testID={`connect-ai-${p}`}
          leading={<ConnectorLogo id={`ai-${p}`} name={PROVIDERS[p].name} size={28} />}
          title={PROVIDERS[p].name}
          body={PROVIDERS[p].short}
          selected={picked === p}
          onPress={() => setPicked(p)}
        />
      ))}

      {others.length > 0 ? (
        <ListSection header="O ve a otro espacio">
          {others.map((o) => (
            <ListRow key={o.id} leading={<RowIcon icon={Buildings} />} title={o.name} chevron onPress={() => choose(o.id)} />
          ))}
        </ListSection>
      ) : null}
    </OnboardingStep>
  );
}
