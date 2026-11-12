-- Weekly schedule of a branch (Monday..Sunday). Wall-clock times of the branch; an
-- end time earlier than the start time means the block crosses midnight (max 24 h).
create table tipshift_private.branch_schedule_blocks (
  block_id uuid primary key default gen_random_uuid(),
  branch_ref uuid not null references tipshift_private.branches(branch_ref) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  starts_at time not null,
  ends_at time not null,
  block_label text check (block_label is null or (char_length(block_label) between 1 and 40 and block_label !~ '[[:cntrl:]]')),
  created_at timestamptz not null default timezone('utc', now()),
  check (starts_at <> ends_at),
  unique (branch_ref, weekday, starts_at)
);
alter table tipshift_private.branch_schedule_blocks enable row level security;
revoke all on tipshift_private.branch_schedule_blocks from public, anon, authenticated;
grant select, insert, update, delete on tipshift_private.branch_schedule_blocks to service_role;

-- The owner may manage every branch of the organization; a manager only their own.
create function tipshift_private.can_manage_branch(p_user uuid, p_branch uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, tipshift_private
as $$
  select exists (
    select 1
    from tipshift_private.admin_authorizations a
    join tipshift_private.branches b on b.branch_ref = p_branch and b.venue_ref = a.venue_ref and b.active
    where a.admin_user_id = p_user
      and (a.role = 'organization_admin' or a.branch_ref = p_branch)
  );
$$;
revoke all on function tipshift_private.can_manage_branch(uuid, uuid) from public, anon, authenticated;
grant execute on function tipshift_private.can_manage_branch(uuid, uuid) to service_role;

create function public.tipshift_admin_branch_schedule(p_admin_user_id uuid, p_branch_ref uuid)
returns table(block_id uuid, weekday smallint, starts_at text, ends_at text, block_label text)
language sql
stable
set search_path = pg_catalog, tipshift_private
as $$
  select s.block_id, s.weekday, to_char(s.starts_at, 'HH24:MI'), to_char(s.ends_at, 'HH24:MI'), s.block_label
  from tipshift_private.branch_schedule_blocks s
  where s.branch_ref = p_branch_ref
    and tipshift_private.can_manage_branch(p_admin_user_id, p_branch_ref)
  order by s.weekday, s.starts_at;
$$;
revoke all on function public.tipshift_admin_branch_schedule(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_branch_schedule(uuid, uuid) to service_role;

-- Atomically replaces the whole weekly schedule. Returns the number of blocks saved,
-- or -1 when the caller may not manage the branch or any block is invalid.
create function public.tipshift_admin_set_branch_schedule(p_admin_user_id uuid, p_branch_ref uuid, p_blocks jsonb)
returns integer
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare
  item jsonb;
  total integer;
begin
  if not tipshift_private.can_manage_branch(p_admin_user_id, p_branch_ref) then return -1; end if;
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then return -1; end if;
  total := jsonb_array_length(p_blocks);
  if total > 70 then return -1; end if;
  for item in select * from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(item) <> 'object'
       or (item->>'weekday') !~ '^[1-7]$'
       or (item->>'startsAt') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (item->>'endsAt') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (item->>'startsAt') = (item->>'endsAt')
       or char_length(coalesce(item->>'label', '')) > 40
       or coalesce(item->>'label', '') ~ '[[:cntrl:]]' then
      return -1;
    end if;
  end loop;
  delete from tipshift_private.branch_schedule_blocks where branch_ref = p_branch_ref;
  insert into tipshift_private.branch_schedule_blocks (branch_ref, weekday, starts_at, ends_at, block_label)
  select p_branch_ref, (e->>'weekday')::smallint, (e->>'startsAt')::time, (e->>'endsAt')::time, nullif(btrim(coalesce(e->>'label', '')), '')
  from jsonb_array_elements(p_blocks) e;
  return total;
exception when unique_violation then
  return -1;
end;
$$;
revoke all on function public.tipshift_admin_set_branch_schedule(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tipshift_admin_set_branch_schedule(uuid, uuid, jsonb) to service_role;
