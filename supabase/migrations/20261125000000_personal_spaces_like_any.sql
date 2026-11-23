-- A personal space works exactly like a company (Álvaro, 2026-11-23,
-- welcome-and-spaces.md): its owner may invite people into it, and everything
-- else is the same. Only the app's words and, later, the agent templates it
-- offers differ, from one map in packages/shared/src/spaces.ts.

drop trigger invitations_not_personal on public.invitations;
drop function public.invitations_not_personal();

-- Health data is about one person (wearables.md). Now that a personal space
-- can have other members, only the person whose space it is reads it.
drop policy "members read their space's health sources" on health.sources;
drop policy "members read their space's health records" on health.records;
drop policy "members read their space's health metrics" on health.metrics;

create function health.is_own_space(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = target_org and o.kind = 'personal' and o.created_by = auth.uid()
  ) and public.is_member(target_org);
$$;

revoke execute on function health.is_own_space(uuid) from public, anon;
grant execute on function health.is_own_space(uuid) to authenticated;

create policy "the space's own person reads its health sources" on health.sources
  for select to authenticated using (health.is_own_space(org_id));
create policy "the space's own person reads its health records" on health.records
  for select to authenticated using (health.is_own_space(org_id));
create policy "the space's own person reads its health metrics" on health.metrics
  for select to authenticated using (health.is_own_space(org_id));
