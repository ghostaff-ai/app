import { splitMentions } from '@ghostaff/shared';
import { Lexer, type Token, type Tokens } from 'marked';
import { Fragment, type ReactNode, useMemo } from 'react';
import { Linking, Platform, Text, View } from 'react-native';

// An agent's reply, its markdown rendered (team-chat.md, step 5). marked's lexer
// does the parsing; this file draws the tokens as Text and View in NativeWind
// classes. Nothing goes through marked's HTML output. A reply may still be
// streaming, so an unclosed «**» is just text and nothing here throws.

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** Heading text: one step above the body's text-base, whatever the depth. */
const HEADING = 'text-title3 font-semibold';
const BODY = 'text-base leading-6';

type Tone = 'ink' | 'muted';

function toneClass(tone: Tone): string {
  return tone === 'muted' ? 'text-muted' : 'text-ink';
}

/** A plain run of text, with @mentions in bold. */
function Mentions({ text, names }: { text: string; names: string[] }) {
  return (
    <>
      {splitMentions(text, names).map((s, i) =>
        s.mention ? (
          <Text key={i} className="font-semibold">
            {s.text}
          </Text>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}

function Inline({ tokens, names }: { tokens: Token[]; names: string[] }) {
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.type) {
          case 'strong':
            return (
              <Text key={i} className="font-semibold">
                <Inline tokens={(t as Tokens.Strong).tokens} names={names} />
              </Text>
            );
          case 'em':
            return (
              <Text key={i} className="italic">
                <Inline tokens={(t as Tokens.Em).tokens} names={names} />
              </Text>
            );
          case 'del':
            return (
              <Text key={i} style={{ textDecorationLine: 'line-through' }}>
                <Inline tokens={(t as Tokens.Del).tokens} names={names} />
              </Text>
            );
          case 'codespan':
            return (
              <Text key={i} className="rounded bg-sunk" style={{ fontFamily: MONO }}>
                {(t as Tokens.Codespan).text}
              </Text>
            );
          case 'link': {
            const link = t as Tokens.Link;
            return (
              <Text
                key={i}
                className="text-accent underline"
                accessibilityRole="link"
                onPress={() => void Linking.openURL(link.href)}
              >
                <Inline tokens={link.tokens} names={names} />
              </Text>
            );
          }
          case 'br':
            return <Fragment key={i}>{'\n'}</Fragment>;
          case 'escape':
          case 'text': {
            const leaf = t as Tokens.Text | Tokens.Escape;
            // A text token may hold inline children (inside a list item); a leaf is plain.
            return 'tokens' in leaf && leaf.tokens ? (
              <Inline key={i} tokens={leaf.tokens} names={names} />
            ) : (
              <Mentions key={i} text={leaf.text} names={names} />
            );
          }
          default:
            // image, html, anything unknown: its source text, so nothing is lost.
            return <Mentions key={i} text={t.raw} names={names} />;
        }
      })}
    </>
  );
}

function Paragraph({ tokens, names, tone, className = BODY }: { tokens: Token[]; names: string[]; tone: Tone; className?: string }) {
  return (
    <Text className={`${className} ${toneClass(tone)}`} selectable>
      <Inline tokens={tokens} names={names} />
    </Text>
  );
}

function List({ list, names, tone }: { list: Tokens.List; names: string[]; tone: Tone }) {
  const start = typeof list.start === 'number' ? list.start : 1;
  return (
    <View>
      {list.items.map((item, i) => (
        <View key={i} className={`flex-row ${i > 0 ? 'mt-1' : ''}`}>
          <Text className={`w-6 ${BODY} ${toneClass(tone)}`}>{list.ordered ? `${start + i}.` : '•'}</Text>
          <View className="flex-1">
            <Blocks tokens={item.tokens} names={names} tone={tone} tight />
          </View>
        </View>
      ))}
    </View>
  );
}

function Blocks({ tokens, names, tone, tight = false }: { tokens: Token[]; names: string[]; tone: Tone; tight?: boolean }) {
  // `space` tokens only separate blocks; the gap between blocks is drawn below.
  const blocks = tokens.filter((t) => t.type !== 'space');
  return (
    <>
      {blocks.map((t, i) => (
        <View key={i} className={i > 0 ? (tight ? 'mt-1' : 'mt-3') : ''}>
          <Block token={t} names={names} tone={tone} />
        </View>
      ))}
    </>
  );
}

function Block({ token: t, names, tone }: { token: Token; names: string[]; tone: Tone }) {
  switch (t.type) {
    case 'paragraph':
    case 'text': {
      const p = t as Tokens.Paragraph | Tokens.Text;
      return <Paragraph tokens={p.tokens ?? [{ type: 'text', raw: p.raw, text: p.text }]} names={names} tone={tone} />;
    }
    case 'heading': {
      const h = t as Tokens.Heading;
      return <Paragraph tokens={h.tokens} names={names} tone={tone} className={HEADING} />;
    }
    case 'list':
      return <List list={t as Tokens.List} names={names} tone={tone} />;
    case 'blockquote':
      return (
        <View className="border-l-2 border-line pl-3">
          <Blocks tokens={(t as Tokens.Blockquote).tokens} names={names} tone="muted" />
        </View>
      );
    case 'code':
      return (
        <View className="rounded-lg bg-sunk p-3">
          <Text className="text-footnote text-ink" style={{ fontFamily: MONO }} selectable>
            {(t as Tokens.Code).text}
          </Text>
        </View>
      );
    case 'hr':
      return <View className="h-px bg-line" />;
    default:
      // table, html, unknown: its raw text as a paragraph, so nothing is lost.
      return <Paragraph tokens={[{ type: 'text', raw: t.raw, text: t.raw.trim() }]} names={names} tone={tone} />;
  }
}

/** An agent's markdown reply in ink. `names` are the @mentionable names, to bold. */
export function Markdown({ text, names }: { text: string; names: string[] }): ReactNode {
  const tokens = useMemo(() => (text.trim() ? new Lexer().lex(text) : []), [text]);
  if (tokens.every((t) => t.type === 'space')) return null;
  return (
    <View>
      <Blocks tokens={tokens} names={names} tone="ink" />
    </View>
  );
}
