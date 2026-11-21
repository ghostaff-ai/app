# The website: ghostaff.ai, what it is, and the pages the platforms ask for

**Priority:** medium, with one urgent part — Google's OAuth verification and Meta's and TikTok's app reviews need a home page, a privacy policy and terms on our own domain ([connectors.md](../ongoing/connectors.md), phases 2 and 3), and none exists yet
**Gate:** Álvaro — a paid Higgsfield account connected to Claude Code; who the data controller is before the legal pages go up
**Next:** the page is built (ghostaff-ai/web #1) with a placeholder film; with Higgsfield connected, two or three takes of the opening shot for him to judge

Jaime's request (2026-11-19), with foundable.com/es as a loose visual reference («salvando las distancias»). Research of the same night below. Álvaro's decisions of 2026-11-21 are in «Decisions».

## Decisions (Álvaro, 2026-11-21)

1. **A repo of its own, `ghostaff-ai/web`** (created 2026-11-21: Astro, static), copying the brand's tokens and ghost models.
2. **The 3D look: a mix.** An AI-made film (Higgsfield), played by the scroll like Apple's product pages, carries the opening: cinematic versions of our ghosts working in a night office, their paperwork folding into one decision card. The app's own six ghosts appear live in 3D where the page shows the team, and beside each founder. Chosen over a fully hand-built 3D world (igloo.inc, Lusion, Immersive Garden: slower, needs top 3D modelling) and over film alone (less interactive). A paid Higgsfield plan paid by Ghostaff (no watermark); Higgsfield's terms (2026-10-23) leave us the outputs and commercial use, but may train on them, so only our own ghost pictures go in. Shot list: `ghostaff-ai/web`, `docs/film.md`.
3. **The story:** a night office where ghosts do the company's work; the camera moves desk to desk (Finanzas files invoices, Redes writes a post, Secretaría sorts mail); the paperwork flies into one decision card that lands on a phone («Solo te traen lo que es tuyo»); then data in Europe, FAQ, **the founders, Álvaro and Jaime**, «Pedir acceso».
4. **Astro on Firebase Hosting** in `ghostaff-prod`, as proposed below.
5. **Founders:** a real photo, name, role and one line each, with their own ghost beside them; placeholders until they send them.
6. **Legal pages built in the site, not published** until the controller is decided (open question 2).
7. **Spanish and English from the first day** (`/` and `/en/`).
8. **Two or three hero tries first**, as previews he judges, then the rest of the page.

## Goal

1. **Unblock the platforms.** A home page that says what Ghostaff is, `/privacidad` and `/terminos`, in Spanish (English later), at `https://ghostaff.ai`. That is what Google's verification and Meta's and TikTok's reviews check, together with the app's name and logo matching the consent screen.
2. **Explain the product** to a small company's owner who has never heard of it, and get them into the app.

## What to take from the reference (foundable.com/es)

Its home, in order: a hero with its mascot floating in a sky, a line and a call to action; social proof; «from idea to first customer» as five steps that advance with the scroll, each with a screenshot of the app; «real work, not templates», showing what it delivers; what a business needs (domain, payments, approval before sending); figures; an FAQ (it answers «does it act without my approval?»); a final call to action and a footer with the legal pages. Plus Jakarta Sans, a light grey page (`#f5f5f7`), one blue accent, a black pill as the main button, light and dark themes, gentle motion that respects reduced motion.

**Worth borrowing**
1. **The ghosts as the team, in the hero**: our 3D agents floating gently, each with its department's name. They are our mascot already.
2. **«Un día en tu empresa»** as the scroll-driven steps: Dirección, Finanzas, Marketing, each with a real screenshot of the app's calm desk (Hoy, a decision card, the team chat).
3. **Show real work, not features**: a reconciled month, a drafted post waiting for approval, a decision card. Matches «only the decisions that are yours».
4. **An FAQ and a «Seguridad y datos» page**: approval before anything goes out, data in the EU on storage we own, keys in a vault. That is our differentiator, and the same pages serve the platform reviews.
5. **Sober tokens, light and dark, one accent, a dark pill button**, in Rubik for headings like the app.

**To avoid**
1. A wall of borrowed logos: we have no such credibility yet, and should not pretend to.
2. A 14-item mega-menu and dozens of languages: four links (Producto, Seguridad, Precios, Entrar) and ES, later EN.
3. A prompt box in the hero that collects text before sign-up: it means storing data from strangers and clashes with the calm tone.

## Paid tools and their credits

Subscription credits are lost when unused, so each month is planned to spend them (Álvaro, 2026-11-21).

- **Higgsfield**: paid by Álvaro on 2026-11-21 for the film. Subscription credits do not roll over: unused ones expire at the end of each billing month, and after cancelling they stay usable until the paid period ends (Higgsfield help center). Bought credit packs last 90 days.
- **Tripo** (made the app's ghosts): €18 on 2026-11-14 through Link/Stripe, Mastercard ···7405, to the ghostaff Gmail; no cancellation mail found on 2026-11-21, so it likely renews on the 14th. Monthly subscription credits reset on the billing date and do not carry over; cancelling or expiry clears them; bought extra credits never expire (Tripo help, «Do my credits expire?»).

## Where it lives and how it is served

Research of 2026-11-19 (sources in the conversation of that night; prices are list prices):

| Option | Served from | Cost for a small site | Domain and TLS | Fits «data in the EU»? |
|---|---|---|---|---|
| **Firebase Hosting** (static) | Google's global CDN; visitor IP logs kept by Google «a few months», not choosable | Free tier covers it (10 GB stored, 360 MB/day) | Automatic | Yes for public static pages (no customer data). A form or analytics must go elsewhere (below) |
| Cloud Storage bucket in the EU + load balancer + Cloud CDN | Our bucket in the EU; CDN caches worldwide | About 18 USD/month (the load balancer's forwarding rule) | Managed certificate | Yes, logs in our project |
| Cloud Run in europe-west1 | Our region | About 18 USD/month with a load balancer (direct domain mapping is Preview) | Managed certificate | Yes, but a container for static HTML is complexity for nothing |
| Vercel / Netlify | US companies, global edge | Free to 20 USD per user a month | Automatic | No for forms and analytics (no documented EU storage) |

**Proposal:** a static site (Astro) on **Firebase Hosting** in `ghostaff-prod`; a contact form, if any, as a rewrite to a small Cloud Run function in europe-west1 that writes to the database in Frankfurt or sends a mail; no analytics at first (or self-hosted Umami in the EU later; never Google Analytics). If even visitors' IP logs must stay in the EU, the bucket + load balancer + CDN option, at about 18 USD a month.

## Steps

1. **Legal and home, plain** (unblocks the platforms): `/`, `/privacidad`, `/terminos` with the controller's identity, what the app and the connectors collect (each connector's scopes, as in the catalogue), where it is kept (EU), who processes it (Supabase, Google Cloud, the AI provider the organisation chose), retention, rights and contact. Written by us, reviewed by someone who knows GDPR before the platforms see it.
2. **Domain verification**: ghostaff.ai verified in Google Search Console for the OAuth consent screen; the same pages linked from the Google Auth Platform branding, Meta's app settings and TikTok's.
3. **The marketing home**, following «Worth borrowing», with real screenshots of the beta.
4. **«Seguridad y datos»** and the FAQ.

## Open questions

1. **Who is the controller** in the privacy policy before the SL exists: one founder as autónomo, as in connectors.md's open question 4, or wait for the SL. The platforms check the policy names someone real.
2. **Web app at app.ghostaff.ai**: the app already builds for the web (`expo export --platform web`). Serving it too is a separate decision; this plan is only the public site.
