# The chat's look: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** General and every agent chat look like the approved mockup: lavender bubbles for you, white ones without a border for everyone else, real tails, a ghost wallpaper, violet voice notes, big emoji, a group face in General's header.

**Architecture:** Chat colours become tokens in `apps/mobile/lib/palette.ts` (light and dark), read through Tailwind classes like every other colour; the components under `components/chat/` stop using `accent`/`on-accent` for your bubble. The wallpaper and the tail are `react-native-svg` drawings (already a dependency, ships over the air).

**Tech Stack:** Expo + expo-router + NativeWind, react-native-svg 15, Jest + @testing-library/react-native.

**Spec:** [chat-look.md](chat-look.md). Mockup: `ghostaff/capturas/propuesta-chat-2026-11-27.html`.

## Global Constraints

- Work in a worktree off `origin/develop` (AGENTS.md, Branches); one pull request, landed with `pnpm pr:land`.
- No new dependency and no native module: it ships over the air.
- `accent` / `on-accent` keep meaning primary buttons everywhere else (Aprobar, GuideCard, AccountAskCard, Markdown links stay as they are).
- Green only for earned autonomy, orange only for «te espera», red only for errors (app-design decision 21).
- Code and comments in English, everything a person sees in Spanish.
- `pnpm check` green before landing.

## Review Focus

1. Holding or swiping a big-emoji message still opens the menu and replies (Task 3 test).
2. `👍🏽`, `👨‍👩‍👧`, `❤️` count as emoji; `123`, `#`, `😀 hola`, four emoji or more do not (Task 3 test).
3. Your bubble with a quote, a forwarded message, a file, a link card or «Eliminaste este mensaje» reads on lavender in light and dark: nothing left in `on-accent` (Task 2 test).
4. The wallpaper stays still while the list scrolls and when the keyboard opens; it never takes touches (Task 5 test: `pointerEvents="none"`).
5. A General with only you and no agents says «Tú», not «Tú y 0 agentes» (Task 6 test).

---

### Task 1: Chat tokens in the palette

**Files:**
- Modify: `apps/mobile/lib/palette.ts`
- Test: `apps/mobile/__tests__/palette.test.ts`

**Interfaces:**
- Produces: `Palette` gains `chat`, `chatPattern`, `mine`, `mineMuted`, `mineSunk`, `theirs`, `chatAccent`, `onChatAccent`, `read`, `chip`, hence the classes `bg-chat`, `bg-mine`, `text-mine-muted`, `bg-mine-sunk`, `bg-theirs`, `bg-chat-accent`, `text-chat-accent`, `bg-chip`, and `usePalette().read` etc.

- [ ] **Step 1: Write the failing test** in `palette.test.ts`:

```ts
it('has the chat colours of chat-look.md', () => {
  expect(COLOR_NAMES).toEqual(expect.arrayContaining(['chat', 'chat-pattern', 'mine', 'mine-muted', 'mine-sunk', 'theirs', 'chat-accent', 'on-chat-accent', 'read', 'chip']));
  expect(LIGHT.mine).toBe('#E4DFFB');
  expect(DARK.mine).toBe('#352F63');
  expect(LIGHT.chatAccent).toBe('#4B3FC7');
  expect(DARK.chatAccent).toBe('#8F84FF');
});
```

- [ ] **Step 2:** `pnpm --filter ghostaff-mobile test palette` → FAIL.
- [ ] **Step 3: Add the tokens**, with a one-line comment each, values from the spec:

| token | light | dark |
|---|---|---|
| chat | `#ECEAF3` | `#0E0F16` |
| chatPattern | `#D6D2E6` | `#1C1E29` |
| mine | `#E4DFFB` | `#352F63` |
| mineMuted | `#6B6390` | `#A9A3D6` |
| mineSunk (a quote inside your bubble) | `#D6CFF6` | `#2A2550` |
| theirs | `#FFFFFF` | `#1C1E29` |
| chatAccent | `#4B3FC7` | `#8F84FF` |
| onChatAccent | `#FFFFFF` | `#16151E` |
| read | `#3D7BF0` | `#6AA8FF` |
| chip (day pill, unread divider) | `rgba(255,255,255,0.78)` | `rgba(28,30,41,0.85)` |

