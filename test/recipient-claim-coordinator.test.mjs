import assert from 'node:assert/strict'
import test from 'node:test'
import { RecipientClaimCoordinator, RecipientClaimError } from '../src/server/recipient-claim-coordinator.mjs'

const now = 1_700_000_000_000
const claimArgs = {
  organizationRef: 'org-1', locationRef: 'branch-1', shiftRef: 'shift-1',
  recipientRef: 'recipient-01', shareBps: 10_000,
  locationLabel: 'Café Nómada', shiftLabel: 'Lunch shift', expiresAt: now + 60_000,
}

function coordinator(overrides = {}) {
  return new RecipientClaimCoordinator({ now: () => now, verifyProof: async () => true, recipientDomain: 'tipshift.local', ...overrides })
}

test('private claim: admin status never contains a wallet while contract roster does', async () => {
  const service = coordinator()
  const issued = service.issueClaim(claimArgs)
  assert.equal(issued.token.includes('recipient-01'), false)
  assert.equal(service.openClaim({ token: issued.token }).shareBps, 10_000)
  const challenge = service.startSignature({ token: issued.token })
  await service.completeClaim({ token: issued.token, accountId: 'employee.public.near', publicKey: 'ed25519:test', signature: 'signature' })

  const status = service.adminStatus({ token: issued.token })
  assert.deepEqual(status, { recipientRef: 'recipient-01', shareBps: 10_000, status: 'verified', expiresAt: now + 60_000 })
  assert.equal(JSON.stringify(status).includes('employee.public.near'), false)
  assert.equal(challenge.message.includes('employee.public.near'), false)
  assert.deepEqual(service.contractRoster({ tokens: [issued.token] }), [
    { workerRef: 'recipient-01', nearWallet: 'employee.public.near', shareBps: 10_000 },
  ])
})

test('private claim: rejects reuse, expiry, unverified recipients and duplicate wallet in one shift', async () => {
  const service = coordinator()
  const first = service.issueClaim({ ...claimArgs, recipientRef: 'recipient-01', shareBps: 5_000 })
  const second = service.issueClaim({ ...claimArgs, recipientRef: 'recipient-02', shareBps: 5_000 })
  assert.throws(() => service.contractRoster({ tokens: [first.token, second.token] }), RecipientClaimError)
  service.startSignature({ token: first.token })
  await service.completeClaim({ token: first.token, accountId: 'same.public.near', publicKey: 'ed25519:first', signature: 'one' })
  assert.throws(() => service.openClaim({ token: first.token }), (error) => error.code === 'CLAIM_USED')
  service.startSignature({ token: second.token })
  await assert.rejects(
    () => service.completeClaim({ token: second.token, accountId: 'same.public.near', publicKey: 'ed25519:second', signature: 'two' }),
    (error) => error.code === 'DUPLICATE_SHIFT_WALLET',
  )
  let clock = now
  const expiring = coordinator({ now: () => clock })
  const token = expiring.issueClaim({ ...claimArgs, expiresAt: now + 1 }).token
  clock += 2
  assert.throws(() => expiring.openClaim({ token }), (error) => error.code === 'CLAIM_EXPIRED')
  assert.equal(expiring.adminStatus({ token }).status, 'expired')
  assert.throws(() => service.issueClaim({ ...claimArgs, recipientRef: 'recipient-01', shareBps: 5_000 }), (error) => error.code === 'DUPLICATE_RECIPIENT')
})

test('private claim: the same wallet may claim a recipient in a different shift', async () => {
  const service = coordinator()
  const first = service.issueClaim(claimArgs)
  const nextShift = service.issueClaim({ ...claimArgs, shiftRef: 'shift-2' })
  for (const claim of [first, nextShift]) {
    service.startSignature({ token: claim.token })
    await service.completeClaim({ token: claim.token, accountId: 'repeat.public.near', publicKey: 'ed25519:test', signature: 'signature' })
  }
})
