-- Disputes. An employee who was present can object to a shift's split. The people present vote
-- (more than half of them must agree, the same majority rule as the vault contract). If the
-- objection is accepted, the manager proposes a corrected split and the same people vote on it.
-- Everything stays in the shift report; nothing here goes on-chain. Individual votes are never shown
-- to the manager: only the counts. The records disappear with the shift (30-day retention, cascade).

create table tipshift_private.turn_disputes (
  dispute_id uuid primary key default gen_random_uuid(),
  turn_ref uuid not null references tipshift_private.turns(turn_ref) on delete cascade,
  opened_by uuid not null references tipshift_private.employees(employee_id) on delete cascade,
  note text check (note is null or char_length(note) <= 280),
  state text not null default 'voting' check (state in ('voting', 'accepted', 'rejected', 'withdrawn', 'correction_voting', 'corrected', 'correction_rejected')),
  proposed_shares jsonb,
  proposal_note text check (proposal_note is null or char_length(proposal_note) <= 280),
  created_at timestamptz not null default timezone('utc', clock_timestamp()),
  accepted_at timestamptz,
  proposed_at timestamptz,
  resolved_at timestamptz
);
create unique index turn_disputes_one_open on tipshift_private.turn_disputes (turn_ref) where state in ('voting', 'accepted', 'correction_voting');
alter table tipshift_private.turn_disputes enable row level security;
revoke all on tipshift_private.turn_disputes from public, anon, authenticated;
grant select, insert, update on tipshift_private.turn_disputes to service_role;

create table tipshift_private.dispute_votes (
  dispute_id uuid not null references tipshift_private.turn_disputes(dispute_id) on delete cascade,
  employee_id uuid not null references tipshift_private.employees(employee_id) on delete cascade,
  phase text not null check (phase in ('dispute', 'correction')),
  support boolean not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (dispute_id, employee_id, phase)
);
alter table tipshift_private.dispute_votes enable row level security;
revoke all on tipshift_private.dispute_votes from public, anon, authenticated;
grant select, insert on tipshift_private.dispute_votes to service_role;

-- People who can vote: those with a signed check-in in the shift.
create function public.tipshift_dispute_eligible(p_turn_ref uuid)
returns integer
language sql
set search_path = pg_catalog, tipshift_private
as $$ select count(distinct c.employee_id)::integer from tipshift_private.turn_checkins c where c.turn_ref = p_turn_ref and c.signed_at is not null $$;
revoke all on function public.tipshift_dispute_eligible(uuid) from public, anon, authenticated;
grant execute on function public.tipshift_dispute_eligible(uuid) to service_role;

-- Settle a vote as soon as the outcome cannot change.
create function public.tipshift_dispute_evaluate(p_dispute_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare d tipshift_private.turn_disputes%rowtype; eligible integer; yes integer; no integer; vote_phase text;
begin
  select * into d from tipshift_private.turn_disputes x where x.dispute_id = p_dispute_id;
  if not found or d.state not in ('voting', 'correction_voting') then return; end if;
  vote_phase := case when d.state = 'voting' then 'dispute' else 'correction' end;
  eligible := public.tipshift_dispute_eligible(d.turn_ref);
  select count(*) filter (where v.support), count(*) filter (where not v.support) into yes, no
    from tipshift_private.dispute_votes v where v.dispute_id = p_dispute_id and v.phase = vote_phase;
  if yes * 2 > eligible then
    if d.state = 'voting' then update tipshift_private.turn_disputes set state = 'accepted', accepted_at = timezone('utc', now()) where dispute_id = p_dispute_id;
    else update tipshift_private.turn_disputes set state = 'corrected', resolved_at = timezone('utc', now()) where dispute_id = p_dispute_id; end if;
  elsif no * 2 >= eligible then
    if d.state = 'voting' then update tipshift_private.turn_disputes set state = 'rejected', resolved_at = timezone('utc', now()) where dispute_id = p_dispute_id;
    else update tipshift_private.turn_disputes set state = 'correction_rejected', resolved_at = timezone('utc', now()) where dispute_id = p_dispute_id; end if;
  end if;
end;
$$;
revoke all on function public.tipshift_dispute_evaluate(uuid) from public, anon, authenticated;
grant execute on function public.tipshift_dispute_evaluate(uuid) to service_role;

-- Every dispute of one shift as shown in a report, newest first. Counts only; an employee also sees whether they voted.
create function public.tipshift_dispute_summary(p_turn_ref uuid, p_employee_id uuid)
returns jsonb
language sql
set search_path = pg_catalog, tipshift_private
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'disputeId', d.dispute_id, 'state', d.state, 'note', d.note, 'createdAt', d.created_at, 'acceptedAt', d.accepted_at,
    'proposedAt', d.proposed_at, 'resolvedAt', d.resolved_at, 'proposedShares', d.proposed_shares, 'proposalNote', d.proposal_note,
    'eligible', public.tipshift_dispute_eligible(p_turn_ref),
    'disputeYes', (select count(*) from tipshift_private.dispute_votes v where v.dispute_id = d.dispute_id and v.phase = 'dispute' and v.support),
    'disputeNo', (select count(*) from tipshift_private.dispute_votes v where v.dispute_id = d.dispute_id and v.phase = 'dispute' and not v.support),
    'correctionYes', (select count(*) from tipshift_private.dispute_votes v where v.dispute_id = d.dispute_id and v.phase = 'correction' and v.support),
    'correctionNo', (select count(*) from tipshift_private.dispute_votes v where v.dispute_id = d.dispute_id and v.phase = 'correction' and not v.support),
    'mine', case when p_employee_id is null then null else jsonb_build_object(
      'opener', d.opened_by = p_employee_id,
      'disputeVote', (select v.support from tipshift_private.dispute_votes v where v.dispute_id = d.dispute_id and v.employee_id = p_employee_id and v.phase = 'dispute'),
      'correctionVote', (select v.support from tipshift_private.dispute_votes v where v.dispute_id = d.dispute_id and v.employee_id = p_employee_id and v.phase = 'correction')) end
  ) order by d.created_at desc), '[]'::jsonb)
  from tipshift_private.turn_disputes d where d.turn_ref = p_turn_ref
