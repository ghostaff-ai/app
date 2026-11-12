-- The multi-organisation base and the decision inbox (first slice).
--
-- Invariant 1 (AGENTS.md): every organisation is separate. Every table that
-- holds an organisation's data carries `org_id`, has row-level security on,
-- and is readable only by that organisation's members. The app never writes
-- tables directly: an answer goes through `answer_decision()`, which checks
-- membership itself. The sync job (apps/sync) writes with the service role,
-- which bypasses RLS and never ships in the app.

create extension if not exists pgcrypto;

-- Organisations -------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  -- Short stable name, used by the sync job to find the org (`ordago`).
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  -- How the person signs an answer in the record (`respuesta.por`), e.g. `Álvaro`.
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

-- Security definer so the policies below can ask "is the caller a member?"
-- without recursing through memberships' own policy.
create function public.is_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

create policy "members read their organisations"
  on public.organizations for select to authenticated
  using (public.is_member(id));

create policy "members read their organisation's members"
  on public.memberships for select to authenticated
  using (public.is_member(org_id));

-- Decisions -----------------------------------------------------------------
--
-- One row per decision file in the organisation's record (`por-decidir/<id>.yaml`
-- in Órdago's). The file is the source of truth; this row is the copy the app
-- reads. The sync job upserts it and sets `closed_at` once the agent has acted
-- and deleted the file. An answer given in the app lands here first
-- (`answer_source = 'app'`, `written_back_at` null) and the sync job writes it
-- into the file, the same way the Órdago panel does.

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The file name without `.yaml`, e.g. `seo-envites-volver-a-publicar`.
  record_id text not null check (record_id ~ '^[a-z0-9][a-z0-9-]*$'),
  -- Path inside the record, e.g. `por-decidir/seo-envites-volver-a-publicar.yaml`.
  source_path text not null,
  area text not null,
  kind text not null,          -- `tipo`: the class of decision, the unit autonomy is earned in
  question text not null,      -- `pregunta`
  context text not null,       -- `contexto`
  proposed_by text not null,   -- `propone`: the agent that opened it and will act
  created_on date not null,    -- `creada`
  -- Only for `tipo: regla`: the rule wording the agent proposes.
  rule_proposal text,

  answer text check (answer in ('ok', 'no')),
  answered_by_name text,
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz,
  answer_note text,
  -- Only for a rule answered OK: the wording the person signs.
  answer_text text,
  answer_source text check (answer_source in ('record', 'app')),
  written_back_at timestamptz,

  -- The record commit this row was last read from.
  source_commit text,
  synced_at timestamptz not null default now(),
  closed_at timestamptz,

  unique (org_id, record_id),
  check ((answer is null) = (answered_at is null)),
  check (answer is null or answered_by_name is not null)
);

create index decisions_open_idx on public.decisions (org_id, created_on desc) where closed_at is null;

alter table public.decisions enable row level security;

create policy "members read their organisation's decisions"
  on public.decisions for select to authenticated
  using (public.is_member(org_id));

-- No insert/update/delete policy: clients cannot write decisions directly.

create function public.answer_decision(
  decision_id uuid,
  answer text,
  note text default null,
  signed_text text default null
)
returns public.decisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.decisions;
  signer text;
begin
  if answer is null or answer not in ('ok', 'no') then
    raise exception 'answer must be ok or no' using errcode = '22023';
  end if;

  select * into d from public.decisions where id = decision_id for update;
  if not found or not public.is_member(d.org_id) then
    -- Same error either way: a non-member learns nothing about the row.
    raise exception 'decision not found' using errcode = 'P0002';
  end if;
  if d.closed_at is not null then
    raise exception 'decision is closed' using errcode = '22023';
  end if;
  if d.answer is not null then
    raise exception 'decision already answered' using errcode = '22023';
  end if;

  if length(coalesce(note, '')) > 2000 or length(coalesce(signed_text, '')) > 2000 then
    raise exception 'note too long' using errcode = '22001';
  end if;
  if nullif(trim(signed_text), '') is not null and d.kind <> 'regla' then
    raise exception 'only a rule carries signed text' using errcode = '22023';
  end if;
  if d.kind = 'regla' and answer = 'ok' and nullif(trim(signed_text), '') is null then
    raise exception 'a rule is signed with its text' using errcode = '22023';
  end if;

  select m.display_name into signer
  from public.memberships m
  where m.org_id = d.org_id and m.user_id = auth.uid();

  update public.decisions set
    answer = answer_decision.answer,
    answered_by = auth.uid(),
    answered_by_name = signer,
    answered_at = now(),
    answer_note = nullif(trim(note), ''),
    answer_text = case when answer_decision.answer = 'ok' then nullif(trim(signed_text), '') end,
    answer_source = 'app',
    written_back_at = null
  where id = decision_id
  returning * into d;

  return d;
end;
$$;

revoke execute on function public.answer_decision(uuid, text, text, text) from public, anon;
grant execute on function public.answer_decision(uuid, text, text, text) to authenticated;
