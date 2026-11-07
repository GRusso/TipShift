import assert from 'node:assert/strict'
import test from 'node:test'
import { TipShiftSdk, TipShiftSdkError } from '../src/sdk/tipshift-sdk.mjs'

function adapter(overrides = {}) {
  return {
    async quoteExactOutput(request) {
      return {
        asset: request.asset,
        recipient: request.recipient,
        exactOutputAmount: request.exactOutputAmount,
        maxInputAmount: 5_150_000n,
        ...overrides,
      }
    },
  }
}

function sdk(overrides = {}) {
  return new TipShiftSdk({
    intentClient: adapter(overrides),
    paymentRefFactory: () => 'checkout-opaque-1',
  })
}

test('creates an exact-output checkout without exposing the pool in the payment message', async () => {
  const checkout = await sdk().createTipCheckout({ poolId: 'turn-private-to-business', amount: 5_000_000n })
  assert.equal(checkout.recipient, 'tipshift.near')
  assert.equal(checkout.exactOutputAmount, 5_000_000n)
  assert.equal(checkout.quote.maxInputAmount, 5_150_000n)
  assert.equal(checkout.paymentMessage, '{"payment_ref":"checkout-opaque-1"}')
  assert.equal(checkout.paymentMessage.includes('turn-private-to-business'), false)
})

test('rejects a quote that would short the vault', async () => {
  await assert.rejects(
    () => sdk({ exactOutputAmount: 4_999_999n }).createTipCheckout({ poolId: 'turn-1', amount: 5_000_000n }),
    (error) => error instanceof TipShiftSdkError && error.code === 'INVALID_QUOTE',
  )
})

test('rejects settlement when the actual USDC output differs from the exact tip', async () => {
  const client = sdk()
  const checkout = await client.createTipCheckout({ poolId: 'turn-1', amount: 5_000_000n })
  assert.throws(
    () => client.verifySettlement(checkout, {
      status: 'settled',
      paymentRef: checkout.paymentRef,
      recipient: checkout.recipient,
      asset: 'USDC',
      outputAmount: 4_999_999n,
    }),
    (error) => error.code === 'SHORT_OUTPUT',
  )
})

test('accepts a receipt only when all exact-output properties match', async () => {
  const client = sdk()
  const checkout = await client.createTipCheckout({ poolId: 'turn-1', amount: 5_000_000n })
  assert.equal(client.verifySettlement(checkout, {
    status: 'settled',
    paymentRef: checkout.paymentRef,
    recipient: checkout.recipient,
    asset: 'USDC',
    outputAmount: 5_000_000n,
  }), true)
})
