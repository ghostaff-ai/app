import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { friendlyAuthError } from '@/lib/auth/errors';

// Sign in: your email, then the 6-digit code we send to it.

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function SignIn() {
  const { sendCode, verifyCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-ink">Ghostaff</Text>
        <Text className="mt-2 text-base text-muted">
          {sent ? `Te hemos mandado un código a ${email.trim()}.` : 'Entra o crea tu cuenta con tu correo. Te mandamos un código, sin contraseñas.'}
        </Text>

        {!sent ? (
          <View className="mt-8">
            <TextInput
              accessibilityLabel="Correo"
              className="rounded-xl border border-line bg-card px-4 py-3 text-base text-ink"
              placeholder="tu@correo.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={() => looksLikeEmail(email) && run(async () => { await sendCode(email); setSent(true); })}
            />
            <View className="mt-4">
              <Button
                label="Mandarme el código"
                disabled={!looksLikeEmail(email)}
                busy={busy}
                onPress={() => run(async () => { await sendCode(email); setSent(true); })}
              />
            </View>
          </View>
        ) : (
          <View className="mt-8">
            <TextInput
              accessibilityLabel="Código"
              className="rounded-xl border border-line bg-card px-4 py-3 text-center text-2xl tracking-widest text-ink"
              placeholder="123456"
              keyboardType="number-pad"
              inputMode="numeric"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
            />
            <View className="mt-4">
              <Button label="Entrar" disabled={code.length !== 6} busy={busy} onPress={() => run(() => verifyCode(email, code))} />
            </View>
            <View className="mt-3">
              <Button label="Usar otro correo" tone="plain" onPress={() => { setSent(false); setCode(''); setError(null); }} />
            </View>
          </View>
        )}
        <ErrorText>{error}</ErrorText>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
