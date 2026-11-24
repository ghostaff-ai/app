# The agent asks a person for the access it lacks

**Priority:** high — Jaime (2026-11-24): Ghostaff has to handle any customer system without a connector built for each; this is how an agent gets past a missing permission instead of failing
**Gate:** blocked:customer-cloud-access
**Next:** once an organisation has its Google Cloud account, design the access request on top of `account_asks` for Google Cloud first

The principle is in [architecture.md](../../architecture.md#principle-the-agent-asks-a-person-for-the-access-it-lacks). It came up while moving Órdago's agents: each needs grants in `ordago-prod` (BigQuery tables, buckets, a job), and a customer's needs will never all be known ahead.

## The flow

1. **The agent meets a wall.** A permission error from a system it reaches as the organisation's identity (Google Cloud first).
2. **It drafts the request itself**: what it needs, why (the task it is on), the least role that would do, and how to grant it, with the organisation's account already in: `gcloud`/`bq` commands, console steps, or a Terraform fragment (`google_*_iam_member`) for a customer who keeps IAM in code.
3. **It asks a person.**
   - The person talking to it is an owner: asked there, in the conversation.
   - Not an owner: told an owner has been asked; the request reaches the owners.
   - A scheduled run: the request goes to each owner's own chat, and the task waits.
4. **An owner grants it in their own system** and says so. Ghostaff checks the access as the organisation's identity (never as the engine); if it works, the task resumes where it stopped; if not, it says what is still missing.
5. **The grant is kept**: what, on which resource, for which agent and task, asked when, granted by whom. Owners can list them and withdraw one (Ghostaff gives the command to revoke).

## Rules

- **Ghostaff never grants itself anything**, and never asks for a role that would let it (IAM admin, owner, editor on a customer's project).
- **Least access**: a table before a dataset, a dataset before a project, read before write.
- **A request is a proposal from an agent**: it reaches people as an agent's message, never as an action that runs on approval, since the grant happens outside Ghostaff.

## Builds on

- [customer-cloud-access.md](../ongoing/customer-cloud-access.md): the organisation's identity in Google Cloud, and «Comprobar» as that identity.
- `account_asks` (an agent asking for a connector from the chat, [connector-in-chat.md](../ongoing/connector-in-chat.md)): the request and its card.
- [ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md): Órdago's agents are the first to use it.

## Open

- How the agent knows the error is about access, across systems (Google's 403 is clear; others less).
- Other clouds: the same shape once an organisation has an identity there (Workload Identity Federation for AWS or Azure).
