# Connectors: every outside account behind one button

**Priority:** high — Jaime (2026-11-18): without connectors a non-technical person can use, the product is worthless; Álvaro (2026-11-14): connectors are a crucial part of the app
**Gate:** none for the code; trying each maker for real waits on Jaime signing in to it (his Chrome has no session with any of them)
**Next:** Jaime connects Search Console, Analytics and YouTube on the local web (the shared Google callback is fixed); then #21 and #22 (each needs its migration pushed to beta first); an AI account to try an agent using a connected account

## Goal

An organisation connects the accounts it already uses (Instagram, its mail, its bank, Notion…) by pressing a button and accepting, never by copying a key, and its agents can then read and act on them. The [checklist](#the-checklist) at the end is the product's connector list: a line is ticked when that connector works for any organisation, not just for us.

## Context

- **Why it matters, and what the research found:** the product plan's section [Conectores](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#conectores-cómo-entra-y-sale-todo) and the full research of 2026-11-18, [ghostaff-conectores.md](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-conectores.md) (Zernio, what each platform demands, the providers and their costs). The short version: what is worth owning is the *approval* each platform gives an app, not the code; whoever registered the app the person accepted owns that link, and moving away from them makes every customer connect again.
- **What exists today:** `public.connections` holds only AI connections (`kind = 'ai'`), the engine keeps their keys in Secret Manager (`apps/engine/src/vault.ts`), and the Conexiones screen shows them ([llm-connectors.md](llm-connectors.md)). Agents have no tools yet: they only talk (`apps/engine/src/chat.ts`).
- **How Órdago does it today** (`ghostaff-ai/agents`, `proyectos/ordago/`): tokens made by hand by Jaime and Álvaro (`ordago-meta-token`, ElevenLabs, a Google app password for the mailbox), mounted into each agent as environment variables. That is exactly what a customer cannot do.

## The three kinds of connector

Not all «1,000 connectors» are alike. Each app falls into one of three kinds, and each kind is handled differently:

| Kind | What it is | Examples | How we do it |
|---|---|---|---|
| **A. Ours** | The platform reviews any app that acts for someone else, and that is where the value is for a non-technical person | Instagram, Facebook, TikTok, WhatsApp, Google Business Profile, the bank | **Our own app on each platform**, its review passed by us, tokens in our vault in the EU, and our own code for what the agents do (publish a reel, answer a comment). Few, done well |
| **B. The maker's** | The maker publishes an official remote MCP server, so the tools are theirs | Notion, Holded, Factorial, Stripe, Google Drive and Calendar, HubSpot… | **We write no per-app code.** The engine is an MCP client: the person accepts on the maker's screen, the engine keeps that organisation's token in the vault, and the agent gets the maker's tools. Two flavours (below): some makers take any client; others want our app registered with them first |
| **C. Everything else** | Rare apps, apps without an API or MCP, portals | A booking system only one customer uses, the invoices on Meta's billing page | **A general way in:** a forwarding address per organisation (`<org>@…`), uploading a file, a form. Built once, it covers every app of this kind |

**The two flavours of kind B** (audit of official MCP servers, 2026-11-18, with a source for each: [the annex of ghostaff-conectores.md](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-conectores.md#anexo-servidores-mcp-oficiales)):

- **B-open:** the server lets any MCP client register itself (dynamic client registration or a client metadata document), so the button works the day phase 0 is in. Documented as open: Notion (with an official guide for third-party clients), Airtable, Calendly, Factorial. Advertised as open and still to prove with a test account: Holded, Stripe, PayPal, Wix, WordPress.com, Linear, monday, Pipedrive, Typeform, Webflow, Squarespace, TikTok Ads.
- **B-app:** the maker's server, but only for clients registered with the maker: Google Workspace (Gmail, Calendar, Drive, Docs, Sheets), Microsoft 365, HubSpot, Asana, Zoom, Meta Ads, Salesforce, Dropbox. Some add a gate: Slack only for apps in its Marketplace; Canva, ClickUp and Square through an allow-list; Intercom allow-lists redirect addresses; Atlassian lets each customer's admin block us; Box needs each customer's admin to create credentials (no good for us). Google Analytics and Google Ads have official servers that Google does not host: we would run them ourselves.

**Going through a maker's MCP does not lift the maker's own rules.** Gmail through Google's official MCP server still uses our OAuth client and Gmail's restricted scopes, so reading mail still needs the annual CASA assessment; Google's mail server is in developer preview too.

**No official MCP, so kind A or C:** Instagram and Facebook Pages (organic), Google Business Profile, YouTube, Search Console, LinkedIn pages (its MCP only posts job offers), WhatsApp conversations (its MCP only configures the account), Spanish banks and Bizum, Quaderno, Sage, a3.

A connector moves between kinds as the world moves: when a maker publishes an MCP server, an app we handled as C becomes B; if one of ours gets an official MCP that is good enough, it can drop from A to B.

## How one connector works (Instagram, for Órdago)

1. In Conexiones, an owner presses «Conectar Instagram». The engine opens a connect session tied to the organisation and sends them to Meta.
2. Meta asks: «¿Dejas a **Ghostaff** publicar en tu cuenta?» The name is that of whoever registered the app; with ours, it says Ghostaff.
3. They accept. Meta returns a one-time code; the engine swaps it for an access token and a refresh token.
4. The tokens go to the vault (one secret per organisation and account, EU only). `connections` records only that it exists: provider, account name, scopes, who, when, health.
5. Out of sight, the engine renews the token before it expires and saves the new one before anything else (losing a refreshed token is how connections break for everyone at once).
6. The Marketing agent proposes a reel; a person says OK in the decision inbox. The agent calls a tool such as `publish_reel`; the engine adds the organisation from the run, never from the model, so an agent can never act for another organisation or see a token.
7. Comments and stats come back by webhook or polling, stored per organisation.

Kind B is the same flow with the maker's consent screen in step 2 and the maker's tools in step 6.

## Architecture

- **One `connections` table for every kind.** `kind` grows past `'ai'` (`'account'`); `method` grows to `'oauth'`, `'mcp'`, `'forwarding'`. Still never a token in the table, still only the engine writes (invariant 3).
- **Tokens in the vault we already have.** Secret Manager, one secret per organisation and account. Refresh, locks and revocation either in the engine or in a self-hosted Nango in `europe-west1` (open question 2).
- **Agents see one shape of tool.** Our kind-A connectors are exposed to agents the same way as a maker's MCP server (our own MCP server, or tools with the same contract), so an agent does not care who built a tool and a connector can move between kinds without touching agents.
- **Writes wait for an owner's approval** (built, `apps/engine/src/actions.ts`). A tool that creates or changes something outside Ghostaff never runs when the model asks: the engine records it in `agent_actions` and shows a card in the agent's message; it runs, from the stored row and exactly once, only when an owner presses «Aprobar». That is also what stops text the agent reads (a comment, a review, a page) from talking it into acting. Reads need no approval. A kind of action earning autonomy later is a separate decision.
- **Health is visible.** Each connection shows ok or failing in Conexiones; a failing one becomes a decision for an owner («Instagram se ha desconectado: vuelve a conectar»), never a silent gap in an agent's numbers.

## How we iterate

**[Phase 0](#phases) lays the foundation once.**

**Then one connector at a time, each through the same four steps:**

1. **Works for Órdago** (organisation zero), in the platform's test mode if its review is not passed yet.
2. **Works for anyone:** the platform's review passed; for kind B, our client and our redirect address accepted by the maker, checked with an account that is not ours.
3. **In the app:** its card in Conexiones, with a short guide when the platform needs a step from the person (an Instagram account must be professional and linked to a Facebook page).
4. **Proven:** an end-to-end flow where one is possible, and its health check.

A line in the checklist is ticked only after step 4.

**What comes next is chosen by demand, not by catalogue size.** An organisation can ask for a connector it is missing («Conectar otra app» → name it); each request is counted, and the most requested kind-B or kind-C app goes next. Kind A is planned ahead, since each platform's review takes its own time and only starts once there is a working product to film.

## Phases

Ordered by what Jaime put first (2026-11-18): Google (calendar, spreadsheets, reviews), then Instagram and TikTok, then invoices. Everything else waits until someone asks. Each phase says what we do and which connectors it opens.

**Phase 0: the foundation.**
- Built (branch `feat/connectors-google`): agents get tools that act for one organisation, with the organisation taken from the run and never from the model (`apps/engine/src/tools.ts`, `accounts.ts`); connecting by signing in with a one-time state and PKCE, finished by the app as the person who started it (so nobody can get a stranger's account into their own organisation by sending them a sign-in link); tokens in the vault, the database keeping only the account's email and granted scopes; a connection Google stops honouring turns `failing` and the card says to reconnect.
- Still to do: the forwarding address, uploading a file, asking for a connector we lack, and the engine as an MCP client for the makers' servers (open question 3).
- *Opens:* the forwarding address (Finanzas gets invoices and bank notices from day one), uploading a file, asking for a connector we lack.

**Phase 1: Google.** One OAuth client, «Ghostaff Conectores» in `ghostaff-prod`, opens several apps.
- Calendar and Sheets first (built on the same branch). Sheets is how an agent hands over an Excel: it creates the spreadsheet in the organisation's Drive, and it downloads as .xlsx from there. Through Google's stable REST APIs: its MCP servers for Calendar and Sheets are still a developer preview.
- Then answering Google reviews (Google Business Profile, kind A: no MCP; its API needs an access form first), Drive files the person picks, Search Console and Analytics.
- While the Google app is in Testing, a connection lasts seven days and only listed test users can connect. Verifying it (sensitive scopes only, no security assessment) needs a home page and a privacy policy on ghostaff.ai, the same ones Google sign-in waits for ([build-first-version.md](build-first-version.md)).
- *Opens:* Google Calendar, Google Sheets, Google Business Profile reviews, Drive files the person picks, Search Console, Google Analytics.

**Phase 2: Instagram and TikTok, ours.** The first kind-A connectors, and what Marketing needs.
- Decide first: whose name the apps go in (open question 4), and own vault or Zernio (open question 1).
- Build publishing (reels, carousels, video), stats and comments for Instagram and Facebook Pages on our Meta app, and publishing and stats for TikTok with the consent screen TikTok's audit checks (the account's name, avatar and privacy options shown before posting).
- Órdago uses it first in Meta's test mode (`@ordago.app` given a role in our app), which retires the hand-made `ordago-meta-token`. TikTok without its audit only posts privately, so Órdago keeps its current way there until the audit passes.
- Film each permission working, verify the business with Meta, send Meta's App Review and TikTok's audit.
- *Opens:* Instagram, Facebook Pages, TikTok.

**Phase 3: invoices.**
- Receiving them is phase 0's forwarding address.
- Issuing them is not ours to build: an invoice a Spanish company sends must come from invoicing software that meets the tax agency's rules (Verifactu), so the agent issues it through the organisation's own tool. Holded first, through its official MCP server (kind B-open).
- *Opens:* Holded.

**On demand.** Built when an organisation asks and, where there is a cost or a heavy review, pays for it: the rest of kind B-open (Factorial, Stripe, Notion, Calendly, Wix, WordPress.com…), the rest of kind B-app (Microsoft 365, HubSpot, Shopify, Slack…), reading Gmail (CASA every year, 499–5,400 USD), bank movements (an aggregator), WhatsApp conversations, YouTube, LinkedIn pages (needs the SL), X.

## The checklist

`[ ]` not started · `[~]` started (say which step) · `[x]` ticked, with its date. Within each list, the order is the order we expect to build them; demand reorders it.

### Kind A — ours

- [~] Instagram (publish photos, reels and carousels; stats; read, answer and hide comments) — built (`apps/engine/src/instagram.ts`, Instagram API with Instagram Login: a professional account, no Facebook page). Waits for our Meta app; until Meta's App Review, only accounts with a role in the app connect
- [ ] Facebook Pages — same Meta review
- [~] TikTok (upload videos, list videos and stats) — built (`apps/engine/src/tiktok.ts`, the engine uploads the file itself, so no domain to verify). Waits for our TikTok app; until TikTok's audit, posts can only be private
- [~] Google Business Profile reviews (read and answer) — built as its own card on our Google OAuth client (`business.manage`, `apps/engine/src/googleBusiness.ts`); Google answers 403 until our access request for the Business Profile APIs is approved
- [ ] WhatsApp Business conversations — Meta Tech Provider, 10 new customers a week until verified
- [~] Google Search Console (searches, clicks, position) — built as its own read-only card (`webmasters.readonly`, `apps/engine/src/googleInsights.ts`); API enabled in `ghostaff-prod` 2026-11-19
- [~] YouTube (channel, videos and their numbers, comments; reading only) — same file, `youtube.readonly`; answering comments needs `youtube.force-ssl`, left out until asked. Quota audit past 10,000 units a day
- [ ] LinkedIn pages — needs a registered company; a rejection kills the app
- [ ] Bank movements (PSD2) — an aggregator, price on request
- [ ] X — pay per use (0.20 USD a post with a link); only if someone asks

### Kind B-open — the maker's, any client

All built on `feat/connectors-google` through one generic MCP connector (`apps/engine/src/mcp.ts`), each a line in the catalogue (`packages/shared/src/connectors.ts`). Discovery checked against every real server on 2026-11-18; none has yet been connected with a real account (step 1).

- [~] Holded (invoices, contacts, accounting) — the organisation must have Holded's API turned on
- [~] Stripe (payments) — OAuth per account; Connect platforms need an agent key instead
- [~] Notion
- [~] Calendly (bookings on paid plans)
- [~] Factorial (time off, clocking, people) — wants a confidential client: the engine registers one and keeps its secret in the vault
- [~] Wix (site, store, bookings)
- [~] WordPress.com (sites hosted on WordPress.com only) — asks for the server's whole scope list, `global` included; narrow it if the consent screen is too broad
- [~] Airtable
- [~] Pipedrive — without admin and mail-sending scopes
- [~] monday.com
- [~] Typeform
- [~] Linear
- [~] Webflow
- [~] PayPal
- [~] Squarespace — takes only a client metadata document, so it connects from an https engine (beta), never from localhost
- [ ] TikTok Ads — read only, Marketing never pays for ads

Added 2026-11-19, same checks (discovery and open registration seen on each real server, nothing registered):

- [~] Buffer (schedule posts on Facebook, LinkedIn, X, Pinterest, Threads…) — the way to Facebook and LinkedIn without our own Meta or LinkedIn review
- [~] Qonto (business bank: movements, client and supplier invoices, payment links) — asks for no transfer, card or bank-account scope
- [~] Square (sales, payments, catalogue, appointments)
- [~] SumUp (card payments) — client metadata document only: beta, never localhost
- [~] Mailchimp — asks for no send, delete or account scope
- [~] Brevo, MailerLite, Klaviyo (mail marketing)
- [~] Semrush (SEO) — the organisation's plan must include API access
- [~] Cal.com, Jotform, Tally (bookings and forms)
- [~] Attio, Close (CRM; Close without its destructive scope)
- [~] Zendesk (support) — client metadata document only: beta, never localhost
- [~] ClickUp, Todoist, Miro
- [~] Gamma (presentations) — refuses a localhost redirect URI: beta only (`httpsOnly`)
- [~] Fireflies, Granola, tl;dv (meeting notes)
- [~] Zapier, Make — a door to thousands of apps more; each call spends the organisation's Zapier tasks or Make operations

Checked on 2026-11-19 and not added here: Asana, HubSpot, Xero, DocuSign, Zoom and Canva take only a registered app (now under B-app, below); Box, Smartsheet and GitHub likewise, not added (below); Figma, Intercom and Atlassian keep an allow-list of clients or redirects; Shopify, Zoho and Freshworks have no remote server at the obvious address; Sentry, Cloudflare, Vercel, Netlify, Supabase and Plaid are for developers, not our customers; Wise moves money and Apollo sends mail, both left until someone asks.

### Kind B-app — the maker's, our app registered first

- [~] Google Calendar (see and create events) — step 1: built, waiting for the OAuth client to try it with a real account
- [~] Google Sheets (create a spreadsheet: the Excel) — step 1, same
- [~] Google Docs (create a document from HTML: the Word) — on the Google card, `drive.file`, no new consent
- [ ] Google Drive, reading — reading every file is a restricted scope, so only files the person picks (Google Picker)
- [ ] Gmail, reading (invoices, notices) — restricted scope: CASA every year, 499–5,400 USD
- [~] Google Analytics (GA4 reports: visits, where they come from, pages) — its own read-only card (`analytics.readonly`), our own tools rather than Google's server; Admin and Data APIs enabled 2026-11-19
- [~] Microsoft 365 (Outlook mail and drafts, calendar, OneDrive and Excel) — our own tools over Graph (Microsoft's Work IQ server needs a Copilot licence and an admin); scopes a person consents to alone, never `Mail.Send`; waits for our Entra app
- [~] HubSpot — `mcp.hubspot.com` (beta); waits for our MCP connector app
- [ ] Meta Ads — read only; our Meta app
- [ ] Google Ads — read only; Google's official server, run by us
- [ ] Shopify — `[unknown: whether its store-admin MCP takes clients other than Claude and ChatGPT]`
- [~] Asana — `mcp.asana.com/v2/mcp`; waits for our «MCP app», distributed to any workspace
- [~] Zoom — `mcp.zoom.us`; waits for our General app (until Zoom reviews it, only our own account, or ~10 beta users)
- [~] Canva — Canva Connect's server (`api.canva.com/connect/v1/mcp`), which takes our own app with «Canva MCP» on; its redirects take `127.0.0.1`, not `localhost`
- [~] Xero — `api.xero.com/mcp/v1`; our app needs Xero's Core developer plan or above for the remote server; no payments or bank writes asked
- [~] DocuSign — `mcp.docusign.com`; our integration key, DocuSign's production allow-list form, and each customer's admin turning MCP on
- [ ] Slack — its MCP server is for Marketplace apps only (10 active workspaces, then a review of up to 10 weeks)
- [ ] Intercom — allow-listed redirect; has an EU server
- [ ] Atlassian (Jira, Confluence) — Developer Console apps do not work with its server (ROVO-870); only open registration plus each customer's admin allowing us
- [ ] Salesforce — External Client App, but the server's address is per customer (My Domain), and one app across customers' orgs is unverified
- [ ] Box — the server takes credentials each customer's admin creates; our own app unverified
- [ ] Dropbox — back from B-open: its registration answers «Only pre-registered MCP trusted partners» (2026-11-21); `app: true` until we are one
- [ ] GitHub, Smartsheet — GitHub publishes no authorization metadata and its OAuth tokens never expire (the engine assumes they do); Smartsheet's own-app use is undocumented

The B-app cards above that use a maker's server (`app: true` in the catalogue) and Microsoft read our app from the vault, `engine-app-<id>`, put there by `scripts/connector-app.sh`: no env var, no deploy. Until it is there the card answers «todavía no está disponible».

### Kind C — the general ways in

- [ ] Forwarding address per organisation — to decide first: the domain (`<org>@in.ghostaff.ai`?) and an inbound mail service that keeps mail in the EU and calls the engine (Postmark's EU servers, Mailgun EU, or our own MX on Cloud Run); where attachments are stored (open question of the upload below)
- [ ] Upload a file (a bank export, a spreadsheet) — to decide first: storage per organisation in the EU (Supabase Storage in Frankfurt with a bucket policy per `org_id`, or Cloud Storage in `europe-west1`), and how an agent reads it (a tool that lists and reads the organisation's files)
- [~] Ask for a connector we lack (and count the requests) — step 3 on `feat/connector-requests` (2026-11-20): «Pedir X» when the search finds nothing and «¿Falta alguna?» at the end of the list, any member, once per organisation and app (`connector_requests`, `request_connector`). Count them with the service role: `select lower(name), count(*) from public.connector_requests group by 1 order by 2 desc`

## Handoff

State on 2026-11-19 (branch `feat/connectors-google`, not merged): 54 cards built and unit-tested, grouped by area in Conexiones with a search box (5 Google cards, Microsoft 365, Instagram, TikTok, 46 makers' MCP servers, 6 of them through our own app); none yet connected with a real account. What each still needs, in the order to do it:

**2026-11-21, every card pressed in Jaime's Chrome on the local stack (a subagent, Jaime's OK):**
- **Reach the maker's sign-in** (discovery and registration work; nobody signed in, so not connected): Stripe, PayPal, Qonto, Buffer, Square, Mailchimp, Brevo, MailerLite, Klaviyo, Semrush, Calendly, Cal.com, Typeform, Jotform, Pipedrive, Attio, Close, Factorial, Notion, Airtable, monday, Linear, ClickUp, Todoist, Miro, Wix, WordPress.com, Webflow, Fireflies, Granola, tl;dv, Zapier, Make; and, after the fixes below, Holded and Tally.
- **Fixed on `fix/connector-callbacks`:** the four new Google cards asked Google for their own callback (`/searchconsole/callback`…), which the OAuth client doesn't list (`redirect_uri_mismatch`): every Google card now returns to `/google/callback` and the attempt says which card it was. Holded answers its registration with `software_id: null`, which the SDK refused: our own registration reads nulls as absent and keeps the server's reason when it refuses. Tally's server moved to `api.tally.so/mcp`. Dropbox takes only partners (now B-app); Gamma refuses localhost (beta only).
- **Not available, as expected:** Squarespace, SumUp, Zendesk, Gamma (locally); HubSpot, Asana, Zoom, Canva, Xero, DocuSign, Dropbox, Microsoft 365, Instagram, TikTok (our app missing).

**Night of 2026-11-19 (Claude with Jaime's OK):**
- **Step 1:** Google (calendar, sheets, docs) connected for real with ghostaff.ai@gmail.com from the local web app; the web's connect popup never finished until `maybeCompleteAuthSession` (fixed on the branch). Notion and Stripe reach their makers' sign-in (discovery and registration work); not connected, as Jaime's Chrome has no session there. Not yet tried: an agent using the connected account (no AI account locally; step 2).
- **Step 6, apps created with ghostaff.ai@gmail.com** (client IDs are public; the secrets are in each portal, to be put in the vault by hand with `scripts/connector-app.sh`):
  - `hubspot`: MCP connector «Ghostaff» in HubSpot's EU portal 149819111, client ID `9f8f1436-6f3f-440b-9fd4-fb48bbb038ee`, both redirect URIs. The EU portal authorises at `mcp-eu1.hubspot.com`, the catalogue points at `mcp.hubspot.com`: check which one the connect lands on.
  - `asana`: MCP app «Ghostaff», client ID `1220721839539578`, both redirect URIs, distribution «any workspace». Press «Restablecer» on its secret before copying it: the one shown that night passed through a tool's output.
  - Not created: TikTok (developer accounts take email and password only), Meta (needs a Facebook account), Microsoft (needs a Microsoft account), Zoom (asks a birth year at sign-up), Canva, Xero, DocuSign (phase 4 anyway). Google Business Profile's access form not sent: Ghostaff has no Business Profile to ask with.
- **Step 7 was already done** by another session: the migration is on ghostaff-beta and the engine at the branch's commit is on Cloud Run.

1. **Try the local ones (Jaime, no one else needed).** With the branch's engine and Metro running locally, open Conexiones (simulator or http://localhost:8083) and press Conectar on each card you have an account for: Google (calendar and sheets) first, then Holded, Stripe, Notion, Calendly and the rest. Each one: sign in there and accept. Google needs the account listed as a test user in the Google Auth Platform (`ghostaff-prod`, Audience). Squarespace, SumUp and Zendesk cannot connect locally (they need the https engine; locally their card answers «todavía no está disponible»). The new Google cards (Search Console, Analytics, YouTube) ask for scopes not yet listed in the Google Auth Platform's Data access: they work for test users with Google's «unverified» warning; list them there before verification.
2. **An AI account for the agents**, or the chat cannot use any of it: enable Claude in Vertex AI Model Garden in `ghostaff-prod` (accept Anthropic's terms there), or connect an Anthropic key in Conexiones.
3. **Google reviews:** request access to the Business Profile APIs for project `ghostaff-prod` (Google's access form, linked from developers.google.com/my-business/content/prereqs). Until it is granted every review call answers 403.
4. **Our Meta app (Instagram):** in Meta for Developers create an app «Ghostaff», use case «Manage messaging and content on Instagram», business login with Instagram. Redirect URI: `https://engine-664656500315.europe-west1.run.app/connections/oauth/instagram/callback` (Meta takes https only, so it is tried on beta). Add `@ordago.app` as an Instagram tester. Put the Instagram app ID in `scripts/deploy-engine.sh` and its secret in Secret Manager as `instagram-app-secret`.
5. **Our TikTok app:** in TikTok for Developers create an app «Ghostaff» with Login Kit and Content Posting API (Direct Post), scopes `user.info.basic`, `user.info.stats`, `video.list`, `video.publish`, redirect URI `https://engine-664656500315.europe-west1.run.app/connections/oauth/tiktok/callback`. Client key in `scripts/deploy-engine.sh`, secret in Secret Manager as `tiktok-client-secret`.
6. **Our apps with the B-app makers.** In each portal, an app named «Ghostaff» with two redirect URIs, beta `https://engine-664656500315.europe-west1.run.app/connections/oauth/<id>/callback` and local `http://localhost:8787/connections/oauth/<id>/callback` (Canva: `http://127.0.0.1:8787/…`, and run the local engine with `ENGINE_PUBLIC_URL=http://127.0.0.1:8787`). Then `bash scripts/connector-app.sh beta <id> <client-id>` (and `prod` once production's callback is in the portal) and paste the secret at its hidden prompt.
   - `microsoft`: entra.microsoft.com, App registrations, «Accounts in any organizational directory and personal Microsoft accounts», Web platform; delegated Graph permissions `User.Read Mail.ReadWrite Calendars.ReadWrite Files.ReadWrite offline_access`; a client secret. Publisher verification (a Microsoft Partner Network ID) before customers see it as verified.
   - `hubspot`: developers.hubspot.com, Development, MCP Connectors, «Create MCP connector».
   - `asana`: app.asana.com/0/my-apps, Create new app, type «MCP app»; Manage distribution, «Any workspace».
   - `zoom`: marketplace.zoom.us, Develop, Build app, General app, user-managed; the scopes the card lists (no delete).
   - `canva`: canva.com/developers, an integration, «Outside Canva», turn on «Canva MCP»; the scopes the card lists.
   - `xero`: developer.xero.com/app/manage, a Web app; the Core plan for the remote MCP server.
   - `docusign`: developers.docusign.com, Apps and Keys, an integration key with a secret; then the go-live and MCP allow-list form.
7. **Beta (whoever holds the Supabase login: Álvaro, and Jaime since 2026-11-19):** `npx supabase link --project-ref rggvcvnstbitbdptiwtk`, `npx supabase db push` for `20261119000000_account_connections.sql`, then `CLOUDSDK_ACTIVE_CONFIG_NAME=ghostaff-prod bash scripts/deploy-engine.sh` (Colima running). Only then merge the PR: merging first would show the new cards in the beta app against an engine that cannot connect them.

## Known gaps

From the security review of 2026-11-19; fixed on the branch unless listed here. Fixed since on `fix/connectors-hardening` (2026-11-20): two instances refreshing the same token (a lease per account in `refresh_leases`, taken before refreshing) and TikTok's video fetch reaching a private address behind a public name (`apps/engine/src/publicFetch.ts`, checked at connect time).

- **`ghostaff://` on Android can be claimed by another app.** The engine sends the provider's code only to the app's scheme (or a listed web origin), and only the person who started can finish, but an app registering the same scheme could read the code. Fix: verified App Links / Universal Links for the return address.
- **Approving is owners only.** Whether a member with «talk» on the agent may approve some kinds of action is a product decision (Álvaro).

## Open questions

1. **Own vault or Zernio for social networks** (the gate). If invariant 2 covers social tokens, only our own apps and vault meet it. If it does not, Zernio with our own app ids (`oauthAppId`, where the platform allows it) is cheaper and covers video publishing for us. Before deciding, ask Zernio in writing where tokens live.
2. **Nango or our own refresh code.** Self-hosted Nango (Elastic License 2.0) brings what Nango learnt the hard way about refresh and rate limits; our own code avoids running another service. `[unknown: what the free self-hosted Nango leaves out, and whether ELv2 allows our use]`
3. ~~How the engine gives a maker's MCP tools to an agent.~~ Settled 2026-11-18: the engine is the MCP client itself (`apps/engine/src/mcp.ts`, the official TypeScript SDK), so it works whatever model provider runs the agent, Vertex AI in the EU included. It signs in as the MCP authorisation spec asks: a client metadata document at a Ghostaff URL where the server takes one and the engine is on https, otherwise a client registered once per server and kept in the vault; PKCE and the `resource` parameter on every request; tokens kept per organisation and server, refreshed and rotated by the engine. A server's tools are listed once per access token and named `<connector>_<tool>`.
4. **Whose name the platform apps are in.** Only LinkedIn requires a registered company. Meta verifies the business, and by consultants' accounts a registered autónomo passes `[unknown: which documents Meta accepts from an autónomo in Spain]`; TikTok asks for no legal form in what was read. So one of the founders as autónomo could hold the Meta and TikTok apps now, or we wait for the SL and skip moving them later. It is in the product plan's «Por decidir entre los dos».
