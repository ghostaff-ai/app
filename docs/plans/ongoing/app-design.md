# The app's design: a calm desk

**Priority:** high
**Gate:** none
**Next:** Hoy with the ghost on top, one sentence and the folded «Hecho sin ti»; then the three tabs with the mic

Álvaro asked (2026-11-17) for the app's design from first principles, with the state of the art in agent products, and every decision put in front of him to review. He took all my picks («go», 2026-11-17). The pages he reviewed, with the reasoning and the sources:

- [Design principles](https://claude.ai/artifact/QUoNFtzcvwGfQw2gwhNhBM): the job, ten principles, what 2025–26 agent products teach.
- [Five concepts](https://claude.ai/artifact/K3gRpphDEWUf3ejNm8oSEP): five ways the whole app could feel, drawn as phone screens.
- [Thirty decisions](https://claude.ai/artifact/QsmaX1eqA42kCzyaWSv4Eu): one card per call, with options drawn and my pick.

## The idea

A person opens Ghostaff for a couple of minutes, takes the decisions that are theirs, and leaves. The app works when it needs them less every month: an agent proposes, the person decides, the agent learns a signed rule and earns autonomy per kind of decision ([ghostaff-producto.md, «El aprendizaje»](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#el-aprendizaje-lo-que-nos-diferencia)). Every screen shortens that loop or makes it more trustworthy.

The direction is **«A calm desk»**: one ghost greets you with one sentence; under it only what is yours; one folded line for what the team did without you. The glowing ghost is the only colour in the app, so it reads as the brand. This builds on what the gamification plan already chose (character on top, inbox below, calm interface, neutral colours plus one accent, rounded headings).

## Decisions (Álvaro, 2026-11-17, all my picks)

**Shape**

1. Three tabs, **Hoy · Equipo · Registro**, and a mic button that is always there.
2. Talking goes to **Secretaría**, who answers or passes it to the right agent; the agent replies by name.
3. Switching organisation: the name at the top opens a sheet with how many decisions wait in each.
4. On a computer: the list and the decision side by side.

**The decision**

5. **Five fixed parts:** the question, one quoted source, the sources, «Con el sí / Con el no», and the agent's recommendation. They are optional fields in por-decidir (`recomienda`, `con_si`, `con_no`, `cita`, `fuentes`, plus `vence`), added to [Órdago's README](https://github.com/ordago-app/business/blob/main/por-decidir/README.md) on 2026-11-17; `contexto` stays required and folds behind «Todo el contexto».
6. The main button **names the action** (`recomienda`), next to «No» and «Preguntar».
7. **No swipe** to answer.
8. An answer can be **taken back until the agent has it** (until the sync writes it into the record), only by whoever gave it.
9. A correction becomes a rule the way Órdago does it: the agent proposes it as its own decision, the person edits and signs.
10. Earned autonomy shows as a **10-step bar on each decision** («6 de 10 OK seguidos sin corregir») and a ladder per kind on the agent's page.
11. What agents did alone: **one folded line on Hoy**, «Hecho sin ti», opening to a list with undo for a day.
12. Order: what waits first, nearest `vence` first, then newest.
13. «Preguntar» opens a short chat about that decision; the agent answers there.

**Rhythm and reach**

14. Notifications: **one a day** at the person's hour, plus a push only for a decision due today or money leaving.
15. Weekly summary: **audio plus cards**, each sentence linked to its source in the record.
16. A home-screen widget («3 te esperan» with the ghost), later.
17. Agents speak in the **first person** and use «tú».
18. Agent-written text in a muted style, the person's in ink; never a sparkle icon.

**The first run**

19. Paste links and **watch the record build**, each fact with its source; end on the first real decision.
20. Incorporación's «¿esto es así?» cards are the **same card as a decision**.

**The look**

21. **Ink and cool greys**; orange only for «te espera», green only for earned autonomy, red only for errors (`apps/mobile/lib/theme.ts`).
22. Light and dark, **following the phone**.
23. Headings in **Rubik**; body text in the phone's own face.
24. Cards only for things you act on (decisions, agents); the rest are plain rows.
25. **Native** tab bar, sheets and haptics; our own decision card and ghosts.
26. One signature motion: the answered card folds into its ghost, whose eyes turn happy, with a light haptic.
27. Ghosts big on Hoy and on agent pages, small on rows; nowhere else.
28. The ghost's face shows state only (waiting, working, happy, resting); it never nags.
29. «Te espera» is the ghost's warm orange.
30. Thin line icons (Phosphor).

## Progress

**2026-11-17, the decision screen** (branch `feat/design-calm-desk`):

- [x] por-decidir's optional fields: documented in Órdago's README, read by `packages/shared/src/record/porDecidir.ts`, carried by the sync, stored in `decisions` (`supabase/migrations/20261117100000_decision_parts.sql`).
- [x] `unanswer_decision()`: whoever answered takes it back until the sync writes it; pgTAP proves nobody else can, and nobody from another organisation.
- [x] The decision screen with the five parts, the named button, the folded context, the autonomy bar and «Cambiar la respuesta»; a success haptic on the phone.
- [x] The inbox card: ghost, question, who asks and when it is due; ordered by `vence`.
- [x] The palette and Rubik headings in `lib/theme.ts`, used by Tailwind, headers and the 3D stage.
- [ ] Hoy: ghost on top with one sentence from Secretaría, «Te esperan», «Hecho sin ti».
- [ ] Three tabs and the mic (native tabs); Organizaciones as a sheet with counts.
- [ ] «Preguntar»: a chat about one decision. Needs the engine's always-on service for talking to a department.
- [ ] Dark mode (the app is light only today, `app.config.ts`).
- [ ] The signature motion when a decision is answered.
- [ ] Notifications, the weekly summary, the widget: each its own plan when the engine sends them.
- [ ] Órdago's agents writing the new fields: they read the README; check the first decisions that come with them.
