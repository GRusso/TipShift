-- Branch managers are invited by the organization owner and may be revoked at any time.
-- Only the manager's work email is stored (an administrator, never an employee).
create table tipshift_private.manager_invitations (
  invitation_id uuid primary key default gen_random_uuid(),
  venue_ref uuid not null,
  branch_ref uuid not null references tipshift_private.branches(branch_ref),
  manager_email text not null check (
    manager_email = lower(manager_email)
    and char_length(manager_email) between 3 and 254
    and manager_email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
  ),
  status text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  created_by uuid references auth.users(id) on delete set null,
  claimed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  claimed_at timestamptz,
  revoked_at timestamptz,
  unique (branch_ref, manager_email)
);
alter table tipshift_private.manager_invitations enable row level security;
revoke all on tipshift_private.manager_invitations from public, anon, authenticated;
grant select, insert, update on tipshift_private.manager_invitations to service_role;

create function public.tipshift_admin_invite_manager(p_admin_user_id uuid, p_venue_ref uuid, p_branch_ref uuid, p_email text)
returns table(invitation_id uuid, status text)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  email text := lower(btrim(coalesce(p_email, '')));
begin
  if not exists (
    select 1 from tipshift_private.admin_authorizations a
    where a.admin_user_id = p_admin_user_id and a.venue_ref = p_venue_ref and a.role = 'organization_admin'
  ) or not exists (
    select 1 from tipshift_private.branches b where b.branch_ref = p_branch_ref and b.venue_ref = p_venue_ref and b.active
  ) then
    return;
  end if;
  return query
    insert into tipshift_private.manager_invitations as i (venue_ref, branch_ref, manager_email, created_by)
    values (p_venue_ref, p_branch_ref, email, p_admin_user_id)
    on conflict (branch_ref, manager_email) do update
      set status = case when i.status = 'revoked' then 'invited' else i.status end,
          revoked_at = case when i.status = 'revoked' then null else i.revoked_at end
    returning i.invitation_id, i.status;
exception when check_violation then
  return;
end;
$$;
revoke all on function public.tipshift_admin_invite_manager(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tipshift_admin_invite_manager(uuid, uuid, uuid, text) to service_role;

create function public.tipshift_admin_revoke_manager(p_admin_user_id uuid, p_invitation_id uuid)
returns table(invitation_id uuid, status text)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  inv tipshift_private.manager_invitations;
begin
  select i.* into inv from tipshift_private.manager_invitations i where i.invitation_id = p_invitation_id for update;
  if not found then return; end if;
  if not exists (
    select 1 from tipshift_private.admin_authorizations a
    where a.admin_user_id = p_admin_user_id and a.venue_ref = inv.venue_ref and a.role = 'organization_admin'
  ) then
    return;
  end if;
  update tipshift_private.manager_invitations set status = 'revoked', revoked_at = timezone('utc', now()) where manager_invitations.invitation_id = inv.invitation_id;
  -- Access ends immediately: remove the manager's branch authorization.
  delete from tipshift_private.admin_authorizations a
  where a.admin_user_id = inv.claimed_by and a.role = 'branch_admin' and a.branch_ref = inv.branch_ref;
  return query select inv.invitation_id, 'revoked'::text;
end;
$$;
revoke all on function public.tipshift_admin_revoke_manager(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_revoke_manager(uuid, uuid) to service_role;

-- Called by the Edge Function with the id and e-mail of the already-verified JWT user.
create function public.tipshift_admin_claim_invitations(p_user_id uuid, p_email text)
returns integer
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  inv tipshift_private.manager_invitations;
begin
  if p_user_id is null or p_email is null then return 0; end if;
  if exists (select 1 from tipshift_private.admin_authorizations a where a.admin_user_id = p_user_id) then return 0; end if;
  select i.* into inv
  from tipshift_private.manager_invitations i
  join tipshift_private.branches b on b.branch_ref = i.branch_ref and b.active
  where i.status = 'invited' and i.manager_email = lower(btrim(p_email))
  order by i.created_at
  limit 1
  for update of i;
  if not found then return 0; end if;
  insert into tipshift_private.admin_authorizations (admin_user_id, venue_ref, branch_ref, role)
  values (p_user_id, inv.venue_ref, inv.branch_ref, 'branch_admin');
  update tipshift_private.manager_invitations
  set status = 'active', claimed_by = p_user_id, claimed_at = timezone('utc', now())
  where manager_invitations.invitation_id = inv.invitation_id;
  return 1;
end;
$$;
revoke all on function public.tipshift_admin_claim_invitations(uuid, text) from public, anon, authenticated;
grant execute on function public.tipshift_admin_claim_invitations(uuid, text) to service_role;

create function public.tipshift_admin_manager_invitations(p_admin_user_id uuid, p_venue_ref uuid)
returns table(invitation_id uuid, branch_ref uuid, branch_label text, manager_email text, status text, created_at timestamptz)
language sql
set search_path = pg_catalog, tipshift_private
as $$
  select i.invitation_id, i.branch_ref, b.branch_label, i.manager_email, i.status, i.created_at
  from tipshift_private.manager_invitations i
  join tipshift_private.branches b on b.branch_ref = i.branch_ref
  where i.venue_ref = p_venue_ref
    and exists (
      select 1 from tipshift_private.admin_authorizations a
      where a.admin_user_id = p_admin_user_id and a.venue_ref = p_venue_ref and a.role = 'organization_admin'
    )
  order by i.created_at;
$$;
revoke all on function public.tipshift_admin_manager_invitations(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_manager_invitations(uuid, uuid) to service_role;
