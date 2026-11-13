-- service_role cannot read auth.users; the foreign key already guarantees the user exists.
create or replace function public.tipshift_admin_bootstrap(p_admin_user_id uuid)
returns void
language sql
set search_path = pg_catalog, tipshift_private
as $$
  insert into tipshift_private.admin_authorizations (admin_user_id, venue_ref, branch_ref, role)
  values (p_admin_user_id, gen_random_uuid(), null, 'organization_admin')
  on conflict (admin_user_id) do nothing;
$$;
