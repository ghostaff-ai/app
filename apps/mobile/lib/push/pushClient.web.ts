import type { PushData } from '@ghostaff/shared';
import type { Device, Permission } from './pushClient';

// The web gets no pushes (decision-notifications.md): everything answers
// «unsupported», so the provider never registers and the chat never asks.

export type { Device, Permission };

export async function permission(): Promise<Permission> {
  return 'unsupported';
}

export async function requestPermission(): Promise<Permission> {
  return 'unsupported';
}

export async function deviceToken(): Promise<Device | null> {
  return null;
}

export function pushDataOf(): PushData | null {
  return null;
}

export function onTap(_cb: (data: PushData) => void): () => void {
  return () => {};
}

export function setForegroundFilter(_hide: (data: PushData) => boolean): void {}
