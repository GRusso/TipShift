-- Shift reports. Managers/owners see the reports of their location(s); an employee sees only the
-- report of the group and shift they checked in to. Everyone can delete: managers and owners
-- remove the report for the business; an employee only hides it from their own view. Reports
-- disappear on their own 30 days after the shift ends (they are a convenience copy; the final
-- distribution lives on-chain, and distribution_tx keeps the link to it once it exists).

alter table tipshift_private.turn_groups add column group_label text check (group_label is null or char_length(group_label) between 1 and 48);

create table tipshift_private.turn_report_state (
  turn_ref uuid primary key references tipshift_private.turns(turn_ref) on delete cascade,
  deleted_at timestamptz,
  distribution_tx text check (distribution_tx is null or char_length(distribution_tx) <= 128)
);
alter table tipshift_private.turn_report_state enable row level security;
revoke all on tipshift_private.turn_report_state from public, anon, authenticated;
grant select, insert, update on tipshift_private.turn_report_state to service_role;

create table tipshift_private.employee_report_hidden (
  turn_ref uuid not null references tipshift_private.turns(turn_ref) on delete cascade,
  employee_id uuid not null references tipshift_private.employees(employee_id) on delete cascade,
  primary key (turn_ref, employee_id)
);
alter table tipshift_private.employee_report_hidden enable row level security;
revoke all on tipshift_private.employee_report_hidden from public, anon, authenticated;
grant select, insert on tipshift_private.employee_report_hidden to service_role;

create table tipshift_private.report_challenges (
  nonce bytea primary key check (octet_length(nonce) = 32),
  expires_at timestamptz not null
);
alter table tipshift_private.report_challenges enable row level security;
revoke all on tipshift_private.report_challenges from public, anon, authenticated;
grant select, insert, delete on tipshift_private.report_challenges to service_role;

-- Group names now travel with the shift so reports can show them. Replaces the 070000 function (same signature).
create or replace function public.tipshift_admin_create_group_turn(
  p_admin_user_id uuid, p_venue_ref uuid, p_branch_ref uuid,
  p_scheduled_starts_at timestamptz, p_scheduled_ends_at timestamptz,
  p_groups jsonb, p_links jsonb
)
returns uuid
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare new_turn_ref uuid := gen_random_uuid(); group_total integer; group_count integer; link_count integer;
begin
  if not public.tipshift_admin_authorized(p_admin_user_id, p_venue_ref, p_branch_ref)
    or jsonb_typeof(p_groups) <> 'array' or jsonb_typeof(p_links) <> 'array'
    or p_scheduled_ends_at <= timezone('utc', now())
    or p_scheduled_starts_at > timezone('utc', now()) + interval '31 days'
    or p_scheduled_ends_at <= p_scheduled_starts_at
    or p_scheduled_ends_at > p_scheduled_starts_at + interval '24 hours' then return null; end if;
  select coalesce(sum((entry->>'shareBps')::integer), 0), count(*) into group_total, group_count from jsonb_array_elements(p_groups) entry;
  select count(*) into link_count from jsonb_array_elements(p_links);
  if group_count < 1 or group_count > 20 or group_total <> 10000 or link_count <> group_count then return null; end if;
  if exists (select 1 from jsonb_array_elements(p_groups) entry where not (entry ? 'groupRef') or (entry->>'shareBps') !~ '^(?:[1-9][0-9]{0,3}|10000)$')
    or exists (select 1 from jsonb_array_elements(p_links) entry where not (entry ?& array['capabilityHash', 'groupRef', 'capacity'])
      or (entry->>'capabilityHash') !~ '^[0-9a-f]{64}$' or (entry->>'capacity') !~ '^[1-9][0-9]?$|^100$') then return null; end if;
  insert into tipshift_private.turns (turn_ref, venue_ref, branch_ref, state, claim_window_ends_at, scheduled_starts_at, scheduled_ends_at, retention_delete_after)
  values (new_turn_ref, p_venue_ref, p_branch_ref, 'draft', p_scheduled_ends_at, p_scheduled_starts_at, p_scheduled_ends_at, timezone('utc', now()) + interval '31 days');
  insert into tipshift_private.turn_groups (turn_ref, group_ref, share_bps, group_label)
  select new_turn_ref, (entry->>'groupRef')::uuid, (entry->>'shareBps')::integer, nullif(btrim(entry->>'label'), '') from jsonb_array_elements(p_groups) entry;
  insert into tipshift_private.turn_group_links (capability_hash, turn_ref, group_ref, capacity)
  select decode(entry->>'capabilityHash', 'hex'), new_turn_ref, (entry->>'groupRef')::uuid, (entry->>'capacity')::smallint from jsonb_array_elements(p_links) entry;
  update tipshift_private.turns t set state = 'claiming' where t.turn_ref = new_turn_ref;
  return new_turn_ref;
exception when invalid_text_representation or unique_violation or check_violation or foreign_key_violation then return null;
end;
$$;

-- Automatic deletion: reports (and the shift data behind them) go 30 days after the shift ends.
create function public.tipshift_purge_old_reports()
returns bigint
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare removed bigint;
begin
  delete from tipshift_private.report_challenges where expires_at < timezone('utc', now());
  with gone as (delete from tipshift_private.turns t where t.scheduled_ends_at < timezone('utc', now()) - interval '30 days' returning 1)
  select count(*) into removed from gone;
  return removed;
end;
$$;
revoke all on function public.tipshift_purge_old_reports() from public, anon, authenticated;
grant execute on function public.tipshift_purge_old_reports() to service_role;

