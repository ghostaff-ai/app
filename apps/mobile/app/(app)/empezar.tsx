import { createPersonalSpace } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { useState } from 'react';
import { Buildings, EnvelopeSimple, User } from '@/components/icons';
import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { OptionCard } from '@/components/onboarding/OptionCard';
import { Button, Choice, ErrorText } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useMyInvitations } from '@/lib/hooks/useInvitations';
import { type Purpose, stepsFor } from '@/lib/onboarding';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// Step 2 of the way in (welcome-and-spaces.md), with a profile and no space
// yet: what Ghostaff is for. «Para mí» makes your personal space at once;
// «Para mi empresa» goes on to its name. An invitation waiting for you comes first.

const tooMany = (e: unknown) =>
  (e as { code?: string })?.code === '54000' || /too many/.test(e instanceof Error ? e.message : String(e));

export default function Start() {
  const { enter } = useActiveOrg();
  const { signOut } = useAuth();
  const { items: invitations } = useMyInvitations();
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    if (purpose === 'company') {
      router.push('/crear-empresa');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const space = await createPersonalSpace(supabase);
      // The layout's guards follow the active space and move on by themselves.
      await enter(space.id);
    } catch (e) {
      setError(tooMany(e) ? 'Ya tienes demasiados espacios.' : e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <OnboardingStep
      ghost="base"
      step={2}
      of={stepsFor(purpose)}
      title="¿Para qué vas a usar Ghostaff?"
      topRight={<Button label="Salir" variant="plain" size="small" onPress={() => void signOut()} />}
      action={
        <>
          <Button label="Seguir" disabled={!purpose} busy={busy} onPress={() => void next()} />
          <ErrorText>{error}</ErrorText>
        </>
      }
      link={<Button label="Unirme a una empresa" variant="plain" onPress={() => router.push('/unirme')} />}
    >
      {invitations.length > 0 ? (
        <Choice
          title={invitations.length === 1 ? `Te han invitado a ${invitations[0]!.orgName}` : `Tienes ${invitations.length} invitaciones`}
          body="Míralas y únete."
          icon={EnvelopeSimple}
          onPress={() => router.push('/unirme')}
        />
      ) : null}
      <OptionCard title="Para mí" body="Tu asistente personal" icon={User} selected={purpose === 'personal'} onPress={() => setPurpose('personal')} />
      <OptionCard
        title="Para mi empresa"
        body="Un equipo de agentes"
        icon={Buildings}
        selected={purpose === 'company'}
        onPress={() => setPurpose('company')}
      />
    </OnboardingStep>
  );
}
