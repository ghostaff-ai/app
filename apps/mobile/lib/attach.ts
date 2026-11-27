import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

// What the clip and the camera hand to a chat, as in WhatsApp (docs/plans/
// ready/chat-like-whatsapp.md, phase 3): photos (several at once) shrunk to
// 2,048 px on their long side as JPEG, so they go fast and an agent can see
// them; documents as they are, up to 25 MB (the engine's limit).

export const PHOTO_LONG_SIDE = 2048;
export const PHOTO_QUALITY = 0.8;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** A file ready to send: its bytes, type, name and, for a photo, its size in pixels. */
export interface ReadyFile {
  data: Blob;
  mediaType: string;
  name: string;
  width?: number;
  height?: number;
}

export type AttachKind = 'photos' | 'camera' | 'document';

/** What picking came to: the files, a refused permission, or nothing (closed). */
export type Attached = { files: ReadyFile[] } | { denied: true } | null;

async function blobOf(uri: string): Promise<Blob> {
  return (await fetch(uri)).blob();
}

/** A photo shrunk and saved as JPEG. */
export async function readyPhoto(uri: string, n: number): Promise<ReadyFile> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const { width, height } = original;
  const image =
    Math.max(width, height) > PHOTO_LONG_SIDE
      ? await ImageManipulator.manipulate(original)
          .resize(width >= height ? { width: PHOTO_LONG_SIDE } : { height: PHOTO_LONG_SIDE })
          .renderAsync()
      : original;
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return { data: await blobOf(saved.uri), mediaType: 'image/jpeg', name: `foto-${stamp}${n ? `-${n + 1}` : ''}.jpg`, width: saved.width, height: saved.height };
}

/** Opens the library (several photos), the camera, or the document picker. */
export async function pickToAttach(kind: AttachKind): Promise<Attached> {
  if (kind === 'document') {
    const res = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return null;
    const mediaType = asset.mimeType || 'application/octet-stream';
    // A photo picked as a file is still a photo: it goes as one.
    if (/^image\/(jpeg|png|webp|heic)$/.test(mediaType)) return { files: [await readyPhoto(asset.uri, 0)] };
    return { files: [{ data: asset.file ?? (await blobOf(asset.uri)), mediaType, name: asset.name }] };
  }
  if (kind === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { denied: true };
  }
  // The library needs no permission: the system's picker hands over only what the person picks.
  const res =
    kind === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true, selectionLimit: 10 });
  if (res.canceled || res.assets.length === 0) return null;
  const files: ReadyFile[] = [];
  for (const [i, a] of res.assets.entries()) files.push(await readyPhoto(a.uri, i));
  return { files };
}

/** «240 kB», «3,1 MB». */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** «PDF», «XLSX»: a file's extension as its card shows it. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && name.length - dot <= 6 ? name.slice(dot + 1).toUpperCase() : 'ARCHIVO';
}
