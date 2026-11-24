import type { GuidePhoto } from '@ghostaff/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

// A photo of the person's screen for a guide (docs/plans/ready/guided-access.md):
// from the camera or the library on the phone, a file or a paste on the web. It
// is shrunk to 1,568 px on its long side (what the model reads best) and sent
// as JPEG at 0.7, well under the engine's 2 MB. The device keeps it to draw the
// model's mark on it; the engine never keeps it.

export const LONG_SIDE = 1568;
export const JPEG_QUALITY = 0.7;

/** A photo this device sent, to draw the mark on. */
export type Shot = { uri: string; width: number; height: number };

/** A photo ready to send: what the screen draws, and what the model reads. */
export type ReadyShot = Shot & { photo: GuidePhoto };

/** What picking one came to: a photo, a refused permission, or nothing (they closed the picker). */
export type Picked = { shot: ReadyShot } | { denied: true } | null;

/** Shrinks any image the device can read (a file, a blob or a data URL) to what the guide sends. */
export async function readyShot(uri: string): Promise<ReadyShot> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const { width, height } = original;
  const image =
    Math.max(width, height) > LONG_SIDE
      ? await ImageManipulator.manipulate(original)
          .resize(width >= height ? { width: LONG_SIDE } : { height: LONG_SIDE })
          .renderAsync()
      : original;
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
  if (!saved.base64) throw new Error('the photo came back without its data');
  return { uri: saved.uri, width: saved.width, height: saved.height, photo: { mediaType: 'image/jpeg', data: saved.base64 } };
}

/** Opens the camera or the library and returns the photo, shrunk. */
export async function pickShot(source: 'camera' | 'library'): Promise<Picked> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { denied: true };
  }
  // The library needs no permission: the system's picker hands over only what the person picks.
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  return { shot: await readyShot(asset.uri) };
}
