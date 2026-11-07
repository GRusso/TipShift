/**
 * TipShift's integration boundary for products such as a freelancer checkout.
 *
 * An adapter owns the provider-specific NEAR Intents / 1Click calls. The SDK
 * owns two invariants that an integrator must not weaken:
 *
 *   1. the TipShift vault receives the exact USDC output requested; and
 *   2. the checkout exposes only an opaque payment reference, never a turn or
 *      employee roster in the buyer-facing instruction.
 */

export class TipShiftSdkError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TipShiftSdkError'
    this.code = code
  }
}

function fail(code, message) {
  throw new TipShiftSdkError(code, message)
}

function requirePositiveBigInt(value, label) {
  if (typeof value !== 'bigint' || value <= 0n) fail('INVALID_AMOUNT', `${label} must be a positive bigint.`)
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_INPUT', `${label} is required.`)
  return value.trim()
}

export class TipShiftSdk {
  #intentClient
  #vaultAccountId
  #asset
  #paymentRefFactory

  constructor({ intentClient, vaultAccountId = 'tipshift.near', asset = 'USDC', paymentRefFactory }) {
    if (!intentClient || typeof intentClient.quoteExactOutput !== 'function') {
      fail('INVALID_ADAPTER', 'intentClient.quoteExactOutput is required.')
    }
    if (typeof paymentRefFactory !== 'function') fail('INVALID_ADAPTER', 'paymentRefFactory is required.')
    this.#intentClient = intentClient
    this.#vaultAccountId = requireNonEmptyString(vaultAccountId, 'vaultAccountId')
    this.#asset = requireNonEmptyString(asset, 'asset')
    this.#paymentRefFactory = paymentRefFactory
  }

  /**
   * Builds a buyer checkout. `poolId` is retained only by the integrator/session
   * registry; it does not enter the buyer-facing intent payload.
   */
  async createTipCheckout({ poolId, amount }) {
    poolId = requireNonEmptyString(poolId, 'poolId')
    requirePositiveBigInt(amount, 'amount')
    const paymentRef = requireNonEmptyString(this.#paymentRefFactory(), 'paymentRefFactory result')
    const paymentMessage = JSON.stringify({ payment_ref: paymentRef })

    const quote = await this.#intentClient.quoteExactOutput({
      asset: this.#asset,
      exactOutputAmount: amount,
      recipient: this.#vaultAccountId,
      message: paymentMessage,
    })

    this.#assertExactQuote(quote, amount)
    return Object.freeze({
      poolId,
      paymentRef,
      asset: this.#asset,
      exactOutputAmount: amount,
      recipient: this.#vaultAccountId,
      paymentMessage,
      quote,
    })
  }

  /**
   * The caller should invoke this only after independently checking the
   * on-chain receipt. It refuses a partial output or a mismatched recipient;
   * therefore no input gas or route spread can silently be taken from the tip.
   */
  verifySettlement(checkout, settlement) {
    if (!checkout || !settlement) fail('INVALID_SETTLEMENT', 'checkout and settlement are required.')
    if (settlement.status !== 'settled') fail('UNSETTLED', 'The payment is not settled.')
    if (settlement.paymentRef !== checkout.paymentRef) fail('MISMATCHED_SETTLEMENT', 'payment reference does not match.')
    if (settlement.recipient !== checkout.recipient) fail('MISMATCHED_SETTLEMENT', 'recipient does not match the vault.')
    if (settlement.asset !== checkout.asset) fail('MISMATCHED_SETTLEMENT', 'asset does not match.')
    if (settlement.outputAmount !== checkout.exactOutputAmount) {
      fail('SHORT_OUTPUT', 'The vault did not receive the exact quoted tip amount.')
    }
    return true
  }

  #assertExactQuote(quote, expectedAmount) {
    if (!quote || quote.recipient !== this.#vaultAccountId || quote.asset !== this.#asset) {
      fail('INVALID_QUOTE', 'Quote does not settle to the configured TipShift vault.')
    }
    if (quote.exactOutputAmount !== expectedAmount) {
      fail('INVALID_QUOTE', 'Quote does not guarantee the exact requested output amount.')
    }
    if (typeof quote.maxInputAmount !== 'bigint' || quote.maxInputAmount <= 0n) {
      fail('INVALID_QUOTE', 'Quote must disclose a positive maximum buyer input.')
    }
  }
}
