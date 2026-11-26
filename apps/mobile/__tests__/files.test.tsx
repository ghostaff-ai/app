import { fireEvent, render, screen } from '@testing-library/react-native';
import { Composer } from '@/components/chat/Composer';
import { FileBubble } from '@/components/chat/FileBubble';
import { extensionOf, sizeLabel } from '@/lib/attach';

// Files in the chat (chat-like-whatsapp.md, phase 3).

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@ghostaff/shared/services', () => ({ fileUrl: jest.fn(async () => 'https://storage.test/x') }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  IOSOutputFormat: { MPEG4AAC: 'aac ' },
  AudioQuality: { MEDIUM: 64 },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

describe('a file in the chat', () => {
  it('names its size and kind as a person reads them', () => {
    expect(sizeLabel(2400)).toBe('2 kB');
    expect(sizeLabel(3_250_000)).toBe('3,1 MB');
    expect(extensionOf('presupuesto feria.pdf')).toBe('PDF');
    expect(extensionOf('sin-extension')).toBe('ARCHIVO');
  });

  it('draws a document as a card that opens it', async () => {
    await render(<FileBubble part={{ type: 'document', path: 'o/t/m/presupuesto.pdf', mediaType: 'application/pdf', name: 'presupuesto.pdf', size: 240_000 }} mine={false} />);
    expect(screen.getByText('presupuesto.pdf')).toBeTruthy();
    expect(screen.getByText('PDF · 234 kB')).toBeTruthy();
    expect(screen.getByLabelText('Abrir presupuesto.pdf, 234 kB')).toBeTruthy();
  });

  it('draws a photo that opens full screen', async () => {
    await render(<FileBubble part={{ type: 'document', path: 'o/t/m/foto.jpg', mediaType: 'image/jpeg', name: 'foto.jpg', size: 90_000, width: 2048, height: 1536 }} mine />);
    expect(screen.getByLabelText('Foto foto.jpg, ver en grande')).toBeTruthy();
  });

  it('the clip offers a document, photos or the camera; the camera is one tap away too', async () => {
    const onAttach = jest.fn();
    await render(<Composer placeholder="Mensaje" names={[]} onSend={jest.fn()} onAttach={onAttach} />);
    await fireEvent.press(screen.getByLabelText('Hacer una foto'));
    expect(onAttach).toHaveBeenLastCalledWith('camera');
    await fireEvent.press(screen.getByLabelText('Adjuntar'));
    await fireEvent.press(screen.getByLabelText('Documento'));
    expect(onAttach).toHaveBeenLastCalledWith('document');
    await fireEvent.press(screen.getByLabelText('Adjuntar'));
    await fireEvent.press(screen.getByLabelText('Fotos'));
    expect(onAttach).toHaveBeenLastCalledWith('photos');
  });
});
