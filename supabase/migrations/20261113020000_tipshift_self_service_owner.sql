-- Self-service sign-up: a user with no authorization becomes the owner of a new, empty company.
-- The foreign key to auth.users guarantees the user exists.
-- Invited managers already have a branch authorization (claimed first), so they are untouched.
create function public.tipshift_admin_bootstrap(p_admin_user_id uuid)
returns void
language sql
set search_path = pg_catalog, tipshift_private
as $$
  insert into tipshift_private.admin_authorizations (admin_user_id, venue_ref, branch_ref, role)
  select p_admin_user_id, gen_random_uuid(), null, 'organization_admin'
  on conflict (admin_user_id) do nothing;
$$;
revoke all on function public.tipshift_admin_bootstrap(uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_bootstrap(uuid) to service_role;
