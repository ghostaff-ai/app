import { render, screen } from '@testing-library/react-native';
import { Wallpaper } from '@/components/chat/Wallpaper';

describe('Wallpaper', () => {
  it('fills the chat behind everything and takes no touches', async () => {
    await render(<Wallpaper />);
    expect(screen.getByTestId('chat-wallpaper').props.pointerEvents).toBe('none');
  });
});
