-- A profile photo for each person (Jaime, 2026-11-26): one per person, across
-- organisations, shown beside their messages, in Personas and wherever their
-- face goes; their initials until they set one. A private bucket in the EU;
-- the engine writes it (the app writes no storage), and whoever shares an
-- organisation with the person sees it.

alter table public.profiles add column avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

/** Whether two people belong to the same organisation. */
create function public.share_an_organisation(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships x join public.memberships y on y.org_id = x.org_id
    where x.user_id = a and y.user_id = b
  );
$$;

revoke execute on function public.share_an_organisation(uuid, uuid) from public, anon, authenticated;

/** Whether the signed-in person may see the photo at `object_name`, `<user>/<file>`: their own, or someone's they share an organisation with. */
create function public.can_see_avatar(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
      then split_part(object_name, '/', 1)::uuid = auth.uid()
           or public.share_an_organisation(auth.uid(), split_part(object_name, '/', 1)::uuid)
    else false
  end;
$$;

revoke execute on function public.can_see_avatar(text) from public, anon;
grant execute on function public.can_see_avatar(text) to authenticated;

create policy "people see the photos of whoever they share an organisation with"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.can_see_avatar(name));

/** The photos of an organisation's members, for one of them. */
create function public.member_avatars(target_org uuid)
returns table (user_id uuid, avatar_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.avatar_path
  from public.memberships m
  join public.profiles p on p.user_id = m.user_id
  where m.org_id = target_org and p.avatar_path is not null and public.is_member(target_org);
$$;

revoke execute on function public.member_avatars(uuid) from public, anon;
grant execute on function public.member_avatars(uuid) to authenticated;
