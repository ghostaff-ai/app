import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

// An address of the app that a browser opens from outside it: where a
// provider's sign-in sends the person back to. On the web the app may live
// under a path of its domain (ghostaff.ai/app, docs/plans/ongoing/
// desktop-web.md), which expo-linking leaves out; the router knows it as the
// build's base URL. On a phone it is the app's own scheme, as before.

export function appLink(path: string): string {
  if (Platform.OS !== 'web') return Linking.createURL(path);
  return Linking.createURL(withBase(path, process.env.EXPO_BASE_URL ?? ''));
}

/** `path` under `base` (`/app` + `chat/x` → `/app/chat/x`); the path alone when there is no base. */
export function withBase(path: string, base: string): string {
  const root = base.replace(/\/+$/, '');
  const rest = path.replace(/^\/+/, '');
  return root ? `${root}/${rest}` : rest;
}
