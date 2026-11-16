import { createOrganization, splitLinks, normalizeLink } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Field } from '@/components/ui';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// Create an organisation: its name, and optionally a light first look at it
// (web, what it does, other links). Incorporación will build the record from
// this later; nothing here is required beyond the name.

export default function CreateOrganization() {
  const { enter } = useActiveOrg();
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [about, setAbout] = useState('');
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const org = await createOrganization(supabase, {
        name,
        website: normalizeLink(website),
        about,
        links: splitLinks(links),
      });
      await enter(org.id);
      // After the layout has re-rendered with the new organisation, so the inbox route exists.
      requestAnimationFrame(() => router.replace('/'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/too many/.test(msg) ? 'Has llegado al máximo de empresas por cuenta.' : msg);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-surface">
      <ScrollView contentContainerClassName="px-6 pt-4 pb-16" keyboardShouldPersistTaps="handled">
        <Field label="Nombre de la empresa" placeholder="Por ejemplo, Panadería Ana" autoCapitalize="words" value={name} onChangeText={setName} />

        <Text className="mt-8 text-lg font-semibold text-ink">Cuéntanos un poco (opcional)</Text>
        <Text className="mt-1 text-base text-muted">Con esto tus agentes empiezan sabiendo quiénes sois.</Text>

        <Field
          label="Web"
          placeholder="tuempresa.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          inputMode="url"
          value={website}
          onChangeText={setWebsite}
        />
        <Field label="¿Qué hacéis?" hint="Un par de frases, como se lo contarías a alguien." multiline value={about} onChangeText={setAbout} />
        <Field
          label="Otros enlaces"
          hint="Redes, ficha en las tiendas, una carpeta de Drive… uno por línea."
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          value={links}
          onChangeText={setLinks}
        />

        <View className="mt-8">
          <Button label="Crear empresa" disabled={!name.trim()} busy={busy} onPress={() => void submit()} />
        </View>
        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
