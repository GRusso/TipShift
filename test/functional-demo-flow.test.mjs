import assert from 'node:assert/strict'
import test from 'node:test'
import { ShiftState, TipShiftVault } from '../src/core/tipshift-vault.mjs'

const poolId = 'demo-cafe-nomada-lunch'
const adminRef = 'demo-branch-admin'
const roster = [
  { workerRef: 'recipient-01', nearWallet: 'bound-recipient-01', shareBps: 4_000 },
  { workerRef: 'recipient-02', nearWallet: 'bound-recipient-02', shareBps: 3_500 },
  { workerRef: 'recipient-03', nearWallet: 'bound-recipient-03', shareBps: 2_500 },
]

test('functional demo flow: collect, dispute, correct, accept and distribute an isolated tip pool', () => {
  const vault = new TipShiftVault()
  vault.createPool({ poolId, organizationRef: 'demo-organization', locationRef: 'demo-location', adminRef, roster })
  vault.startShift({ poolId, adminRef })
  vault.fundTip({ poolId, paymentRef: 'demo-payment-1', amount: 5_000_000n })
  vault.closeCollection({ poolId, adminRef })

  vault.raiseObjection({ poolId, workerRef: 'recipient-01', note: 'Demo review.' })
  vault.castDisputeVote({ poolId, workerRef: 'recipient-02', supports: true })
  assert.equal(vault.getAdminView({ poolId, adminRef }).state, ShiftState.DISPUTED)

  vault.submitCorrectedDistribution({ poolId, adminRef, roster })
  for (const workerRef of roster.map((member) => member.workerRef)) {
    vault.castCorrectionVote({ poolId, workerRef, accepts: true })
  }
  assert.equal(vault.getAdminView({ poolId, adminRef }).state, ShiftState.DISTRIBUTABLE)

  const payouts = vault.release({ poolId, adminRef })
  assert.equal(vault.getAdminView({ poolId, adminRef }).state, ShiftState.DISTRIBUTED)
  assert.equal(payouts.reduce((total, payout) => total + payout.amount, 0n), 5_000_000n)
  assert.deepEqual(payouts.map((payout) => payout.amount), [2_000_000n, 1_750_000n, 1_250_000n])
})
