-- Manager: the people who signed in to a shift, with their sealed wallet. The Edge Function decrypts the
-- wallets server-side and hands the manager only what the on-chain roster needs. Only signed check-ins count.
create function public.tipshift_admin_turn_roster(p_admin_user_id uuid, p_turn_ref uuid)
returns table(group_ref uuid, share_bps integer, employee_id uuid, branch_ref uuid, wallet_ciphertext bytea)
language plpgsql
set search_path = pg_catalog, tipshift_private
as $$
begin
  if not exists (
    select 1 from tipshift_private.turns t where t.turn_ref = p_turn_ref and public.tipshift_admin_authorized(p_admin_user_id, t.venue_ref, t.branch_ref)
  ) then return; end if;
  return query
    select c.group_ref, g.share_bps::integer, c.employee_id, e.branch_ref, e.wallet_ciphertext
    from tipshift_private.turn_checkins c
    join tipshift_private.turn_groups g on g.turn_ref = c.turn_ref and g.group_ref = c.group_ref
    join tipshift_private.employees e on e.employee_id = c.employee_id
    where c.turn_ref = p_turn_ref and c.signed_at is not null
    order by c.group_ref, c.employee_id;
end;
$$;
revoke all on function public.tipshift_admin_turn_roster(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tipshift_admin_turn_roster(uuid, uuid) to service_role;
