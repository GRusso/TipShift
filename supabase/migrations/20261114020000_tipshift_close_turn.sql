-- Closing a shift freezes it: the pool balance at that moment is kept (so receipts show what was
-- really split, not the live pool), the on-chain transaction is linked, and disputes stop. The balance
-- lives in the report state row, which is deleted with the shift 30 days after it ends.
alter table tipshift_private.turn_report_state
  add column closed_at timestamptz,
  add column closing_balance numeric check (closing_balance is null or (closing_balance >= 0 and closing_balance = trunc(closing_balance)));

create function public.tipshift_turn_closed(p_turn_ref uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, tipshift_private
as $$ select exists (select 1 from tipshift_private.turn_report_state s where s.turn_ref = p_turn_ref and s.closed_at is not null) $$;
revoke all on function public.tipshift_turn_closed(uuid) from public, anon, authenticated;
grant execute on function public.tipshift_turn_closed(uuid) to service_role;

-- Manager / owner. First call (balance) closes the shift and is refused while a dispute is still open.
-- Second call (tx) links the on-chain transaction. Both are idempotent: the first values win.
create function public.tipshift_admin_close_turn(p_admin_user_id uuid, p_turn_ref uuid, p_balance numeric, p_tx text)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare turn_row tipshift_private.turns%rowtype; state_row tipshift_private.turn_report_state%rowtype;
begin
  select * into turn_row from tipshift_private.turns t where t.turn_ref = p_turn_ref;
  if not found or not public.tipshift_admin_authorized(p_admin_user_id, turn_row.venue_ref, turn_row.branch_ref) then return false; end if;
  select * into state_row from tipshift_private.turn_report_state s where s.turn_ref = p_turn_ref;
  if state_row.closed_at is null then
    if p_balance is null then return false; end if;
    -- An accepted objection or a correction vote must be settled first. An objection nobody backed in time simply lapses.
    if exists (select 1 from tipshift_private.turn_disputes d where d.turn_ref = p_turn_ref and d.state in ('accepted', 'correction_voting')) then return false; end if;
    update tipshift_private.turn_disputes d set state = 'rejected', resolved_at = timezone('utc', now()) where d.turn_ref = p_turn_ref and d.state = 'voting';
  end if;
  insert into tipshift_private.turn_report_state (turn_ref, closed_at, closing_balance, distribution_tx)
  values (p_turn_ref, timezone('utc', now()), p_balance, nullif(btrim(p_tx), ''))
  on conflict (turn_ref) do update set
    closed_at = coalesce(tipshift_private.turn_report_state.closed_at, excluded.closed_at),
    -- A retry before the payout is linked may refresh the balance (more tips may have arrived); afterwards it is final.
    closing_balance = case when tipshift_private.turn_report_state.distribution_tx is null then coalesce(excluded.closing_balance, tipshift_private.turn_report_state.closing_balance) else tipshift_private.turn_report_state.closing_balance end,
    distribution_tx = coalesce(excluded.distribution_tx, tipshift_private.turn_report_state.distribution_tx);
  return true;
exception when check_violation then return false;
end;
$$;
revoke all on function public.tipshift_admin_close_turn(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.tipshift_admin_close_turn(uuid, uuid, numeric, text) to service_role;

-- No disputes once the shift is closed.
create or replace function public.tipshift_employee_dispute_open(p_commitments bytea[], p_turn_ref uuid, p_note text)
returns uuid
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare emp uuid; new_id uuid;
begin
  select e.employee_id into emp from tipshift_private.employees e
    join tipshift_private.turn_checkins c on c.employee_id = e.employee_id and c.turn_ref = p_turn_ref and c.signed_at is not null
    join tipshift_private.turns t on t.turn_ref = c.turn_ref
    where e.wallet_commitment = any(p_commitments) and e.active and t.scheduled_starts_at <= timezone('utc', now()) limit 1;
  if emp is null or public.tipshift_turn_closed(p_turn_ref) then return null; end if;
  insert into tipshift_private.turn_disputes (turn_ref, opened_by, note) values (p_turn_ref, emp, nullif(btrim(p_note), '')) returning dispute_id into new_id;
  insert into tipshift_private.dispute_votes (dispute_id, employee_id, phase, support) values (new_id, emp, 'dispute', true);
  perform public.tipshift_dispute_evaluate(new_id);
  return new_id;
exception when unique_violation or check_violation then return null;
end;
$$;

create or replace function public.tipshift_employee_dispute_vote(p_commitments bytea[], p_dispute_id uuid, p_phase text, p_support boolean)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare d tipshift_private.turn_disputes%rowtype; emp uuid; expected text;
begin
  select * into d from tipshift_private.turn_disputes x where x.dispute_id = p_dispute_id;
  if not found or p_phase not in ('dispute', 'correction') then return false; end if;
  expected := case when p_phase = 'dispute' then 'voting' else 'correction_voting' end;
  if d.state <> expected or public.tipshift_turn_closed(d.turn_ref) then return false; end if;
  select e.employee_id into emp from tipshift_private.employees e
    join tipshift_private.turn_checkins c on c.employee_id = e.employee_id and c.turn_ref = d.turn_ref and c.signed_at is not null
    where e.wallet_commitment = any(p_commitments) and e.active limit 1;
  if emp is null then return false; end if;
  insert into tipshift_private.dispute_votes (dispute_id, employee_id, phase, support) values (p_dispute_id, emp, p_phase, p_support);
  perform public.tipshift_dispute_evaluate(p_dispute_id);
  return true;
exception when unique_violation then return false;
end;
$$;

create or replace function public.tipshift_admin_dispute_propose(p_admin_user_id uuid, p_dispute_id uuid, p_shares jsonb, p_note text)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare d tipshift_private.turn_disputes%rowtype; turn_row tipshift_private.turns%rowtype; total integer; entries integer; groups integer;
begin
  select * into d from tipshift_private.turn_disputes x where x.dispute_id = p_dispute_id;
  if not found or d.state <> 'accepted' or public.tipshift_turn_closed(d.turn_ref) then return false; end if;
  select * into turn_row from tipshift_private.turns t where t.turn_ref = d.turn_ref;
  if not public.tipshift_admin_authorized(p_admin_user_id, turn_row.venue_ref, turn_row.branch_ref) then return false; end if;
  if jsonb_typeof(p_shares) <> 'array' then return false; end if;
  select coalesce(sum((entry->>'shareBps')::integer), 0), count(*) into total, entries from jsonb_array_elements(p_shares) entry;
  select count(*) into groups from tipshift_private.turn_groups g where g.turn_ref = d.turn_ref;
  if total <> 10000 or entries <> groups
    or exists (select 1 from jsonb_array_elements(p_shares) entry where (entry->>'shareBps') !~ '^(?:0|[1-9][0-9]{0,3}|10000)$'
      or not exists (select 1 from tipshift_private.turn_groups g where g.turn_ref = d.turn_ref and g.group_ref::text = entry->>'groupRef')) then return false; end if;
  update tipshift_private.turn_disputes set state = 'correction_voting', proposed_shares = p_shares, proposal_note = nullif(btrim(p_note), ''), proposed_at = timezone('utc', now()) where dispute_id = p_dispute_id;
  return true;
exception when invalid_text_representation or check_violation then return false;
end;
$$;

-- Reports expose whether the shift is closed and the balance that was split.
create or replace function public.tipshift_admin_branch_reports(p_admin_user_id uuid, p_branch_ref uuid)
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
      'distributionTx', s.distribution_tx, 'closed', (s.closed_at is not null), 'closingBalance', s.closing_balance::text, 'disputes', public.tipshift_dispute_summary(t.turn_ref, null),
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


create or replace function public.tipshift_employee_reports(p_commitments bytea[])
returns jsonb
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(report order by (report->>'startsAt') desc), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'turnRef', t.turn_ref, 'branchLabel', b.branch_label, 'startsAt', t.scheduled_starts_at, 'endsAt', t.scheduled_ends_at,
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

