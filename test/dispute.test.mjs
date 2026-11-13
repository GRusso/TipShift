import assert from 'node:assert/strict'
import test from 'node:test'
import { disputeRows, effectiveShares, isOpen } from '../apps/web/src/ui/dispute.ts'

const groups = [{ groupRef: 'g1', shareBps: 6000 }, { groupRef: 'g2', shareBps: 4000 }]
const dispute = (state, extra = {}) => ({ disputeId: 'd', state, note: null, createdAt: '2026-11-13T12:00:00Z', acceptedAt: null, proposedAt: null, resolvedAt: null, proposedShares: null, proposalNote: null, eligible: 3, disputeYes: 2, disputeNo: 0, correctionYes: 0, correctionNo: 0, mine: null, ...extra })

test('the original split applies until a correction is approved', () => {
  assert.deepEqual(effectiveShares(groups, undefined), groups)
  assert.deepEqual(effectiveShares(groups, []), groups)
  const proposal = [{ groupRef: 'g1', shareBps: 5000 }, { groupRef: 'g2', shareBps: 5000 }]
  for (const state of ['voting', 'accepted', 'correction_voting', 'correction_rejected', 'rejected', 'withdrawn']) {
    assert.deepEqual(effectiveShares(groups, [dispute(state, { proposedShares: proposal })]), groups, state)
  }
})

test('an approved correction replaces the shares', () => {
  const proposal = [{ groupRef: 'g1', shareBps: 5000 }, { groupRef: 'g2', shareBps: 5000 }]
  assert.deepEqual(effectiveShares(groups, [dispute('corrected', { proposedShares: proposal })]).map((g) => g.shareBps), [5000, 5000])
})

test('the newest approved correction wins (reports list newest first)', () => {
  const newer = [{ groupRef: 'g1', shareBps: 7000 }, { groupRef: 'g2', shareBps: 3000 }]
  const older = [{ groupRef: 'g1', shareBps: 5000 }, { groupRef: 'g2', shareBps: 5000 }]
  const list = [dispute('corrected', { proposedShares: newer }), dispute('corrected', { proposedShares: older })]
  assert.deepEqual(effectiveShares(groups, list).map((g) => g.shareBps), [7000, 3000])
})

test('only voting, accepted and correction voting need action', () => {
  assert.deepEqual(['voting', 'accepted', 'correction_voting', 'rejected', 'withdrawn', 'corrected', 'correction_rejected'].map((s) => isOpen(dispute(s))), [true, true, true, false, false, false, false])
})

test('csv rows keep the full dispute history and are empty without disputes', () => {
  assert.deepEqual(disputeRows([], () => ''), [])
  const rows = disputeRows([dispute('corrected', { note: 'LP worked less', proposalNote: 'covered more', proposedShares: [{ groupRef: 'g1', shareBps: 5000 }, { groupRef: 'g2', shareBps: 5000 }], correctionYes: 2, correctionNo: 1 })], (ref) => ({ g1: 'Floor', g2: 'Kitchen' })[ref])
  assert.equal(rows[0].length, 0)
  assert.equal(rows[1][0], 'dispute_state')
  assert.deepEqual(rows[2], ['corrected', '2026-11-13T12:00:00Z', 'LP worked less', 2, 0, 3, 'covered more', 'Floor 50.00% | Kitchen 50.00%', 2, 1])
})
