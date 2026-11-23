# The app's design: a calm desk

**Priority:** high
**Gate:** none
**Next:** the signature motion (decision 26); then «Hecho sin ti» and the mic once the engine records what agents do alone and can talk

Álvaro asked (2026-11-17) for the app's design from first principles, with the state of the art in agent products, and every decision put in front of him to review. He took all my picks («go», 2026-11-17). The pages he reviewed, with the reasoning and the sources:

- [Design principles](https://claude.ai/artifact/QUoNFtzcvwGfQw2gwhNhBM): the job, ten principles, what 2025–26 agent products teach.
- [Five concepts](https://claude.ai/artifact/K3gRpphDEWUf3ejNm8oSEP): five ways the whole app could feel, drawn as phone screens.
- [Thirty decisions](https://claude.ai/artifact/QsmaX1eqA42kCzyaWSv4Eu): one card per call, with options drawn and my pick.
- [Look and stack](https://claude.ai/artifact/8uiV3YbjsXDxsLDeTYC1cs): the 2026 system looks (Liquid Glass, Material 3 Expressive) and the React Native UI libraries, eight decisions. He mixed the style himself (light from one option, dark from another) and took my picks for the rest («go», 2026-11-17). They refine 21–30 below and add 31–34.

## The idea

A person opens Ghostaff for a couple of minutes, takes the decisions that are theirs, and leaves. The app works when it needs them less every month: an agent proposes, the person decides, the agent learns a signed rule and earns autonomy per kind of decision ([ghostaff-producto.md, «El aprendizaje»](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#el-aprendizaje-lo-que-nos-diferencia)). Every screen shortens that loop or makes it more trustworthy.

The direction is **«A calm desk»**: one ghost greets you with one sentence; under it only what is yours; one folded line for what the team did without you. The glowing ghost is the only colour in the app, so it reads as the brand. This builds on what the gamification plan already chose (character on top, inbox below, calm interface, neutral colours plus one accent, rounded headings).

## Decisions (Álvaro, 2026-11-17, all my picks)

**Shape**

1. Three tabs, **Hoy · Equipo · Registro**, and a mic button that is always there. A fourth, **Conexiones**, joined them (Álvaro, 2026-11-22): everything an organisation connects, its AI account first. **Replaced on 2026-11-23** by Equipo · Decisiones · Empresa, with no Hoy and no mic ([three-tabs.md](three-tabs.md)).
2. Talking goes to **Secretaría**, who answers or passes it to the right agent; the agent replies by name.
3. Switching organisation: the name at the top opens a sheet with how many decisions wait in each.
4. On a computer: the list and the decision side by side.

**The decision**

5. **Five fixed parts:** the question, one quoted source, the sources, «Con el sí / Con el no», and the agent's recommendation. They are optional fields in por-decidir (`recomienda`, `con_si`, `con_no`, `cita`, `fuentes`, plus `vence`), added to [Órdago's README](https://github.com/ordago-app/business/blob/main/por-decidir/README.md) on 2026-11-17; `contexto` stays required and folds behind «Todo el contexto».
6. The main button **names the action** (`recomienda`), next to «No» and «Preguntar».
7. **No swipe** to answer. **Reversed on 2026-11-23**: swipe right takes the pick, left is «later», never «no» ([three-tabs.md](three-tabs.md), decision 7).
8. An answer can be **taken back until the agent has it** (until the sync writes it into the record), only by whoever gave it.
9. A correction becomes a rule the way Órdago does it: the agent proposes it as its own decision, the person edits and signs.
10. Earned autonomy shows as a **10-step bar on each decision** («6 de 10 OK seguidos sin corregir») and a ladder per kind on the agent's page.
11. What agents did alone: **one folded line on Hoy**, «Hecho sin ti», opening to a list with undo for a day. **Gone with Hoy on 2026-11-23**: it shows in each person's chat with the agent ([three-tabs.md](three-tabs.md), decisions 2 and 12).
12. Order: what waits first, nearest `vence` first, then newest.
13. «Preguntar» opens a short chat about that decision; the agent answers there.

**Rhythm and reach**

14. Notifications: **one a day** at the person's hour, plus a push only for a decision due today or money leaving.
15. Weekly summary: **audio plus cards**, each sentence linked to its source in the record.
16. A home-screen widget («3 te esperan» with the ghost), later.
17. Agents speak in the **first person** and use «tú».
18. Agent-written text in ink, like the person's, set apart by the agent's ghost, name and layout; never a sparkle icon. (Muted until 2026-11-22, when Jaime found it grey and hard to read on the beta app: team-chat.md, step 5.)

**The first run**

19. Paste links and **watch the record build**, each fact with its source; end on the first real decision.
20. Incorporación's «¿esto es así?» cards are the **same card as a decision**.

**The look**

21. **Ink and greys tinted a few degrees toward the ghost's violet** (`#F3F3F7` surface, `#FFFFFF` card, `#E9E8F0` sunk, `#6A687A` muted, `#16151E` ink), so the iridescent ghost sits in the page; orange only for «te espera», green only for earned autonomy, red only for errors (`apps/mobile/lib/theme.ts`). On Hoy only, a faint iridescent halo taken from the ghost sits behind it; the only new thing we draw.
22. Light and dark, **following the phone**. Dark is a **night studio**, not inverted greys: deep ink (`#0C0D13` ground, `#171922` cards, `#ECEDF3` ink, `#8C8FA0` muted, `#FF8A4C` «te espera») and the ghost glowing. Both sets are the same tokens.
23. Headings in **Rubik**; body text in the phone's own face.
24. Cards only for things you act on (decisions, agents); the rest are plain rows.
25. **Native** tab bar, sheets and haptics; our own decision card and ghosts. The tab bar is the phone's own in light and dark: the floating Liquid Glass bar on iOS 26, Material 3 on Android, so it stays current as the systems change.
26. One signature motion: the answered card folds into its ghost, whose eyes turn happy, with a light haptic.
27. Ghosts big on Hoy and on agent pages, small on rows; nowhere else.
28. The ghost's face shows state only (waiting, working, happy, resting); it never nags.
29. «Te espera» is the ghost's warm orange.
30. Thin line icons (Phosphor) wherever we draw; SF Symbols and Material Symbols inside native tabs and menus, where the system expects them.

**The stack** (state of the libraries in Nov 2026 and the alternatives weighed: the Look and stack page)

31. Styles stay on **NativeWind 4**; dark mode through its CSS variables. Move to Tailwind 4 when NativeWind 5 leaves release candidate (the class names barely change). Uniwind and Unistyles 3 were weighed and not needed.
32. Components stay **our own** (`components/ui.tsx`). When one is hard to get right (an accessible dialog, a select, a toast), copy that single component from React Native Reusables into the repo and restyle it. No installed kit (HeroUI Native, gluestack, Tamagui, Paper).
33. Native controls through **Expo UI** (`@expo/ui`, stable since SDK 56) and Expo Router's **native tabs**: the organisation sheet, menus, pickers, switches, settings. On the web Expo UI is still experimental, so there our own components stand in.
34. Motion with **Reanimated 4** only; no Skia or Rive until a style or a designer needs them.

## Progress

**2026-11-17, the decision screen** (branch `feat/design-calm-desk`):

- [x] por-decidir's optional fields: documented in Órdago's README, read by `packages/shared/src/record/porDecidir.ts`, carried by the sync, stored in `decisions` (`supabase/migrations/20261117100000_decision_parts.sql`).
- [x] `unanswer_decision()`: whoever answered takes it back until the sync writes it; pgTAP proves nobody else can, and nobody from another organisation.
- [x] The decision screen with the five parts, the named button, the folded context, the autonomy bar and «Cambiar la respuesta»; a success haptic on the phone.
- [x] The inbox card: ghost, question, who asks and when it is due; ordered by `vence`.
- [x] The palette and Rubik headings in `lib/theme.ts`, used by Tailwind, headers and the 3D stage.
- [x] Hoy: Secretaría on top with the halo and one sentence (`lib/hoy.ts`), «Te esperan», «Respondidas» (PR #11).
- [ ] «Hecho sin ti» on Hoy: nothing records what agents did alone yet.
- [x] Three native tabs, Hoy · Equipo · Registro (Registro: what was decided); Organizaciones as a native sheet with counts (PR #11).
- [ ] The mic: needs the engine's always-on service for talking to Secretaría.
- [ ] «Preguntar»: a chat about one decision, a thread of the team chat ([team-chat.md](team-chat.md)). Needs the engine's always-on service for talking to a department.
- [x] The ghost-tinted greys and the night-studio dark set (`lib/palette.ts`), following the phone (PR #10).
- [x] The halo behind the ghost on Hoy, a glow after dark (`GhostScene`, PR #11).
- [ ] Expo UI (decision 33): add it with the first native control the app needs (a menu, picker or switch); the org sheet is already a native form sheet.
- [ ] The signature motion when a decision is answered.
- [ ] Notifications, the weekly summary, the widget: each its own plan when the engine sends them.
- [ ] Órdago's agents writing the new fields: they read the README; check the first decisions that come with them.

**2026-11-20, the polish pass** (branch `feat/ui-polish`, Jaime's ask: elegant, concise, professional). A refinement inside decisions 21–34, not a change to them:

- [x] One type scale in `tailwind.config.ts` (`title` 30, `title2` 22, `title3` 18, `footnote` 13, `caption` 12), Rubik for titles, sentence case everywhere: no all-caps labels.
- [x] Buttons in three weights (`primary`, `secondary`, `plain`) plus `danger` only to confirm a removal; `small` for inline.
- [x] Phosphor icons (decision 30), imported one file per icon from `components/icons.tsx` so the app carries only those it draws.
- [x] Inset grouped lists (`ListSection` + `ListRow`) for everything that is not a decision or an agent (decision 24); `EmptyState` says what is missing and the next step; `Segmented` for the phone's segmented control.
- [x] Haptics in one place (`lib/haptics.ts`): selection on a choice, success when something lands, a tap when a message goes.
- [x] Conexiones: each service's real logo (simple-icons, CC0, generated into `lib/brandLogos.ts` by `apps/mobile/scripts/brand-logos.mjs`; its initial when it has none), area filters, and a page per connection (`conexiones/[id]`, `conexiones/ia/[provider]`) inside the sheet's own stack. Since 2026-11-22 it is a tab with its own stack, third, before Registro; it lists only what is connected, and «Añadir conexión» (`conexiones/anadir`) opens the whole catalogue.
- [x] An owner whose organisation has no AI account its agents run on (Claude subscription, Anthropic key, Claude on Google Cloud) connects one before the tabs (`conectar-ia`); a member who isn't an owner gets in, and Hoy says what's missing (Álvaro, 2026-11-22).
- [x] Organizaciones as a settings list; its links close the sheet first, because iOS opens nothing from a sheet until it is gone.
- [ ] The ghost on Hoy in the iOS simulator: it draws nothing there (no GPU); check on a phone before treating it as a bug.
