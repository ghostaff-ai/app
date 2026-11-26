import { removeMyAvatar, setMyAvatar } from '@ghostaff/shared/services';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { EngineAccess } from '@ghostaff/shared/services';

// Your profile photo (Jaime, 2026-11-26): picked from the library or taken with
// the camera, cut square, shrunk to 512 px and sent as JPEG.

export const PHOTO_SIDE = 512;

/** Picks, shrinks and sends a new photo; null when the person closed the picker; 'denied' without the camera. */
export async function changeMyPhoto(engine: EngineAccess, source: 'library' | 'camera'): Promise<string | null | 'denied'> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: true, aspect: [1, 1] };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  const side = Math.min(asset.width || PHOTO_SIDE, asset.height || PHOTO_SIDE);
  const square = await ImageManipulator.manipulate(asset.uri)
    .crop({ originX: Math.max(0, ((asset.width || side) - side) / 2), originY: Math.max(0, ((asset.height || side) - side) / 2), width: side, height: side })
    .resize({ width: PHOTO_SIDE, height: PHOTO_SIDE })
    .renderAsync();
  const saved = await square.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const blob = await (await fetch(saved.uri)).blob();
  return setMyAvatar(engine, blob.type ? blob : new Blob([blob], { type: 'image/jpeg' }));
}

export async function removeMyPhoto(engine: EngineAccess): Promise<void> {
  await removeMyAvatar(engine);
}
