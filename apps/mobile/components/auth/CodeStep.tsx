import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';

// The second step of signing in by email: the 6-digit code. It signs in on its
// own once the sixth digit is in (typed, pasted or filled by the phone), and
// lets the person ask for another code once the provider would accept it.

/** Seconds before another code can be asked for; the hosted Supabase refuses sooner. */
export const RESEND_AFTER_S = 60;
const CODE_LENGTH = 6;

export function CodeStep({
  email,
  busy,
  onVerify,
  onResend,
  onChangeEmail,
}: {
  email: string;
  /** A check of the code is under way. */
  busy: boolean;
  onVerify: (code: string) => void;
  /** Sends a new code; rejects when it could not. */
  onResend: () => Promise<void>;
  onChangeEmail: () => void;
}) {
  const [code, setCode] = useState('');
  // When another code may be asked for. Counted from the clock, not from ticks, so
  // a tab the browser slowed down in the background still shows the right wait.
  const [until, setUntil] = useState(() => Date.now() + RESEND_AFTER_S * 1000);
  const [wait, setWait] = useState(RESEND_AFTER_S);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    const left = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
    setWait(left());
    const t = setInterval(() => {
      const s = left();
      setWait(s);
      if (s === 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [until]);

  // Pasted codes often carry spaces or a dash ("332 529"), so no maxLength on the
  // box: it would cut them before the digits are picked out.
  const onChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH && digits !== code && !busy) onVerify(digits);
  };

  const resend = async () => {
    setResending(true);
    setResent(false);
    try {
      await onResend();
      setResent(true);
      setUntil(Date.now() + RESEND_AFTER_S * 1000);
      setCode('');
    } catch {
      // The screen shows the error; the person can try again.
    } finally {
      setResending(false);
    }
  };

  return (
    <View className="mt-8">
      <TextInput
        accessibilityLabel="Código"
        testID="signin-code"
        className="rounded-xl border border-line bg-card px-4 py-3 text-center text-2xl tracking-widest text-ink"
        placeholder="6 cifras"
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        value={code}
        onChangeText={onChange}
      />
      <Text className="mt-3 text-sm text-muted">
        {resent ? 'Te hemos mandado otro.' : `Si no te llega en un minuto, mira en spam o en promociones.`}
      </Text>
      <View className="mt-4">
        <Button label="Entrar" disabled={code.length !== CODE_LENGTH} busy={busy} onPress={() => onVerify(code)} />
      </View>
      <View className="mt-3">
        <Button
          label={wait > 0 ? `Reenviar código en ${wait} s` : 'Reenviar código'}
          variant="plain"
          disabled={wait > 0 || busy}
          busy={resending}
          onPress={resend}
        />
      </View>
      <View className="mt-3">
        <Button label="Usar otro correo" variant="plain" onPress={onChangeEmail} />
      </View>
    </View>
  );
}
