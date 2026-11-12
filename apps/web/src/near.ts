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

// Wallets that implement NEP-413 message signing, which the registration, check-in and report flows need.
function selector() {
  selectorPromise ??= Promise.all([
    import('@near-wallet-selector/core'),
    import('@near-wallet-selector/meteor-wallet'),
    import('@near-wallet-selector/my-near-wallet'),
    import('@near-wallet-selector/here-wallet'),
    import('@near-wallet-selector/nightly'),
  ]).then(([core, meteor, myNear, here, nightly]) => core.setupWalletSelector({
    network: 'testnet',
    modules: [meteor.setupMeteorWallet(), myNear.setupMyNearWallet(), here.setupHereWallet(), nightly.setupNightly()],
  }))
  return selectorPromise
}

const modals = new Map<string, { show: () => void; hide: () => void; on: (event: 'onHide', callback: () => void) => { remove: () => void } }>()

// Opens the wallet chooser and resolves once the person has signed in with any of the wallets.
async function chooseWallet(activeSelector: WalletSelector, params: { contractId?: string; methodNames?: string[] }) {
  const { setupModal } = await import('@near-wallet-selector/modal-ui')
  await import('@near-wallet-selector/modal-ui/styles.css')
  const key = `${params.contractId ?? ''}|${(params.methodNames ?? []).join(',')}`
  let modal = modals.get(key)
  if (!modal) {
    modal = setupModal(activeSelector, { contractId: params.contractId, methodNames: params.methodNames, theme: 'auto' }) as never
    modals.set(key, modal!)
  }
  const shown = modal!
  await new Promise<void>((resolve, reject) => {
    const subscription = activeSelector.on('signedIn', () => { subscription.remove(); hidden.remove(); resolve() })
    const hidden = shown.on('onHide', () => {
      // Wallets that leave the page signal a hide too; only a closed modal without a session is a cancellation.
      setTimeout(() => { if (!activeSelector.isSignedIn()) { subscription.remove(); hidden.remove(); reject(new Error('No wallet was connected.')) } }, 400)
    })
    shown.show()
  })
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
  if (!activeSelector.isSignedIn()) await chooseWallet(activeSelector, params)
  const wallet = await activeSelector.wallet()
  const accounts = await wallet.getAccounts()
  const accountId = accounts.at(0)?.accountId
  if (!accountId) throw new Error('The wallet did not return a testnet account.')
  return { wallet, accountId }
}

// Signs out so another account can be chosen the next time a wallet is needed.
export async function disconnectTestnetWallet() {
  const activeSelector = await selector()
  if (activeSelector.isSignedIn()) await (await activeSelector.wallet()).signOut()
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

const DISTRIBUTION_KEY = `tipshift-distribution-${DEMO_POOL_ID}`
export function savedDistributionTx(): string | null {
  try { return window.localStorage.getItem(DISTRIBUTION_KEY) } catch { return null }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitForPool(accept: (pool: PoolSummary) => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pool = await readDemoPool().catch(() => null)
    if (pool && accept(pool)) return pool
    await sleep(1500)
  }
  throw new Error('The network has not confirmed the step yet. Refresh in a few seconds and try again.')
}

type ActionFactory = typeof import('@near-js/transactions').actionCreators
const call = (actions: ActionFactory, methodName: string, args: object, deposit = 0n, gas = 100_000_000_000_000n) => actions.functionCall(methodName, args, gas, deposit)

/**
 * Demonstration close: the branch admin wallet closes collection, freezes the split and pays every
 * payout. The roster of the demonstration pool is fixed, so this does not use the live check-ins.
 */
export async function closeAndDistributeDemo(onStep: (step: 'closing' | 'paying' | 'confirming') => void) {
  const { wallet, accountId } = await connectTestnetWallet({})
  if (accountId !== DEMO_ADMIN_ID) throw new Error('NOT_ADMIN')
  let pool = await readDemoPool()
  if (!pool) throw new Error('The demonstration pool is not available.')
  if (pool.state === 'distributed') throw new Error('ALREADY_DISTRIBUTED')
  const { actionCreators } = await import('@near-js/transactions')
  let lastHash: string | null = null

  if (pool.state === 'collecting' || pool.state === 'distributable') {
    onStep('closing')
    const actions = [
      ...(pool.state === 'collecting' ? [call(actionCreators, 'close_collection', { pool_id: DEMO_POOL_ID }, 0n, 30_000_000_000_000n)] : []),
      call(actionCreators, 'prepare_distribution', { pool_id: DEMO_POOL_ID }, 0n, 60_000_000_000_000n),
    ]
    await wallet.signAndSendTransactions({ transactions: [{ signerId: accountId, receiverId: VAULT_ACCOUNT_ID, actions }] })
    pool = await waitForPool((p) => p.state === 'paying')
  }
  if (pool.state !== 'paying') throw new Error(`The pool is in state "${pool.state}" and cannot be distributed.`)

  onStep('paying')
  const transactions = Array.from({ length: pool.payout_count }, (_, index) => ({
    signerId: accountId,
    receiverId: VAULT_ACCOUNT_ID,
    actions: [call(actionCreators, 'dispatch_payout', { pool_id: DEMO_POOL_ID, payout_index: index }, 1n)],
  }))
  const outcomes = await wallet.signAndSendTransactions({ transactions })
  const list = Array.isArray(outcomes) ? outcomes : []
  lastHash = list.length ? transactionHash(list[list.length - 1]) : null

  onStep('confirming')
  const done = await waitForPool((p) => p.state === 'distributed')
  if (lastHash) { try { window.localStorage.setItem(DISTRIBUTION_KEY, lastHash) } catch { /* link is only a convenience */ } }
  return { pool: done, hash: lastHash }
}
