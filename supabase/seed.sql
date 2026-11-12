-- Local only (`pnpm db:reset`). Órdago is organisation zero. People are added
-- with `pnpm --filter @ghostaff/sync org add-member`, which also creates the login.
insert into public.organizations (slug, name) values ('ordago', 'Órdago')
on conflict (slug) do nothing;
