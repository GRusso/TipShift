begin;

alter table tipshift_private.turns
  add column scheduled_starts_at timestamptz,
  add column scheduled_ends_at timestamptz,
  add constraint turns_scheduled_window check (
    (scheduled_starts_at is null and scheduled_ends_at is null)
    or (
      scheduled_starts_at is not null
      and scheduled_ends_at is not null
      and scheduled_ends_at > scheduled_starts_at
      and scheduled_ends_at <= scheduled_starts_at + interval '24 hours'
    )
  );

create function public.tipshift_admin_create_turn(
  p_admin_user_id uuid,
  p_venue_ref uuid,
  p_branch_ref uuid,
  p_claim_window_ends_at timestamptz,
  p_scheduled_starts_at timestamptz,
  p_scheduled_ends_at timestamptz,
  p_groups jsonb,
  p_claims jsonb
)
returns uuid
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
declare new_turn_ref uuid := gen_random_uuid(); group_total integer; group_count integer; claim_count integer;
begin
  if not public.tipshift_admin_authorized(p_admin_user_id, p_venue_ref, p_branch_ref)
    or jsonb_typeof(p_groups) <> 'array' or jsonb_typeof(p_claims) <> 'array'
    or p_scheduled_starts_at <= timezone('utc', now())
    or p_scheduled_starts_at > timezone('utc', now()) + interval '31 days'
    or p_claim_window_ends_at <> p_scheduled_starts_at
    or p_scheduled_ends_at <= p_scheduled_starts_at
    or p_scheduled_ends_at > p_scheduled_starts_at + interval '24 hours' then return null; end if;
  select coalesce(sum((entry->>'shareBps')::integer), 0), count(*) into group_total, group_count from jsonb_array_elements(p_groups) entry;
  select count(*) into claim_count from jsonb_array_elements(p_claims);
  if group_count < 1 or group_count > 20 or group_total <> 10000 or claim_count < 1 or claim_count > 100 then return null; end if;
  if exists (select 1 from jsonb_array_elements(p_groups) entry where not (entry ? 'groupRef') or (entry->>'shareBps') !~ '^(?:[1-9][0-9]{0,3}|10000)$')
    or exists (select 1 from jsonb_array_elements(p_claims) entry where not (entry ?& array['capabilityHash','groupRef','recipientSlot','shareWeight','expiresAt']) or (entry->>'capabilityHash') !~ '^[0-9a-f]{64}$' or (entry->>'recipientSlot') !~ '^[1-9][0-9]{0,3}$' or (entry->>'shareWeight') !~ '^[1-9][0-9]{0,8}$' or (entry->>'expiresAt')::timestamptz <> p_scheduled_starts_at) then return null; end if;
  insert into tipshift_private.turns (turn_ref, venue_ref, branch_ref, state, claim_window_ends_at, scheduled_starts_at, scheduled_ends_at, retention_delete_after)
  values (new_turn_ref, p_venue_ref, p_branch_ref, 'draft', p_claim_window_ends_at, p_scheduled_starts_at, p_scheduled_ends_at, timezone('utc', now()) + interval '31 days');
  insert into tipshift_private.turn_groups (turn_ref, group_ref, share_bps) select new_turn_ref, (entry->>'groupRef')::uuid, (entry->>'shareBps')::integer from jsonb_array_elements(p_groups) entry;
  insert into tipshift_private.claim_capabilities (capability_hash, turn_ref, group_ref, recipient_slot, share_weight, expires_at, retention_delete_after)
  select decode(entry->>'capabilityHash', 'hex'), new_turn_ref, (entry->>'groupRef')::uuid, (entry->>'recipientSlot')::smallint, (entry->>'shareWeight')::integer, (entry->>'expiresAt')::timestamptz, (entry->>'expiresAt')::timestamptz + interval '24 hours' from jsonb_array_elements(p_claims) entry;
  return new_turn_ref;
exception when invalid_text_representation or unique_violation or check_violation or foreign_key_violation then return null;
end;
$$;

create or replace function public.tipshift_admin_open_claims(p_admin_user_id uuid, p_turn_ref uuid)
returns boolean language plpgsql set search_path = pg_catalog, tipshift_private as $$
declare changed integer;
begin
  update tipshift_private.turns t set state = 'claiming'
  where t.turn_ref = p_turn_ref and t.state = 'draft'
    and (t.scheduled_starts_at is null or t.scheduled_starts_at > timezone('utc', now()))
    and public.tipshift_admin_authorized(p_admin_user_id, t.venue_ref, t.branch_ref);
  get diagnostics changed = row_count; return changed = 1;
end;
$$;

create or replace function public.tipshift_admin_start_turn(p_admin_user_id uuid, p_turn_ref uuid)
returns boolean language plpgsql set search_path = pg_catalog, tipshift_private as $$
declare changed integer;
begin
  update tipshift_private.turns t set state = 'collecting', started_at = timezone('utc', now())
  where t.turn_ref = p_turn_ref and t.state = 'claiming'
    and (t.scheduled_starts_at is null or (timezone('utc', now()) >= t.scheduled_starts_at and timezone('utc', now()) < t.scheduled_ends_at))
    and public.tipshift_admin_authorized(p_admin_user_id, t.venue_ref, t.branch_ref)
    and (select count(*) from tipshift_private.claim_capabilities c where c.turn_ref = t.turn_ref) > 0
    and (select count(*) from tipshift_private.claim_capabilities c where c.turn_ref = t.turn_ref and c.state = 'claimed') = (select count(*) from tipshift_private.claim_capabilities c where c.turn_ref = t.turn_ref);
  get diagnostics changed = row_count; return changed = 1;
end;
$$;

create or replace function public.tipshift_admin_turn_status(p_admin_user_id uuid, p_turn_ref uuid)
returns jsonb language sql set search_path = pg_catalog, tipshift_private as $$
  select jsonb_build_object('turnRef', t.turn_ref, 'state', t.state, 'recipientCount', count(c.capability_hash), 'verifiedCount', count(*) filter (where c.state = 'claimed'), 'scheduledStartsAt', t.scheduled_starts_at, 'scheduledEndsAt', t.scheduled_ends_at)
  from tipshift_private.turns t left join tipshift_private.claim_capabilities c on c.turn_ref = t.turn_ref
  where t.turn_ref = p_turn_ref and public.tipshift_admin_authorized(p_admin_user_id, t.venue_ref, t.branch_ref)
  group by t.turn_ref, t.state, t.scheduled_starts_at, t.scheduled_ends_at;
$$;

revoke all on function public.tipshift_admin_create_turn(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tipshift_admin_create_turn(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, jsonb, jsonb) to service_role;

commit;
