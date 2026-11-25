import type { DevicePlatform, PushData } from '@ghostaff/shared';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { appEnv } from '../env';

// The phone's side of push, and the only file that imports expo-notifications
// (pushClient.web.ts answers for the web). The engine sends straight to APNs
// and FCM with the native token, never through Expo's push service
// (docs/plans/ready/decision-notifications.md).

export type Permission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export interface Device {
  token: string;
  platform: DevicePlatform;
  apnsEnvironment: 'production' | 'sandbox' | null;
  bundleId: string;
}

// The engine's FCM messages name this channel. Android 8+ drops a notification
// whose channel doesn't exist, and Android 13 shows no permission dialog until
// one does, so it is made before asking and before reading the token.
const CHANNEL_ID = 'default';
let channel: Promise<void> | null = null;

function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channel ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Avisos',
    importance: Notifications.AndroidImportance.HIGH,
  })
    .then(() => undefined)
    .catch(() => {
      channel = null;
    });
  return channel;
}

function toPermission(s: Notifications.NotificationPermissionsStatus): Permission {
  if (s.granted) return 'granted';
  if (s.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  // Android says `denied` both before the first ask (on some versions) and after
  // a refusal; only `canAskAgain` tells them apart.
  return s.canAskAgain ? 'undetermined' : 'denied';
}

export async function permission(): Promise<Permission> {
  await ensureChannel();
  return toPermission(await Notifications.getPermissionsAsync());
}

export async function requestPermission(): Promise<Permission> {
  await ensureChannel();
  return toPermission(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } }));
}

/**
 * This phone's native token, or null when there is none to register: not
 * allowed, no Firebase file in this Android build, a simulator without push.
 * Never throws: a phone that can't register just gets no pushes.
 */
export async function deviceToken(): Promise<Device | null> {
  try {
    if ((await permission()) !== 'granted') return null;
    const { data } = await Notifications.getDevicePushTokenAsync();
    if (typeof data !== 'string' || data.length === 0) return null;
    if (Platform.OS === 'ios') {
      return {
        token: data,
        platform: 'ios',
        // A dev build is signed for Apple's sandbox gateway; beta and the store app for production.
        apnsEnvironment: appEnv === 'dev' ? 'sandbox' : 'production',
        bundleId: Constants.expoConfig?.ios?.bundleIdentifier ?? '',
      };
    }
    return { token: data, platform: 'android', apnsEnvironment: null, bundleId: Constants.expoConfig?.android?.package ?? '' };
  } catch {
    return null;
  }
}

function asPushData(raw: Record<string, unknown>): PushData | null {
  const { kind, orgId, route } = raw;
  if (kind !== 'reply' && kind !== 'daily') return null;
  // Only a path inside the app: a push never opens anything else.
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return null;
  return typeof orgId === 'string' && orgId ? { kind, orgId, route } : { kind, route };
}

/**
 * Our keys out of a received push, or null when it isn't one of ours. On an
 * iPhone, expo-notifications fills `content.data` only from a `body` key that
 * Expo's push service writes; a push sent straight to APNs keeps its keys
 * beside `aps`, which it hands over as the trigger's payload. On Android they
 * are the FCM message's data, in `content.data`.
 */
export function pushDataOf(request: Notifications.NotificationRequest): PushData | null {
  const trigger = request.trigger;
  if (trigger && 'type' in trigger && trigger.type === 'push' && trigger.payload) {
    const { aps: _aps, ...keys } = trigger.payload;
    return asPushData(keys);
  }
  return asPushData((request.content.data as Record<string, unknown> | null) ?? {});
}

// A tap can reach us twice: as the last response (the one that started the
// app) and through the listener. One delivery is one tap.
let lastTap: string | null = null;

function deliver(response: Notifications.NotificationResponse, cb: (data: PushData) => void): void {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const key = `${response.notification.request.identifier}@${response.notification.date}`;
  if (key === lastTap) return;
  lastTap = key;
  // Handled: a later remount mustn't open it again.
  Notifications.clearLastNotificationResponse();
  const data = pushDataOf(response.notification.request);
  if (data) cb(data);
}

/** Calls `cb` for each tap on one of our pushes, the one that started the app included; returns how to stop. */
export function onTap(cb: (data: PushData) => void): () => void {
  const launch = Notifications.getLastNotificationResponse();
  if (launch) deliver(launch, cb);
  const sub = Notifications.addNotificationResponseReceivedListener((r) => deliver(r, cb));
  return () => sub.remove();
}

/** While the app is open, a push for which `hide` says true isn't shown; any other is. */
export function setForegroundFilter(hide: (data: PushData) => boolean): void {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const data = pushDataOf(n.request);
      const show = !(data && hide(data));
      // On Android a silent one doesn't drop down, so a shown push keeps its sound.
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    },
  });
}
