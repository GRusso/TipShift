import assert from 'node:assert/strict'
import test from 'node:test'
import { webcrypto } from 'node:crypto'
import { buildAdminTurnRequest } from '../supabase/functions/tipshift-claims/admin-turn-request.mjs'

if (!globalThis.crypto) globalThis.crypto = webcrypto

const venueRef = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const branchRef = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const groupRef = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const nextWeek = '2026-11-18T15:00:00.000Z'
const now = new Date('2026-11-11T15:00:00.000Z')

function request() {
  return {
    venueRef,
    branchRef,
    claimWindowEndsAt: nextWeek,
    groups: [{ groupRef, shareBps: 10_000 }],
    recipients: [{ groupRef, recipientSlot: 1, shareWeight: 1 }],
  }
}

test('creates opaque fragment links while only placing SHA-256 hashes in the RPC payload', async () => {
  const result = await buildAdminTurnRequest(request(), {
    appUrl: 'https://tipshift.example/admin',
    now,
    randomValues: (bytes) => bytes.fill(7),
  })
  assert.equal(result.claimLinks.length, 1)
  assert.match(result.claimLinks[0].url, /^https:\/\/tipshift\.example\/admin#claim=/)
  assert.equal(result.rpcArgs.p_claims[0].capabilityHash.length, 64)
  assert.doesNotMatch(JSON.stringify(result.rpcArgs), /#claim=|Bw{8}/)
  assert.equal(result.rpcArgs.p_groups[0].shareBps, 10_000)
})

test('rejects duplicate anonymous slots and invalid distributions before an RPC call', async () => {
  const duplicateSlot = request()
  duplicateSlot.recipients.push({ groupRef, recipientSlot: 1, shareWeight: 1 })
  await assert.rejects(buildAdminTurnRequest(duplicateSlot, { appUrl: 'https://tipshift.example', now }))

  const invalidDistribution = request()
  invalidDistribution.groups[0].shareBps = 9_999
  await assert.rejects(buildAdminTurnRequest(invalidDistribution, { appUrl: 'https://tipshift.example', now }))
})
