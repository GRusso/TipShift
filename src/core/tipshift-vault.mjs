/**
 * TipShift's deterministic domain core.
 *
 * This module deliberately holds no private key, connects to no RPC, and moves
 * no money. It is the executable specification of TipShift's private review
 * layer: employee objections and votes arrive here after wallet-signature
 * verification, never as individual chain transactions. The NEAR contract
 * receives only an aggregate tally and a report hash.
 *
 * Amounts are bigint atomic units (USDC uses 6 decimals on NEAR). Never use a
 * JavaScript number for money.
 */

export const SHARE_DENOMINATOR = 10_000
export const CORRECTION_WINDOW_MS = 60 * 60 * 1_000
export const ACCEPTANCE_THRESHOLD_BPS = 7_500
export const OPPOSITION_THRESHOLD_BPS = 7_500

export const ShiftState = Object.freeze({
  DRAFT: 'draft',
  COLLECTING: 'collecting',
  DISTRIBUTABLE: 'distributable',
  DISPUTE_VOTING: 'dispute_voting',
  DISPUTED: 'disputed',
  CORRECTION_REVIEW: 'correction_review',
  DISTRIBUTED: 'distributed',
})

export class TipShiftError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TipShiftError'
    this.code = code
  }
}

function fail(code, message) {
  throw new TipShiftError(code, message)
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_INPUT', `${label} is required.`)
  return value.trim()
}

function cloneRoster(roster) {
  return roster.map((member) => ({ ...member }))
}

function validateRoster(roster) {
  if (!Array.isArray(roster) || roster.length === 0) fail('INVALID_ROSTER', 'A roster requires at least one worker.')

  const workerRefs = new Set()
  const wallets = new Set()
  let total = 0

  for (const member of roster) {
    requireNonEmptyString(member?.workerRef, 'workerRef')
    requireNonEmptyString(member?.nearWallet, 'nearWallet')
    if (!Number.isInteger(member.shareBps) || member.shareBps <= 0) {
      fail('INVALID_ROSTER', 'Each share must be a positive integer in basis points.')
    }
    if (workerRefs.has(member.workerRef)) fail('INVALID_ROSTER', 'workerRef must be unique within a shift.')
    if (wallets.has(member.nearWallet)) fail('INVALID_ROSTER', 'A wallet cannot appear twice in a shift.')
    workerRefs.add(member.workerRef)
    wallets.add(member.nearWallet)
    total += member.shareBps
  }

  if (total !== SHARE_DENOMINATOR) {
    fail('INVALID_ROSTER', `Shares must total exactly ${SHARE_DENOMINATOR} basis points.`)
  }
}

function countVotes(votes, choice) {
  return [...votes.values()].filter((vote) => vote === choice).length
}

function meetsThreshold(count, eligible, thresholdBps) {
  return count * SHARE_DENOMINATOR >= eligible * thresholdBps
}

/**
 * Splits an atomic-unit balance exactly. Remainders are allocated by descending
 * fractional remainder, then workerRef. That keeps the rule deterministic and
 * makes the sums auditable without ever losing a USDC atomic unit.
 */
export function allocateExactly(amount, roster) {
  if (typeof amount !== 'bigint' || amount < 0n) fail('INVALID_AMOUNT', 'Amount must be a non-negative bigint.')
  validateRoster(roster)

  const provisional = roster.map((member) => {
    const weighted = amount * BigInt(member.shareBps)
    return {
      workerRef: member.workerRef,
      nearWallet: member.nearWallet,
      amount: weighted / BigInt(SHARE_DENOMINATOR),
      remainder: weighted % BigInt(SHARE_DENOMINATOR),
    }
  })
  const assigned = provisional.reduce((sum, payout) => sum + payout.amount, 0n)
  let remaining = amount - assigned

  provisional.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1
    return a.workerRef.localeCompare(b.workerRef)
  })

  for (let index = 0; remaining > 0n; index += 1, remaining -= 1n) {
    provisional[index % provisional.length].amount += 1n
  }

  return provisional
    .map(({ remainder, ...payout }) => payout)
    .sort((a, b) => a.workerRef.localeCompare(b.workerRef))
}

