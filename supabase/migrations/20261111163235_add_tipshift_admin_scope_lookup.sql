-- Called only by the Edge Function with the authenticated admin UUID. Browser
-- roles cannot execute it or read the private authorization table directly.
create or replace function public.tipshift_admin_scopes(p_admin_user_id uuid)
returns table(venue_ref uuid, branch_ref uuid, role text)
language sql
set search_path = pg_catalog, tipshift_private
as $$
  select a.venue_ref, a.branch_ref, a.role
  from tipshift_private.admin_authorizations a
  where a.admin_user_id = p_admin_user_id
  order by a.created_at asc;
$$;
revoke all on function public.tipshift_admin_scopes(uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_scopes(uuid) to service_role;
