# External parties: the freelancers, companies and services an organisation works with

**Priority:** medium — not in the first version; the record and the agents get more useful once they know who's who outside
**Gate:** decision:how this fits the product plan's rule against contact cards (see Open questions)
**Next:** Álvaro answers open question 1, then this joins the product plan

Álvaro's idea (2026-11-17), written down loosely. Don't treat any detail here as decided.

## Goal

The app models the people and companies outside the organisation that it regularly works with, and what each one does for it. If you always send the designs to a freelance illustrator, or the gestoría always files the quarterly VAT, that is saved in the app, so the agents know who handles what and route work to them instead of asking every time.

## Context

- The product plan's *Incorporación* agent already pulls "socios, clientes y proveedores que se ven" and "las cuentas y servicios que usa la organización" into the first record ([`ghostaff-producto.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#incorporación)). This idea gives that a proper home in the app instead of loose notes.
- The same section says that agent never makes "fichas de empleados o contactos". This idea has to square with that.

## The idea

1. **Three kinds of external party:** a person (a freelancer, an advisor), a company (the gestoría, a client, a supplier) and a service (a SaaS tool, a bank, a platform).
2. **Each one records what it does for the organisation**: "always does the illustrations", "files the quarterly taxes", "prints the posters". That role is the point; contact details are secondary.
3. **Agents use it.** Finanzas knows an invoice from the gestoría is expected each quarter; Marketing knows who to brief for a new illustration; a decision can say "send this to Ana, who usually does it".
4. **It lives in the record** like everything else (files with history), and reaches the app through the database like the rest.

## Open questions

1. **The contact-card rule.** Is this a change to the product decision (it moves from "never" to "only the role and a way to reach them, only what the organisation enters or confirms"), or does it stay companies and services only, with no individual people? Recommendation: allow people, but store only what they do for the organisation and how to reach them, added or confirmed by a person, never scraped. That needs an edit to `ghostaff-producto.md`.
2. **Who adds them:** by hand in the app, proposed by agents from mail and invoices for a person to confirm, or both.
3. **Shared across departments or per department.** Likely one list per organisation, each party tagged with the departments it works with.
