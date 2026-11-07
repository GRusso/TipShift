import assert from 'node:assert/strict'
import test from 'node:test'
import { TipShiftVault, TipShiftError } from '../src/core/tipshift-vault.mjs'
import { TipShiftSdk, TipShiftSdkError } from '../src/sdk/tipshift-sdk.mjs'

const locationARoster = [
  { workerRef: 'a-worker-1', nearWallet: 'a-worker-1.public.near', shareBps: 6_000 },
  { workerRef: 'a-worker-2', nearWallet: 'a-worker-2.public.near', shareBps: 4_000 },
]

const locationBRoster = [
  { workerRef: 'b-worker-1', nearWallet: 'b-worker-1.public.near', shareBps: 5_000 },
  { workerRef: 'b-worker-2', nearWallet: 'b-worker-2.public.near', shareBps: 5_000 },
]

function twoLocations() {
  const vault = new TipShiftVault({ now: () => 1_000 })
  vault.createPool({
    poolId: 'org-1-location-a-turn-1',
    organizationRef: 'org-1',
    locationRef: 'location-a',
    adminRef: 'location-a-admin',
    roster: locationARoster,
  })
  vault.createPool({
    poolId: 'org-1-location-b-turn-1',
    organizationRef: 'org-1',
    locationRef: 'location-b',
    adminRef: 'location-b-admin',
    roster: locationBRoster,
  })
  vault.startShift({ poolId: 'org-1-location-a-turn-1', adminRef: 'location-a-admin' })
  vault.startShift({ poolId: 'org-1-location-b-turn-1', adminRef: 'location-b-admin' })
  return vault
}

function sdk() {
  return new TipShiftSdk({
    intentClient: {
      async quoteExactOutput(request) {
        return { ...request, maxInputAmount: request.exactOutputAmount + 1n }
      },
    },
    vaultAccountId: 'tipshift.testnet',
    paymentRefFactory: () => 'opaque-checkout-reference',
  })
}

test('client: checkout refuses a zero tip before requesting a route', async () => {
  await assert.rejects(
    () => sdk().createTipCheckout({ poolId: 'org-1-location-a-turn-1', amount: 0n }),
    (error) => error instanceof TipShiftSdkError && error.code === 'INVALID_AMOUNT',
  )
})

test('client: one payment reference cannot credit tips in two branches', () => {
  const vault = twoLocations()
  vault.fundTip({ poolId: 'org-1-location-a-turn-1', paymentRef: 'opaque-ref-1', amount: 1_000_000n })

  assert.throws(
    () => vault.fundTip({ poolId: 'org-1-location-b-turn-1', paymentRef: 'opaque-ref-1', amount: 1_000_000n }),
    (error) => error instanceof TipShiftError && error.code === 'DUPLICATE_PAYMENT',
  )
  assert.equal(vault.getAdminView({ poolId: 'org-1-location-b-turn-1', adminRef: 'location-b-admin' }).balance, 0n)
})

test('employee: a worker can inspect only their wallet and the roster rule for their own turn', () => {
  const vault = twoLocations()
  const view = vault.getEmployeeView({ poolId: 'org-1-location-a-turn-1', workerRef: 'a-worker-1' })

  assert.equal(view.ownWallet, 'a-worker-1.public.near')
  assert.deepEqual(view.rule, [
    { workerRef: 'a-worker-1', shareBps: 6_000 },
    { workerRef: 'a-worker-2', shareBps: 4_000 },
  ])
  assert.equal(Object.values(view).includes('a-worker-2.public.near'), false)
  assert.throws(
    () => vault.getEmployeeView({ poolId: 'org-1-location-b-turn-1', workerRef: 'a-worker-1' }),
    (error) => error instanceof TipShiftError && error.code === 'FORBIDDEN',
  )
})

test('employee: an unassigned wallet cannot open a dispute or vote in another branch', () => {
  const vault = twoLocations()
  assert.throws(
    () => vault.raiseObjection({ poolId: 'org-1-location-a-turn-1', workerRef: 'b-worker-1' }),
    (error) => error instanceof TipShiftError && error.code === 'FORBIDDEN',
  )
})

test('location admin: an administrator cannot inspect, close, or release another location turn', () => {
  const vault = twoLocations()
  vault.fundTip({ poolId: 'org-1-location-b-turn-1', paymentRef: 'opaque-ref-b', amount: 1_000_000n })

  for (const action of [
    () => vault.getAdminView({ poolId: 'org-1-location-b-turn-1', adminRef: 'location-a-admin' }),
    () => vault.closeCollection({ poolId: 'org-1-location-b-turn-1', adminRef: 'location-a-admin' }),
    () => vault.release({ poolId: 'org-1-location-b-turn-1', adminRef: 'location-a-admin' }),
  ]) {
    assert.throws(action, (error) => error instanceof TipShiftError && error.code === 'FORBIDDEN')
  }
  assert.equal(vault.getAdminView({ poolId: 'org-1-location-b-turn-1', adminRef: 'location-b-admin' }).balance, 1_000_000n)
})

test('location admin: one branch closing collection does not freeze the other branch', () => {
  const vault = twoLocations()
  vault.closeCollection({ poolId: 'org-1-location-a-turn-1', adminRef: 'location-a-admin' })
  vault.fundTip({ poolId: 'org-1-location-b-turn-1', paymentRef: 'opaque-ref-b', amount: 1_000_000n })
  assert.equal(vault.getAdminView({ poolId: 'org-1-location-b-turn-1', adminRef: 'location-b-admin' }).balance, 1_000_000n)
})

test.todo('organization owner: authenticated aggregate history and a single export across locations require the private off-chain reporting layer')
