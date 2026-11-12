-- ON CONFLICT (venue_ref) was ambiguous with the RETURNS TABLE output column of the same
-- name. Target the primary-key constraint instead.
create or replace function public.tipshift_admin_set_organization(p_admin_user_id uuid, p_venue_ref uuid, p_organization_name text)
returns table(venue_ref uuid, organization_name text)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  if not exists (
    select 1 from tipshift_private.admin_authorizations a
    where a.admin_user_id = p_admin_user_id and a.venue_ref = p_venue_ref and a.role = 'organization_admin'
  ) or p_organization_name is null or char_length(btrim(p_organization_name)) not between 1 and 80 or btrim(p_organization_name) ~ '[[:cntrl:]]' then
    return;
  end if;
  return query
    insert into tipshift_private.organizations as o (venue_ref, organization_name)
    values (p_venue_ref, btrim(p_organization_name))
    on conflict on constraint organizations_pkey do update set organization_name = excluded.organization_name, updated_at = timezone('utc', now())
    returning o.venue_ref, o.organization_name;
end;
$$;
