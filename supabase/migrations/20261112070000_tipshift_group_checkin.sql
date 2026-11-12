-- Group check-in: one QR per group and shift. A registered employee scans it and signs with
-- their wallet to say "I am present". The roster is whoever signed. The manager sets a capacity
-- per group, sees initials only, and may reserve a place for a late employee who gave notice
-- (that employee signs on arrival). Group shares stay branch-level templates.
-- Additive: the slot-based turn creation (tipshift_admin_create_turn) is left untouched.

-- One QR (capability) per group and shift. Only its SHA-256 hash is stored.
create table tipshift_private.turn_group_links (
  capability_hash bytea primary key check (octet_length(capability_hash) = 32),
  turn_ref uuid not null,
  group_ref uuid not null,
  capacity smallint not null check (capacity between 1 and 100),
  created_at timestamptz not null default timezone('utc', now()),
  unique (turn_ref, group_ref),
  foreign key (turn_ref, group_ref) references tipshift_private.turn_groups(turn_ref, group_ref) on delete cascade
);
alter table tipshift_private.turn_group_links enable row level security;
revoke all on tipshift_private.turn_group_links from public, anon, authenticated;
grant select, insert on tipshift_private.turn_group_links to service_role;

-- A row is a place in a group. signed_at is null while the place is only reserved by the manager.
create table tipshift_private.turn_checkins (
  turn_ref uuid not null,
  group_ref uuid not null,
  employee_id uuid not null references tipshift_private.employees(employee_id) on delete cascade,
  reserved_by_manager boolean not null default false,
  signed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (turn_ref, employee_id),
  foreign key (turn_ref, group_ref) references tipshift_private.turn_groups(turn_ref, group_ref) on delete cascade,
  check (reserved_by_manager or signed_at is not null)
);
alter table tipshift_private.turn_checkins enable row level security;
revoke all on tipshift_private.turn_checkins from public, anon, authenticated;
grant select, insert, update on tipshift_private.turn_checkins to service_role;

-- One-time NEP-413 challenges for check-in (replay protection).
create table tipshift_private.checkin_challenges (
  nonce bytea primary key check (octet_length(nonce) = 32),
  capability_hash bytea not null,
  expires_at timestamptz not null
);
alter table tipshift_private.checkin_challenges enable row level security;
revoke all on tipshift_private.checkin_challenges from public, anon, authenticated;
grant select, insert, delete on tipshift_private.checkin_challenges to service_role;

