import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAdminGroupTurnRequest } from '../supabase/functions/tipshift-claims/admin-group-turn-request.mjs'

const now = new Date('2026-11-12T12:00:00Z')
const ids = {
  venue: '11111111-1111-4111-8111-111111111111',
  branch: '22222222-2222-4222-8222-222222222222',
  a: '33333333-3333-4333-8333-333333333333',
  b: '44444444-4444-4444-8444-444444444444',
}
const request = (overrides = {}) => ({
  venueRef: ids.venue,
  branchRef: ids.branch,
  scheduledStartsAt: '2026-11-12T11:00:00Z',
  scheduledEndsAt: '2026-11-12T20:00:00Z',
  groups: [{ groupRef: ids.a, shareBps: 6000, capacity: 3 }, { groupRef: ids.b, shareBps: 4000, capacity: 2 }],
  ...overrides,
})
let counter = 0
const randomValues = (bytes) => { counter += 1; bytes.fill(counter); return bytes }
const options = { appUrl: 'https://clarialabs.com/tipshift', now, randomValues }

test('builds one check-in link per group and sends only hashes to the database', async () => {
  counter = 0
  const built = await buildAdminGroupTurnRequest(request(), options)
  assert.equal(built.checkinLinks.length, 2)
  assert.equal(built.rpcArgs.p_links.length, 2)
  for (const [index, link] of built.checkinLinks.entries()) {
    const token = new URL(link.url).hash.replace('#checkin=', '')
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    assert.match(built.rpcArgs.p_links[index].capabilityHash, /^[0-9a-f]{64}$/)
    assert.ok(!JSON.stringify(built.rpcArgs).includes(token), 'plaintext token must not reach the RPC payload')
    assert.equal(built.rpcArgs.p_links[index].groupRef, link.groupRef)
  }
  assert.notEqual(built.rpcArgs.p_links[0].capabilityHash, built.rpcArgs.p_links[1].capabilityHash)
  assert.deepEqual(built.rpcArgs.p_links.map((link) => link.capacity), [3, 2])
  assert.deepEqual(built.rpcArgs.p_groups, [{ groupRef: ids.a, shareBps: 6000 }, { groupRef: ids.b, shareBps: 4000 }])
})

test('rejects group shares that do not add up to 100%', async () => {
  await assert.rejects(buildAdminGroupTurnRequest(request({ groups: [{ groupRef: ids.a, shareBps: 5000, capacity: 1 }] }), options), TypeError)
})

test('rejects duplicate groups, bad capacities and bad windows', async () => {
  const dup = [{ groupRef: ids.a, shareBps: 5000, capacity: 1 }, { groupRef: ids.a, shareBps: 5000, capacity: 1 }]
  await assert.rejects(buildAdminGroupTurnRequest(request({ groups: dup }), options), TypeError)
  for (const capacity of [0, -1, 101, 1.5, '2']) {
    await assert.rejects(buildAdminGroupTurnRequest(request({ groups: [{ groupRef: ids.a, shareBps: 10000, capacity }] }), options), TypeError)
  }
  await assert.rejects(buildAdminGroupTurnRequest(request({ scheduledEndsAt: '2026-11-12T10:00:00Z' }), options), TypeError)
  await assert.rejects(buildAdminGroupTurnRequest(request({ scheduledStartsAt: '2026-11-10T00:00:00Z' }), options), TypeError)
  await assert.rejects(buildAdminGroupTurnRequest(request({ scheduledEndsAt: '2026-11-13T12:00:00Z' }), options), TypeError)
})
