-- External parties (docs/plans/ongoing/external-parties.md): the people,
-- companies and services an organisation works with outside, with what each
-- does for it, the departments it works with and how to reach it. One list per
-- organisation.
--
-- The record is the master (`externos/<slug>.md`); this table is its projection,
-- the way `decisions` is `por-decidir/`'s. An owner's change in the app, or an
-- agent's proposal an owner approved, lands here with `pending` set, and the
-- engine's sync writes it into the record on the tick. Only a person adds a
-- party (Jaime, 2026-11-26): no agent writes the table or the folder.

create table public.external_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- `externos/<slug>.md`; null until the engine first writes the file.
  path text check (path ~ '^externos/[a-z0-9][a-z0-9-]{0,80}\.md$'),
  kind text not null check (kind in ('person', 'company', 'service')),
  name text not null check (length(trim(name)) between 1 and 120),
  -- What it does for the organisation (the file's `hace`): the point of the list.
  role text not null check (length(trim(role)) between 1 and 300),
  departments text[] not null default '{}'
    check (departments <@ array['direccion', 'finanzas', 'legal', 'producto', 'marketing']),
  email text check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  phone text check (length(trim(phone)) between 3 and 40),
  website text check (website ~ '^https?://\S+$' and length(website) <= 300),
  -- Who added or confirmed it, and when; a name, so it survives them leaving.
  added_by uuid references auth.users (id) on delete set null,
  added_by_name text not null default '' check (length(added_by_name) <= 120),
  added_at timestamptz not null default now(),
  -- The agent that proposed it, when one did.
  proposed_by_agent uuid references public.agents (id) on delete set null,
  proposed_by_name text check (length(proposed_by_name) <= 120),
  -- sha-256 of the file as last read or written: how the sync tells that the record moved under an app change.
  content_hash text,
  -- An app change the record does not have yet.
  pending text check (pending in ('save', 'remove')),
  updated_at timestamptz not null default now(),
  unique (org_id, path)
);

create index external_parties_org on public.external_parties (org_id);
create index external_parties_pending on public.external_parties (org_id) where pending is not null;

alter table public.external_parties enable row level security;

-- Every member sees the list; a party being removed is already gone for them.
create policy "members read their organisation's external parties"
  on public.external_parties for select to authenticated
  using (public.is_member(org_id) and pending is distinct from 'remove');

revoke insert, update, delete, truncate on public.external_parties from anon, authenticated;

/**
 * Adds a party (`party` null) or changes one, as an owner of `target_org`.
 * `proposed_by` is the agent whose proposal the owner approved, on a new party.
 * Every field is checked as the file would be; `pending` asks the sync to write it.
 */
create function public.save_external_party(
  target_org uuid,
  party uuid,
  new_kind text,
  new_name text,
  new_role text,
  new_departments text[],
  new_email text,
  new_phone text,
  new_website text,
  proposed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me_name text;
  agent_name text;
  result uuid;
begin
  if not public.is_owner(target_org) then
    raise exception 'only an owner adds or changes who the organisation works with' using errcode = '42501';
  end if;
  if proposed_by is not null then
    select a.name into agent_name from public.agents a where a.id = proposed_by and a.org_id = target_org;
    if not found then
      raise exception 'that agent is not in this organisation' using errcode = '22023';
    end if;
  end if;

  if party is null then
    select m.display_name into me_name from public.memberships m where m.org_id = target_org and m.user_id = auth.uid();
    insert into public.external_parties (
      org_id, kind, name, role, departments, email, phone, website,
      added_by, added_by_name, proposed_by_agent, proposed_by_name, pending
    )
    values (
      target_org, new_kind, trim(new_name), trim(new_role), coalesce(new_departments, '{}'),
      nullif(trim(new_email), ''), nullif(trim(new_phone), ''), nullif(trim(new_website), ''),
      auth.uid(), coalesce(me_name, ''), proposed_by, agent_name, 'save'
    )
    returning id into result;
    return result;
  end if;

  update public.external_parties p set
    kind = new_kind,
    name = trim(new_name),
    role = trim(new_role),
    departments = coalesce(new_departments, '{}'),
    email = nullif(trim(new_email), ''),
    phone = nullif(trim(new_phone), ''),
    website = nullif(trim(new_website), ''),
    pending = 'save',
    updated_at = now()
  where p.id = party and p.org_id = target_org and p.pending is distinct from 'remove'
  returning p.id into result;
  if result is null then
    raise exception 'no such party in this organisation' using errcode = '22023';
  end if;
  return result;
end;
$$;

revoke execute on function public.save_external_party(uuid, uuid, text, text, text, text[], text, text, text, uuid) from public, anon;
grant execute on function public.save_external_party(uuid, uuid, text, text, text, text[], text, text, text, uuid) to authenticated;

/**
 * Removes a party, as an owner of its organisation. One the record never had
 * goes at once; any other waits, hidden, until the sync deletes its file.
 */
create function public.remove_external_party(party uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.external_parties;
begin
  select * into p from public.external_parties x where x.id = party;
  if not found or not public.is_owner(p.org_id) then
    raise exception 'only an owner removes who the organisation works with' using errcode = '42501';
  end if;
  if p.path is null then
    delete from public.external_parties x where x.id = party;
  else
    update public.external_parties x set pending = 'remove', updated_at = now() where x.id = party;
  end if;
end;
$$;

revoke execute on function public.remove_external_party(uuid) from public, anon;
grant execute on function public.remove_external_party(uuid) to authenticated;
