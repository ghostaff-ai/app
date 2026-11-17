import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/lib/auth/AuthContext';

// "Continuar con Apple", iPhone only. Apple requires its own control, not a
// look-alike, so this is the system button, shaped like the app's others.

export function AppleButton({ onSignIn }: { onSignIn: (fn: () => Promise<void>) => void }) {
  const { signInWithApple } = useAuth();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAvailable, () => setAvailable(false));
  }, []);
  if (!available) return null;
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={24}
      style={{ height: 48, marginBottom: 12 }}
      onPress={() => onSignIn(signInWithApple)}
    />
  );
}
