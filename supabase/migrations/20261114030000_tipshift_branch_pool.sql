-- One pool per location, for good. The pool lives on-chain (admin = the wallet that created it); the
-- location only remembers its id so the console, the customer QR and the employees' receipts find it.
alter table tipshift_private.branches add column pool_id text check (pool_id is null or pool_id ~ '^[A-Za-z0-9._:-]{1,128}$');

create function public.tipshift_admin_set_branch_pool(p_admin_user_id uuid, p_branch_ref uuid, p_pool_id text)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare venue uuid;
begin
  select b.venue_ref into venue from tipshift_private.branches b where b.branch_ref = p_branch_ref and b.active;
  if venue is null or not public.tipshift_admin_authorized(p_admin_user_id, venue, p_branch_ref) then return false; end if;
  update tipshift_private.branches set pool_id = p_pool_id where branch_ref = p_branch_ref;
  return true;
exception when check_violation then return false;
end;
$$;
revoke all on function public.tipshift_admin_set_branch_pool(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tipshift_admin_set_branch_pool(uuid, uuid, text) to service_role;

-- Scopes now carry the location's pool id.
drop function public.tipshift_admin_scopes(uuid);
create function public.tipshift_admin_scopes(p_admin_user_id uuid)
returns table(venue_ref uuid, organization_name text, branch_ref uuid, branch_label text, branch_address text, role text, branch_pool_id text)
language sql
set search_path = pg_catalog, tipshift_private
as $$
  select a.venue_ref, o.organization_name, b.branch_ref, b.branch_label, b.branch_address, a.role, b.pool_id
  from tipshift_private.admin_authorizations a
  join tipshift_private.branches b
    on b.venue_ref = a.venue_ref and b.active
  left join tipshift_private.organizations o on o.venue_ref = a.venue_ref
  where a.admin_user_id = p_admin_user_id
    and (a.role = 'organization_admin' or a.branch_ref = b.branch_ref)
  union all
  select a.venue_ref, o.organization_name, null::uuid, null::text, null::text, a.role, null::text
  from tipshift_private.admin_authorizations a
  left join tipshift_private.organizations o on o.venue_ref = a.venue_ref
  where a.admin_user_id = p_admin_user_id
    and a.role = 'organization_admin'
    and not exists (select 1 from tipshift_private.branches b where b.venue_ref = a.venue_ref and b.active);
$$;
revoke all on function public.tipshift_admin_scopes(uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_scopes(uuid) to service_role;

-- Employees see the pool of their location so their receipt can show the tips collected so far.
create or replace function public.tipshift_employee_reports(p_commitments bytea[])
returns jsonb
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(report order by (report->>'startsAt') desc), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'turnRef', t.turn_ref, 'branchLabel', b.branch_label, 'poolId', b.pool_id, 'startsAt', t.scheduled_starts_at, 'endsAt', t.scheduled_ends_at,
      'distributionTx', s.distribution_tx, 'closed', (s.closed_at is not null), 'closingBalance', s.closing_balance::text, 'disputes', public.tipshift_dispute_summary(t.turn_ref, e.employee_id), 'myGroupRef', me.group_ref, 'myEmployeeId', e.employee_id, 'myInitials', e.initials,
      'groups', (select coalesce(jsonb_agg(jsonb_build_object(
          'groupRef', g.group_ref, 'label', g.group_label, 'shareBps', g.share_bps,
          'signedCount', (select count(*) from tipshift_private.turn_checkins c where c.turn_ref = g.turn_ref and c.group_ref = g.group_ref and c.signed_at is not null),
          'people', case when g.group_ref = me.group_ref then
              (select coalesce(jsonb_agg(jsonb_build_object('employeeId', c.employee_id, 'initials', e2.initials) order by c.created_at), '[]'::jsonb)
               from tipshift_private.turn_checkins c join tipshift_private.employees e2 on e2.employee_id = c.employee_id
               where c.turn_ref = g.turn_ref and c.group_ref = g.group_ref and c.signed_at is not null) else '[]'::jsonb end
        ) order by g.group_ref), '[]'::jsonb) from tipshift_private.turn_groups g where g.turn_ref = t.turn_ref)
    ) as report
    from tipshift_private.employees e
    join tipshift_private.turn_checkins me on me.employee_id = e.employee_id and me.signed_at is not null
    join tipshift_private.turns t on t.turn_ref = me.turn_ref
    join tipshift_private.branches b on b.branch_ref = t.branch_ref
    left join tipshift_private.turn_report_state s on s.turn_ref = t.turn_ref
    where e.wallet_commitment = any(p_commitments) and e.active
      and not exists (select 1 from tipshift_private.employee_report_hidden h where h.turn_ref = t.turn_ref and h.employee_id = e.employee_id)
  ) reports;
  return result;
end;
$$;
