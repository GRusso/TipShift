-- Managers join a location like employees do: the owner creates a 3-letter pseudonym and a QR, the manager
-- signs it with their wallet, and that wallet becomes the location's administrator (pays the network fees).
-- No e-mail is needed. A manager can also ask the owner for more NEAR for fees.
alter table tipshift_private.manager_invitations alter column manager_email drop not null;
alter table tipshift_private.manager_invitations
  add column pseudonym text check (pseudonym ~ '^[A-Z]{3}$'),
  add column capability_hash bytea unique,
  add column manager_wallet text check (manager_wallet ~ '^[a-z0-9._-]{2,64}$'),
  add column funding_requested_yocto numeric check (funding_requested_yocto is null or funding_requested_yocto > 0),
  add column funding_requested_at timestamptz;
create unique index manager_invitations_branch_pseudonym on tipshift_private.manager_invitations (branch_ref, pseudonym)
  where status <> 'revoked' and pseudonym is not null;

create function public.tipshift_admin_create_manager_invite(p_admin_user_id uuid, p_venue_ref uuid, p_branch_ref uuid, p_pseudonym text, p_capability_hash bytea)
returns table(invitation_id uuid, status text)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  name text := upper(btrim(coalesce(p_pseudonym, '')));
begin
  if name !~ '^[A-Z]{3}$' or p_capability_hash is null then return; end if;
  if not exists (
    select 1 from tipshift_private.admin_authorizations a
    where a.admin_user_id = p_admin_user_id and a.venue_ref = p_venue_ref and a.role = 'organization_admin'
  ) or not exists (
    select 1 from tipshift_private.branches b where b.branch_ref = p_branch_ref and b.venue_ref = p_venue_ref and b.active
  ) then
    return;
  end if;
  return query
    insert into tipshift_private.manager_invitations as i (venue_ref, branch_ref, pseudonym, capability_hash, created_by)
    values (p_venue_ref, p_branch_ref, name, p_capability_hash, p_admin_user_id)
    returning i.invitation_id, i.status;
exception when unique_violation or check_violation then
  return;
end;
$$;
revoke all on function public.tipshift_admin_create_manager_invite(uuid, uuid, uuid, text, bytea) from public, anon, authenticated;
grant execute on function public.tipshift_admin_create_manager_invite(uuid, uuid, uuid, text, bytea) to service_role;

-- What a manager sees before signing: only the location and the pseudonym.
create function public.tipshift_manager_invite_lookup(p_capability_hash bytea)
returns table(branch_ref uuid, branch_label text, pseudonym text)
language sql
set search_path = pg_catalog, tipshift_private
as $$
  select i.branch_ref, b.branch_label, i.pseudonym
  from tipshift_private.manager_invitations i
  join tipshift_private.branches b on b.branch_ref = i.branch_ref and b.active
  where i.capability_hash = p_capability_hash and i.status = 'invited';
$$;
revoke all on function public.tipshift_manager_invite_lookup(bytea) from public, anon, authenticated;
grant execute on function public.tipshift_manager_invite_lookup(bytea) to service_role;

-- Consumes the invitation: the wallet's account becomes the branch administrator. One account, one role.
create function public.tipshift_manager_invite_claim(p_capability_hash bytea, p_user_id uuid, p_wallet text)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  inv tipshift_private.manager_invitations;
begin
  if p_user_id is null or p_wallet is null then return false; end if;
  select i.* into inv
  from tipshift_private.manager_invitations i
  join tipshift_private.branches b on b.branch_ref = i.branch_ref and b.active
  where i.capability_hash = p_capability_hash and i.status = 'invited'
  for update of i;
  if not found then return false; end if;
  if exists (select 1 from tipshift_private.admin_authorizations a where a.admin_user_id = p_user_id) then return false; end if;
  insert into tipshift_private.admin_authorizations (admin_user_id, venue_ref, branch_ref, role)
  values (p_user_id, inv.venue_ref, inv.branch_ref, 'branch_admin');
  update tipshift_private.manager_invitations
  set status = 'active', claimed_by = p_user_id, claimed_at = timezone('utc', now()), manager_wallet = p_wallet
  where manager_invitations.invitation_id = inv.invitation_id;
  return true;
end;
$$;
revoke all on function public.tipshift_manager_invite_claim(bytea, uuid, text) from public, anon, authenticated;
grant execute on function public.tipshift_manager_invite_claim(bytea, uuid, text) to service_role;

drop function public.tipshift_admin_manager_invitations(uuid, uuid);
create function public.tipshift_admin_manager_invitations(p_admin_user_id uuid, p_venue_ref uuid)
returns table(invitation_id uuid, branch_ref uuid, branch_label text, manager_email text, pseudonym text, manager_wallet text, status text, funding_requested text, created_at timestamptz)
language sql
set search_path = pg_catalog, tipshift_private
as $$
  select i.invitation_id, i.branch_ref, b.branch_label, i.manager_email, i.pseudonym, i.manager_wallet, i.status,
         trunc(i.funding_requested_yocto)::text, i.created_at
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

-- The active manager of a location (pseudonym and wallet). Visible to the owner and to that location's admin.
create function public.tipshift_admin_branch_manager(p_admin_user_id uuid, p_branch_ref uuid)
returns table(pseudonym text, manager_wallet text, funding_requested text)
language sql
set search_path = pg_catalog, tipshift_private
as $$
  select i.pseudonym, i.manager_wallet, trunc(i.funding_requested_yocto)::text
  from tipshift_private.manager_invitations i
  where i.branch_ref = p_branch_ref and i.status = 'active' and i.manager_wallet is not null
    and exists (
      select 1 from tipshift_private.admin_authorizations a
      where a.admin_user_id = p_admin_user_id
        and ((a.role = 'organization_admin' and a.venue_ref = i.venue_ref) or (a.role = 'branch_admin' and a.branch_ref = i.branch_ref))
    )
  order by i.claimed_at desc
  limit 1;
$$;
revoke all on function public.tipshift_admin_branch_manager(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_branch_manager(uuid, uuid) to service_role;

-- A manager asks the owner for NEAR to cover network fees; the owner sees the request next to the manager.
create function public.tipshift_manager_request_funds(p_admin_user_id uuid, p_amount_yocto numeric)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  if p_amount_yocto is null or p_amount_yocto <= 0 or p_amount_yocto > 100 * 1e24 then return false; end if;
  update tipshift_private.manager_invitations
  set funding_requested_yocto = trunc(p_amount_yocto), funding_requested_at = timezone('utc', now())
  where claimed_by = p_admin_user_id and status = 'active';
  return found;
end;
$$;
revoke all on function public.tipshift_manager_request_funds(uuid, numeric) from public, anon, authenticated;
grant execute on function public.tipshift_manager_request_funds(uuid, numeric) to service_role;

create function public.tipshift_admin_clear_funding(p_admin_user_id uuid, p_invitation_id uuid)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  update tipshift_private.manager_invitations i
  set funding_requested_yocto = null, funding_requested_at = null
  where i.invitation_id = p_invitation_id
    and exists (
      select 1 from tipshift_private.admin_authorizations a
      where a.admin_user_id = p_admin_user_id and a.venue_ref = i.venue_ref and a.role = 'organization_admin'
    );
  return found;
end;
$$;
revoke all on function public.tipshift_admin_clear_funding(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_clear_funding(uuid, uuid) to service_role;
