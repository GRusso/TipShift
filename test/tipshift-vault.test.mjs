import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CORRECTION_WINDOW_MS,
  ShiftState,
  TipShiftError,
  TipShiftVault,
  allocateExactly,
} from '../src/core/tipshift-vault.mjs'

const roster = [
  { workerRef: 'worker-a', nearWallet: 'a.public.near', shareBps: 5_000 },
  { workerRef: 'worker-b', nearWallet: 'b.public.near', shareBps: 3_000 },
  { workerRef: 'worker-c', nearWallet: 'c.public.near', shareBps: 2_000 },
]

function fixture() {
  let now = 1_000
  const vault = new TipShiftVault({ now: () => now })
  vault.createPool({
    poolId: 'turn-2026-11-04-dinner',
    organizationRef: 'org-demo',
    locationRef: 'location-demo',
    adminRef: 'admin-location-demo',
    roster,
  })
  return { vault, advance: (milliseconds) => (now += milliseconds) }
}

function startedPool() {
  const context = fixture()
  context.vault.startShift({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' })
  return context
}

test('a verified roster starts as an immutable pool rule', () => {
  const { vault } = fixture()
  vault.startShift({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' })
  const admin = vault.getAdminView({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' })
  assert.deepEqual(admin.roster, roster)
})

test('a payment reference is idempotent and funds never mix after collection closes', () => {
  const { vault } = startedPool()
  vault.fundTip({ poolId: 'turn-2026-11-04-dinner', paymentRef: 'intent-1', amount: 5_000_000n })
  assert.throws(
    () => vault.fundTip({ poolId: 'turn-2026-11-04-dinner', paymentRef: 'intent-1', amount: 5_000_000n }),
    (error) => error.code === 'DUPLICATE_PAYMENT',
  )
  vault.closeCollection({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' })
  assert.throws(
    () => vault.fundTip({ poolId: 'turn-2026-11-04-dinner', paymentRef: 'intent-2', amount: 1n }),
    (error) => error.code === 'FUNDS_LOCKED',
  )
})

test('one employee opens a dispute and a strict majority isolates only that turn', () => {
  const { vault } = startedPool()
  vault.fundTip({ poolId: 'turn-2026-11-04-dinner', paymentRef: 'intent-1', amount: 10_000_000n })
  vault.raiseObjection({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-a', note: 'Missing worker.' })
  vault.castDisputeVote({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-b', supports: true })
  assert.equal(vault.getAdminView({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' }).state, ShiftState.DISPUTED)
})

test('a rejected dispute returns to distribution only after the voting window', () => {
  const { vault, advance } = startedPool()
  vault.raiseObjection({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-a' })
  vault.castDisputeVote({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-b', supports: false })
  advance(CORRECTION_WINDOW_MS)
  vault.finalizeDisputeVote({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' })
  assert.equal(vault.getAdminView({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' }).state, ShiftState.DISTRIBUTABLE)
})

test('the employee who raised the original objection can withdraw it and unblock the turn', () => {
  const { vault } = startedPool()
  vault.raiseObjection({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-a' })
  vault.castDisputeVote({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-b', supports: true })
  assert.equal(vault.getAdminView({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' }).state, ShiftState.DISPUTED)
  vault.withdrawObjection({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-a' })
  assert.equal(vault.getAdminView({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' }).state, ShiftState.DISTRIBUTABLE)
})

test('another employee cannot withdraw an objection they did not create', () => {
  const { vault } = startedPool()
  vault.raiseObjection({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-a' })
  assert.throws(
    () => vault.withdrawObjection({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-b' }),
    (error) => error.code === 'FORBIDDEN',
  )
})

test('75% acceptance releases a corrected distribution early', () => {
  const { vault } = startedPool()
  vault.raiseObjection({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-a' })
  vault.castDisputeVote({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-b', supports: true })
  vault.submitCorrectedDistribution({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo', roster })
  vault.castCorrectionVote({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-a', accepts: true })
  vault.castCorrectionVote({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-b', accepts: true })
  vault.castCorrectionVote({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-c', accepts: true })
  assert.equal(vault.getAdminView({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' }).state, ShiftState.DISTRIBUTABLE)
})

test('75% opposition reopens the dispute', () => {
  const { vault } = startedPool()
  vault.raiseObjection({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-a' })
  vault.castDisputeVote({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-b', supports: true })
  vault.submitCorrectedDistribution({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo', roster })
  for (const workerRef of ['worker-a', 'worker-b', 'worker-c']) {
    vault.castCorrectionVote({ poolId: 'turn-2026-11-04-dinner', workerRef, accepts: false })
  }
  assert.equal(vault.getAdminView({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' }).state, ShiftState.DISPUTED)
})

test('employee view never exposes co-workers wallets, admin view does', () => {
  const { vault } = startedPool()
  const employee = vault.getEmployeeView({ poolId: 'turn-2026-11-04-dinner', workerRef: 'worker-a' })
  assert.equal(employee.ownWallet, 'a.public.near')
  assert.deepEqual(employee.rule, [
    { workerRef: 'worker-a', shareBps: 5_000 },
    { workerRef: 'worker-b', shareBps: 3_000 },
    { workerRef: 'worker-c', shareBps: 2_000 },
  ])
  const admin = vault.getAdminView({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' })
  assert.equal(admin.roster[1].nearWallet, 'b.public.near')
})

test('exact allocation preserves every atomic unit', () => {
  const payouts = allocateExactly(7n, roster)
  assert.equal(payouts.reduce((sum, payout) => sum + payout.amount, 0n), 7n)
  assert.deepEqual(payouts.map((payout) => payout.amount), [4n, 2n, 1n])
})

test('only the location admin may release an unlocked pool', () => {
  const { vault } = startedPool()
  vault.fundTip({ poolId: 'turn-2026-11-04-dinner', paymentRef: 'intent-1', amount: 7n })
  vault.closeCollection({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' })
  assert.throws(
    () => vault.release({ poolId: 'turn-2026-11-04-dinner', adminRef: 'wrong-admin' }),
    (error) => error.code === 'FORBIDDEN',
  )
  const payouts = vault.release({ poolId: 'turn-2026-11-04-dinner', adminRef: 'admin-location-demo' })
  assert.equal(payouts.reduce((sum, payout) => sum + payout.amount, 0n), 7n)
})
