-- The organisation's main agent as a role (agent-builder slice 1). Until now
-- "the main agent" was whoever drew the `secretaria` ghost, so a custom agent
-- with that ghost counted as her and Órdago's Correo (a job agent drawn the
-- same way) was mistaken for her. The role is explicit: `is_main`, one per
-- organisation, and the database refuses to remove it.

alter table public.agents add column is_main boolean not null default false;

create unique index agents_one_main on public.agents (org_id) where is_main;

-- Hires the main agent, as create_agent would: in Dirección, and members may
-- talk to her. Internal: the functions that create a space and ensure_main_agent
-- call it. created_by is the organisation's, so it also works with no
-- auth.uid() (the service role, the migration).
create function public.hire_main_agent(target_org uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.agents (org_id, name, ghost, department, created_by, member_default, is_main)
  -- The name repeats MAIN_AGENT_NAME in packages/shared: change both together.
  select o.id, 'Secretaría', 'secretaria', 'direccion', o.created_by, 'talk', true
  from public.organizations o where o.id = target_org
  returning id;
$$;

-- Makes sure the organisation has a main agent and returns its id. An existing
-- one is returned as it is; else the oldest chat `secretaria` agent takes the
-- role (spaces made before it); else one is hired (Órdago, whose only
-- `secretaria` agent is a job, and organisations that removed theirs).
create function public.ensure_main_agent(target_org uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  main_id uuid;
begin
  select a.id into main_id from public.agents a where a.org_id = target_org and a.is_main;
  if found then
    return main_id;
  end if;

  update public.agents a set is_main = true
  where a.id = (
    select x.id from public.agents x
    where x.org_id = target_org and x.ghost = 'secretaria' and x.runner = 'chat'
    order by x.created_at, x.id
    limit 1
  )
  returning a.id into main_id;
  if found then
    return main_id;
  end if;

  return public.hire_main_agent(target_org);
end;
$$;

revoke execute on function public.hire_main_agent(uuid) from public, anon, authenticated;
revoke execute on function public.ensure_main_agent(uuid) from public, anon, authenticated;
-- The sync CLI creates organisations with the service role, not create_organization.
grant execute on function public.ensure_main_agent(uuid) to service_role;

-- As in 20261122300000_spaces.sql, with hire_main_agent in place of hire_secretaria.
create or replace function public.create_organization(
  name text,
  website text default null,
  about text default null,
  links text[] default '{}'
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  o public.organizations;
  clean_links text[];
begin
  select * into me from public.profiles where user_id = auth.uid();
  if not found then
    raise exception 'profile first' using errcode = '42501';
  end if;
  if nullif(trim(name), '') is null or length(trim(name)) > 120 then
    raise exception 'a name is required' using errcode = '22023';
  end if;
  -- Open sign-up: a ceiling so one account cannot fill the table.
  if (select count(*) from public.organizations x where x.created_by = auth.uid()) >= 10 then
    raise exception 'too many organisations' using errcode = '54000';
  end if;

  select coalesce(array_agg(trim(l)), '{}') into clean_links
  from unnest(coalesce(links, '{}')) as l
  where nullif(trim(l), '') is not null;

  insert into public.organizations (slug, name, created_by, website, about, links)
  values (public.slug_for(name), trim(name), auth.uid(), nullif(trim(website), ''), nullif(trim(about), ''), clean_links)
  returning * into o;

  insert into public.memberships (org_id, user_id, role, display_name)
  values (o.id, auth.uid(), 'owner', me.full_name);

  perform public.hire_main_agent(o.id);
  return o;
end;
$$;

-- Your personal space: made the first time, returned as it is after that (a
-- double tap on «Para mí» is harmless). It counts towards the same ceiling.
create or replace function public.create_personal_space()
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  o public.organizations;
begin
  select * into me from public.profiles where user_id = auth.uid();
  if not found then
    raise exception 'profile first' using errcode = '42501';
  end if;

  select * into o from public.organizations x where x.created_by = auth.uid() and x.kind = 'personal';
  if found then
    return o;
  end if;

  if (select count(*) from public.organizations x where x.created_by = auth.uid()) >= 10 then
    raise exception 'too many organisations' using errcode = '54000';
  end if;

  begin
    insert into public.organizations (slug, name, created_by, kind)
    values (public.slug_for('personal'), 'Personal', auth.uid(), 'personal')
    returning * into o;
  exception when unique_violation then
    -- Two taps in the same instant: the other call made it, return that one.
    select * into o from public.organizations x where x.created_by = auth.uid() and x.kind = 'personal';
    return o;
  end;

  insert into public.memberships (org_id, user_id, role, display_name)
  values (o.id, auth.uid(), 'owner', me.full_name);

  perform public.hire_main_agent(o.id);
  return o;
end;
$$;

revoke execute on function public.create_personal_space() from public, anon;
grant execute on function public.create_personal_space() to authenticated;

drop function public.hire_secretaria(uuid);

-- As in 20261117000000_agents.sql, and the main agent stays.
create or replace function public.delete_agent(agent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
  main boolean;
begin
  select a.org_id, a.is_main into target_org, main from public.agents a where a.id = agent_id;
  if not found or not public.is_owner(target_org) then
    raise exception 'only an owner removes agents' using errcode = '42501';
  end if;
  if main then
    raise exception 'the main agent stays' using errcode = '42501';
  end if;
  delete from public.agents a where a.id = agent_id;
end;
$$;

-- As in 20261118000000_team_chat.sql, but only the main agent is talk-by-default
-- (hire_main_agent sets it): a custom agent drawn as `secretaria` is read-only
-- for members like any other.
create or replace function public.create_agent(target_org uuid, name text, ghost text, department text)
returns public.agents
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
begin
  if not public.is_owner(target_org) then
    raise exception 'only an owner adds agents' using errcode = '42501';
  end if;
  if nullif(trim(name), '') is null or length(trim(name)) > 60 then
    raise exception 'a name of up to 60 characters is required' using errcode = '22023';
  end if;
  -- A ceiling so one organisation cannot fill the table.
  if (select count(*) from public.agents x where x.org_id = target_org) >= 50 then
    raise exception 'too many agents' using errcode = '54000';
  end if;

  insert into public.agents (org_id, name, ghost, department, created_by, member_default)
  values (target_org, trim(name), ghost, department, auth.uid(), 'read')
  returning * into a;
  return a;
end;
$$;

-- Every organisation that exists gets its main agent.
select public.ensure_main_agent(id) from public.organizations;
