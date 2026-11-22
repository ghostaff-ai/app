import { render, screen, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { Markdown } from '@/components/chat/Markdown';

/** Every string rendered, joined, to assert on what a person would read. */
function allText(): string {
  return JSON.stringify(screen.toJSON());
}

describe('Markdown', () => {
  it('renders bold text without its asterisks', async () => {
    await render(<Markdown text="**Vuelve** ahora" names={[]} />);
    expect(screen.getByText('Vuelve')).toBeTruthy();
    expect(allText()).not.toContain('**');
  });

  it('renders list items without the dash marker', async () => {
    await render(<Markdown text={'- uno\n- dos'} names={[]} />);
    expect(screen.getByText('uno')).toBeTruthy();
    expect(screen.getByText('dos')).toBeTruthy();
    expect(screen.getAllByText('•')).toHaveLength(2);
    expect(allText()).not.toContain('- ');
  });

  it('keeps the numbers of an ordered list', async () => {
    await render(<Markdown text={'1. a\n2. b'} names={[]} />);
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
  });

  it('honours the start of an ordered list', async () => {
    await render(<Markdown text={'3. a\n4. b'} names={[]} />);
    expect(screen.getByText('3.')).toBeTruthy();
    expect(screen.getByText('4.')).toBeTruthy();
  });

  it('renders a nested list one level down', async () => {
    await render(<Markdown text={'- a\n  - b\n- c'} names={[]} />);
    expect(screen.getAllByText('•')).toHaveLength(3);
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('draws task list items with a box marker and no bracket text', async () => {
    await render(<Markdown text={'- [ ] uno\n- [x] dos'} names={[]} />);
    expect(screen.getByText('uno')).toBeTruthy();
    expect(screen.getByText('dos')).toBeTruthy();
    expect(screen.getByText('☐')).toBeTruthy();
    expect(screen.getByText('☑')).toBeTruthy();
    expect(allText()).not.toMatch(/\[ \]|\[x\]/);
  });

  it('draws loose task list items (blank line between) the same way', async () => {
    await render(<Markdown text={'- [ ] uno\n\n- [x] dos'} names={[]} />);
    expect(screen.getByText('uno')).toBeTruthy();
    expect(screen.getByText('dos')).toBeTruthy();
    expect(screen.getByText('☐')).toBeTruthy();
    expect(screen.getByText('☑')).toBeTruthy();
    expect(allText()).not.toMatch(/\[ \]|\[x\]/);
  });

  it('shows wide list numbers', async () => {
    await render(<Markdown text={'100. a\n101. b'} names={[]} />);
    expect(screen.getByText('100.')).toBeTruthy();
    expect(screen.getByText('101.')).toBeTruthy();
  });

  it('hides reference definitions', async () => {
    await render(<Markdown text={'hola [r]\n\n[r]: https://x.y'} names={[]} />);
    expect(allText()).toContain('hola');
    expect(allText()).not.toContain('https://x.y');
  });

  it('opens a link with Linking', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue();
    await render(<Markdown text="[web](https://ghostaff.ai)" names={[]} />);
    await fireEvent.press(screen.getByText('web'));
    expect(open).toHaveBeenCalledWith('https://ghostaff.ai');
    open.mockRestore();
  });

  it('renders a link with a blocked scheme as plain text', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue();
    await render(<Markdown text="[x](javascript:alert(1))" names={[]} />);
    const node = screen.getByText('x');
    expect(node.props.accessibilityRole).toBeUndefined();
    expect(node.props.onPress).toBeUndefined();
    expect(screen.queryByRole('link')).toBeNull();
    await fireEvent.press(node);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('opens mailto links', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue();
    await render(<Markdown text="[mail](mailto:a@b.co)" names={[]} />);
    await fireEvent.press(screen.getByText('mail'));
    expect(open).toHaveBeenCalledWith('mailto:a@b.co');
    open.mockRestore();
  });

  it('swallows a failed open instead of leaving an unhandled rejection', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await render(<Markdown text="[web](https://ghostaff.ai)" names={[]} />);
    await fireEvent.press(screen.getByText('web'));
    await new Promise((r) => setTimeout(r, 0));
    expect(open).toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
    open.mockRestore();
  });

  it('marks headings as headers', async () => {
    await render(<Markdown text="## Título" names={[]} />);
    expect(screen.getByRole('header')).toBeTruthy();
  });

  it('bolds @mentions', async () => {
    await render(<Markdown text="hola @Redes" names={['Redes']} />);
    const node = screen.getByText('@Redes');
    expect(JSON.stringify(node.props.className ?? node.props.style)).toMatch(/semibold|600|bold/);
  });

  it('survives an unclosed marker from a reply still streaming', async () => {
    await render(<Markdown text="**hola" names={[]} />);
    expect(allText()).toContain('hola');
  });

  it('renders nothing for empty text', async () => {
    await render(<Markdown text="" names={[]} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('keeps the text of a table', async () => {
    await render(<Markdown text={'| a | b |\n|---|---|\n| 1 | 2 |'} names={[]} />);
    expect(allText()).toContain('1');
    expect(allText()).toContain('b');
  });

  it('renders headings, quotes, code and rules without leaking markers', async () => {
    await render(<Markdown text={'# Título\n\n> cita\n\n```\ncodigo\n```\n\n---\n\n`x` y _énfasis_'} names={[]} />);
    expect(screen.getByText('Título')).toBeTruthy();
    expect(screen.getByText('cita')).toBeTruthy();
    expect(allText()).not.toMatch(/[#>`_]/);
  });
});
