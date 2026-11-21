# Move the edge-functions inspector off Metro's 8083

**Priority:** low — harmless while the edge runtime is off; matters the day it is turned on

**Goal:** turning on Supabase's edge runtime never collides with Ghostaff's own Metro.

## Context

`supabase/config.toml` (`[edge_runtime]`) keeps Supabase's default `inspector_port = 8083`.
8083 is the first port of Ghostaff's Metro series (8083, 8093 … 8173; workspace decision
`_workspace/docs/decisions/dev-port-series.md`), the one `pnpm app:start` takes when no other
copy holds it. Today `enabled = false` (the engine runs on Cloud Run Jobs), so nothing binds
the inspector. Found while landing the port series (2026-11-13).

## Design

Set `inspector_port` to a free port in the 543xx range the rest of the local Supabase stack
already uses (taken: 54320–54324, 54327, 54329; 54325/54326 are commented out), e.g.
`54328`, with a comment naming why it is not 8083. Do it in the same PR that enables the
edge runtime, or before.

## Open questions

- None; it only waits for a reason to touch `[edge_runtime]`.
