import { useState } from 'react';
import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { Button, ErrorText, Field } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { dismissKeyboard } from '@/lib/keyboard';
import { stepsFor } from '@/lib/onboarding';
import { useProfile } from '@/lib/profile/ProfileContext';

// Step 1 of the way in (welcome-and-spaces.md): your name, how you sign your
// answers in every space you're in. Nothing else is asked (Jaime, 2026-11-22).

export default function Welcome() {
  const { save } = useProfile();
  const { session } = useAuth();
  // Google, and Apple the first time, tell us the name: offer it, editable.
  const [name, setName] = useState(() => {
    const meta = session?.user.user_metadata ?? {};
    const given = meta.full_name ?? meta.name;
    return typeof given === 'string' ? given : '';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // The next step has no field: it must not start under a closing keyboard.
      await dismissKeyboard();
      await save({ fullName: name.trim(), occupation: null, heardFrom: null });
      // The layout moves on by itself once the profile exists.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <OnboardingStep
      ghost="base"
      step={1}
      of={stepsFor(null)}
      title="¿Cómo te llamas?"
      line="Así firmarás lo que apruebes."
      action={
        <>
          <Button label="Seguir" disabled={!name.trim()} busy={busy} onPress={() => void submit()} />
          <ErrorText>{error}</ErrorText>
        </>
      }
    >
      <Field
        label="Tu nombre"
        placeholder="Nombre y apellido"
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        returnKeyType="next"
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => (name.trim() ? void submit() : undefined)}
      />
    </OnboardingStep>
  );
}
