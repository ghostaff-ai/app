import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppleButton } from '@/components/auth/AppleButton';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { Button, ErrorText } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { friendlyAuthError } from '@/lib/auth/errors';

// Sign in: Apple (iPhone) or Google in one tap, or your email and the 6-digit
// code we send to it. Any of them creates the account the first time.

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function SignIn() {
  const { sendCode, verifyCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  // Which way in is working: its button spins, the others wait.
  const [busy, setBusy] = useState<'code' | 'social' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, kind: 'code' | 'social' = 'code') => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-ink">Ghostaff</Text>
        <Text className="mt-2 text-base text-muted">
          {sent ? `Te hemos mandado un código a ${email.trim()}.` : 'Entra o crea tu cuenta. Sin contraseñas.'}
        </Text>

        {!sent ? (
          <View className="mt-8">
            <AppleButton onSignIn={(fn) => run(fn, 'social')} />
            <GoogleButton onSignIn={(fn) => run(fn, 'social')} disabled={busy !== null} />
            <View className="my-6 flex-row items-center">
              <View className="h-px flex-1 bg-line" />
              <Text className="mx-3 text-sm text-muted">o con tu correo</Text>
              <View className="h-px flex-1 bg-line" />
            </View>
            <TextInput
              accessibilityLabel="Correo"
              testID="signin-email"
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
                disabled={!looksLikeEmail(email) || busy === 'social'}
                busy={busy === 'code'}
                onPress={() => run(async () => { await sendCode(email); setSent(true); })}
              />
            </View>
          </View>
        ) : (
          <View className="mt-8">
            <TextInput
              accessibilityLabel="Código"
              testID="signin-code"
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
              <Button label="Entrar" disabled={code.length !== 6} busy={busy === 'code'} onPress={() => run(() => verifyCode(email, code))} />
            </View>
            <View className="mt-3">
              <Button label="Usar otro correo" variant="plain" onPress={() => { setSent(false); setCode(''); setError(null); }} />
            </View>
          </View>
        )}
        <ErrorText>{error}</ErrorText>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
