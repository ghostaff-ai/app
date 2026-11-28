# Removing someone from an organisation, and one person with two accounts

**Priority:** medium — today only a terminal with the service-role key can take someone out
**Gate:** none; either founder picks it up
**Next:** decide where the action lives (Personas, under each person) and write the `remove_member` function with its pgTAP test

## What happened (2026-11-28)

Álvaro appeared twice in Órdago's Personas, both owners: one account from signing in with the email code (alvaro.francisco.gil@gmail.com, which created Órdago on 2026-11-12) and one from Google (xxpowervaroxx@gmail.com, from 2026-11-17, with his photo and his chats). Supabase links sign-ins only when the email matches, so two addresses make two people. The app had no way to remove either, so the old account was deleted by hand with `scripts/db-admin.sh beta DELETE /auth/v1/admin/users/<id>`, at Álvaro's word, after checking it held nothing but `created_by` references (set to null on delete) and the test organisation Panaderia, deleted with it.

## What the product lacks

1. **An owner removes a member** from Personas. A `security definer` function `remove_member(target_org, target_user)`: owners only; never the last owner; the private conversations go with the membership ([chat-permissions.md](../ongoing/chat-permissions.md), decision 4). Classified in `settings.ts` (rule 6): the main agent may propose it, an owner approves.
2. **A person leaves** an organisation themselves, with the same last-owner guard.
3. **Deleting your own account** (Apple requires it in the app for the store), which removes every membership first.
4. **Sign-in that doesn't fork a person.** Show which method and address the account uses (in Ajustes), and let a signed-in person link another method (Supabase `linkIdentity`), so signing in with Google after the email code reaches the same account.
