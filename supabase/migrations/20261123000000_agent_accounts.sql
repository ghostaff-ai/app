-- Which connected accounts each agent may use (docs/plans/ongoing/agent-settings.md).
-- Until now every agent got every account the organisation connected. `accounts`
-- is the list of providers (connections.provider of kind 'account') the agent
-- may use; null keeps that old behaviour: every connected account, including
-- the ones connected later.
--
-- Owners set it through set_agent_accounts, from the app's screen or by approving
-- what the organisation's main agent proposes: the engine then calls this same
-- function with the approving owner's own session, so the check below holds
-- for both.

alter table public.agents add column accounts text[];

create function public.set_agent_accounts(target_agent uuid, providers text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
begin
  select a.org_id into target_org from public.agents a where a.id = target_agent;
  if not found or not public.is_owner(target_org) then
    raise exception 'only an owner chooses an agent''s tools' using errcode = '42501';
  end if;
  if providers is not null and (
    cardinality(providers) > 50
    or exists (select 1 from unnest(providers) p where p is null or p !~ '^[a-z0-9_]{1,40}$')
  ) then
    raise exception 'tools must be up to 50 provider names' using errcode = '22023';
  end if;

  update public.agents
  set accounts = case when providers is null then null else array(select distinct p from unnest(providers) p order by p) end
  where id = target_agent;
end;
$$;

revoke execute on function public.set_agent_accounts(uuid, text[]) from public, anon;
grant execute on function public.set_agent_accounts(uuid, text[]) to authenticated;
