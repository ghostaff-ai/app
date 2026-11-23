import { fireEvent, render, screen } from '@testing-library/react-native';
import { Audience } from '@/components/chat/Audience';
import { VisibilityPicker } from '@/components/chat/VisibilityPicker';

describe('VisibilityPicker', () => {
  it('offers the three choices, says what each means and reports the one tapped', async () => {
    const onChange = jest.fn();
    await render(<VisibilityPicker value="private" agentName="Finanzas" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: /^Solo yo/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^El equipo puede leer/ })).not.toBeChecked();
    expect(screen.getByText('La lee quien tiene acceso a Finanzas. Solo tú escribes.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: /^El equipo puede escribir/ }));
    expect(onChange).toHaveBeenCalledWith('write');
  });
});

describe('Audience', () => {
  it('says who sees it and, for the opener, opens the choice', async () => {
    const onPress = jest.fn();
    await render(<Audience visibility="read" agentName="Finanzas" readers={4} onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'La lee el equipo de Finanzas · 4 personas' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('is only a line for everyone else', async () => {
    await render(<Audience visibility="private" agentName="Finanzas" readers={1} />);
    expect(screen.getByText('Solo tú y Finanzas')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
