-- Only the company owner (the one who named the business) can link a pool to a location.
-- A location manager can operate the location but cannot attach or swap its pool.
create or replace function public.tipshift_admin_set_branch_pool(p_admin_user_id uuid, p_branch_ref uuid, p_pool_id text)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare venue uuid;
begin
  select b.venue_ref into venue from tipshift_private.branches b where b.branch_ref = p_branch_ref and b.active;
  if venue is null or not exists (
    select 1 from tipshift_private.admin_authorizations a
    where a.admin_user_id = p_admin_user_id and a.venue_ref = venue and a.role = 'organization_admin'
  ) then return false; end if;
  update tipshift_private.branches set pool_id = p_pool_id where branch_ref = p_branch_ref;
  return true;
exception when check_violation then return false;
end;
$$;
