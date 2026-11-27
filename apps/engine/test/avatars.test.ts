import { describe, expect, it } from 'vitest';
import { type AvatarStore, removeAvatar, setAvatar } from '../src/avatars';

// Profile photos (avatars.ts).

function store() {
  const files = new Map<string, Uint8Array>();
  let path: string | null = 'u1/old.jpg';
  files.set('u1/old.jpg', new Uint8Array([9]));
  const s: AvatarStore = {
    put: async (p, b) => void files.set(p, b),
    remove: async (p) => void files.delete(p),
    setPath: async (_u, p) => {
      const before = path;
      path = p;
      return before;
    },
  };
  return { s, files, path: () => path };
}

const body = (bytes: number[]) => new Response(new Uint8Array(bytes)).body;

describe('a profile photo', () => {
  it('replaces the one before', async () => {
    const { s, files, path } = store();
    const { avatarPath } = await setAvatar(s, 'u1', { contentType: 'image/jpeg', contentLength: '3', body: body([1, 2, 3]) });
    expect(avatarPath).toMatch(/^u1\/[0-9a-f-]{36}\.jpg$/);
    expect(path()).toBe(avatarPath);
    expect([...files.keys()]).toEqual([avatarPath]);
  });

  it('takes only photos, up to 5 MB', async () => {
    const { s } = store();
    await expect(setAvatar(s, 'u1', { contentType: 'application/pdf', contentLength: '3', body: body([1]) })).rejects.toMatchObject({ status: 415 });
    await expect(setAvatar(s, 'u1', { contentType: 'image/png', contentLength: String(6 * 1024 * 1024), body: body([1]) })).rejects.toMatchObject({ status: 413 });
  });

  it('can be taken away', async () => {
    const { s, files, path } = store();
    await removeAvatar(s, 'u1');
    expect(path()).toBeNull();
    expect(files.size).toBe(0);
  });
});
