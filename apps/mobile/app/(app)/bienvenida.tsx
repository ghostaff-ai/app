import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chips, ErrorText, Field } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useProfile } from '@/lib/profile/ProfileContext';

// First screen after the first code: who you are. Only the name is required;
// it is how you sign your answers in every organisation you join.

const OCCUPATIONS = ['Fundador/a', 'Dirección', 'Finanzas', 'Marketing', 'Operaciones', 'Otra cosa'] as const;
const HEARD_FROM = ['Alguien que conozco', 'Redes sociales', 'Buscando en internet', 'Un evento', 'Otro'] as const;

export default function Welcome() {
  const { save } = useProfile();
  const { session } = useAuth();
  // Google, and Apple the first time, tell us the name: offer it, editable.
  const [name, setName] = useState(() => {
    const meta = session?.user.user_metadata ?? {};
    const given = meta.full_name ?? meta.name;
    return typeof given === 'string' ? given : '';
  });
  const [occupation, setOccupation] = useState<string | null>(null);
  const [occupationOther, setOccupationOther] = useState('');
  const [heardFrom, setHeardFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await save({
        fullName: name.trim(),
        occupation: occupation === 'Otra cosa' ? occupationOther.trim() || occupation : occupation,
        heardFrom,
      });
      // The layout moves on by itself once the profile exists.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="px-6 py-10" keyboardShouldPersistTaps="handled">
          <Text className="text-3xl font-bold text-ink">Te damos la bienvenida</Text>
          <Text className="mt-2 text-base text-muted">Antes de empezar, cuéntanos un poco de ti.</Text>

          <Field
            label="Tu nombre"
            hint="Así firmarás lo que decidas."
            placeholder="Nombre y apellido"
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            value={name}
            onChangeText={setName}
          />

          <Chips label="¿A qué te dedicas? (opcional)" options={OCCUPATIONS} value={occupation} onChange={setOccupation} />
          {occupation === 'Otra cosa' ? (
            <Field label="¿Qué haces?" placeholder="Por ejemplo, gestoría" value={occupationOther} onChangeText={setOccupationOther} />
          ) : null}

          <Chips label="¿Cómo nos conociste? (opcional)" options={HEARD_FROM} value={heardFrom} onChange={setHeardFrom} />

          <View className="mt-8">
            <Button label="Seguir" disabled={!name.trim()} busy={busy} onPress={() => void submit()} />
          </View>
          <ErrorText>{error}</ErrorText>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