-- Manager: create a shift with one check-in QR per group. The turn is opened ('claiming') right away.
-- p_groups: [{groupRef, shareBps}], p_links: [{capabilityHash (64 hex), groupRef, capacity}].
create function public.tipshift_admin_create_group_turn(
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
  insert into tipshift_private.turn_groups (turn_ref, group_ref, share_bps)
  select new_turn_ref, (entry->>'groupRef')::uuid, (entry->>'shareBps')::integer from jsonb_array_elements(p_groups) entry;
  insert into tipshift_private.turn_group_links (capability_hash, turn_ref, group_ref, capacity)
  select decode(entry->>'capabilityHash', 'hex'), new_turn_ref, (entry->>'groupRef')::uuid, (entry->>'capacity')::smallint from jsonb_array_elements(p_links) entry;
  -- A trigger requires turns to be created as draft; open it for check-in right away.
  update tipshift_private.turns t set state = 'claiming' where t.turn_ref = new_turn_ref;
  return new_turn_ref;
exception when invalid_text_representation or unique_violation or check_violation or foreign_key_violation then return null;
end;
$$;
revoke all on function public.tipshift_admin_create_group_turn(uuid, uuid, uuid, timestamptz, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tipshift_admin_create_group_turn(uuid, uuid, uuid, timestamptz, timestamptz, jsonb, jsonb) to service_role;

-- Employee, step 1: resolve the QR and issue a challenge. Nothing is returned once the shift
-- is over or the turn is no longer open for check-in.
create function public.tipshift_checkin_start(p_capability_hash bytea, p_nonce bytea)
returns table(turn_ref uuid, group_ref uuid, branch_ref uuid, branch_label text, capacity smallint, taken bigint, scheduled_starts_at timestamptz, scheduled_ends_at timestamptz)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  if not exists (
    select 1 from tipshift_private.turn_group_links l join tipshift_private.turns t on t.turn_ref = l.turn_ref
    where l.capability_hash = p_capability_hash and t.state = 'claiming' and t.scheduled_ends_at > timezone('utc', now())
  ) then return; end if;
  delete from tipshift_private.checkin_challenges c where c.expires_at < timezone('utc', now());
  insert into tipshift_private.checkin_challenges (nonce, capability_hash, expires_at)
  values (p_nonce, p_capability_hash, timezone('utc', now()) + interval '10 minutes');
  return query
    select t.turn_ref, l.group_ref, t.branch_ref, b.branch_label, l.capacity,
      (select count(*) from tipshift_private.turn_checkins c where c.turn_ref = l.turn_ref and c.group_ref = l.group_ref),
      t.scheduled_starts_at, t.scheduled_ends_at
    from tipshift_private.turn_group_links l
    join tipshift_private.turns t on t.turn_ref = l.turn_ref
    join tipshift_private.branches b on b.branch_ref = t.branch_ref
    where l.capability_hash = p_capability_hash;
end;
$$;
revoke all on function public.tipshift_checkin_start(bytea, bytea) from public, anon, authenticated;
grant execute on function public.tipshift_checkin_start(bytea, bytea) to service_role;

-- Employee, step 2: consume the challenge and record presence. status is one of
-- 'ok', 'not_registered' (wallet is not registered in this branch), 'full' (group at capacity)
-- or 'other_group' (the employee already has a place in a different group of this shift).
-- An empty result means the QR or challenge is not valid.
create function public.tipshift_checkin_complete(p_capability_hash bytea, p_nonce bytea, p_wallet_commitment bytea)
returns table(status text, initials text)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  link tipshift_private.turn_group_links%rowtype;
  turn_row tipshift_private.turns%rowtype;
  employee tipshift_private.employees%rowtype;
  already tipshift_private.turn_checkins%rowtype;
  taken bigint;
begin
  select * into link from tipshift_private.turn_group_links l where l.capability_hash = p_capability_hash;
  if not found then return; end if;
  select * into turn_row from tipshift_private.turns t where t.turn_ref = link.turn_ref;
  if turn_row.state <> 'claiming' or turn_row.scheduled_ends_at <= timezone('utc', now()) or octet_length(p_wallet_commitment) <> 32 then return; end if;
  delete from tipshift_private.checkin_challenges c
  where c.nonce = p_nonce and c.capability_hash = p_capability_hash and c.expires_at > timezone('utc', now());
  if not found then return; end if;
  select * into employee from tipshift_private.employees e
  where e.branch_ref = turn_row.branch_ref and e.wallet_commitment = p_wallet_commitment and e.active;
  if not found then return query select 'not_registered'::text, null::text; return; end if;
  select * into already from tipshift_private.turn_checkins c where c.turn_ref = link.turn_ref and c.employee_id = employee.employee_id;
  if found then
    -- The employee already has a place in this shift: confirm presence (reserved places become signed).
    if already.group_ref <> link.group_ref then return query select 'other_group'::text, employee.initials; return; end if;
    update tipshift_private.turn_checkins c set signed_at = coalesce(c.signed_at, timezone('utc', now()))
    where c.turn_ref = link.turn_ref and c.employee_id = employee.employee_id;
    return query select 'ok'::text, employee.initials; return;
  end if;
  select count(*) into taken from tipshift_private.turn_checkins c where c.turn_ref = link.turn_ref and c.group_ref = link.group_ref;
  if taken >= link.capacity then return query select 'full'::text, employee.initials; return; end if;
  insert into tipshift_private.turn_checkins (turn_ref, group_ref, employee_id, signed_at)
  values (link.turn_ref, link.group_ref, employee.employee_id, timezone('utc', now()));
  return query select 'ok'::text, employee.initials;
end;
$$;
revoke all on function public.tipshift_checkin_complete(bytea, bytea, bytea) from public, anon, authenticated;
grant execute on function public.tipshift_checkin_complete(bytea, bytea, bytea) to service_role;

-- Manager: per group, capacity and the people in it (initials only, never wallets).
create function public.tipshift_admin_group_checkins(p_admin_user_id uuid, p_turn_ref uuid)
returns table(group_ref uuid, capacity smallint, employee_id uuid, initials text, signed boolean, signed_at timestamptz)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  if not exists (
    select 1 from tipshift_private.turns t where t.turn_ref = p_turn_ref and public.tipshift_admin_authorized(p_admin_user_id, t.venue_ref, t.branch_ref)
  ) then return; end if;
  return query
    select l.group_ref, l.capacity, e.employee_id, e.initials, (c.signed_at is not null), c.signed_at
    from tipshift_private.turn_group_links l
    left join tipshift_private.turn_checkins c on c.turn_ref = l.turn_ref and c.group_ref = l.group_ref
    left join tipshift_private.employees e on e.employee_id = c.employee_id
    where l.turn_ref = p_turn_ref
    order by l.group_ref, c.created_at;
end;
$$;
revoke all on function public.tipshift_admin_group_checkins(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_group_checkins(uuid, uuid) to service_role;

-- Manager: reserve a place for a registered employee who warned they will be late (or to
-- rotate people between groups). The employee confirms by signing on arrival.
create function public.tipshift_admin_reserve_place(p_admin_user_id uuid, p_turn_ref uuid, p_group_ref uuid, p_employee_id uuid)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  turn_row tipshift_private.turns%rowtype;
  link tipshift_private.turn_group_links%rowtype;
  taken bigint;
begin
  select * into turn_row from tipshift_private.turns t where t.turn_ref = p_turn_ref and t.state = 'claiming' and t.scheduled_ends_at > timezone('utc', now());
  if not found or not public.tipshift_admin_authorized(p_admin_user_id, turn_row.venue_ref, turn_row.branch_ref) then return false; end if;
  select * into link from tipshift_private.turn_group_links l where l.turn_ref = p_turn_ref and l.group_ref = p_group_ref;
  if not found or not exists (select 1 from tipshift_private.employees e where e.employee_id = p_employee_id and e.branch_ref = turn_row.branch_ref and e.active) then return false; end if;
  -- Moving an unsigned place between groups is allowed; a signed place is never moved.
  delete from tipshift_private.turn_checkins c where c.turn_ref = p_turn_ref and c.employee_id = p_employee_id and c.signed_at is null;
  if exists (select 1 from tipshift_private.turn_checkins c where c.turn_ref = p_turn_ref and c.employee_id = p_employee_id) then return false; end if;
  select count(*) into taken from tipshift_private.turn_checkins c where c.turn_ref = p_turn_ref and c.group_ref = p_group_ref;
  if taken >= link.capacity then return false; end if;
  insert into tipshift_private.turn_checkins (turn_ref, group_ref, employee_id, reserved_by_manager) values (p_turn_ref, p_group_ref, p_employee_id, true);
  return true;
end;
$$;
revoke all on function public.tipshift_admin_reserve_place(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_reserve_place(uuid, uuid, uuid, uuid) to service_role;
