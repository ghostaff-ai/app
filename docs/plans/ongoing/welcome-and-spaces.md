# The way in, step by step, and your spaces

**Priority:** high — every new person goes through it, and Jaime's own first use (a personal assistant) has no way in today
**Gate:** none
**Next:** land PR 2 (`feat/spaces-on-tabs`); then retire this plan once both are seen on beta

Jaime walked the way in on the web (2026-11-22, local Supabase, a phone-sized window) and found it poor: too much text, the buttons halfway down the screen, sheets you can't close, the organisation only visible on Hoy, and nothing for someone who wants Ghostaff for themselves. **His first use of Ghostaff is a personal assistant**, before any company. He took the mockups below («me gusta más, sí; usa los fantasmas», 2026-11-22). It builds on [entry-flows.md](../ideas/entry-flows.md) and answers its open question 1.

## What was there (2026-11-22)

1. **Bienvenida**: a form with a name (required) and two optional chip questions (what you do, how you heard of us). The answers are stored in `profiles` and read by nothing.
2. **Empezar**: «Hola, X / ¿Cómo quieres empezar?», then «Crear una empresa» or «Unirme a una empresa», and «Cerrar sesión» in the middle of the way in.
3. **Crear empresa**: four fields, with web, about and links optional. The button sits at the edge of the screen.
4. **Conectar IA** (owners only), then **Hoy**: «No te espera nada», with no next step.
5. Inside: the organisation's name and switcher only on Hoy. The `organizaciones` sheet opens full screen on the web with no way to close it. «Unirme» and the other modals show a back arrow, not a close.

The native app is not held back by the web: the tabs are the system's own (`NativeTabs`) and sheets are native `formSheet`s. The web is what degrades (a sheet becomes a page with no exit), so every screen here is checked on both.

## Goals