$$;
revoke all on function public.tipshift_dispute_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_dispute_summary(uuid, uuid) to service_role;

-- Employee: open a dispute (the opener's own vote counts as agreement).
create function public.tipshift_employee_dispute_open(p_commitments bytea[], p_turn_ref uuid, p_note text)
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
  if emp is null then return null; end if;
  insert into tipshift_private.turn_disputes (turn_ref, opened_by, note) values (p_turn_ref, emp, nullif(btrim(p_note), '')) returning dispute_id into new_id;
  insert into tipshift_private.dispute_votes (dispute_id, employee_id, phase, support) values (new_id, emp, 'dispute', true);
  perform public.tipshift_dispute_evaluate(new_id);
  return new_id;
exception when unique_violation or check_violation then return null;
end;
$$;
revoke all on function public.tipshift_employee_dispute_open(bytea[], uuid, text) from public, anon, authenticated;
grant execute on function public.tipshift_employee_dispute_open(bytea[], uuid, text) to service_role;

-- Employee: vote once per phase. Only people present in that shift can vote.
create function public.tipshift_employee_dispute_vote(p_commitments bytea[], p_dispute_id uuid, p_phase text, p_support boolean)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare d tipshift_private.turn_disputes%rowtype; emp uuid; expected text;
begin
  select * into d from tipshift_private.turn_disputes x where x.dispute_id = p_dispute_id;
  if not found or p_phase not in ('dispute', 'correction') then return false; end if;
  expected := case when p_phase = 'dispute' then 'voting' else 'correction_voting' end;
  if d.state <> expected then return false; end if;
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
revoke all on function public.tipshift_employee_dispute_vote(bytea[], uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tipshift_employee_dispute_vote(bytea[], uuid, text, boolean) to service_role;

-- Employee: the person who opened it can withdraw before a correction is proposed.
create function public.tipshift_employee_dispute_withdraw(p_commitments bytea[], p_dispute_id uuid)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  update tipshift_private.turn_disputes d set state = 'withdrawn', resolved_at = timezone('utc', now())
  where d.dispute_id = p_dispute_id and d.state in ('voting', 'accepted')
    and d.opened_by in (select e.employee_id from tipshift_private.employees e where e.wallet_commitment = any(p_commitments) and e.active);
  return found;
end;
$$;
revoke all on function public.tipshift_employee_dispute_withdraw(bytea[], uuid) from public, anon, authenticated;
grant execute on function public.tipshift_employee_dispute_withdraw(bytea[], uuid) to service_role;

-- Manager / owner: once an objection is accepted, propose the corrected split (one entry per group, adding up to 100%).
create function public.tipshift_admin_dispute_propose(p_admin_user_id uuid, p_dispute_id uuid, p_shares jsonb, p_note text)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare d tipshift_private.turn_disputes%rowtype; turn_row tipshift_private.turns%rowtype; total integer; entries integer; groups integer;
begin
  select * into d from tipshift_private.turn_disputes x where x.dispute_id = p_dispute_id;
  if not found or d.state <> 'accepted' then return false; end if;
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
revoke all on function public.tipshift_admin_dispute_propose(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.tipshift_admin_dispute_propose(uuid, uuid, jsonb, text) to service_role;

-- Reports now carry the dispute (same signatures as the 080000 functions; grants are kept).
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
      'distributionTx', s.distribution_tx, 'disputes', public.tipshift_dispute_summary(t.turn_ref, null),
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
      'distributionTx', s.distribution_tx, 'disputes', public.tipshift_dispute_summary(t.turn_ref, e.employee_id), 'myGroupRef', me.group_ref, 'myEmployeeId', e.employee_id, 'myInitials', e.initials,
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

