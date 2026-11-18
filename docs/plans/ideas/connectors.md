# Connectors: every outside account behind one button

**Priority:** high — Jaime (2026-11-18): without connectors a non-technical person can use, the product is worthless; Álvaro (2026-11-14): connectors are a crucial part of the app
**Gate:** decision:Álvaro takes this to ready/, since what gets built here is his call (Jaime's proposal, 2026-11-18)
**Next:** give the engine's agents tools that act for one organisation (stage 0 below); it is needed whichever way open question 1 goes

## Goal

An organisation connects the accounts it already uses (Instagram, its mail, its bank, Notion…) by pressing a button and accepting, never by copying a key, and its agents can then read and act on them. The [checklist](#the-checklist) at the end is the product's connector list: a line is ticked when that connector works for any organisation, not just for us.

## Context

- **Why it matters, and what the research found:** the product plan's section [Conectores](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#conectores-cómo-entra-y-sale-todo) and the full research of 2026-11-18, [ghostaff-conectores.md](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-conectores.md) (Zernio, what each platform demands, the providers and their costs). The short version: what is worth owning is the *approval* each platform gives an app, not the code; whoever registered the app the person accepted owns that link, and moving away from them makes every customer connect again.
- **What exists today:** `public.connections` holds only AI connections (`kind = 'ai'`), the engine keeps their keys in Secret Manager (`apps/engine/src/vault.ts`), and the Conexiones screen shows them ([llm-connectors.md](../ongoing/llm-connectors.md)). Agents have no tools yet: they only talk (`apps/engine/src/chat.ts`).
- **How Órdago does it today** (`ghostaff-ai/agents`, `proyectos/ordago/`): tokens made by hand by Jaime and Álvaro (`ordago-meta-token`, ElevenLabs, a Google app password for the mailbox), mounted into each agent as environment variables. That is exactly what a customer cannot do.

## The three kinds of connector

Not all «1,000 connectors» are alike. Each app falls into one of three kinds, and each kind is handled differently:

| Kind | What it is | Examples | How we do it |
|---|---|---|---|
| **A. Ours** | The platform reviews any app that acts for someone else, and that is where the value is for a non-technical person | Instagram, Facebook, TikTok, WhatsApp, Google Business Profile, the bank | **Our own app on each platform**, its review passed by us, tokens in our vault in the EU, and our own code for what the agents do (publish a reel, answer a comment). Few, done well |
| **B. The maker's** | The maker publishes an official remote MCP server, so the tools are theirs | Notion, Holded, Factorial, Stripe, Google Drive and Calendar, HubSpot… | **We write no per-app code.** The engine is an MCP client: the person accepts on the maker's screen, the engine keeps that organisation's token in the vault, and the agent gets the maker's tools. Two flavours (below): some makers take any client; others want our app registered with them first |
| **C. Everything else** | Rare apps, apps without an API or MCP, portals | A booking system only one customer uses, the invoices on Meta's billing page | **A general way in:** a forwarding address per organisation (`<org>@…`), uploading a file, a form. Built once, it covers every app of this kind |

**The two flavours of kind B** (audit of official MCP servers, 2026-11-18, with a source for each: [the annex of ghostaff-conectores.md](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-conectores.md#anexo-servidores-mcp-oficiales)):

- **B-open:** the server lets any MCP client register itself (dynamic client registration or a client metadata document), so the button works the day stage 0 is in. Documented as open: Notion (with an official guide for third-party clients), Airtable, Calendly, Factorial. Advertised as open and still to prove with a test account: Holded, Stripe, PayPal, Wix, WordPress.com, Linear, monday, Pipedrive, Typeform, Webflow, Squarespace, TikTok Ads.
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
- **Writes go through a decision.** The product rule stays: the agent proposes, a person approves, then it happens, until that kind of decision has earned autonomy. Reads need no approval.
- **Health is visible.** Each connection shows ok or failing in Conexiones; a failing one becomes a decision for an owner («Instagram se ha desconectado: vuelve a conectar»), never a silent gap in an agent's numbers.

## How we iterate

**Stage 0, once: the foundation.** Agents get tools that act for one organisation; the generic connection model above; Conexiones lists every kind; health and the reconnect decision; the forwarding address (kind C). Nothing here waits on the gate except where the social tokens live.

**Then one connector at a time, each through the same four steps:**

1. **Works for Órdago** (organisation zero), in the platform's test mode if its review is not passed yet.
2. **Works for anyone:** the platform's review passed; for kind B, our client and our redirect address accepted by the maker, checked with an account that is not ours.
3. **In the app:** its card in Conexiones, with a short guide when the platform needs a step from the person (an Instagram account must be professional and linked to a Facebook page).
4. **Proven:** an end-to-end flow where one is possible, and its health check.

A line in the checklist is ticked only after step 4.

**What comes next is chosen by demand, not by catalogue size.** An organisation can ask for a connector it is missing («Conectar otra app» → name it); each request is counted, and the most requested kind-B or kind-C app goes next. Kind A is planned, since each review has its own lead time and needs the company (SL) first.

**The order, as far as it is known today:**

1. Stage 0, and the forwarding address, which already serves Finanzas (invoices, bank notices) for every organisation.
2. Kind B-open for what Spanish small companies use, as soon as stage 0 is in: Holded and Factorial first, then Stripe, Notion, Calendly and the shop builders (Wix, WordPress.com). No review and no cost per app. Then the Google Workspace B-app connectors that need only a sensitive scope (Calendar, Drive files we are given), once our Google OAuth client is verified.
3. Meta (Instagram and Facebook Pages, one review) and TikTok: what Órdago needs. Meta's test mode serves Órdago now if `@ordago.app` has a role in our app; TikTok without its audit only posts privately, which is not enough. Both reviews need the SL.
4. Google Business Profile, WhatsApp, YouTube, LinkedIn.
5. Reading Gmail directly (the annual CASA assessment, 499–5,400 USD) and the bank through an aggregator, when paying customers ask for them.

## The checklist

`[ ]` not started · `[~]` started (say which step) · `[x]` ticked, with its date. Within each list, the order is the order we expect to build them; demand reorders it.

### Kind A — ours

- [ ] Instagram (publish, stats, comments) — Meta review, needs the SL
- [ ] Facebook Pages — same Meta review
- [ ] TikTok (publish, stats) — Content Posting API audit
- [ ] Google Business Profile (reviews, posts) — access form
- [ ] WhatsApp Business conversations — Meta Tech Provider, 10 new customers a week until verified
- [ ] Google Search Console — our Google OAuth client
- [ ] YouTube — quota audit past 10,000 units a day
- [ ] LinkedIn pages — needs a registered company; a rejection kills the app
- [ ] Bank movements (PSD2) — an aggregator, price on request
- [ ] X — pay per use (0.20 USD a post with a link); only if someone asks

### Kind B-open — the maker's, any client

- [ ] Holded (invoices, contacts, accounting) — the organisation must have Holded's API turned on
- [ ] Factorial (time off, clocking, people)
- [ ] Stripe (payments) — OAuth per account; Connect platforms need an agent key instead
- [ ] Notion
- [ ] Calendly (bookings on paid plans)
- [ ] Wix (site, store, bookings)
- [ ] WordPress.com (sites hosted on WordPress.com only)
- [ ] PayPal
- [ ] Airtable
- [ ] Pipedrive
- [ ] monday.com
- [ ] Linear
- [ ] Typeform
- [ ] Webflow
- [ ] Squarespace
- [ ] TikTok Ads — read only, Marketing never pays for ads

### Kind B-app — the maker's, our app registered first

- [ ] Google Calendar — our Google OAuth client, sensitive scope
- [ ] Google Drive, Docs, Sheets — same client; reading every file is a restricted scope, so only files the person picks
- [ ] Gmail, reading (invoices, notices) — restricted scope: CASA every year, 499–5,400 USD
- [ ] Google Analytics — Google's official server, run by us
- [ ] Microsoft 365 (Outlook, calendar, OneDrive) — our Entra app, publisher verification
- [ ] HubSpot — our MCP auth app
- [ ] Meta Ads — read only; our Meta app
- [ ] Google Ads — read only; Google's official server, run by us
- [ ] Shopify — `[unknown: whether its store-admin MCP takes clients other than Claude and ChatGPT]`
- [ ] Dropbox — our Dropbox app
- [ ] Asana — our MCP app
- [ ] Zoom — our Zoom app
- [ ] Slack — needs our app listed in Slack's Marketplace
- [ ] Canva — allow-list and app verification
- [ ] Intercom — allow-listed redirect; has an EU server
- [ ] Atlassian (Jira, Confluence) — each customer's admin can block us
- [ ] Salesforce — our External Client App

### Kind C — the general ways in

- [ ] Forwarding address per organisation
- [ ] Upload a file (a bank export, a spreadsheet)
- [ ] Ask for a connector we lack (and count the requests)

## Open questions

1. **Own vault or Zernio for social networks** (the gate). If invariant 2 covers social tokens, only our own apps and vault meet it. If it does not, Zernio with our own app ids (`oauthAppId`, where the platform allows it) is cheaper and covers video publishing for us. Before deciding, ask Zernio in writing where tokens live.
2. **Nango or our own refresh code.** Self-hosted Nango (Elastic License 2.0) brings what Nango learnt the hard way about refresh and rate limits; our own code avoids running another service. `[unknown: what the free self-hosted Nango leaves out, and whether ELv2 allows our use]`
3. **How the engine gives a maker's MCP tools to an agent.** The engine calls Claude through the Messages API today, not the Agent SDK the product plan names. Either way the engine registers as an MCP client the way the MCP authorisation spec (2026-07-28) asks: our pre-registered client where the maker requires one, otherwise a client metadata document at a Ghostaff URL, dynamic registration only as a last resort (the spec now deprecates it); PKCE, the `resource` parameter on every token request, and tokens kept per organisation and server. `[unknown: whether the Messages API's MCP connector works on Vertex AI in the EU, or whether the engine must be the MCP client itself]`
4. **When the SL is constituted.** Every kind-A review waits for it (LinkedIn by rule, Meta in practice), so it sets the date of step 3 of the order.
