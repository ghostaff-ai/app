-- Read ticks, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md): your
-- message shows two blue ticks once everyone else who reads the chat has read
-- it. It relaxes, to this one aggregate, the rule that nobody learns another's
-- read marks (follows_thread): never who read it, only that all have.

/**
 * Up to when everyone else who may read the chat has read it: the earliest of
 * their read marks; '-infinity' while one of them has never opened it; null
 * when nobody else reads it. For a member of the chat; anyone else gets null.
 */
create function public.thread_read_by_all(target_thread uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.thread_level_for(t.id, auth.uid()) = 'none' then null
    when count(m.user_id) = 0 then null
    when bool_or(r.read_at is null) then '-infinity'::timestamptz
    else min(r.read_at)
  end
  from public.threads t
  left join public.memberships m
    on m.org_id = t.org_id
   and m.user_id is distinct from auth.uid()
   and public.thread_level_for(t.id, m.user_id) <> 'none'
  left join public.thread_reads r on r.thread_id = t.id and r.user_id = m.user_id
  where t.id = target_thread
  group by t.id;
$$;

revoke execute on function public.thread_read_by_all(uuid) from public, anon;
grant execute on function public.thread_read_by_all(uuid) to authenticated;