export class TipShiftVault {
  #pools = new Map()
  #fundedPaymentRefs = new Set()
  #now

  constructor({ now = () => Date.now() } = {}) {
    this.#now = now
  }

  createPool({ poolId, organizationRef, locationRef, adminRef, roster }) {
    poolId = requireNonEmptyString(poolId, 'poolId')
    if (this.#pools.has(poolId)) fail('DUPLICATE_POOL', 'poolId already exists.')
    validateRoster(roster)

    const at = this.#now()
    this.#pools.set(poolId, {
      poolId,
      organizationRef: requireNonEmptyString(organizationRef, 'organizationRef'),
      locationRef: requireNonEmptyString(locationRef, 'locationRef'),
      adminRef: requireNonEmptyString(adminRef, 'adminRef'),
      state: ShiftState.DRAFT,
      roster: cloneRoster(roster),
      voterRefs: new Set(),
      distributionVersion: 1,
      balance: 0n,
      paymentRefs: new Set(),
      objectionOwnerRef: null,
      disputeVotes: new Map(),
      correctionVotes: new Map(),
      deadlineAt: null,
      events: [{ type: 'pool_created', at, distributionVersion: 1 }],
    })
  }

  startShift({ poolId, adminRef }) {
    const pool = this.#pool(poolId)
    this.#assertAdmin(pool, adminRef)
    if (pool.state !== ShiftState.DRAFT) fail('INVALID_STATE', 'Only a draft pool can start.')
    pool.state = ShiftState.COLLECTING
    pool.voterRefs = new Set(pool.roster.map((member) => member.workerRef))
    pool.events.push({ type: 'shift_started', at: this.#now(), distributionVersion: pool.distributionVersion })
  }

  fundTip({ poolId, paymentRef, amount }) {
    const pool = this.#pool(poolId)
    if (pool.state !== ShiftState.COLLECTING) {
      fail('FUNDS_LOCKED', 'Tips can be funded only while the shift is collecting.')
    }
    paymentRef = requireNonEmptyString(paymentRef, 'paymentRef')
    if (this.#fundedPaymentRefs.has(paymentRef)) fail('DUPLICATE_PAYMENT', 'paymentRef was already credited.')
    if (typeof amount !== 'bigint' || amount <= 0n) fail('INVALID_AMOUNT', 'Tip amount must be a positive bigint.')
    pool.paymentRefs.add(paymentRef)
    this.#fundedPaymentRefs.add(paymentRef)
    pool.balance += amount
    pool.events.push({ type: 'tip_funded', at: this.#now(), paymentRef, amount })
  }

  closeCollection({ poolId, adminRef }) {
    const pool = this.#pool(poolId)
    this.#assertAdmin(pool, adminRef)
    if (pool.state !== ShiftState.COLLECTING) fail('INVALID_STATE', 'Only a collecting shift can close.')
    pool.state = ShiftState.DISTRIBUTABLE
    pool.events.push({ type: 'collection_closed', at: this.#now(), balance: pool.balance })
  }

  raiseObjection({ poolId, workerRef, note = '' }) {
    const pool = this.#pool(poolId)
    this.#assertVoter(pool, workerRef)
    if (![ShiftState.COLLECTING, ShiftState.DISTRIBUTABLE].includes(pool.state)) {
      fail('INVALID_STATE', 'An objection is allowed only before distribution or during collection.')
    }
    if (typeof note !== 'string' || note.length > 280) fail('INVALID_NOTE', 'The optional note must be 280 characters or less.')

    pool.state = ShiftState.DISPUTE_VOTING
    pool.objectionOwnerRef = workerRef
    pool.disputeVotes = new Map([[workerRef, 'support']])
    pool.deadlineAt = this.#now() + CORRECTION_WINDOW_MS
    // The caller represents a verified off-chain signature. This data must
    // remain in the encrypted reporting layer; it is not a contract call.
    pool.events.push({ type: 'objection_raised', at: this.#now(), workerRef, note: note.trim() || null })
    this.#evaluateDispute(pool)
  }

  /**
   * The employee who opened the initial objection may withdraw it. This is
   * intentionally stronger than a "reject" vote: the user-defined rule says
   * that withdrawing the objection lets the original distribution continue.
   * Corrected-distribution votes are independently changeable by calling
   * castCorrectionVote again before a terminal threshold is reached.
   */
  withdrawObjection({ poolId, workerRef }) {
    const pool = this.#pool(poolId)
    if (pool.objectionOwnerRef !== workerRef) fail('FORBIDDEN', 'Only the employee who opened this objection may withdraw it.')
    if (![ShiftState.DISPUTE_VOTING, ShiftState.DISPUTED].includes(pool.state)) {
      fail('INVALID_STATE', 'There is no withdrawable objection.')
    }
    pool.state = ShiftState.DISTRIBUTABLE
    pool.deadlineAt = null
    pool.objectionOwnerRef = null
    pool.events.push({ type: 'objection_withdrawn', at: this.#now(), workerRef })
  }

  castDisputeVote({ poolId, workerRef, supports }) {
    const pool = this.#pool(poolId)
    this.#assertVoter(pool, workerRef)
    if (pool.state !== ShiftState.DISPUTE_VOTING) fail('INVALID_STATE', 'There is no open dispute vote.')
    if (typeof supports !== 'boolean') fail('INVALID_VOTE', 'supports must be boolean.')
    pool.disputeVotes.set(workerRef, supports ? 'support' : 'reject')
    pool.events.push({ type: 'dispute_vote_cast', at: this.#now(), workerRef, supports })
    this.#evaluateDispute(pool)
  }

  finalizeDisputeVote({ poolId, adminRef }) {
    const pool = this.#pool(poolId)
    this.#assertAdmin(pool, adminRef)
    if (pool.state !== ShiftState.DISPUTE_VOTING) fail('INVALID_STATE', 'There is no dispute vote to finalize.')
    if (this.#now() < pool.deadlineAt) fail('WINDOW_OPEN', 'The dispute voting window is still open.')
    this.#moveToDisputedOrDistributable(pool)
  }

  submitCorrectedDistribution({ poolId, adminRef, roster }) {
    const pool = this.#pool(poolId)
    this.#assertAdmin(pool, adminRef)
    if (pool.state !== ShiftState.DISPUTED) fail('INVALID_STATE', 'A correction requires a disputed pool.')
    validateRoster(roster)
    pool.roster = cloneRoster(roster)
    pool.distributionVersion += 1
    pool.correctionVotes = new Map()
    pool.state = ShiftState.CORRECTION_REVIEW
    pool.deadlineAt = this.#now() + CORRECTION_WINDOW_MS
    pool.events.push({ type: 'corrected_distribution_published', at: this.#now(), distributionVersion: pool.distributionVersion })
  }

  castCorrectionVote({ poolId, workerRef, accepts }) {
    const pool = this.#pool(poolId)
    this.#assertVoter(pool, workerRef)
    if (pool.state !== ShiftState.CORRECTION_REVIEW) fail('INVALID_STATE', 'There is no corrected distribution to review.')
    if (typeof accepts !== 'boolean') fail('INVALID_VOTE', 'accepts must be boolean.')
    pool.correctionVotes.set(workerRef, accepts ? 'accept' : 'oppose')
    pool.events.push({ type: 'correction_vote_cast', at: this.#now(), workerRef, accepts })
    this.#evaluateCorrection(pool)
  }

  finalizeCorrectionReview({ poolId, adminRef }) {
    const pool = this.#pool(poolId)
    this.#assertAdmin(pool, adminRef)
    if (pool.state !== ShiftState.CORRECTION_REVIEW) fail('INVALID_STATE', 'There is no correction review to finalize.')
    if (this.#now() < pool.deadlineAt) fail('WINDOW_OPEN', 'The correction review window is still open.')
    this.#moveCorrectionToTerminal(pool)
  }

  release({ poolId, adminRef }) {
    const pool = this.#pool(poolId)
    this.#assertAdmin(pool, adminRef)
    if (pool.state !== ShiftState.DISTRIBUTABLE) fail('INVALID_STATE', 'Only a distributable pool can release funds.')
    const payouts = allocateExactly(pool.balance, pool.roster)
    pool.state = ShiftState.DISTRIBUTED
    pool.events.push({ type: 'distribution_released', at: this.#now(), distributionVersion: pool.distributionVersion, payouts })
    return payouts
  }

  getEmployeeView({ poolId, workerRef }) {
    const pool = this.#pool(poolId)
    this.#assertVoter(pool, workerRef)
    const self = pool.roster.find((member) => member.workerRef === workerRef)
    return {
      poolId: pool.poolId,
      state: pool.state,
      distributionVersion: pool.distributionVersion,
      ownWallet: self?.nearWallet ?? null,
      rule: pool.roster.map(({ workerRef: ref, shareBps }) => ({ workerRef: ref, shareBps })),
      balance: pool.balance,
    }
  }

  getAdminView({ poolId, adminRef }) {
    const pool = this.#pool(poolId)
    this.#assertAdmin(pool, adminRef)
    return this.#snapshot(pool, true)
  }

  #evaluateDispute(pool) {
    const support = countVotes(pool.disputeVotes, 'support')
    if (support * 2 > pool.voterRefs.size) this.#moveToDisputed(pool)
  }

  #moveToDisputedOrDistributable(pool) {
    const support = countVotes(pool.disputeVotes, 'support')
    if (support * 2 > pool.voterRefs.size) this.#moveToDisputed(pool)
    else {
      pool.state = ShiftState.DISTRIBUTABLE
      pool.deadlineAt = null
      pool.events.push({ type: 'dispute_rejected_or_expired', at: this.#now() })
    }
  }

  #moveToDisputed(pool) {
    pool.state = ShiftState.DISPUTED
    pool.deadlineAt = null
    pool.events.push({ type: 'pool_disputed', at: this.#now(), balance: pool.balance })
  }

  #evaluateCorrection(pool) {
    const eligible = pool.voterRefs.size
    const accepts = countVotes(pool.correctionVotes, 'accept')
    const opposes = countVotes(pool.correctionVotes, 'oppose')
    if (meetsThreshold(accepts, eligible, ACCEPTANCE_THRESHOLD_BPS)) {
      pool.state = ShiftState.DISTRIBUTABLE
      pool.deadlineAt = null
      pool.events.push({ type: 'correction_accepted_early', at: this.#now() })
    } else if (meetsThreshold(opposes, eligible, OPPOSITION_THRESHOLD_BPS)) {
      this.#moveToDisputed(pool)
    }
  }

  #moveCorrectionToTerminal(pool) {
    const opposes = countVotes(pool.correctionVotes, 'oppose')
    if (meetsThreshold(opposes, pool.voterRefs.size, OPPOSITION_THRESHOLD_BPS)) this.#moveToDisputed(pool)
    else {
      pool.state = ShiftState.DISTRIBUTABLE
      pool.deadlineAt = null
      pool.events.push({ type: 'correction_window_elapsed', at: this.#now() })
    }
  }

  #pool(poolId) {
    poolId = requireNonEmptyString(poolId, 'poolId')
    const pool = this.#pools.get(poolId)
    if (!pool) fail('UNKNOWN_POOL', 'Unknown poolId.')
    return pool
  }

  #assertAdmin(pool, adminRef) {
    if (pool.adminRef !== adminRef) fail('FORBIDDEN', 'Only the location admin may perform this action.')
  }

  #assertVoter(pool, workerRef) {
    if (!pool.voterRefs.has(workerRef)) fail('FORBIDDEN', 'Only a worker locked into this shift may vote or view it.')
  }

  #snapshot(pool, includeWallets) {
    return {
      poolId: pool.poolId,
      organizationRef: pool.organizationRef,
      locationRef: pool.locationRef,
      state: pool.state,
      distributionVersion: pool.distributionVersion,
      balance: pool.balance,
      deadlineAt: pool.deadlineAt,
      roster: pool.roster.map((member) =>
        includeWallets ? { ...member } : { workerRef: member.workerRef, shareBps: member.shareBps },
      ),
      events: pool.events.map((event) => ({ ...event })),
    }
  }
}
