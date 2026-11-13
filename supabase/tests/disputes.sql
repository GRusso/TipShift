do $$
declare v uuid := gen_random_uuid(); b uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); g1 uuid := gen_random_uuid(); g2 uuid := gen_random_uuid();
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; c1 bytea := sha256('\x01'); c2 bytea := sha256('\x02'); c3 bytea := sha256('\x03'); c4 bytea := sha256('\x04');
  d uuid; d2 uuid; d3 uuid; st text; r jsonb;
begin
  insert into auth.users (id, email) values (adm, 'm@test.local');
  insert into tipshift_private.organizations (venue_ref, organization_name) values (v, 'Test Co');
  insert into tipshift_private.branches (branch_ref, venue_ref, branch_label) values (b, v, 'North');
  insert into tipshift_private.admin_authorizations (admin_user_id, venue_ref, branch_ref, role) values (adm, v, b, 'branch_admin');
  insert into tipshift_private.turns (turn_ref, venue_ref, branch_ref, state, claim_window_ends_at, retention_delete_after, scheduled_starts_at, scheduled_ends_at)
    values (t, v, b, 'draft', now() - interval '1 hour', now() + interval '20 days', now() - interval '3 hours', now() - interval '1 hour');
  insert into tipshift_private.turn_groups (turn_ref, group_ref, share_bps, group_label) values (t, g1, 6000, 'Floor'), (t, g2, 4000, 'Kitchen');
  update tipshift_private.turns set state = 'claiming' where turn_ref = t;
  insert into tipshift_private.employees (branch_ref, initials, wallet_commitment, wallet_ciphertext) values (b, 'AM', c1, '\x00') returning employee_id into e1;
  insert into tipshift_private.employees (branch_ref, initials, wallet_commitment, wallet_ciphertext) values (b, 'JR', c2, '\x00') returning employee_id into e2;
  insert into tipshift_private.employees (branch_ref, initials, wallet_commitment, wallet_ciphertext) values (b, 'LP', c3, '\x00') returning employee_id into e3;
  insert into tipshift_private.employees (branch_ref, initials, wallet_commitment, wallet_ciphertext) values (b, 'CD', c4, '\x00') returning employee_id into e4;
  insert into tipshift_private.turn_group_links (capability_hash, turn_ref, group_ref, capacity) values (sha256('\x11'), t, g1, 5), (sha256('\x12'), t, g2, 5);
  insert into tipshift_private.turn_checkins (turn_ref, group_ref, employee_id, signed_at) values (t, g1, e1, now()), (t, g1, e2, now()), (t, g2, e3, now());

  assert public.tipshift_employee_dispute_open(array[c4], t, 'x') is null, '1: absent employee must not open';
  d := public.tipshift_employee_dispute_open(array[c1], t, 'LP worked less');
  assert d is not null, '2: present employee opens';
  assert public.tipshift_employee_dispute_open(array[c2], t, 'again') is null, '2b: only one open dispute per shift';
  select state into st from tipshift_private.turn_disputes where dispute_id = d; assert st = 'voting', '2c: voting, got '||st;
  assert public.tipshift_employee_dispute_vote(array[c1], d, 'dispute', true) = false, '3: no double vote';
  assert public.tipshift_employee_dispute_vote(array[c4], d, 'dispute', true) = false, '4: absent cannot vote';
  assert public.tipshift_employee_dispute_vote(array[c2], d, 'correction', true) = false, '5: wrong phase';
  assert public.tipshift_employee_dispute_vote(array[c2], d, 'dispute', true) = true, '6: second yes';
  select state into st from tipshift_private.turn_disputes where dispute_id = d; assert st = 'accepted', '7: accepted, got '||st;

  assert public.tipshift_admin_dispute_propose(adm, d, ('[{"groupRef":"'||g1||'","shareBps":5000},{"groupRef":"'||g2||'","shareBps":4000}]')::jsonb, 'n') = false, '8: sum must be 100%';
  assert public.tipshift_admin_dispute_propose(other, d, ('[{"groupRef":"'||g1||'","shareBps":5000},{"groupRef":"'||g2||'","shareBps":5000}]')::jsonb, 'n') = false, '9: unauthorized admin';
  assert public.tipshift_admin_dispute_propose(adm, d, ('[{"groupRef":"'||g1||'","shareBps":5000}]')::jsonb, 'n') = false, '9b: every group required';
  assert public.tipshift_admin_dispute_propose(adm, d, ('[{"groupRef":"'||g1||'","shareBps":5000},{"groupRef":"'||g2||'","shareBps":5000}]')::jsonb, 'LP covered more') = true, '10: valid proposal';
  select state into st from tipshift_private.turn_disputes where dispute_id = d; assert st = 'correction_voting', '10b: got '||st;

  assert public.tipshift_employee_dispute_vote(array[c1], d, 'correction', true), '11a';
  assert public.tipshift_employee_dispute_vote(array[c3], d, 'correction', false), '11b';
  select state into st from tipshift_private.turn_disputes where dispute_id = d; assert st = 'correction_voting', '11c still open, got '||st;
  assert public.tipshift_employee_dispute_vote(array[c2], d, 'correction', true), '11d';
  select state into st from tipshift_private.turn_disputes where dispute_id = d; assert st = 'corrected', '12: corrected, got '||st;

  d2 := public.tipshift_employee_dispute_open(array[c3], t, 'second');
  assert d2 is not null, '13: a new dispute is possible after resolution';
  assert public.tipshift_employee_dispute_vote(array[c1], d2, 'dispute', false) and public.tipshift_employee_dispute_vote(array[c2], d2, 'dispute', false), '13b';
  select state into st from tipshift_private.turn_disputes where dispute_id = d2; assert st = 'rejected', '14: rejected, got '||st;

  d3 := public.tipshift_employee_dispute_open(array[c2], t, 'third');
  assert public.tipshift_employee_dispute_withdraw(array[c1], d3) = false, '15: only opener withdraws';
  assert public.tipshift_employee_dispute_withdraw(array[c2], d3) = true, '15b: opener withdraws';
  select state into st from tipshift_private.turn_disputes where dispute_id = d3; assert st = 'withdrawn', '15c';

  r := public.tipshift_admin_branch_reports(adm, b);
  assert jsonb_array_length(r->0->'disputes') = 3, '16: report lists all 3 disputes: '||coalesce((r->0->'disputes')::text,'null');
  assert (r->0->'disputes'->0->>'state') = 'withdrawn' and (r->0->'disputes'->1->>'state') = 'rejected' and (r->0->'disputes'->2->>'state') = 'corrected', '16b: newest first';
  assert (r->0->'disputes'->0->'mine') = 'null'::jsonb, '16c: admin sees no personal vote';
  assert (r->0->'disputes'->2->>'note') = 'LP worked less' and (r->0->'disputes'->2->>'correctionYes')::int = 2, '16d: counts and note kept';
  r := public.tipshift_employee_reports(array[c2]);
  assert (r->0->'disputes'->0->'mine'->>'opener')::boolean = true, '17: employee sees they opened the newest one';
  assert (r->0->'disputes'->2->'mine'->>'disputeVote')::boolean = true, '17b: employee sees their own vote';
  raise notice 'ALL DISPUTE CHECKS PASSED';
end $$;
