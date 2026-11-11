-- Business labels identify a venue location, never an employee or customer.
create table tipshift_private.branches (
  branch_ref uuid primary key default gen_random_uuid(),
  venue_ref uuid not null,
  branch_label text not null check (char_length(branch_label) between 1 and 80 and branch_label !~ '[[:cntrl:]]'),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  unique (venue_ref, branch_label)
);
alter table tipshift_private.branches enable row level security;
revoke all on tipshift_private.branches from public, anon, authenticated;

create or replace function tipshift_private.assert_active_branch()
returns trigger
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  if not exists (
    select 1 from tipshift_private.branches b
    where b.venue_ref = new.venue_ref and b.branch_ref = new.branch_ref and b.active
  ) then
    raise exception 'TipShift branch is not registered or active.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger turns_active_branch_required
  before insert on tipshift_private.turns
  for each row execute function tipshift_private.assert_active_branch();

drop function public.tipshift_admin_scopes(uuid);
create function public.tipshift_admin_scopes(p_admin_user_id uuid)
returns table(venue_ref uuid, branch_ref uuid, branch_label text, role text)
language sql
set search_path = pg_catalog, tipshift_private
as $$
  select a.venue_ref, b.branch_ref, b.branch_label, a.role
  from tipshift_private.admin_authorizations a
  join tipshift_private.branches b
    on b.venue_ref = a.venue_ref and b.active
  where a.admin_user_id = p_admin_user_id
    and (a.role = 'organization_admin' or a.branch_ref = b.branch_ref)
  union all
  select a.venue_ref, null::uuid, null::text, a.role
  from tipshift_private.admin_authorizations a
  where a.admin_user_id = p_admin_user_id
    and a.role = 'organization_admin'
    and not exists (select 1 from tipshift_private.branches b where b.venue_ref = a.venue_ref and b.active);
$$;
revoke all on function public.tipshift_admin_scopes(uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_scopes(uuid) to service_role;

create function public.tipshift_admin_register_branch(p_admin_user_id uuid, p_venue_ref uuid, p_branch_label text)
returns table(branch_ref uuid, branch_label text)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  if not exists (
    select 1 from tipshift_private.admin_authorizations a
    where a.admin_user_id = p_admin_user_id and a.venue_ref = p_venue_ref and a.role = 'organization_admin'
  ) or p_branch_label is null or char_length(btrim(p_branch_label)) not between 1 and 80 or btrim(p_branch_label) ~ '[[:cntrl:]]' then
    return;
  end if;
  return query
    insert into tipshift_private.branches (venue_ref, branch_label)
    values (p_venue_ref, btrim(p_branch_label))
    returning branches.branch_ref, branches.branch_label;
exception when unique_violation then
  return;
end;
$$;
revoke all on function public.tipshift_admin_register_branch(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tipshift_admin_register_branch(uuid, uuid, text) to service_role;
