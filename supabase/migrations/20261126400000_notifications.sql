-- Push notifications (docs/plans/ongoing/decision-notifications.md): a person's
-- phones, and an outbox the engine drains to Apple and Google. When an agent
-- message is finished, a trigger queues one row per person who sees the
-- conversation, follows it and has a phone; once a day the engine adds one for
-- what waits. Only names leave: the agent's and the organisation's.

-- Phones --------------------------------------------------------------------

-- A phone belongs to a person, not to an organisation, like their profile: no
-- org_id. Each token is one app install; it moves to whoever signs in on it.
create table public.device_tokens (
  token text primary key check (length(token) between 1 and 4096),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  -- Which APNs host the token belongs to: an iPhone's only.
  apns_environment text check (apns_environment in ('production', 'sandbox')),
  bundle_id text not null check (length(bundle_id) between 1 and 255),
  -- IANA, from the phone: the daily one goes at 09:00 there.
  time_zone text not null,
  updated_at timestamptz not null default clock_timestamp(),
  check ((platform = 'ios') = (apns_environment is not null))
);

create index device_tokens_user on public.device_tokens (user_id, updated_at desc);

alter table public.device_tokens enable row level security;

create policy "people read their own phones"
  on public.device_tokens for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete, truncate on public.device_tokens from anon, authenticated;

-- The outbox -------------------------------------------------------------------

-- What the engine sends. Only the engine (service role) touches it: row-level
-- security on, no policy, nothing granted to the app. `sent_at` with `outcome`
-- closes a row: «sent», «read» (read before it went out), «no_device»,
-- «gave_up», or «stale» (a reply still unsent an hour on, as while push was
-- off: too late to say «te ha contestado»). A claimed row left unsent two
-- minutes is claimed again.
create table public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Null for a daily one summing several organisations.
  org_id uuid references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('reply', 'daily')),
  thread_id uuid references public.threads (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  -- The person's date the daily one is for.
  local_day date,
  title text not null,
  body text not null,
  -- What the app reads on a tap: kind, orgId, route.
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  -- Pushes with the same one replace each other on the phone: the thread.
  collapse_id text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  outcome text check (outcome in ('sent', 'read', 'no_device', 'gave_up', 'stale')),
  attempts integer not null default 0,
  last_error text,
  check ((sent_at is null) = (outcome is null)),
  check (kind <> 'reply' or (org_id is not null and thread_id is not null and message_id is not null)),
  check (kind <> 'daily' or local_day is not null)
);

create unique index push_outbox_one_per_reply on public.push_outbox (user_id, message_id) where kind = 'reply';
create unique index push_outbox_one_daily on public.push_outbox (user_id, local_day) where kind = 'daily';
create index push_outbox_unsent on public.push_outbox (created_at) where sent_at is null;

alter table public.push_outbox enable row level security;

revoke all on public.push_outbox from anon, authenticated;

-- Who follows a conversation ---------------------------------------------------

/**
 * Whether a member follows a conversation: it is their chat with the agent,
 * they opened it, read it, wrote in it or were @mentioned in it (as a whole
 * name: «@Ana» isn't «@Anabel»). Runs as the
 * caller, so a person asking about someone else learns only what they could
 * read anyway (never another's read marks); the trigger and the engine see all.
 */
