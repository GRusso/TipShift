/**
 * Private recipient-claim boundary.
 *
 * This module is deliberately server-only: it never exposes recipient wallets
 * through an administrator-facing view. An HTTP adapter may use it later, but
 * must keep `contractRoster` on an internal path used only to provision a
 * TipShift pool. The public customer checkout has no access to this state.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const SHARE_DENOMINATOR = 10_000
const TOKEN_BYTES = 32
const NONCE_BYTES = 32

export class RecipientClaimError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RecipientClaimError'
    this.code = code
  }
}

function fail(code, message) {
  throw new RecipientClaimError(code, message)
}

function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_INPUT', `${field} is required.`)
  return value.trim()
}

function bps(value) {
  if (!Number.isInteger(value) || value < 1 || value > SHARE_DENOMINATOR) {
    fail('INVALID_INPUT', 'shareBps must be an integer from 1 to 10,000.')
  }
  return value
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest()
}

function sameHash(left, right) {
  return left.length === right.length && timingSafeEqual(left, right)
}

function safeContext(claim) {
  return {
    locationLabel: claim.locationLabel,
    shiftLabel: claim.shiftLabel,
    recipientRef: claim.recipientRef,
    shareBps: claim.shareBps,
    expiresAt: claim.expiresAt,
  }
}

/**
 * `verifyProof` is injected by the HTTP adapter. It must verify both NEP-413
 * signature validity and that the public key belongs to `accountId` on the
 * expected NEAR network before returning true.
 */
export class RecipientClaimCoordinator {
  #claims = new Map()
  #walletsByShift = new Map()
  #recipientPlaces = new Set()
  #now
  #randomBytes
  #verifyProof
  #recipientDomain

  constructor({ now = () => Date.now(), random = randomBytes, verifyProof, recipientDomain } = {}) {
    if (typeof verifyProof !== 'function') throw new TypeError('verifyProof is required.')
    this.#now = now
    this.#randomBytes = random
    this.#verifyProof = verifyProof
    this.#recipientDomain = text(recipientDomain, 'recipientDomain')
  }

