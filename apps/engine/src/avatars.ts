// A person's profile photo (Jaime, 2026-11-26): one per person, in the private
// bucket `avatars` at <user>/<random>.jpg (supabase/migrations/
// 20261128160000_profile_photos.sql). The app sends it shrunk; the engine
// stores it, points the profile at it and removes the one before.

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Refusal } from './connections';
import { readAtMost } from './transcribe';

export const AVATARS_BUCKET = 'avatars';
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export interface AvatarStore {
  put(path: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Points the profile at `path` (null: none); returns the path it had. */
  setPath(userId: string, path: string | null): Promise<string | null>;
}

/** Stores the person's new photo and returns its path; the old one goes. */
export async function setAvatar(
  store: AvatarStore | undefined,
  userId: string,
  file: { contentType: string | undefined; contentLength: string | undefined; body: ReadableStream<Uint8Array> | null },
): Promise<{ avatarPath: string }> {
  if (!store) throw new Refusal(503, 'avatars_off', 'photos are not configured on this engine');
  const mediaType = (file.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const ext = TYPES[mediaType];
  if (!ext) throw new Refusal(415, 'unsupported', 'a photo must be JPEG, PNG or WebP');
  if (Number(file.contentLength) > MAX_BYTES) throw new Refusal(413, 'too_large', 'photo over 5 MB');
  const bytes = await readAtMost(file.body, MAX_BYTES, () => new Refusal(413, 'too_large', 'photo over 5 MB'));
  if (bytes.byteLength === 0) throw new Refusal(400, 'bad_request', 'no photo');
  const path = `${userId}/${randomUUID()}.${ext}`;
  await store.put(path, bytes, mediaType);
  const before = await store.setPath(userId, path).catch(async (e) => {
    await store.remove(path).catch(() => {});
    throw e;
  });
  if (before && before !== path) await store.remove(before).catch(() => {});
  return { avatarPath: path };
}

/** Takes the person's photo away: their initials again. */
export async function removeAvatar(store: AvatarStore | undefined, userId: string): Promise<{ avatarPath: null }> {
  if (!store) throw new Refusal(503, 'avatars_off', 'photos are not configured on this engine');
  const before = await store.setPath(userId, null);
  if (before) await store.remove(before).catch(() => {});
  return { avatarPath: null };
}

export function supabaseAvatarStore(admin: SupabaseClient): AvatarStore {
  const bucket = () => admin.storage.from(AVATARS_BUCKET);
  return {
    async put(path, bytes, mediaType) {
      const { error } = await bucket().upload(path, bytes, { contentType: mediaType, upsert: false });
      if (error) throw error;
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw error;
    },
    async setPath(userId, path) {
      const { data: had, error: readError } = await admin.from('profiles').select('avatar_path').eq('user_id', userId).maybeSingle();
      if (readError) throw readError;
      if (!had) throw new Refusal(409, 'no_profile', 'profile first');
      const { error } = await admin.from('profiles').update({ avatar_path: path }).eq('user_id', userId);
      if (error) throw error;
      return (had.avatar_path as string | null) ?? null;
    },
  };
}
