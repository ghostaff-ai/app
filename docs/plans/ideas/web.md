# The website: ghostaff.ai, what it is, and the pages the platforms ask for

**Priority:** medium, with one urgent part — Google's OAuth verification and Meta's and TikTok's app reviews need a home page, a privacy policy and terms on our own domain ([connectors.md](../ongoing/connectors.md), phases 2 and 3), and none exists yet
**Gate:** decision:Álvaro — where the site lives (a repo of its own?) and whether the legal pages can go up before the SL exists (Open questions)
**Next:** the three legal-and-home pages first, plain, at ghostaff.ai; the full marketing site after

Jaime's request (2026-11-19), with foundable.com/es as a loose visual reference («salvando las distancias»). Research of the same night below; nothing here is decided.

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

1. **A repo of its own** (`ghostaff-ai/web`) or a folder in this one? A repo of its own keeps the app's CI and release pipeline free of the site; a folder keeps one place for the brand's tokens. Proposal: its own repo, copying the tokens.
2. **Who is the controller** in the privacy policy before the SL exists: one founder as autónomo, as in connectors.md's open question 4, or wait for the SL. The platforms check the policy names someone real.
3. **Web app at app.ghostaff.ai**: the app already builds for the web (`expo export --platform web`). Serving it too is a separate decision; this plan is only the public site.
