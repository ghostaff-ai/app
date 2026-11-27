import { render, screen } from '@testing-library/react-native';
import { Wallpaper } from '@/components/chat/Wallpaper';

describe('Wallpaper', () => {
  it('fills the chat behind everything and takes no touches', async () => {
    await render(<Wallpaper />);
    expect(screen.getByTestId('chat-wallpaper').props.pointerEvents).toBe('none');
  });

  it('sizes the svg to the full area, not the 300x150 default', async () => {
    await render(<Wallpaper />);
    const svg = screen.getByTestId('chat-wallpaper');
    expect(svg.props.width).toBe('100%');
    expect(svg.props.height).toBe('100%');
  });
});
