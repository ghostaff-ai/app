-- Local only (`pnpm db:reset`). Órdago is organisation zero. People sign up in
-- the app, or are added with `pnpm --filter @ghostaff/sync org add-member`.
insert into public.organizations (slug, name) values ('ordago', 'Órdago')
on conflict (slug) do nothing;
