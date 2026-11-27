# The chat's look: lavender, a wallpaper, real tails

**Priority:** high — next to WhatsApp and Telegram our chat still looks worse, and people compare
**Gate:** Jaime approves this design
**Next:** the implementation plan, then one pull request

Jaime (2026-11-27), with screenshots of General, WhatsApp and Telegram side by side: «la UI del chat la sigo viendo regular, primero el color negro de mis mensajes no me convence nada … es mucho más feo el nuestro». The mockup he approved: `ghostaff/capturas/propuesta-chat-2026-11-27.html` (and `.png`): today's General, the proposal in light and dark, and a chat with an agent. He picked **lavender** for his own bubbles over ink grey and WhatsApp green.

It follows [chat-like-whatsapp.md](chat-like-whatsapp.md), whose behaviour stays as it is: this is only the look, for General and every agent chat (the same components).

## What changes, and why

1. **Your bubbles: lavender with ink text**, not the accent (ink-black in light, near-white in dark). Black read as a warning block and drowned everything else; WhatsApp and Telegram both use a light tint with dark text. Light `#E4DFFB`, dark `#352F63`; the time and ticks on it in a muted violet (`#6B6390` / `#A9A3D6`).
2. **A wallpaper**: a faint tile of ghost outlines and sparkles over a lavender-grey ground (light `#ECEAF3` with strokes `#D6D2E6`; dark `#0E0F16` with `#1C1E29`). It gives the depth the flat `surface` grey lacks. This reverses «wallpapers left out» of chat-like-whatsapp.md only for one fixed pattern of ours; choosing a wallpaper stays out.
3. **Everyone else's bubbles: white (dark: `#1C1E29`), no border, a 1 px shadow.** The grey border made them look like form fields.
4. **A real tail** on the first bubble of a run, drawn beside the bubble's sharp top corner, instead of only the sharper corner.
5. **Voice notes**: a round play button in the chat violet, the waveform in a light violet that fills in the strong violet as it plays, the length at the bottom left and the time and ticks at the bottom right on the same line. «Transcripción» in the violet.
6. **A message of only emoji (1–3, no other text) is drawn large, without a bubble**, the time in a small translucent pill beside it, as in WhatsApp and Telegram.
7. **General's header**: the group's face (a person's photo or initials overlapping an agent's ghost) instead of the black people icon, and «Álvaro, tú y 3 agentes» instead of «Álvaro, Álvaro, Tú» (you named «tú» and last; the agents the viewer can talk to counted).
8. **The day pill without a border**, translucent over the wallpaper; **the composer floats over the wallpaper** without its top line, and the mic and send buttons take the chat violet (dark: `#8F84FF` with an ink icon).

The chat violet is `#4B3FC7` (dark `#8F84FF`) and the read ticks `#3D7BF0` (dark `#6AA8FF`): blue on lavender keeps «read» readable where `#53BDEB` does not. Green stays only for earned autonomy (app-design decision 21), so «escribiendo…» moves from green to the violet too.

## Approaches

- **Chat tokens in the palette (picked).** New tokens in `apps/mobile/lib/palette.ts`, light and dark: the wallpaper's ground and stroke, your bubble and its muted text, their bubble, the chat violet, the read blue. Every «mine ? on-accent : ink» in `components/chat/` reads them instead. One place to tune; dark mode comes with it; `accent` keeps meaning buttons everywhere else.
- Redefining `accent` as lavender: every primary button in the app would turn lavender. Rejected.
- Colours written into `Bubble.tsx` and friends: quick, but forty call sites drift apart and dark mode is done twice. Rejected.

The wallpaper and the tail are drawn with `react-native-svg` (already a dependency: it ships over the air): a `Pattern` tile behind the list, and a small path beside the bubble. A PNG tile was the other way; the SVG takes the theme's colour and stays sharp.

## What's left to the builder

- How the shadow is drawn per platform (iOS and web shadow; Android elevation looks wrong under a tail, so a hairline or no shadow there).
- The emoji test (Unicode `\p{Extended_Pictographic}` with joiners and skin tones; Hermes supports `/u` property escapes, `packages/shared/src/chat.ts` already uses them), with a unit test.
- Everything inside a bubble that uses `on-accent` today (quotes, files, link cards, decision and guide cards, action cards) moves to the new tokens and must still read well on lavender in both themes.
- «Álvaro, Álvaro, Tú» may be data, not code: two members of the organisation both called Álvaro. The new subtitle lists names as they are; it does not merge them.
