import AsyncStorage from '@react-native-async-storage/async-storage';

// The token this phone last registered for pushes, kept on the device so that
// signing out can forget it later, even after a restart and even once
// notifications have been turned off in the phone's settings (when the token
// can no longer be read behind the permission).

const STORAGE_KEY = 'ghostaff.pushToken';

export async function rememberRegisteredToken(token: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, token).catch(() => {});
}

export async function registeredToken(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
}

export async function clearRegisteredToken(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
