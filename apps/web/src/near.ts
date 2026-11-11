import type { WalletSelector } from '@near-wallet-selector/core'

export const TESTNET_RPC = import.meta.env.VITE_TIPSHIFT_TESTNET_RPC ?? 'https://rpc.testnet.near.org'
export const VAULT_ACCOUNT_ID = import.meta.env.VITE_TIPSHIFT_VAULT_ID ?? 'vault.tipshift-owner-20261105-r8k4.testnet'
export const TOKEN_ACCOUNT_ID = import.meta.env.VITE_TIPSHIFT_TOKEN_ID ?? 'usdc.fakes.testnet'
export const DEMO_POOL_ID = import.meta.env.VITE_TIPSHIFT_POOL_ID ?? 'web-live-20261110'
export const DEMO_ADMIN_ID = import.meta.env.VITE_TIPSHIFT_ADMIN_ID ?? 'v2.tipshift-owner-20261105-r8k4.testnet'
export const USDC_DECIMALS = 6

export type PoolSummary = {
  state: string
  balance: string
  total_funded: string
  roster_count: number
  voter_count: number
  payout_count: number
  delivered_payout_count: number
}

let selectorPromise: Promise<WalletSelector> | undefined

function selector() {
  selectorPromise ??= Promise.all([
    import('@near-wallet-selector/core'),
    import('@near-wallet-selector/meteor-wallet'),
  ]).then(([core, meteor]) => core.setupWalletSelector({
    network: 'testnet',
    modules: [meteor.setupMeteorWallet()],
  }))
  return selectorPromise
}

function base64Json(value: object) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeResult(result: number[]) {
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result)))
}

async function viewCall<T>(accountId: string, methodName: string, args: object): Promise<T> {
  const response = await fetch(TESTNET_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `tipshift-${methodName}`,
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: accountId,
        method_name: methodName,
        args_base64: base64Json(args),
      },
    }),
  })
  const payload = await response.json()
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? 'Unable to read testnet state.')
  return decodeResult(payload.result.result) as T
}

export async function readDemoPool() {
  return viewCall<PoolSummary | null>(VAULT_ACCOUNT_ID, 'get_pool', { pool_id: DEMO_POOL_ID })
}

export async function connectTestnetWallet(params: { contractId?: string; methodNames?: string[] } = {}) {
  const activeSelector = await selector()
  const wallet = await activeSelector.wallet()
  if (!activeSelector.isSignedIn()) await wallet.signIn(params as never)
  const accounts = await wallet.getAccounts()
  const accountId = accounts.at(0)?.accountId
  if (!accountId) throw new Error('Meteor Wallet did not return a testnet account.')
  return { wallet, accountId }
}

function transactionHash(outcome: unknown) {
  const candidate = outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } }
  return candidate.transaction?.hash ?? candidate.transaction_outcome?.id ?? null
}

export function explorerTransaction(hash: string) {
  return `https://explorer.testnet.near.org/transactions/${encodeURIComponent(hash)}`
}

export function toAtomicUsdc(value: string) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error('Enter a positive USDC amount with up to 6 decimals.')
  const [whole, fraction = ''] = value.split('.')
  const amount = BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))
  if (amount <= 0n) throw new Error('The tip amount must be greater than zero.')
  return amount
}

export function paymentRef() {
  return `ts-${crypto.randomUUID().replaceAll('-', '')}`
}

export async function openPaymentSession(params: { accountId: string; paymentRef: string; amount: bigint }) {
  const { actionCreators } = await import('@near-js/transactions')
  const { wallet } = await connectTestnetWallet({
    contractId: VAULT_ACCOUNT_ID,
    methodNames: ['open_payment_session'],
  })
  const outcome = await wallet.signAndSendTransaction({
    signerId: params.accountId,
    receiverId: VAULT_ACCOUNT_ID,
    actions: [actionCreators.functionCall('open_payment_session', {
      pool_id: DEMO_POOL_ID,
      payment_ref: params.paymentRef,
      expected_amount: params.amount.toString(),
    }, 50_000_000_000_000n, 0n)],
  })
  return transactionHash(outcome)
}

export async function payTip(params: { accountId: string; paymentRef: string; amount: bigint }) {
  const { actionCreators } = await import('@near-js/transactions')
  const { wallet } = await connectTestnetWallet({
    contractId: TOKEN_ACCOUNT_ID,
    methodNames: ['ft_transfer_call'],
  })
  const outcome = await wallet.signAndSendTransaction({
    signerId: params.accountId,
    receiverId: TOKEN_ACCOUNT_ID,
    actions: [actionCreators.functionCall('ft_transfer_call', {
      receiver_id: VAULT_ACCOUNT_ID,
      amount: params.amount.toString(),
      memo: null,
      msg: JSON.stringify({ payment_ref: params.paymentRef }),
    }, 100_000_000_000_000n, 1n)],
  })
  return transactionHash(outcome)
}
