import { createOrganization } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { useState } from 'react';
import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { Button, ErrorText, Field } from '@/components/ui';
import { stepsFor } from '@/lib/onboarding';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// A company: only its name (welcome-and-spaces.md). Its web and what it does
// are added later. Step 3 of the way in for someone with no space yet; a
// modal with a close when opened later from «Tus espacios».

export default function CreateOrganization() {
  const { enter, organizations } = useActiveOrg();
  const onTheWayIn = organizations.length === 0;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const org = await createOrganization(supabase, { name });
      await enter(org.id);
      // After the layout has re-rendered with the new organisation, so the inbox route exists.
      requestAnimationFrame(() => router.replace('/'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/too many/.test(msg) ? 'Ya tienes demasiados espacios.' : msg);
      setBusy(false);
    }
  };

  return (
    <OnboardingStep
      ghost="incorporacion"
      step={onTheWayIn ? 3 : undefined}
      of={onTheWayIn ? stepsFor('company') : undefined}
      title="¿Cómo se llama tu empresa?"
      line="La web y lo que hacéis, luego."
      topRight={onTheWayIn ? undefined : <Button label="Cerrar" variant="plain" size="small" onPress={() => router.back()} />}
      link={onTheWayIn ? <Button label="Atrás" variant="plain" onPress={() => router.back()} /> : undefined}
      action={
        <>
          <Button label="Crear" disabled={!name.trim()} busy={busy} onPress={() => void submit()} />
          <ErrorText>{error}</ErrorText>
        </>
      }
    >
      <Field
        label="Nombre de la empresa"
        placeholder="Por ejemplo, Panadería Ana"
        autoCapitalize="words"
        returnKeyType="done"
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => (name.trim() ? void submit() : undefined)}
      />
    </OnboardingStep>
  );
}