Your bubble's text is `ink` in both themes (`#16151E` / `#ECEDF3`), so it needs no token.

- [ ] **Step 4:** test → PASS; `pnpm --filter ghostaff-mobile typecheck` → clean.
- [ ] **Step 5:** commit `feat(app): the chat's colours in the palette`.

### Task 2: Bubbles: lavender, no border, a shadow, a real tail

**Files:**
- Modify: `apps/mobile/components/chat/Bubble.tsx`, `Message.tsx` (QuoteBlock, quoteBlocks, the deleted message, `textTone`), `FileBubble.tsx`, `LinkCard.tsx`, `DecisionInChat.tsx` (`DecisionQuote`)
- Test: `apps/mobile/__tests__/Bubble.test.tsx` (new)

**Interfaces:**
- Consumes: Task 1's tokens.
- Produces: `Bubble`'s `stamp` becomes optional (`stamp?: ReactNode`; nothing drawn when absent), used by Task 4. `DecisionQuote`'s and `QuoteBlock`'s prop `onAccent` is renamed `mine`.

- [ ] **Step 1: Write the failing tests** (`MessageView` with `DecisionInChat` mocked as in `VoiceNote.test.tsx`):
  - `it('draws your bubble in lavender with ink text')`: a person's text «Hola» with `mine`: the bubble's Pressable className contains `bg-mine` and not `bg-accent`; the text's className contains `text-ink`.
  - `it('draws theirs white without a border')`: className contains `bg-theirs`, not `border`.
  - `it('draws the tail on the first of a run only')`: `testID="bubble-tail"` present with `showAuthor`, absent without.
  - `it('leaves nothing in on-accent inside your bubble')`: your message with a quote part, a forward part, a document part and a link; no className contains `on-accent` and no `style.color` equals `LIGHT.onAccent`. Same for a deleted message of yours.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
  - `Bubble`: mine `bg-mine`, theirs `bg-theirs` (no `border`), radius 18 (`rounded-[18px]`, the tail corner 4 px). Shadow on iOS and web only (`Platform.select`): colour `#16151E`, opacity 0.14 light / black 0.5 dark, offset `{0,1}`, radius 0.6; none on Android (elevation draws badly under the tail).
  - The tail: an `Svg` 9×12, `testID="bubble-tail"`, absolutely placed at the top outside the sharp corner (mine `right: -7`, theirs `left: -7`), filled with `mine`/`theirs`. Paths from the mockup: mine `M0 0 H9 C6 1.5 2.5 6 0 12 Z`, theirs `M9 0 H0 C3 1.5 6.5 6 9 12 Z`.
  - `Stamp`: on yours `text-mine-muted` (no opacity), read ticks in `read`, sent tick in `mineMuted`.
  - Inside your bubble every `on-accent` becomes `text-ink` (main text) or `text-mine-muted` (secondary lines, icons); QuoteBlock's background on yours is `mineSunk`, its name in the author's colour as on theirs; `DecisionQuote`'s border `border-mine-muted`. `FileBubble`'s spinner `mineMuted`.
- [ ] **Step 4:** run → PASS; the existing `VoiceNote`, `files`, `messageActions`, `DecisionInChat` tests still pass.
- [ ] **Step 5:** commit `feat(app): lavender bubbles with a real tail`.

### Task 3: A message of only emoji, big and without a bubble

**Files:**
- Modify: `apps/mobile/lib/chat.ts`, `apps/mobile/components/chat/Message.tsx`
- Test: `apps/mobile/__tests__/chat.test.ts`, `apps/mobile/__tests__/Bubble.test.tsx`

**Interfaces:**
- Produces: `emojiOnly(text: string): boolean` in `lib/chat.ts`: true for 1–3 emoji and only whitespace besides.

- [ ] **Step 1: Write the failing tests.**

