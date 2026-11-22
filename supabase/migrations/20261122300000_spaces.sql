-- Spaces (docs/plans/ongoing/welcome-and-spaces.md). An organisation is a
-- company or a person's own personal space: the same record, agents,
-- connections and decisions, with only its owner in it. Every new space starts
-- with Secretaría hired (Álvaro 2026-11-21, Jaime 2026-11-22: creating the
-- space is the «yes»); spaces created before this keep their team as it is.

alter table public.organizations
  add column kind text not null default 'company' check (kind in ('personal', 'company'));

-- One personal space per person.
create unique index organizations_one_personal on public.organizations (created_by) where kind = 'personal';

-- Secretaría, as create_agent would hire her: in Dirección, and members may
-- talk to her. Internal: only the functions that create a space call it.
create function public.hire_secretaria(target_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.agents (org_id, name, ghost, department, created_by, member_default)
  values (target_org, 'Secretaría', 'secretaria', 'direccion', auth.uid(), 'talk');
$$;

revoke execute on function public.hire_secretaria(uuid) from public, anon, authenticated;

-- As in 20261113000000_onboarding.sql, plus Secretaría.
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

  perform public.hire_secretaria(o.id);
  return o;
end;
$$;

-- Your personal space: made the first time, returned as it is after that (a
-- double tap on «Para mí» is harmless). It counts towards the same ceiling.
create function public.create_personal_space()
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

  perform public.hire_secretaria(o.id);
  return o;
end;
$$;

revoke execute on function public.create_personal_space() from public, anon;
grant execute on function public.create_personal_space() to authenticated;

-- A personal space has only its owner: nobody is invited to one, whatever
-- function writes the invitation.
create function public.invitations_not_personal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select kind from public.organizations where id = new.org_id) = 'personal' then
    raise exception 'a personal space has only its owner' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger invitations_not_personal
  before insert on public.invitations
  for each row execute function public.invitations_not_personal();
