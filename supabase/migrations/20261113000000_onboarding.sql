-- The way in (Álvaro, 2026-11-12): anyone can sign up with their email; then
-- they say who they are, and create a company or join one that invited them.
--
-- - `profiles`: one per person, across organisations. Their name is how they
--   sign in every organisation they join.
-- - `organizations` gains what its creator tells us about it: the light first
--   step of Incorporación, which will later build the record from it.
-- - `invitations`: an owner invites an email; the person who signs in with that
--   email sees it and joins. Nobody can search or guess their way into an
--   organisation, and the list of organisations is never shown.
--
-- As before, the app writes only through security definer functions that
-- check who is calling; no table here has an insert, update or delete policy.

-- Profiles ------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  -- «¿A qué te dedicas?», optional.
  occupation text check (length(occupation) <= 120),
  -- «¿Cómo nos conociste?», optional.
  heard_from text check (length(heard_from) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "people read their own profile"
  on public.profiles for select to authenticated
  using (user_id = auth.uid());

-- Everyone who already belongs to an organisation gets a profile from how they
-- sign there, so they never see the welcome screen.
insert into public.profiles (user_id, full_name)
select distinct on (m.user_id) m.user_id, m.display_name
from public.memberships m
order by m.user_id, m.created_at
on conflict (user_id) do nothing;

create function public.save_profile(full_name text, occupation text default null, heard_from text default null)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if nullif(trim(full_name), '') is null then
    raise exception 'a name is required' using errcode = '22023';
  end if;
  insert into public.profiles (user_id, full_name, occupation, heard_from)
  values (auth.uid(), trim(full_name), nullif(trim(occupation), ''), nullif(trim(heard_from), ''))
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    occupation = excluded.occupation,
    heard_from = excluded.heard_from,
    updated_at = now()
  returning * into p;
  return p;
end;
$$;

revoke execute on function public.save_profile(text, text, text) from public, anon;
grant execute on function public.save_profile(text, text, text) to authenticated;

-- Organisations: who created them and what they told us ----------------------

alter table public.organizations
  add column created_by uuid references auth.users (id) on delete set null,
  add column website text check (length(website) <= 300),
  -- «¿Qué hacéis?», in the creator's words.
  add column about text check (length(about) <= 2000),
  -- Other links: social profiles, store pages, a Drive folder.
  add column links text[] not null default '{}' check (cardinality(links) <= 20);

create function public.is_owner(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

revoke execute on function public.is_owner(uuid) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated;

-- `Mi Empresa, S.L.` -> `mi-empresa-s-l`; a taken slug gets a short suffix.
create function public.slug_for(name text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  base text;
  candidate text;
begin
  base := lower(translate(trim(name),
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
    'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'));
  base := trim(both '-' from regexp_replace(base, '[^a-z0-9]+', '-', 'g'));
  base := left(coalesce(nullif(base, ''), 'org'), 40);
  candidate := base;
  while exists (select 1 from public.organizations o where o.slug = candidate) loop
    candidate := base || '-' || substr(md5(random()::text), 1, 4);
  end loop;
  return candidate;
end;
$$;

revoke execute on function public.slug_for(text) from public, anon, authenticated;

create function public.create_organization(
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

  return o;
end;
$$;

revoke execute on function public.create_organization(text, text, text, text[]) from public, anon;
grant execute on function public.create_organization(text, text, text, text[]) to authenticated;

-- Invitations ---------------------------------------------------------------

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  role text not null default 'member' check (role in ('owner', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  -- How the inviter signs, so the invitee sees who asked them.
  invited_by_name text not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- One open invitation per email and organisation.
create unique index invitations_open_idx on public.invitations (org_id, email) where accepted_at is null;
create index invitations_email_idx on public.invitations (email) where accepted_at is null;

alter table public.invitations enable row level security;

-- The signed-in person's email, as Supabase Auth holds it.
create function public.my_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u where u.id = auth.uid();
$$;

revoke execute on function public.my_email() from public, anon;
grant execute on function public.my_email() to authenticated;

create policy "owners read their organisation's invitations"
  on public.invitations for select to authenticated
  using (public.is_owner(org_id));

create policy "people read the invitations addressed to them"
  on public.invitations for select to authenticated
  using (accepted_at is null and email = public.my_email());

-- An invitee sees the name of the organisation that invited them, nothing else of it.
create function public.my_invitations()
returns table (id uuid, org_id uuid, org_name text, role text, invited_by_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.org_id, o.name, i.role, i.invited_by_name, i.created_at
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  where i.accepted_at is null
    and i.email = public.my_email()
    and not exists (select 1 from public.memberships m where m.org_id = i.org_id and m.user_id = auth.uid())
  order by i.created_at desc;
$$;

revoke execute on function public.my_invitations() from public, anon;
grant execute on function public.my_invitations() to authenticated;

create function public.invite_member(target_org uuid, invitee_email text, invitee_role text default 'member')
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter text;
  clean text := lower(trim(invitee_email));
  i public.invitations;
begin
  if not public.is_owner(target_org) then
    raise exception 'only an owner invites' using errcode = '42501';
  end if;
  if invitee_role not in ('owner', 'member') then
    raise exception 'role must be owner or member' using errcode = '22023';
  end if;
  if clean !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'not an email' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
    where m.org_id = target_org and lower(u.email) = clean
  ) then
    raise exception 'already a member' using errcode = '23505';
  end if;

  select m.display_name into inviter
  from public.memberships m where m.org_id = target_org and m.user_id = auth.uid();

  insert into public.invitations (org_id, email, role, invited_by, invited_by_name)
  values (target_org, clean, invitee_role, auth.uid(), inviter)
  on conflict (org_id, email) where accepted_at is null
  do update set role = excluded.role, invited_by = excluded.invited_by,
                invited_by_name = excluded.invited_by_name, created_at = now()
  returning * into i;
  return i;
end;
$$;

revoke execute on function public.invite_member(uuid, text, text) from public, anon;
grant execute on function public.invite_member(uuid, text, text) to authenticated;

create function public.revoke_invitation(invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  select org_id into target from public.invitations where id = invitation_id and accepted_at is null;
  if not found or not public.is_owner(target) then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  delete from public.invitations where id = invitation_id;
end;
$$;

revoke execute on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

create function public.accept_invitation(invitation_id uuid)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  i public.invitations;
  o public.organizations;
begin
  select * into me from public.profiles where user_id = auth.uid();
  if not found then
    raise exception 'profile first' using errcode = '42501';
  end if;
  select * into i from public.invitations
  where id = invitation_id and accepted_at is null and email = public.my_email()
  for update;
  if not found then
    -- Same error for someone else's invitation: nothing learnt about it.
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  insert into public.memberships (org_id, user_id, role, display_name)
  values (i.org_id, auth.uid(), i.role, me.full_name)
  on conflict (org_id, user_id) do nothing;
  update public.invitations set accepted_at = now() where id = i.id;

  select * into o from public.organizations where id = i.org_id;
  return o;
end;
$$;

revoke execute on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;