```ts
describe('emojiOnly', () => {
  it.each(['😆😁', '🫢', '👍🏽', '👨‍👩‍👧', '❤️', ' 🎉 '])('%s is only emoji', (t) => expect(emojiOnly(t)).toBe(true));
  it.each(['', '123', '#', '😀 hola', '😀😀😀😀', 'ok'])('%s is not', (t) => expect(emojiOnly(t)).toBe(false));
});
```

And in `Bubble.test.tsx`: `it('draws a message of only emoji big, without a bubble, and holding it opens the menu')`: «😆😁» from you renders `testID="emoji-message"`, no `bg-mine`, font size ≥ 40; `fireEvent(…, 'longPress')` calls `onMenu`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `emojiOnly`: split with `Intl.Segmenter` when present, else a grapheme regex; each segment must match `/^\p{Extended_Pictographic}/u` (or be a flag pair); count 1–3. In `MessageView`, a person's message with no voice, file, quote, forward or link and `emojiOnly(text)` renders the emoji at 40 px, line height 46, with the stamp beside it in a `bg-chip` pill (`rounded-[9px] px-[7px] py-[2px]`), keeping `SwipeToReply`, `onLongPress` and the reaction chips.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(app): a message of only emoji is drawn big`.

### Task 4: Voice notes in violet, time on the length's line

**Files:**
- Modify: `apps/mobile/components/chat/AudioClip.tsx`, `VoiceNote.tsx`, `AgentAudio.tsx` (tone only), `Message.tsx` (voice branch)
- Test: `apps/mobile/__tests__/VoiceNote.test.tsx`

**Interfaces:**
- Consumes: `Bubble` without `stamp` (Task 2).
- Produces: `AudioTone` becomes `'mine' | 'card'`; `AudioClip` and `VoiceNote` take `stamp?: ReactNode`, drawn at the right end of the length row.

- [ ] **Step 1: Write the failing tests** in `VoiceNote.test.tsx`:
  - `it('puts the time on the same line as the length')`: `MessageView` of your voice note: the stamp's time («10:42» from `createdAt`) and the length («1:24») are children of the same row (`testID="voice-meta"`).
  - `it('draws a round violet play button')`: the play Pressable has className `bg-chat-accent` and `rounded-full`.
  - `it('marks an unplayed note in violet, not green')`: `voice-unplayed` has `bg-chat-accent`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Play: 34 px round `bg-chat-accent`, icon 15 px `onChatAccent`. Bars: unplayed `chatAccent` at opacity 0.35, played `chatAccent` at 1 (both tones). Length text `text-mine-muted` on yours, `text-muted` on theirs; the speed pill tinted `chatAccent`. «Transcripción» and «Reintentar» `text-chat-accent font-semibold`; your transcript text `text-ink`. In `MessageView`'s voice branch the stamp goes to `VoiceNote` and `Bubble` gets none.
- [ ] **Step 4:** run → PASS (the existing voice tests too).
- [ ] **Step 5:** commit `feat(app): voice notes in violet with the time beside the length`.

### Task 5: The wallpaper, the day pill and the floating composer

**Files:**
- Create: `apps/mobile/components/chat/Wallpaper.tsx`
- Modify: `apps/mobile/app/(app)/general.tsx`, `apps/mobile/app/(app)/chat/[agent].tsx` (root view), `components/chat/ChatList.tsx` (day pill, unread divider), `components/chat/Composer.tsx` (container, mic, send, locked-send buttons)
- Test: `apps/mobile/__tests__/Wallpaper.test.tsx` (new), `apps/mobile/__tests__/Composer.test.tsx`

**Interfaces:**
- Consumes: Task 1's `chat`, `chatPattern`, `chip`, `chatAccent`, `onChatAccent`.
- Produces: `export function Wallpaper(): JSX.Element`: an absolute-fill `Svg`, `pointerEvents="none"`, `testID="chat-wallpaper"`.