1. **The way in is a sequence of full-screen steps**: one question per screen, a ghost on top, progress dots, and the main button pinned to the bottom (above the keyboard and the safe area).
2. **Ask less.** The name only, prefilled from Google or Apple. The two optional questions go.
3. **«Para mí» or «Para mi empresa»** is the second step. «Para mí» creates the person's personal space with no form. «Para mi empresa» asks only the name; web, about and links are added later.
4. **You always see where you are and can switch in one tap**: the space's name sits on top of every tab, and the switcher is a sheet with a close.
5. **Every sheet and modal has a close (X)**, on the phone and on the web.
6. **Secretaría starts on her own** (Álvaro's decision of 2026-11-21 in entry-flows.md, confirmed by Jaime 2026-11-22): every new space, personal or company, is created with her hired, and once its AI is connected she introduces herself. The first Hoy shows her at work, not «No te espera nada».

## Non-goals

- Keeping where you were going across sign-in, and invitation links that open the invitation (entry-flows.md, proposals 1–2): unchanged here.
- A personal catalogue of agents. A personal space shows the same team as a company for now.
- The desktop sidebar: it already shows the organisation and switches. It gets the personal space's look (initial, name) and nothing else.

## Anti-goals

- More text on any step. Each step has a title, at most one short line under it, and one main action.
- Anything that makes the phone feel like a web page to match the web.

## The design

### The steps

| # | Screen | Ghost | Title / line | Main button | Other |
|---|---|---|---|---|---|
| 1 | `bienvenida` | `base` | «¿Cómo te llamas?» / «Así firmarás lo que apruebes.» | Seguir (disabled until a name) | — |
| 2 | `empezar` | `base` | «¿Para qué vas a usar Ghostaff?» | Seguir (disabled until a choice) | Two option cards: «Para mí · Tu asistente personal», «Para mi empresa · Un equipo de agentes». An invitation waiting goes on top as a card that opens `unirme`. A text link «Unirme a una empresa» under the button. |
| 3 | `crear-empresa` (company only) | `incorporacion` | «¿Cómo se llama tu empresa?» / «La web y lo que hacéis, luego.» | Crear | — |
| 4 | `conectar-ia` (owners) | `base` | as today, shorter line | as today | Personal copy says «tu espacio», not «tu empresa». |
| 5 | Hoy | `secretaria` | — | — | First-day card (below). |

- Steps 1–3 share one layout component, `OnboardingStep`: safe area, progress dots (step i of n), the ghost in a fixed-height box (`GhostViewer`, one per screen), title, optional line, content, and a footer pinned to the bottom with the main button and an optional link. It keeps the footer above the keyboard (`KeyboardAvoidingView` on iOS, `lib/keyboard`). On a desktop the column is centred at `DESKTOP_PAGE` width and the footer sits at the bottom of the window.
- **Step count.** «Para mí» has 3 dots (name, purpose, AI); «Para mi empresa» has 4 (name, purpose, company name, AI). A member who joins doesn't see dots after step 2.
- **«Para mí»** calls `create_personal_space()` on Seguir, then `enter(id)` on `ActiveOrgContext` (as `crear-empresa` does today): the guards read that context, which doesn't refresh by itself. The guards then move on to `conectar-ia`.
- **«Para mi empresa»** pushes `crear-empresa` as a full-screen step on the way in (not a modal). Opened later from the switcher, `crear-empresa` is a modal with a close and the same single field. Its `presentation` is computed in `app/(app)/_layout.tsx` from whether the person has a space yet (`card` before, `modal` after): the same route, no copy.
- **`conectar-ia` takes `OnboardingStep` too**: the AI accounts become option cards, and the pinned button reads «Conectar {name}». The dots show only on the way in (the person has exactly one space); reached later (a second company created from «Tus espacios»), it has a close instead and no dots.
- **«Cerrar sesión»** leaves the way in's main screens. It stays reachable from step 2 as a small link at the top right («Salir»), because someone who signed in with the wrong account must have a way out.
- `bienvenida` drops `occupation` and `heard_from` from the UI. The columns and `save_profile`'s defaults stay: dropping them is a migration for no gain, and nothing writes them any more.

### The personal space

- **A personal space is an organisation of kind `personal`**: the same record, agents, connections and decisions as a company, with you alone in it. It reuses everything, and its separation is the organisations' own (invariant 1).
- Migration: `organizations.kind text not null default 'company' check (kind in ('personal', 'company'))`, and a unique partial index on `(created_by) where kind = 'personal'` (one personal space per person).
- `create_personal_space()`, `security definer`: requires a profile; returns the caller's personal space if it exists (idempotent, a double tap is harmless); otherwise inserts one named «Personal» with slug from `slug_for('personal')`, and the owner membership signed with the profile's name. It counts towards the ceiling of ten organisations.
- `create_organization` stays as is and creates `kind = 'company'`.
- pgTAP: another person can't see or change your personal space; a second call returns the same space; a second personal space can't be inserted.
- `Organization` / `MyOrganization` gain `kind`. `createPersonalSpace(client)` joins `@ghostaff/shared/services`.
- ~~In a personal space: «Invitar» is hidden (you're alone in it).~~ **Replaced (Álvaro, 2026-11-23): a personal space works exactly like a company.** Its owner may invite people, choose who sees each conversation, and has everything else a company has (`20261125000000_personal_spaces_like_any.sql` drops the invitation block). What differs is only words and looks, all in one map, `packages/shared/src/spaces.ts`: the third tab is **Perfil** (a person icon) in a personal space and **Empresa** in a company, and later the agent templates each kind offers ([agent-templates.md](../ideas/agent-templates.md)). Screens read that map and never check `kind` themselves. Copy that says «empresa» says «tu espacio» instead (conectar-ia).
- **The word** for either is **espacio** («Tus espacios», «tu espacio personal»): under your user, one personal space and any number of companies you belong to.

### Where you are, and switching

- **`SpaceSwitcher`**: a row on top of every tab on the phone (Hoy, Equipo, Registro, Conexiones). It shows the space's initial in a round avatar (a person glyph for the personal space), its name and a caret, and opens `organizaciones`. Hoy keeps the mic beside it. The tabs' own titles («Equipo»…) stay under it. On a desktop the sidebar does this, so the row isn't drawn.
- **`organizaciones` becomes «Tus espacios»**: the spaces with their avatar and the waiting count (personal first, then by name); a check on the one open. Under them, «Invitar a {name}» (company owners only), then «Crear una empresa», «Unirme a una empresa», and «Crear tu espacio personal» if you have none. «Cerrar sesión» goes to a footer line with your email. A close (X) sits top right.
- **`CloseButton`**: one component, an X in a round button, used in every sheet's and modal's header (`headerRight` on the native stack's modals: `crear-empresa`, `unirme`, `invitar`, `nuevo-agente`; drawn in the screen on the header-less sheets: `organizaciones`, `contratar`). It calls `router.back()`, or `router.replace('/')` when there's no history (a sheet opened cold on the web).

### Secretaría starts on her own

- **Hired with the space.** `create_organization` and `create_personal_space` insert her agent (ghost `secretaria`, department `direccion`, name «Secretaría») in the same transaction as the space, so no space exists without her. Spaces created before this keep their team as it is.
- **She says hello once the AI is there.** Her first thread needs a working AI account, which a new space gets one step later (`conectar-ia`). So the first time an owner opens Hoy in a space whose AI can run agents and whose Secretaría has never spoken (no thread), the app calls `agentHello` for her once, as `contratar` does today. Hoy then shows her sentence and her thread. A failure leaves Hoy as it is and is tried again on the next visit.
- **Members** never trigger the hello (only owners hire); they see Hoy as today.

## Approaches

1. **Personal space as an organisation of kind `personal`** (chosen). It reuses the record, agents, connections and the guards. The cost is one column and one function.
2. A personal space named «Personal» with no `kind`: no migration. But nothing can tell it apart: «Invitar» shows, the copy says «empresa», and a second one is possible. It would have to be fixed later.
3. A separate personal mode outside organisations: duplicates agents, connections and decisions per person. It breaks the one model the app has.

For the way in, one stack of separate routes with a shared step layout (chosen) keeps the guards in `app/(app)/_layout.tsx` as the source of truth. A single wizard screen holding all steps in state would duplicate those guards and lose the deep links each step has today.

## Delivery

Two pull requests from one worktree, landed in order with `pnpm pr:land`:

1. **The way in and the personal space**: the migration and pgTAP, the shared model and service, `OnboardingStep`, `bienvenida`, `empezar`, `crear-empresa`, `conectar-ia`, and the end-to-end flows. `sign-in-email.yaml` and `create-company.yaml` change; a new `create-personal.yaml` covers «Para mí». `.maestro/scripts/connect-ai.js` finds the space by its owner's email, not by name: every personal space is called «Personal».
   Secretaría hired with the space is part of this PR's migration.
2. **Spaces and closes**: `SpaceSwitcher` on every tab, «Tus espacios», `CloseButton` on every sheet and modal, and Secretaría's hello on the first Hoy.

## Left to the builder

- Ghost sizes and the progress dots' exact look, within the existing tokens.
- Whether the option cards in step 2 reuse `Choice` with a selected state or are a new `OptionCard`.
- Test IDs for the new flows.

## After the three tabs (2026-11-23)

Álvaro moved the app to three tabs that morning ([three-tabs.md](three-tabs.md)): Hoy went and the switcher moved to Empresa. PR 1 had already landed; PR 2 was rebuilt on top (branch `feat/spaces-on-tabs`), with Jaime's call (2026-11-23) that **the space stays on top of every tab**:

- `SpaceSwitcher` on top of Equipo and Decisiones; Empresa keeps its big name, with the space's avatar beside it. All three open «Tus espacios».
- «Tus espacios» is only the switcher (three-tabs.md, decision 11): your spaces, personal first, «Crear tu espacio personal» when you have none, creating and joining a company, and a close. Inviting and signing out stay in Empresa, and «Invitar a alguien» isn't offered in a personal space.
- Secretaría's first hello runs from Equipo instead of Hoy; it lands in the person's own chat with her (three-tabs.md, decision 3), so her row shows it, unread. The «Secretaría te ha escrito» card on Hoy went with Hoy.

## Implementation plan

> **For agentic workers:** use superpowers:executing-plans. Steps use checkboxes. Worktree: `.claude/worktrees/welcome-steps`, branch `feat/welcome-steps` from `origin/develop` (AGENTS.md, Branches). PR 2 branches `feat/spaces-switcher` from `develop` once PR 1 has landed.

**Goal:** the way in as full-screen steps with a personal space, then the space switcher on every tab, closes on every sheet, and Secretaría's first hello.

**Architecture:** the layout's guards stay the source of truth; each step is its own route sharing an `OnboardingStep` layout. A personal space is an organisation with `kind = 'personal'`, created by a `security definer` function. Secretaría is hired inside the functions that create a space.

**Tech stack:** Expo Router, NativeWind, Supabase (plpgsql, pgTAP), Jest, Maestro.

### Global constraints

- Code and comments in English; everything on screen in Spanish (AGENTS.md rule 5). Screens never call Supabase directly; new calls go through `@ghostaff/shared/services` (rule 1).
- Writes only through `security definer` functions that check the caller; every change to `organizations` has pgTAP coverage (rule 2).
- Each step: title, at most one short line, one main button pinned to the bottom. No step adds explanatory paragraphs.
- Checked on a phone-sized window (375×812) and on a desktop window (≥1024 wide) before each PR lands.

### Review focus

1. **The keyboard over the pinned button** (steps 1 and 3 on iOS and Android): the button stays visible above the keyboard. Test: the `OnboardingStep` render test asserts the footer is inside the `KeyboardAvoidingView`; verified by hand on the web and in the e2e flow (which types and then taps «Seguir» without `hideKeyboard`).
2. **A double tap on «Seguir» in «Para mí»**: one personal space, not two. pgTAP: calling `create_personal_space()` twice returns the same id.
3. **A sheet opened cold on the web** (`/organizaciones` typed in the address bar): the X still leaves, to Hoy. `CloseButton` test: with `router.canGoBack()` false it calls `router.replace('/')`.
4. **Someone who already has companies and no personal space**: «Tus espacios» offers «Crear tu espacio personal», and creating it opens it. Covered by the `Tus espacios` render test.
5. **The ceiling of ten spaces** when creating the personal one: the error shows under the button in Spanish, and the step doesn't hang. pgTAP: the 11th space raises `54000`; `empezar` maps it to «Ya tienes demasiados espacios».

---

### PR 1 — the way in and the personal space

#### Task 1: spaces in the database

**Files:** create `supabase/migrations/20261122300000_spaces.sql`, `supabase/tests/database/spaces.test.sql`.

**Produces:** `organizations.kind` (`'personal' | 'company'`, default `'company'`); `public.create_personal_space() returns public.organizations`; `create_organization(...)` unchanged signature, now also hiring Secretaría; internal `public.hire_secretaria(target_org uuid)` (execute revoked from `public, anon, authenticated`).

- [ ] Write `spaces.test.sql` (pgTAP, same setup as `onboarding.test.sql`): a new company has `kind = 'company'` and exactly one agent, ghost `secretaria`, department `direccion`, name `Secretaría`, `member_default = 'talk'`; `create_personal_space()` without a profile raises `42501`; with one, it returns a space with `kind = 'personal'`, name `Personal`, an owner membership signed with the profile's name, and Secretaría hired; a second call returns the same id; a direct second insert of `kind = 'personal'` for the same `created_by` violates the unique index; another person can't select it; the 11th space raises `54000`.
- [ ] Run `pnpm db:test` — expect the new file to fail (function missing).
- [ ] Write the migration: the column with its check, `create unique index organizations_one_personal on public.organizations (created_by) where kind = 'personal'`, `hire_secretaria`, `create_personal_space` (profile check, return the existing one if any, the same ceiling of ten as `create_organization`, insert with `slug_for('personal')`, owner membership, `hire_secretaria`), and `create or replace function public.create_organization` with its body as today plus `perform public.hire_secretaria(o.id)`. Grant execute on `create_personal_space()` to `authenticated`.
- [ ] Apply locally (`supabase migration up`) and run `pnpm db:test` — expect all files to pass.
- [ ] Commit: `feat(db): personal spaces, and Secretaría hired with every new space`.

#### Task 2: the shared model and services

**Files:** modify `packages/shared/src/models/index.ts`, `packages/shared/src/services/index.ts`; test `packages/shared/test/organizations.test.ts`.

**Produces:** `type OrganizationKind = 'personal' | 'company'`; `Organization.kind: OrganizationKind`; `listMyOrganizations` selects `kind` and sorts personal first, then by name (`es`); `createOrganization` returns `kind`; `createPersonalSpace(client: SupabaseClient): Promise<Organization>` (rpc `create_personal_space`); `sortSpaces(list: MyOrganization[]): MyOrganization[]` exported for the sort.

- [ ] Test `sortSpaces`: `[{name:'Órdago',kind:'company'},{name:'Personal',kind:'personal'},{name:'Factotum',kind:'company'}]` → `Personal, Factotum, Órdago`.
- [ ] Run `pnpm shared:test` — FAIL; implement; run again — PASS; `pnpm shared:typecheck` clean.
- [ ] Commit: `feat(shared): an organisation's kind, and creating your personal space`.

#### Task 3: `OnboardingStep`

**Files:** create `apps/mobile/components/onboarding/OnboardingStep.tsx`, `apps/mobile/lib/onboarding.ts`; test `apps/mobile/__tests__/OnboardingStep.test.tsx`.

**Produces:**
- `OnboardingStep({ ghost, step, of, title, line, children, action, link, topRight }: { ghost: GhostId; step?: number; of?: number; title: string; line?: string; children?: ReactNode; action: ReactNode; link?: ReactNode; topRight?: ReactNode })` — safe area; dots when `step` and `of` are given; `GhostViewer` in a 200-high box (160 on a window under 700 high); title (`font-display text-title`), line (`text-base text-muted`); `children` scroll; the footer (`action` then `link`) pinned at the bottom inside the `KeyboardAvoidingView`. On a desktop, the column uses `DESKTOP_PAGE`.
- `lib/onboarding.ts`: `stepsFor(purpose: 'personal' | 'company' | null): number` → 3 for personal, 4 for company, 2 for null (before choosing).

- [ ] Tests: dots render `of` items with `step` of them filled (`testID="step-dot"`, accessibility label «Paso 2 de 4»); no dots without `step`; `action` renders inside the element with `testID="onboarding-footer"`, a descendant of the `KeyboardAvoidingView`; `stepsFor` values above.
- [ ] Run `pnpm app:test -- OnboardingStep` — FAIL; implement; PASS.
- [ ] Commit: `feat(app): the full-screen step the way in is made of`.

#### Task 4: the steps

**Files:** modify `apps/mobile/app/(app)/bienvenida.tsx`, `empezar.tsx`, `crear-empresa.tsx`, `conectar-ia/index.tsx`, `apps/mobile/app/(app)/_layout.tsx`; test `apps/mobile/__tests__/empezar.test.tsx`.

**Consumes:** Task 2's `createPersonalSpace`; Task 3's `OnboardingStep`, `stepsFor`; `useActiveOrg().enter`.

- [ ] `empezar.test.tsx` (services and router mocked): «Seguir» is disabled until a card is chosen; «Para mí» + «Seguir» calls `createPersonalSpace` then `enter(id)`; «Para mi empresa» + «Seguir» pushes `/crear-empresa`; a waiting invitation renders «Te han invitado a {org}» above the cards and opens `/unirme`; an error with code `54000` shows «Ya tienes demasiados espacios».
- [ ] Run — FAIL.
- [ ] `bienvenida`: `OnboardingStep` ghost `base`, step 1 of `stepsFor(null)`, «¿Cómo te llamas?» / «Así firmarás lo que apruebes.», the name `Field` (placeholder «Nombre y apellido», prefilled as today), action «Seguir» disabled until a name; `save({ fullName, occupation: null, heardFrom: null })`. The chips and their constants go.
- [ ] `empezar`: ghost `base`, step 2, «¿Para qué vas a usar Ghostaff?», two option cards («Para mí» · «Tu asistente personal», icon `User`; «Para mi empresa» · «Un equipo de agentes», icon `Buildings`) with a selected state, the invitation card on top, link «Unirme a una empresa», `topRight` «Salir» (signOut).
- [ ] `crear-empresa`: one field «Nombre de la empresa» (placeholder «Por ejemplo, Panadería Ana»), ghost `incorporacion`, step 3 of 4 when there's no space yet (no dots otherwise), title «¿Cómo se llama tu empresa?» / «La web y lo que hacéis, luego.», action «Crear». Web, about and links leave this screen (the function's defaults stay).
- [ ] `_layout.tsx`: `crear-empresa`'s options become `{ presentation: org.organizations.length ? 'modal' : 'card', headerShown: org.organizations.length > 0, title: 'Crear una empresa' }`.
- [ ] `conectar-ia`: `OnboardingStep` ghost `base`; dots (last of `stepsFor(active.kind)`) only when `organizations.length === 1`; the providers as option cards (keep `testID="connect-ai-{p}"`), action «Conectar {name}» that does what tapping a row does today; the line says «tu espacio» for a personal space, «{active.name}» otherwise; «Cerrar sesión» and the other spaces move to `topRight` «Salir» and a link «Ir a otro espacio» when there are others.
- [ ] Run `pnpm app:test` and `pnpm app:typecheck` — PASS.
- [ ] Commit: `feat(app): the way in, one step per screen, for you or for your company`.

#### Task 5: end-to-end flows

**Files:** modify `.maestro/flows/ci/sign-in-email.yaml`, `.maestro/flows/ci/create-company.yaml`, `.maestro/scripts/connect-ai.js`; create `.maestro/flows/ci/create-personal.yaml`.

- [ ] `sign-in-email.yaml`: wait for «¿Cómo te llamas?», type the name, tap «Seguir» (no `hideKeyboard`: the button must be reachable with the keyboard up), wait for «¿Para qué vas a usar Ghostaff?».
- [ ] `create-company.yaml`: after the name, tap «Para mi empresa», «Seguir», type the company in «Por ejemplo, Panadería Ana», tap «Crear»; the rest as today. In Equipo, Secretaría is now hired, so the vacancy tapped is any other (`vacancy-.*` still matches).
- [ ] `connect-ai.js`: accepts `COMPANY` (as today) or `OWNER_NAME`; with `OWNER_NAME` it finds the personal space through `memberships?select=org_id,organizations!inner(kind)&role=eq.owner&display_name=eq.{name}&organizations.kind=eq.personal` and still requires exactly one.
- [ ] `create-personal.yaml`: sign up (`e2e-me-<time>@ghostaff.test`, name `Yo E2E <6 digits>`), «Para mí», «Seguir», assert «Conecta» and `connect-ai-claude`, run `connect-ai.js` with `OWNER_NAME`, relaunch, assert «Personal» on top and the greeting.
- [ ] Run `pnpm e2e` if an emulator is available; otherwise CI's `End-to-end (Android)` lane runs them on the PR.
- [ ] Commit: `test(e2e): the new way in, for a company and for yourself`.

#### Task 6: verify and land PR 1

- [ ] `pnpm check`. Web at 375×812 and at desktop width against the local stack: a new account through «Para mí» and another through «Para mi empresa»; screenshots of each step.
- [ ] `pnpm pr:land` from the worktree until it exits `0`.

### PR 2 — spaces and closes

#### Task 7: `CloseButton` on every sheet and modal

**Files:** create `apps/mobile/components/CloseButton.tsx`; modify `apps/mobile/app/(app)/_layout.tsx`, `organizaciones.tsx`, `contratar.tsx`; test `apps/mobile/__tests__/CloseButton.test.tsx`.

**Produces:** `CloseButton({ onPress }: { onPress?: () => void })` — a 32-round button with the X icon, label «Cerrar»; default `onPress` is `router.canGoBack() ? router.back() : router.replace('/')`.

- [ ] Tests: it calls `router.back()` when it can go back, `router.replace('/')` when not; accessibility label «Cerrar».
- [ ] Implement; `headerRight: () => <CloseButton />` and `headerBackVisible: false` on `crear-empresa` (when modal), `unirme`, `invitar`, `nuevo-agente`; drawn at the top right in `organizaciones` and `contratar` (header-less).
- [ ] `pnpm app:test` PASS; commit: `feat(app): a close on every sheet and modal`.

#### Task 8: the space on top of every tab, and «Tus espacios»

**Files:** create `apps/mobile/components/SpaceSwitcher.tsx`, `apps/mobile/components/SpaceAvatar.tsx`; modify `apps/mobile/app/(app)/(tabs)/index.tsx`, `equipo.tsx`, `registro.tsx`, `conexiones/index.tsx`, `apps/mobile/app/(app)/organizaciones.tsx`, `apps/mobile/components/Sidebar.tsx`; test `apps/mobile/__tests__/organizaciones.test.tsx`.

**Produces:** `SpaceAvatar({ space, size }: { space: Pick<MyOrganization, 'name' | 'kind'>; size?: number })` — the person glyph for `personal`, else the name's first letter; `SpaceSwitcher({ right }: { right?: ReactNode })` — avatar, name, caret, opens `/organizaciones`; renders nothing on a desktop.

- [ ] `organizaciones.test.tsx`: the title «Tus espacios»; spaces in `sortSpaces` order, a check on the open one; «Invitar a {name}» only for a company owner; «Crear tu espacio personal» only without a personal space, and tapping it calls `createPersonalSpace` then `enter`; «Cerrar sesión» in the footer with the email.
- [ ] Implement; Hoy's header row becomes `<SpaceSwitcher right={<MicButton />} />`; Equipo, Registro and Conexiones get `<SpaceSwitcher />` above their `ScreenTitle`; the sidebar's organisation row uses `SpaceAvatar`.
- [ ] `pnpm app:test` and `pnpm app:typecheck` PASS; commit: `feat(app): where you are on every tab, and your spaces in one sheet`.

#### Task 9: Secretaría's first hello

**Files:** create `apps/mobile/lib/hooks/useFirstHello.ts`; modify `packages/shared/src/services/index.ts`, `apps/mobile/app/(app)/(tabs)/index.tsx`; test `apps/mobile/__tests__/firstHello.test.ts`.

**Produces:** `agentHasThreads(client: SupabaseClient, agentId: string): Promise<boolean>` (a `threads` select with `limit 1`); `useFirstHello(org: MyOrganization | null, agents: Agent[], aiReady: boolean): void` — when `org.role === 'owner'`, `aiReady`, and an agent with ghost `secretaria` exists with no threads, it calls `agentHello` once per agent per app session (a module-level `Set` of ids already tried), then `letAgentAnswer`.

- [ ] Tests (services mocked): no call for a member; none without AI; none when she has a thread; exactly one call across two renders; a failed call is retried on a later mount but not on the same render cycle.
- [ ] Implement and call it from Hoy with `canRunAgents(connections.items)`.
- [ ] `pnpm check` PASS; commit: `feat(app): Secretaría says hello on a new space's first Hoy`.

#### Task 10: verify and land PR 2

- [ ] Web at 375×812 and desktop: the switcher on all four tabs, «Tus espacios» with personal and company spaces, the X on each sheet (also opened cold by URL), Secretaría's thread on a new space's Hoy with the engine running (`pnpm engine:dev`).
- [ ] `pnpm pr:land` until it exits `0`; move this plan's **Next** on; when both are landed and seen on beta, retire the plan per `managing-plans-lifecycle`.
