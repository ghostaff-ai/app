# The way in: from a link or the store to the team at work

**Priority:** medium — every new person goes through it, and every link from a notification or an invitation depends on it
**Gate:** none for the fixes; decision:Álvaro for the product changes (Open questions)
**Next:** land #19 (the code screen) and #23 (links opened cold); then «Keep where you were going across sign-in»

Jaime asked (2026-11-19) to improve the flows into the app. Reviewed that night on the web against the local Supabase, reading `app/(auth)/entrar.tsx`, `app/(app)/bienvenida.tsx`, `empezar.tsx`, `crear-empresa.tsx`, `unirme.tsx` and the guards in `app/(app)/_layout.tsx`.

## The way in today

1. **Entrar**: Google (Apple on iPhone), or an email and a six-digit code.
2. **Bienvenida**: your name (required), what you do and how you heard of us (optional).
3. **Empezar**: an invitation waiting for you first, then «Crear una empresa» or «Unirme a una empresa».
4. **Hoy**, with the team of ghosts as vacancies to fill.

Each step is a guard in the layout: no profile sends you to Bienvenida, no organisation to Empezar.

## Found, and what is already done

- **A link opened cold landed on Hoy** (a decision from a notification, Conexiones, an invitation). The profile and organisation providers had one render with a person and nothing loaded, which flipped the guards. Fixed in #23.
- **The code screen** made you tap «Entrar» after six digits, had no resend and looked like it had a real code in the placeholder. Fixed in #19 (its end-to-end check failed on the runner, not the code; rerun on 2026-11-19).
- **Signed out, a link still ends on Hoy after signing in**: the target is not kept across the sign-in. To do (below).

## Proposed changes

1. **Keep where you were going across sign-in.** When a guard sends a signed-out person to Entrar, keep the address they opened (the router's current path, in memory and in session storage on the web) and go there once they are in and past Bienvenida and Empezar. An invitation link then lands on the invitation, a decision link on the decision.
2. **An invitation link signs you up for that organisation.** Today the invited person goes through Empezar and has to find «Unirme». If they came from an invitation, skip Empezar and show the invitation straight away (it already is first on Empezar; the link should open it).
3. **Bienvenida asks less.** Only the name is required, and Google and Apple already give it. With a name from the provider, consider skipping the screen and asking the optional questions later, once, on Hoy. Fewer screens before the team is visible.
4. **The first Hoy shows the team working, not a list of vacancies.** «Toca para que empiece» on five ghosts is a lot to choose from cold. Proposal: Secretaría starts on its own when the company is created, and Hoy says what it is doing first («Leyendo cómo es tu empresa…»), with the rest as vacancies below. Needs the engine's first run (build-first-version.md).
5. **Empezar: say what creating a company means**: who will see it (only who you invite), that it costs nothing yet, and that you can create more later.

## Open questions

1. **Skipping Bienvenida** when the provider gave a name: the optional answers (what you do, how you heard of us) feed nothing yet; is losing some of them acceptable?
2. **Secretaría starting by itself** on a new company: the product plan's rule is that agents work only when a person says so; a first run on creation may count as that «yes», or not.
