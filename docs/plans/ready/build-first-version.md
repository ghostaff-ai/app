# Build the first version: one engine for several organisations, then the app

**Priority:** high
**Gate:** none
**Next:** Choose the stack (app, backend, record, database, vault, EU hosting) and start phase 1

Covers phases 1 to 3 of [`ghostaff-producto.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#por-fases). We need them for our own projects whether or not Ghostaff becomes a business.

1. **The engine serves several organisations.** Each with its own record, keys and settings. Build the own storage (record, database, file store, vault) and the connector layer here. Órdago's configuration moves out of `agents` (`proyectos/ordago/`) into its record.
2. **Cultuvilla joins, then Álvaro's mother's company.** For each, write down what was shared and what had to be custom. That list is the product spec.
3. **The app** on our phones (TestFlight and Google Play internal testing): decision inbox, weekly summary (also as audio), talking to a department, switching organisation. The way in is the Incorporación (onboarding) agent: paste links and documents, watch the record get built.

Open: `[unknown: which service hosts the git record and the database; chosen when building]`.
