create function public.tipshift_admin_open_claims(p_admin_user_id uuid, p_turn_ref uuid)
returns boolean language plpgsql set search_path = pg_catalog, tipshift_private as $$
declare changed integer;
begin
  update tipshift_private.turns t set state = 'claiming'
  where t.turn_ref = p_turn_ref and t.state = 'draft'
    and public.tipshift_admin_authorized(p_admin_user_id, t.venue_ref, t.branch_ref);
  get diagnostics changed = row_count;
  return changed = 1;
end; $$;

create function public.tipshift_admin_start_turn(p_admin_user_id uuid, p_turn_ref uuid)
returns boolean language plpgsql set search_path = pg_catalog, tipshift_private as $$
declare changed integer;
begin
  update tipshift_private.turns t set state = 'collecting', started_at = timezone('utc', now())
  where t.turn_ref = p_turn_ref and t.state = 'claiming'
    and public.tipshift_admin_authorized(p_admin_user_id, t.venue_ref, t.branch_ref);
  get diagnostics changed = row_count;
  return changed = 1;
end; $$;

create function public.tipshift_admin_turn_status(p_admin_user_id uuid, p_turn_ref uuid)
returns jsonb language sql set search_path = pg_catalog, tipshift_private as $$
  select jsonb_build_object('turnRef', t.turn_ref, 'state', t.state, 'recipientCount', count(c.capability_hash), 'verifiedCount', count(*) filter (where c.state = 'claimed'))
  from tipshift_private.turns t
  left join tipshift_private.claim_capabilities c on c.turn_ref = t.turn_ref
  where t.turn_ref = p_turn_ref and public.tipshift_admin_authorized(p_admin_user_id, t.venue_ref, t.branch_ref)
  group by t.turn_ref, t.state;
$$;

revoke all on function public.tipshift_admin_open_claims(uuid,uuid), public.tipshift_admin_start_turn(uuid,uuid), public.tipshift_admin_turn_status(uuid,uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_open_claims(uuid,uuid), public.tipshift_admin_start_turn(uuid,uuid), public.tipshift_admin_turn_status(uuid,uuid) to service_role;
