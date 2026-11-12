-- Organization (company) identity comes before its branches. Business labels only:
-- never an employee, wallet, email or phone number.
create table tipshift_private.organizations (
  venue_ref uuid primary key,
  organization_name text not null check (char_length(organization_name) between 1 and 80 and organization_name !~ '[[:cntrl:]]'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
alter table tipshift_private.organizations enable row level security;
revoke all on tipshift_private.organizations from public, anon, authenticated;
grant select, insert, update on tipshift_private.organizations to service_role;

-- Optional street address of a branch (a public business address, not personal data).
alter table tipshift_private.branches
  add column branch_address text check (branch_address is null or (char_length(branch_address) between 1 and 160 and branch_address !~ '[[:cntrl:]]'));

create function public.tipshift_admin_set_organization(p_admin_user_id uuid, p_venue_ref uuid, p_organization_name text)
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
    on conflict (venue_ref) do update set organization_name = excluded.organization_name, updated_at = timezone('utc', now())
    returning o.venue_ref, o.organization_name;
end;
$$;
revoke all on function public.tipshift_admin_set_organization(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tipshift_admin_set_organization(uuid, uuid, text) to service_role;

drop function public.tipshift_admin_scopes(uuid);
create function public.tipshift_admin_scopes(p_admin_user_id uuid)
returns table(venue_ref uuid, organization_name text, branch_ref uuid, branch_label text, branch_address text, role text)
language sql
set search_path = pg_catalog, tipshift_private
as $$
  select a.venue_ref, o.organization_name, b.branch_ref, b.branch_label, b.branch_address, a.role
  from tipshift_private.admin_authorizations a
  join tipshift_private.branches b
    on b.venue_ref = a.venue_ref and b.active
  left join tipshift_private.organizations o on o.venue_ref = a.venue_ref
  where a.admin_user_id = p_admin_user_id
    and (a.role = 'organization_admin' or a.branch_ref = b.branch_ref)
  union all
  select a.venue_ref, o.organization_name, null::uuid, null::text, null::text, a.role
  from tipshift_private.admin_authorizations a
  left join tipshift_private.organizations o on o.venue_ref = a.venue_ref
  where a.admin_user_id = p_admin_user_id
    and a.role = 'organization_admin'
    and not exists (select 1 from tipshift_private.branches b where b.venue_ref = a.venue_ref and b.active);
$$;
revoke all on function public.tipshift_admin_scopes(uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_scopes(uuid) to service_role;

-- Registering a branch now requires the organization to be named first.
drop function public.tipshift_admin_register_branch(uuid, uuid, text);
create function public.tipshift_admin_register_branch(p_admin_user_id uuid, p_venue_ref uuid, p_branch_label text, p_branch_address text default null)
returns table(branch_ref uuid, branch_label text, branch_address text)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  address text := nullif(btrim(coalesce(p_branch_address, '')), '');
begin
  if not exists (
    select 1 from tipshift_private.admin_authorizations a
    where a.admin_user_id = p_admin_user_id and a.venue_ref = p_venue_ref and a.role = 'organization_admin'
  ) or not exists (select 1 from tipshift_private.organizations o where o.venue_ref = p_venue_ref)
    or p_branch_label is null or char_length(btrim(p_branch_label)) not between 1 and 80 or btrim(p_branch_label) ~ '[[:cntrl:]]'
    or (address is not null and (char_length(address) > 160 or address ~ '[[:cntrl:]]')) then
    return;
  end if;
  return query
    insert into tipshift_private.branches as b (venue_ref, branch_label, branch_address)
    values (p_venue_ref, btrim(p_branch_label), address)
    returning b.branch_ref, b.branch_label, b.branch_address;
exception when unique_violation then
  return;
end;
$$;
revoke all on function public.tipshift_admin_register_branch(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.tipshift_admin_register_branch(uuid, uuid, text, text) to service_role;