- [ ] **Step 1: Write the failing tests.**
  - `Wallpaper.test.tsx`: `it('fills the chat behind everything and takes no touches')`: renders `chat-wallpaper` with `pointerEvents` `'none'`.
  - `Composer.test.tsx`: `it('draws the mic in the chat violet')`: the mic Pressable className contains `bg-chat-accent`, not `bg-accent`; the container has no `border-t`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `Wallpaper`: `Rect` filled `chat` under a `Pattern` 150×150 (`patternUnits="userSpaceOnUse"`) stroked `chatPattern`, width 1.6, round caps; the tile's shapes are the mockup's SVG (two ghost outlines with eyes, two sparkles, a ring, a smile, a plus), copied from `propuesta-chat-2026-11-27.html`'s `--pattern`. Both chat screens: root `bg-chat` and `<Wallpaper />` as its first child, outside the `KeyboardColumn` so it stays still. ChatList: day pill `bg-chip`, no border, `font-semibold`; the unread divider `bg-chip`. Composer: container without `border-t border-line bg-surface` (transparent); the input `bg-theirs` without border; mic, send and locked-send `bg-chat-accent` with `onChatAccent` icons and spinners.
- [ ] **Step 4:** run → PASS; `Composer` tests still green.
- [ ] **Step 5:** commit `feat(app): a ghost wallpaper behind the chat, the composer floats on it`.

### Task 6: General's header: the group's face and who is in it

**Files:**
- Create: `apps/mobile/components/chat/GroupFace.tsx`
- Modify: `apps/mobile/lib/chat.ts`, `apps/mobile/app/(app)/general.tsx` (`people`, `headerTitle`, typing colour)
- Test: `apps/mobile/__tests__/chat.test.ts`

**Interfaces:**
- Produces: `groupSubtitle(others: string[], agents: number): string` in `lib/chat.ts`; `GroupFace({ person, ghost }: { person: { name: string; id: string } | null; ghost: GhostId })`.

- [ ] **Step 1: Write the failing tests.**

```ts
describe('groupSubtitle', () => {
  it('names the others, then you, then the agents', () => expect(groupSubtitle(['Álvaro'], 3)).toBe('Álvaro, tú y 3 agentes'));
  it('one agent', () => expect(groupSubtitle(['Álvaro', 'Marta'], 1)).toBe('Álvaro, Marta, tú y 1 agente'));
  it('no agents', () => expect(groupSubtitle(['Álvaro'], 0)).toBe('Álvaro y tú'));
  it('only you', () => expect(groupSubtitle([], 0)).toBe('Tú'));
  it('only you and agents', () => expect(groupSubtitle([], 2)).toBe('Tú y 2 agentes'));
  it('keeps two people with the same name', () => expect(groupSubtitle(['Álvaro', 'Álvaro'], 0)).toBe('Álvaro, Álvaro y tú'));
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `groupSubtitle` per the tests. `GroupFace`: 38 px box; the first other member's `Avatar` (27 px, top-left, 2 px ring in `chat`) overlapping the main agent's ghost (26 px circle, bottom-right, ground `#2A2550`); with nobody else, the ghost alone at 32 px. In `general.tsx`: `people = groupSubtitle(others' displayNames in member order, talkable.length)`, the black `UsersThree` circle replaced by `GroupFace` (the main agent from `agents.find(isMainAgent)`), the typing line `text-chat-accent` instead of `text-ok`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(app): general's header with the group's face`.

### Task 7: See it, then land it

- [ ] **Step 1:** `pnpm check` from the repo root → green.
- [ ] **Step 2:** `pnpm app:web` from the worktree; open General and an agent chat in light and dark at 390×844; compare with the mockup PNG: lavender bubbles, tails, wallpaper still under scroll, big emoji, voice note row, header face. Screenshot both themes for the PR.
- [ ] **Step 3:** `pnpm pr:land` until it exits 0 (AGENTS.md); the PR body links chat-look.md and carries the screenshots.
- [ ] **Step 4:** move `chat-look.md`'s **Gate**/**Next** to «in develop; try it on a phone in the next beta» and commit to `develop`.
