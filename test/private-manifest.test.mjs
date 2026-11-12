import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import { attachPrivateManifest, buildPrivateTurnManifest, openPrivateManifest, sealPrivateManifest } from '../apps/web/src/private-manifest.ts'

if (!globalThis.crypto) globalThis.crypto = webcrypto

const groups = [
  { groupRef: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', shareBps: 6_000 },
  { groupRef: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', shareBps: 4_000 },
]
const recipients = [
  { groupRef: groups[0].groupRef, recipientSlot: 1, shareWeight: 5_000 },
  { groupRef: groups[0].groupRef, recipientSlot: 2, shareWeight: 5_000 },
  { groupRef: groups[1].groupRef, recipientSlot: 3, shareWeight: 10_000 },
]

test('puts one encrypted, wallet-free manifest in every private recipient link', async () => {
  const manifest = buildPrivateTurnManifest({ startsAt: '2026-11-12T12:00:00.000Z', endsAt: '2026-11-12T20:00:00.000Z', groups, recipients, groupLabels: { [groups[0].groupRef]: 'GuestService', [groups[1].groupRef]: 'FoodPreparation' }, recipientLabels: { 1: 'EJ', 2: 'SAR', 3: 'MAX' } })
  const envelope = await sealPrivateManifest(manifest)
  const first = attachPrivateManifest('https://tipshift.example/#claim=first-token', envelope)
  const second = attachPrivateManifest('https://tipshift.example/#claim=second-token', envelope)
  assert.match(first, /#claim=first-token&pm=/)
  assert.match(second, /#claim=second-token&pm=/)
  assert.doesNotMatch(first, /GuestService|FoodPreparation/)
  assert.deepEqual(await openPrivateManifest(new URL(first).hash), manifest)
  assert.equal(new URL(first).hash.match(/pm=([^&]+)/)?.[1], new URL(second).hash.match(/pm=([^&]+)/)?.[1])
})

test('rejects a tampered private manifest without affecting the claim capability', async () => {
  const manifest = buildPrivateTurnManifest({ startsAt: '2026-11-12T12:00:00.000Z', endsAt: '2026-11-12T20:00:00.000Z', groups, recipients, groupLabels: {}, recipientLabels: {} })
  const link = attachPrivateManifest('https://tipshift.example/#claim=opaque-capability', await sealPrivateManifest(manifest))
  const hash = new URL(link).hash.replace(/pm=./, 'pm=X')
  assert.equal(await openPrivateManifest(hash), null)
  assert.match(hash, /claim=opaque-capability/)
})

test('accepts accented and uppercase-folded aliases', async () => {
  const manifest = buildPrivateTurnManifest({ startsAt: '2026-11-12T12:00:00.000Z', endsAt: '2026-11-12T20:00:00.000Z', groups: [groups[0], { ...groups[1], shareBps: 4_000 }], recipients, groupLabels: {}, recipientLabels: { 1: 'ñu', 2: 'Ál1', 3: 'ab' } })
  assert.deepEqual(manifest.recipients.map((recipient) => recipient.alias), ['ÑU', 'ÁL1', 'AB'])
  assert.deepEqual(await openPrivateManifest(new URL(attachPrivateManifest('https://tipshift.example/#claim=t', await sealPrivateManifest(manifest))).hash), manifest)
})

test('names the rule that was broken instead of a generic error', () => {
  const base = { startsAt: '2026-11-12T12:00:00.000Z', endsAt: '2026-11-12T20:00:00.000Z', groups, recipients, groupLabels: {}, recipientLabels: {} }
  assert.throws(() => buildPrivateTurnManifest({ ...base, recipientLabels: { 1: 'A B' } }), /alias must be at most 3 letters or numbers/)
  assert.throws(() => buildPrivateTurnManifest({ ...base, recipientLabels: { 1: 'A.' } }), /alias must be at most 3 letters or numbers/)
  assert.throws(() => buildPrivateTurnManifest({ ...base, endsAt: '2026-11-13T13:00:00.000Z' }), /more than 24 hours/)
  assert.throws(() => buildPrivateTurnManifest({ ...base, endsAt: '2026-11-12T11:00:00.000Z' }), /end after it starts/)
  assert.throws(() => buildPrivateTurnManifest({ ...base, groups: [groups[0]] }), /add up to exactly 100%/)
  assert.throws(() => buildPrivateTurnManifest({ ...base, recipients: [recipients[0], recipients[2]] }), /exactly 100% in total/)
  assert.throws(() => buildPrivateTurnManifest({ ...base, recipients: [{ ...recipients[0], groupRef: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, ...recipients.slice(1)] }), /group that no longer exists/)
})
