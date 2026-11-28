import { Linking } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChatError } from '@/components/chat/ChatError';
import { CAMERA_DENIED } from '@/lib/hooks/useMessageActions';

describe('ChatError', () => {
  it('shows nothing without an error', async () => {
    await render(<ChatError text={null} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('offers the settings when the camera was refused', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await render(<ChatError text={CAMERA_DENIED} />);
    await fireEvent.press(screen.getByLabelText('Abrir ajustes'));
    expect(openSettings).toHaveBeenCalled();
  });

  it('offers nothing more for any other error', async () => {
    await render(<ChatError text="No se ha podido." />);
    expect(screen.getByText('No se ha podido.')).toBeTruthy();
    expect(screen.queryByLabelText('Abrir ajustes')).toBeNull();
  });
});
