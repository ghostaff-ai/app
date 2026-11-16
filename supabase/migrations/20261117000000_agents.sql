-- Agents: an organisation's team, by department (ghostaff-producto.md, «El
-- equipo de partida»). For now an agent is what the app shows: its name, the
-- ghost it is drawn as and its department. Its job, rules and schedule come
-- later, with the engine (Álvaro, 2026-11-17).
--
-- Members read their organisation's agents; only its owners add or remove
-- them, through the two functions below, never the table.

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (name = trim(name) and length(name) between 1 and 60),
  -- One of the ghosts in apps/mobile/assets/ghosts/ (apps/mobile/lib/team).
  ghost text not null check (ghost in ('base', 'secretaria', 'incorporacion', 'finanzas', 'redes', 'productor')),
  department text not null check (department in ('direccion', 'finanzas', 'marketing')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index agents_org_id on public.agents (org_id);

alter table public.agents enable row level security;

create policy "members read their organisation's agents"
  on public.agents for select to authenticated
  using (public.is_member(org_id));

revoke insert, update, delete, truncate on public.agents from anon, authenticated;

create function public.create_agent(target_org uuid, name text, ghost text, department text)
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

  insert into public.agents (org_id, name, ghost, department, created_by)
  values (target_org, trim(name), ghost, department, auth.uid())
  returning * into a;
  return a;
end;
$$;

revoke execute on function public.create_agent(uuid, text, text, text) from public, anon;
grant execute on function public.create_agent(uuid, text, text, text) to authenticated;

create function public.delete_agent(agent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
begin
  select a.org_id into target_org from public.agents a where a.id = agent_id;
  if not found or not public.is_owner(target_org) then
    raise exception 'only an owner removes agents' using errcode = '42501';
  end if;
  delete from public.agents a where a.id = agent_id;
end;
$$;

revoke execute on function public.delete_agent(uuid) from public, anon;
grant execute on function public.delete_agent(uuid) to authenticated;