  issueClaim({ organizationRef, locationRef, shiftRef, recipientRef, shareBps, locationLabel, shiftLabel, expiresAt }) {
    const expires = Number(expiresAt)
    if (!Number.isSafeInteger(expires) || expires <= this.#now()) fail('INVALID_EXPIRY', 'expiresAt must be in the future.')
    const claim = {
      organizationRef: text(organizationRef, 'organizationRef'),
      locationRef: text(locationRef, 'locationRef'),
      shiftRef: text(shiftRef, 'shiftRef'),
      recipientRef: text(recipientRef, 'recipientRef'),
      shareBps: bps(shareBps),
      locationLabel: text(locationLabel, 'locationLabel'),
      shiftLabel: text(shiftLabel, 'shiftLabel'),
      expiresAt: expires,
      status: 'awaiting_claim',
      challenge: null,
      wallet: null,
    }
    const recipientPlaceKey = `${claim.organizationRef}\u0000${claim.locationRef}\u0000${claim.shiftRef}\u0000${claim.recipientRef}`
    if (this.#recipientPlaces.has(recipientPlaceKey)) fail('DUPLICATE_RECIPIENT', 'This recipient place already has a private claim link.')
    const token = this.#randomBytes(TOKEN_BYTES).toString('base64url')
    const digest = tokenHash(token)
    const id = digest.toString('hex')
    if (this.#claims.has(id)) fail('TOKEN_COLLISION', 'Try issuing the claim again.')
    this.#claims.set(id, { digest, claim })
    this.#recipientPlaces.add(recipientPlaceKey)
    return { token, ...safeContext(claim) }
  }

  openClaim({ token }) {
    const entry = this.#activeEntry(token)
    return safeContext(entry.claim)
  }

  startSignature({ token }) {
    const entry = this.#activeEntry(token)
    const nonce = this.#randomBytes(NONCE_BYTES).toString('base64url')
    const context = safeContext(entry.claim)
    const message = [
      'TipShift recipient claim',
      `Recipient: ${context.recipientRef}`,
      `Share: ${context.shareBps} bps`,
      `Expires: ${new Date(context.expiresAt).toISOString()}`,
      'I control the receiving NEAR wallet for this assigned TipShift recipient place.',
    ].join('\n')
    entry.claim.challenge = { message, nonce, recipient: this.#recipientDomain, issuedAt: this.#now() }
    return { ...context, message, nonce, recipient: this.#recipientDomain }
  }

  async completeClaim({ token, accountId, publicKey, signature }) {
    const entry = this.#activeEntry(token)
    const challenge = entry.claim.challenge
    if (!challenge) fail('CHALLENGE_REQUIRED', 'Start a new signature challenge first.')
    const wallet = text(accountId, 'accountId')
    const proof = {
      accountId: wallet,
      publicKey: text(publicKey, 'publicKey'),
      signature: text(signature, 'signature'),
      message: challenge.message,
      nonce: challenge.nonce,
      recipient: challenge.recipient,
    }
    const verified = await this.#verifyProof(proof)
    if (verified !== true) fail('INVALID_SIGNATURE', 'The recipient wallet proof could not be verified.')

    const shiftWalletKey = `${entry.claim.organizationRef}\u0000${entry.claim.locationRef}\u0000${entry.claim.shiftRef}\u0000${wallet}`
    const existing = this.#walletsByShift.get(shiftWalletKey)
    if (existing && existing !== entry.claim.recipientRef) {
      fail('DUPLICATE_SHIFT_WALLET', 'This wallet is already bound to another recipient place in this shift.')
    }
    this.#walletsByShift.set(shiftWalletKey, entry.claim.recipientRef)
    entry.claim.wallet = wallet
    entry.claim.status = 'verified'
    entry.claim.challenge = null
    return { ...safeContext(entry.claim), status: 'verified' }
  }

  adminStatus({ token }) {
    const entry = this.#entry(token)
    const status = entry.claim.status === 'awaiting_claim' && entry.claim.expiresAt <= this.#now() ? 'expired' : entry.claim.status
    return { recipientRef: entry.claim.recipientRef, shareBps: entry.claim.shareBps, status, expiresAt: entry.claim.expiresAt }
  }

  /**
   * Internal-only output for the contract-provisioning adapter. Never return
   * this value from an administrator, employee or public-customer endpoint.
   */
  contractRoster({ tokens }) {
    if (!Array.isArray(tokens) || tokens.length === 0) fail('INVALID_INPUT', 'tokens are required.')
    const claims = tokens.map((token) => this.#entry(token).claim)
    if (claims.some((claim) => claim.status !== 'verified')) fail('RECIPIENTS_PENDING', 'Every recipient must be verified before a shift can start.')
    const total = claims.reduce((sum, claim) => sum + claim.shareBps, 0)
    if (total !== SHARE_DENOMINATOR) fail('INVALID_ALLOCATION', 'Recipient shares must total exactly 10,000 bps.')
    const shiftKey = `${claims[0].organizationRef}\u0000${claims[0].locationRef}\u0000${claims[0].shiftRef}`
    if (claims.some((claim) => `${claim.organizationRef}\u0000${claim.locationRef}\u0000${claim.shiftRef}` !== shiftKey)) {
      fail('MIXED_SHIFT', 'A contract roster may contain recipients from only one shift.')
    }
    return claims.map((claim) => ({ workerRef: claim.recipientRef, nearWallet: claim.wallet, shareBps: claim.shareBps }))
  }

  #entry(token) {
    const raw = text(token, 'token')
    const digest = tokenHash(raw)
    const entry = this.#claims.get(digest.toString('hex'))
    if (!entry || !sameHash(entry.digest, digest)) fail('INVALID_CLAIM', 'This private claim link is not valid.')
    return entry
  }

  #activeEntry(token) {
    const entry = this.#entry(token)
    if (entry.claim.status === 'verified') fail('CLAIM_USED', 'This private claim link has already been used.')
    if (entry.claim.expiresAt <= this.#now()) fail('CLAIM_EXPIRED', 'This private claim link has expired.')
    return entry
  }
}
