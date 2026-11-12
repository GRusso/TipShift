-- Permanent employee registry: one registration per branch (wallet = payout address).
-- The manager only ever sees initials; the wallet is sealed (AES-GCM) by the Edge Function
-- and a keyed commitment (HMAC) prevents the same wallet registering twice in a branch.

-- A branch has at most one live registration link. Only its SHA-256 hash is stored;
-- the manager keeps the link itself in the browser, exactly like the shift QR codes.
create table tipshift_private.branch_registration_links (
  branch_ref uuid primary key references tipshift_private.branches(branch_ref) on delete cascade,
  capability_hash bytea not null unique check (octet_length(capability_hash) = 32),
  created_at timestamptz not null default timezone('utc', now())
);
alter table tipshift_private.branch_registration_links enable row level security;
revoke all on tipshift_private.branch_registration_links from public, anon, authenticated;
grant select, insert, update, delete on tipshift_private.branch_registration_links to service_role;

create table tipshift_private.employees (
  employee_id uuid primary key default gen_random_uuid(),
  branch_ref uuid not null references tipshift_private.branches(branch_ref) on delete cascade,
  initials text not null check (initials ~ '^[A-Za-zÀ-ÿ]{1,4}$'),
  wallet_commitment bytea not null check (octet_length(wallet_commitment) = 32),
  wallet_ciphertext bytea not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  unique (branch_ref, wallet_commitment)
);
alter table tipshift_private.employees enable row level security;
revoke all on tipshift_private.employees from public, anon, authenticated;
grant select, insert, update on tipshift_private.employees to service_role;

-- One-time NEP-413 challenges for registration (replay protection).
create table tipshift_private.registration_challenges (
  nonce bytea primary key check (octet_length(nonce) = 32),
  branch_ref uuid not null references tipshift_private.branches(branch_ref) on delete cascade,
  expires_at timestamptz not null
);
alter table tipshift_private.registration_challenges enable row level security;
revoke all on tipshift_private.registration_challenges from public, anon, authenticated;
grant select, insert, delete on tipshift_private.registration_challenges to service_role;

-- Manager: (re)issue the branch registration link. Rotating it revokes the old one.
create function public.tipshift_admin_set_registration_link(p_admin_user_id uuid, p_venue_ref uuid, p_branch_ref uuid, p_capability_hash bytea)
returns boolean
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  if not public.tipshift_admin_authorized(p_admin_user_id, p_venue_ref, p_branch_ref)
     or p_capability_hash is null or octet_length(p_capability_hash) <> 32
     or not exists (select 1 from tipshift_private.branches b where b.branch_ref = p_branch_ref and b.venue_ref = p_venue_ref and b.active) then
    return false;
  end if;
  insert into tipshift_private.branch_registration_links as l (branch_ref, capability_hash)
  values (p_branch_ref, p_capability_hash)
  on conflict (branch_ref) do update set capability_hash = excluded.capability_hash, created_at = timezone('utc', now());
  return true;
end;
$$;
revoke all on function public.tipshift_admin_set_registration_link(uuid, uuid, uuid, bytea) from public, anon, authenticated;
grant execute on function public.tipshift_admin_set_registration_link(uuid, uuid, uuid, bytea) to service_role;

-- Employee, step 1: resolve the link to a branch label and issue a challenge nonce.
create function public.tipshift_registration_start(p_capability_hash bytea, p_nonce bytea)
returns table(branch_ref uuid, branch_label text)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  target uuid;
begin
  select l.branch_ref into target
  from tipshift_private.branch_registration_links l
  join tipshift_private.branches b on b.branch_ref = l.branch_ref and b.active
  where l.capability_hash = p_capability_hash;
  if target is null then return; end if;
  delete from tipshift_private.registration_challenges c where c.expires_at < timezone('utc', now());
  insert into tipshift_private.registration_challenges (nonce, branch_ref, expires_at)
  values (p_nonce, target, timezone('utc', now()) + interval '10 minutes');
  return query select b.branch_ref, b.branch_label from tipshift_private.branches b where b.branch_ref = target;
end;
$$;
revoke all on function public.tipshift_registration_start(bytea, bytea) from public, anon, authenticated;
grant execute on function public.tipshift_registration_start(bytea, bytea) to service_role;

-- Employee, step 2: consume the challenge and store the employee. Returns the
-- employee id and branch label, or nothing when the link/challenge is not valid.
-- A wallet already registered in the branch is simply returned again (idempotent).
create function public.tipshift_registration_complete(p_capability_hash bytea, p_nonce bytea, p_initials text, p_wallet_commitment bytea, p_wallet_ciphertext bytea)
returns table(employee_id uuid, branch_label text, initials text)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  target uuid;
  cleaned text := upper(btrim(p_initials));
begin
  select l.branch_ref into target
  from tipshift_private.branch_registration_links l
  where l.capability_hash = p_capability_hash;
  if target is null or cleaned !~ '^[A-ZÀ-Ý]{1,4}$' or octet_length(p_wallet_commitment) <> 32 then return; end if;
  delete from tipshift_private.registration_challenges c
  where c.nonce = p_nonce and c.branch_ref = target and c.expires_at > timezone('utc', now());
  if not found then return; end if;
  insert into tipshift_private.employees as e (branch_ref, initials, wallet_commitment, wallet_ciphertext)
  values (target, cleaned, p_wallet_commitment, p_wallet_ciphertext)
  on conflict (branch_ref, wallet_commitment) do update set initials = excluded.initials, active = true;
  return query
    select e.employee_id, b.branch_label, e.initials
    from tipshift_private.employees e
    join tipshift_private.branches b on b.branch_ref = e.branch_ref
    where e.branch_ref = target and e.wallet_commitment = p_wallet_commitment;
end;
$$;
revoke all on function public.tipshift_registration_complete(bytea, bytea, text, bytea, bytea) from public, anon, authenticated;
grant execute on function public.tipshift_registration_complete(bytea, bytea, text, bytea, bytea) to service_role;

-- Manager view: initials only, never the wallet.
create function public.tipshift_admin_branch_employees(p_admin_user_id uuid, p_branch_ref uuid)
returns table(employee_id uuid, initials text, created_at timestamptz)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  if not exists (
    select 1 from tipshift_private.branches b
    where b.branch_ref = p_branch_ref and public.tipshift_admin_authorized(p_admin_user_id, b.venue_ref, p_branch_ref)
  ) then
    return;
  end if;
  return query
    select e.employee_id, e.initials, e.created_at
    from tipshift_private.employees e
    where e.branch_ref = p_branch_ref and e.active
    order by e.created_at;
end;
$$;
revoke all on function public.tipshift_admin_branch_employees(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_branch_employees(uuid, uuid) to service_role;