create function public.follows_thread(target_thread uuid, member uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.threads t
    where t.id = target_thread
      and (
        t.personal_of = member
        or t.created_by = member
        or exists (select 1 from public.thread_reads r where r.thread_id = t.id and r.user_id = member)
        or exists (select 1 from public.messages m where m.thread_id = t.id and m.author_user = member)
        or exists (
          select 1 from public.memberships me, public.messages m, jsonb_array_elements(m.parts) p
          where me.org_id = t.org_id and me.user_id = member
            and nullif(trim(me.display_name), '') is not null
            and m.thread_id = t.id and p->>'type' = 'text'
            -- «@Ana» but not «@Anabel»: the name, its regex characters escaped, then no letter.
            and p->>'text' ~* ('@' || regexp_replace(me.display_name, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '($|[^[:alnum:]_])')
        )
      )
  );
$$;

revoke execute on function public.follows_thread(uuid, uuid) from public, anon;
grant execute on function public.follows_thread(uuid, uuid) to authenticated, service_role;

-- The list -------------------------------------------------------------------

-- Unread compares the read mark with when the last message was finished, not
-- started: a reply that began while the person looked and finished after they
-- left is unread. Following is follows_thread(), the rule the trigger uses.
create or replace function public.my_threads(target_org uuid, target_agent uuid default null)
returns table (
  id uuid,
  agent_id uuid,
  title text,
  created_at timestamptz,
  last_message_at timestamptz,
  last_author text,
  last_text text,
  unread boolean,
  personal boolean,
  visibility text,
  mine boolean,
  following boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.agent_id, t.title, t.created_at, t.last_message_at,
         lm.author_name, lm.text,
         coalesce(lm.author_user is distinct from auth.uid()
                  and coalesce(lm.finished_at, lm.created_at) > coalesce(r.read_at, '-infinity'), false),
         t.personal_of is not null,
         t.visibility,
         coalesce(t.personal_of = auth.uid() or t.created_by = auth.uid(), false),
         public.follows_thread(t.id, auth.uid())
  from public.threads t
  left join public.thread_reads r on r.thread_id = t.id and r.user_id = auth.uid()
  left join lateral (
    select m.author_name, m.author_user, m.created_at, m.finished_at,
           (select string_agg(p->>'text', ' ') from jsonb_array_elements(m.parts) p where p->>'type' = 'text') as text
    from public.messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where t.org_id = target_org and (target_agent is null or t.agent_id = target_agent)
  order by t.last_message_at desc
  limit 200;
$$;

revoke execute on function public.my_threads(uuid, uuid) from public, anon;
grant execute on function public.my_threads(uuid, uuid) to authenticated;

-- The trigger ------------------------------------------------------------------

/**
 * When an agent message is finished (inserted done or failed, or leaving
 * «working»), queues a reply push for each person who sees the conversation
 * and has a phone: a personal chat's person; in a shared one, those who follow
 * it. Whether they read it since is checked when the engine claims it.
 */
create function public.messages_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.threads;
begin
  if new.author_kind <> 'agent' or new.state not in ('done', 'failed')
     or (tg_op = 'UPDATE' and old.state is distinct from 'working') then
    return null;
  end if;
  select * into t from public.threads x where x.id = new.thread_id;

  insert into public.push_outbox (user_id, org_id, kind, thread_id, message_id, title, body, data, collapse_id)
  select m.user_id, t.org_id, 'reply', t.id, new.id, new.author_name,
         case new.state when 'done' then 'Te ha contestado' else 'No ha podido acabar' end,
         jsonb_build_object(
           'kind', 'reply',
           'orgId', t.org_id,
           'route', case when t.personal_of is not null then '/chat/' || t.agent_id else '/conversacion/' || t.id end
         ),
         t.id::text
  from public.memberships m
  where m.org_id = t.org_id
    and (case when t.personal_of is not null then m.user_id = t.personal_of
              else public.follows_thread(t.id, m.user_id) end)
    and public.thread_level_for(t.id, m.user_id) <> 'none'
    and exists (select 1 from public.device_tokens d where d.user_id = m.user_id)
  on conflict do nothing;
  return null;
end;
$$;

revoke execute on function public.messages_notify() from public, anon, authenticated;

create trigger messages_notify
  after insert or update of state on public.messages
  for each row execute function public.messages_notify();

-- The app: a person's phones ---------------------------------------------------

/**
 * Registers the signed-in person's phone, or refreshes it. A token someone
 * else held moves to the caller: the phone changed hands, or someone else
 * signed in on it, and the first person stops getting its pushes. A token
 * must look like its platform's, and a person keeps their ten newest phones.
 */
create function public.register_device(token text, platform text, apns_environment text, bundle_id text, time_zone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if nullif(trim(register_device.token), '') is null or length(register_device.token) > 4096 then
    raise exception 'a device token is required' using errcode = '22023';
  end if;
  if register_device.platform is null or register_device.platform not in ('ios', 'android') then
    raise exception 'platform must be ios or android' using errcode = '22023';
  end if;
  if register_device.platform = 'ios' and (register_device.apns_environment is null
       or register_device.apns_environment not in ('production', 'sandbox')) then
    raise exception 'an iPhone says its APNs environment: production or sandbox' using errcode = '22023';
  end if;
  if register_device.platform = 'android' and register_device.apns_environment is not null then
    raise exception 'only an iPhone has an APNs environment' using errcode = '22023';
  end if;
  -- The token goes into APNs' URL path and FCM's JSON body: only its platform's characters. An APNs
  -- token is 64 hex digits today; up to 200 leaves room for Apple to lengthen it.
  if register_device.platform = 'ios' and register_device.token !~ '^[0-9a-fA-F]{64,200}$' then
    raise exception 'an iPhone''s device token is 64 to 200 hex digits' using errcode = '22023';
  end if;
  -- (Postgres caps a regex count at 255: the 4096 bound on an Android token is the length check above.)
  if register_device.platform = 'android' and register_device.token !~ '^[A-Za-z0-9_:-]+$' then
    raise exception 'an Android device token is letters, digits and _ : -' using errcode = '22023';
  end if;
  if nullif(trim(register_device.bundle_id), '') is null or length(register_device.bundle_id) > 255 then
    raise exception 'a bundle id is required' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = register_device.time_zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;

  insert into public.device_tokens (token, user_id, platform, apns_environment, bundle_id, time_zone, updated_at)
  values (register_device.token, auth.uid(), register_device.platform, register_device.apns_environment,
          register_device.bundle_id, register_device.time_zone, clock_timestamp())
  on conflict on constraint device_tokens_pkey do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        apns_environment = excluded.apns_environment,
        bundle_id = excluded.bundle_id,
        time_zone = excluded.time_zone,
        updated_at = excluded.updated_at;

  -- Ten phones a person at most, so one account can't make every push fan out without end: the
  -- most recently registered stay, and the app registers again each time it starts.
  delete from public.device_tokens d
  where d.user_id = auth.uid()
    and d.token not in (
      select k.token from public.device_tokens k
      where k.user_id = auth.uid()
      order by k.updated_at desc, k.token
      limit 10);
end;
$$;

revoke execute on function public.register_device(text, text, text, text, text) from public, anon;
grant execute on function public.register_device(text, text, text, text, text) to authenticated;

/** Forgets the signed-in person's phone, on signing out. Someone else's stays. */
create function public.forget_device(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.device_tokens d where d.token = forget_device.token and d.user_id = auth.uid();
$$;

revoke execute on function public.forget_device(text) from public, anon;
grant execute on function public.forget_device(text) to authenticated;

-- The engine -------------------------------------------------------------------

/**
 * Claims up to `max_rows` unsent pushes for the engine to send. First closes,
 * as «read», each reply the person has read since its message was finished;
 * then claims what is left (skipping rows another drain holds, and taking back
 * rows a drain claimed over two minutes ago and never closed).
 */
create function public.claim_pushes(max_rows integer)
returns setof public.push_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if max_rows is null or max_rows < 1 then
    raise exception 'max_rows must be at least 1' using errcode = '22023';
  end if;

  -- A reply an hour old is news no longer: the backlog of a time push was off
  -- (or down) is closed, not sent all at once.
  update public.push_outbox o
  set outcome = 'stale', sent_at = now()
  where o.kind = 'reply' and o.sent_at is null
    and o.created_at < now() - interval '1 hour'
    -- Not a row a drain is sending now: the same rule as the claim below.
    and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes');

  update public.push_outbox o
  set outcome = 'read', sent_at = now()
  from public.messages m, public.thread_reads r
  where o.kind = 'reply' and o.sent_at is null
    -- Not a row a drain is sending now: the same rule as the claim below.
    and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
    and m.id = o.message_id
    and r.thread_id = o.thread_id and r.user_id = o.user_id
    and r.read_at >= coalesce(m.finished_at, m.created_at);

  return query
  update public.push_outbox o
  set claimed_at = now()
  where o.id in (
    select x.id from public.push_outbox x
    where x.sent_at is null
      and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
    order by x.created_at
    limit max_rows
    for update skip locked
  )
  returning o.*;
end;
$$;

revoke execute on function public.claim_pushes(integer) from public, anon, authenticated;
grant execute on function public.claim_pushes(integer) to service_role;

/**
 * For the daily one: each person with a phone, in each organisation where
 * something waits for them, with the time zone of their latest phone.
 * Waiting: open decisions they haven't put aside, and the pending OK cards
 * they would approve (an owner's, or their own for a card that waits for whoever
 * asked) in conversations they see.
 */
create function public.daily_push_candidates()
returns table (user_id uuid, time_zone text, org_id uuid, org_name text, waiting integer)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select distinct on (d.user_id) d.user_id, d.time_zone
    from public.device_tokens d
    order by d.user_id, d.updated_at desc
  )
  select p.user_id, p.time_zone, o.id, o.name, w.waiting
  from people p
  join public.memberships ms on ms.user_id = p.user_id
  join public.organizations o on o.id = ms.org_id
  cross join lateral (
    select (
      (select count(*) from public.decisions dc
       where dc.org_id = ms.org_id and dc.answer is null and dc.closed_at is null
         and not exists (
           select 1 from public.decision_snoozes s
           where s.decision_id = dc.id and s.user_id = p.user_id and s.until > now()
         ))
      + (select count(*) from public.agent_actions a
         where a.org_id = ms.org_id and a.status = 'pending'
           and (case when a.decider = 'requester' then a.requested_by = p.user_id else ms.role = 'owner' end)
           and public.thread_level_for(a.thread_id, p.user_id) <> 'none')
    )::integer as waiting
  ) w
  where w.waiting > 0
  order by p.user_id, o.name;
$$;

revoke execute on function public.daily_push_candidates() from public, anon, authenticated;
grant execute on function public.daily_push_candidates() to service_role;