-- Manager / owner: the reports of one location (owner: any of the company's locations).
create function public.tipshift_admin_branch_reports(p_admin_user_id uuid, p_branch_ref uuid)
returns jsonb
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare venue uuid; result jsonb;
begin
  select b.venue_ref into venue from tipshift_private.branches b where b.branch_ref = p_branch_ref;
  if venue is null or not public.tipshift_admin_authorized(p_admin_user_id, venue, p_branch_ref) then return null; end if;
  perform public.tipshift_purge_old_reports();
  select coalesce(jsonb_agg(report order by (report->>'startsAt') desc), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'turnRef', t.turn_ref, 'startsAt', t.scheduled_starts_at, 'endsAt', t.scheduled_ends_at,
      'distributionTx', s.distribution_tx,
      'groups', (select coalesce(jsonb_agg(jsonb_build_object(
          'groupRef', g.group_ref, 'label', g.group_label, 'shareBps', g.share_bps,
          'capacity', (select l.capacity from tipshift_private.turn_group_links l where l.turn_ref = g.turn_ref and l.group_ref = g.group_ref),
          'people', (select coalesce(jsonb_agg(jsonb_build_object('employeeId', c.employee_id, 'initials', e.initials, 'signed', c.signed_at is not null) order by c.created_at), '[]'::jsonb)
                     from tipshift_private.turn_checkins c join tipshift_private.employees e on e.employee_id = c.employee_id
                     where c.turn_ref = g.turn_ref and c.group_ref = g.group_ref)
        ) order by g.group_ref), '[]'::jsonb) from tipshift_private.turn_groups g where g.turn_ref = t.turn_ref)
    ) as report
    from tipshift_private.turns t
    left join tipshift_private.turn_report_state s on s.turn_ref = t.turn_ref
    where t.branch_ref = p_branch_ref and s.deleted_at is null
      and exists (select 1 from tipshift_private.turn_group_links l where l.turn_ref = t.turn_ref)
  ) reports;
  return result;
end;
$$;
revoke all on function public.tipshift_admin_branch_reports(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_branch_reports(uuid, uuid) to service_role;

-- Manager / owner: delete a report for the business. (The employees' own views are not touched.)
create function public.tipshift_admin_delete_report(p_admin_user_id uuid, p_turn_ref uuid)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare turn_row tipshift_private.turns%rowtype;
begin
  select * into turn_row from tipshift_private.turns t where t.turn_ref = p_turn_ref;
  if not found or not public.tipshift_admin_authorized(p_admin_user_id, turn_row.venue_ref, turn_row.branch_ref) then return false; end if;
  insert into tipshift_private.turn_report_state (turn_ref, deleted_at) values (p_turn_ref, timezone('utc', now()))
  on conflict (turn_ref) do update set deleted_at = coalesce(tipshift_private.turn_report_state.deleted_at, excluded.deleted_at);
  return true;
end;
$$;
revoke all on function public.tipshift_admin_delete_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_delete_report(uuid, uuid) to service_role;

-- Employee: one-time challenge so a wallet signature proves who is asking.
create function public.tipshift_report_challenge_start(p_nonce bytea)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  perform public.tipshift_purge_old_reports();
  insert into tipshift_private.report_challenges (nonce, expires_at) values (p_nonce, timezone('utc', now()) + interval '10 minutes');
  return true;
end;
$$;
revoke all on function public.tipshift_report_challenge_start(bytea) from public, anon, authenticated;
grant execute on function public.tipshift_report_challenge_start(bytea) to service_role;

create function public.tipshift_report_challenge_consume(p_nonce bytea)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  delete from tipshift_private.report_challenges c where c.nonce = p_nonce and c.expires_at > timezone('utc', now());
  return found;
end;
$$;
revoke all on function public.tipshift_report_challenge_consume(bytea) from public, anon, authenticated;
grant execute on function public.tipshift_report_challenge_consume(bytea) to service_role;

create function public.tipshift_all_branch_refs()
returns setof uuid
language sql
set search_path = pg_catalog, tipshift_private
as $$ select b.branch_ref from tipshift_private.branches b $$;
revoke all on function public.tipshift_all_branch_refs() from public, anon, authenticated;
grant execute on function public.tipshift_all_branch_refs() to service_role;

-- Employee: the reports of the shifts where this wallet (one commitment per location) was present.
-- Only the employee's own group lists people (initials); other groups show just their headcount.
create function public.tipshift_employee_reports(p_commitments bytea[])
returns jsonb
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(report order by (report->>'startsAt') desc), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'turnRef', t.turn_ref, 'branchLabel', b.branch_label, 'startsAt', t.scheduled_starts_at, 'endsAt', t.scheduled_ends_at,
      'distributionTx', s.distribution_tx, 'myGroupRef', me.group_ref, 'myEmployeeId', e.employee_id, 'myInitials', e.initials,
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
revoke all on function public.tipshift_employee_reports(bytea[]) from public, anon, authenticated;
grant execute on function public.tipshift_employee_reports(bytea[]) to service_role;

-- Employee: hide a report from their own view only.
create function public.tipshift_employee_hide_report(p_commitments bytea[], p_turn_ref uuid)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare hidden integer;
begin
  with mine as (
    select e.employee_id from tipshift_private.employees e
    join tipshift_private.turn_checkins c on c.employee_id = e.employee_id and c.turn_ref = p_turn_ref
    where e.wallet_commitment = any(p_commitments) and e.active
  ), done as (
    insert into tipshift_private.employee_report_hidden (turn_ref, employee_id) select p_turn_ref, employee_id from mine on conflict do nothing returning 1
  ) select count(*) into hidden from mine;
  return hidden > 0;
end;
$$;
revoke all on function public.tipshift_employee_hide_report(bytea[], uuid) from public, anon, authenticated;
grant execute on function public.tipshift_employee_hide_report(bytea[], uuid) to service_role;
