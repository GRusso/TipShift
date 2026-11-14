import { Buffer } from 'buffer'
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
  admin_id?: string
  creator_id?: string | null
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

/** Reads any location's pool. Pools are per location: the console learns the id from the server. */
export async function readPool(poolId: string) {
  return viewCall<PoolSummary | null>(VAULT_ACCOUNT_ID, 'get_pool', { pool_id: poolId })
}
/** The fixed demonstration pool of the legacy page. */
export const readDemoPool = () => readPool(DEMO_POOL_ID)

/** NEAR left in a wallet, in yoctoNEAR: what pays the gas of closing shifts. */
export async function readNearBalance(accountId: string): Promise<bigint> {
  const response = await fetch(TESTNET_RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'tipshift-balance', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: accountId } }) })
  const payload = await response.json()
  if (!response.ok || payload.error) throw new Error('Unable to read the wallet balance.')
  return BigInt(payload.result.amount)
}

/** NEAR reserved in the pool for its own storage, in yoctoNEAR. */
export async function readStorageCredit(poolId: string): Promise<bigint> {
  return BigInt(await viewCall<string>(VAULT_ACCOUNT_ID, 'get_storage_credit', { pool_id: poolId }))
}

/** The pool's administrator (manager) or its creator (the company owner) may operate it. */
export const mayAct = (pool: { admin_id?: string; creator_id?: string | null }, account: string) => pool.admin_id === account || pool.creator_id === account

export const formatNear = (yocto: bigint) => (Number(yocto / 10n ** 20n) / 10_000).toFixed(3)

/** Whether a wallet session already exists, so a flow can tell "just connected" from "ready to sign". */
export async function walletIsConnected() {
  return (await selector()).isSignedIn()
}

/** The wallet account currently connected in this browser, or null. Never opens a wallet window. */
export async function connectedAccountId() {
  const active = await selector()
  return active.isSignedIn() ? active.store.getState().accounts.find((a) => a.active)?.accountId ?? null : null
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

const NEAR = 10n ** 24n
const POOL_DEPOSIT = 3n * NEAR / 10n // storage of the pool record + a reserve for later shifts
const POOL_CREDIT = NEAR / 10n

/**
 * Creates the pool of a location with the connected wallet as its admin (it pays the storage) and opens
 * collection in the same transaction. Done once per location.
 */
export async function createBranchPool(params: { poolId: string; handTo?: string | null }) {
  const { wallet, accountId } = await connectTestnetWallet({})
  const { actionCreators } = await import('@near-js/transactions')
  const outcome = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: VAULT_ACCOUNT_ID,
    actions: [
      actionCreators.functionCall('create_pool', { pool_id: params.poolId, admin_id: accountId, roster: [{ worker_ref: 'seed', near_wallet: accountId, share_bps: 10_000 }], storage_credit: POOL_CREDIT.toString() }, 100_000_000_000_000n, POOL_DEPOSIT),
      actionCreators.functionCall('start_collection', { pool_id: params.poolId }, 30_000_000_000_000n, 0n),
      // When the location already has a manager, their wallet takes over the pool in the same transaction.
      ...(params.handTo && params.handTo !== accountId ? [actionCreators.functionCall('set_pool_admin', { pool_id: params.poolId, new_admin_id: params.handTo }, 30_000_000_000_000n, 0n)] : []),
    ],
  })
  await waitForPool(params.poolId, (p) => p.state === 'collecting')
  return { accountId, hash: transactionHash(outcome) }
}

/** Gives the pool to another wallet (current administrator only). */
export async function handPoolTo(params: { poolId: string; newAdmin: string }) {
  const { wallet, accountId } = await connectTestnetWallet({})
  const pool = await readPool(params.poolId)
  if (pool?.admin_id && !mayAct(pool, accountId)) throw new Error('NOT_ADMIN')
  const { actionCreators } = await import('@near-js/transactions')
  const outcome = await wallet.signAndSendTransaction({ signerId: accountId, receiverId: VAULT_ACCOUNT_ID, actions: [actionCreators.functionCall('set_pool_admin', { pool_id: params.poolId, new_admin_id: params.newAdmin }, 30_000_000_000_000n, 0n)] })
  await waitForPool(params.poolId, (p) => p.admin_id === params.newAdmin)
  return transactionHash(outcome)
}

/** "1.5" -> yoctoNEAR; null when it is not a positive amount with at most 6 decimals. */
export function parseNear(text: string): bigint | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,6}))?$/.exec(text.trim())
  if (!m) return null
  const value = BigInt(m[1]) * 10n ** 24n + BigInt((m[2] ?? '').padEnd(6, '0')) * 10n ** 18n
  return value > 0n ? value : null
}

/** Sends NEAR from the connected wallet (the owner funding a manager's network fees). */
export async function sendNear(params: { to: string; amount: bigint }) {
  const { wallet, accountId } = await connectTestnetWallet({})
  const { actionCreators } = await import('@near-js/transactions')
  const outcome = await wallet.signAndSendTransaction({ signerId: accountId, receiverId: params.to, actions: [actionCreators.transfer(params.amount)] })
  return transactionHash(outcome)
}

/** Adds NEAR to the pool's storage reserve (admin only). */
export async function rechargePoolStorage(params: { poolId: string; near?: bigint }) {
  const { wallet, accountId } = await connectTestnetWallet({})
  const { actionCreators } = await import('@near-js/transactions')
  const outcome = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: VAULT_ACCOUNT_ID,
    actions: [actionCreators.functionCall('deposit_storage_credit', { pool_id: params.poolId }, 30_000_000_000_000n, params.near ?? NEAR / 5n)],
  })
  return transactionHash(outcome)
}

/**
 * Opens a checkout for the location's pool. A pool that already paid a shift is reopened in the same
 * transaction, so the manager never has to do anything extra between shifts.
 */
export async function openPaymentSession(params: { poolId: string; paymentRef: string; amount: bigint }) {
  const { actionCreators } = await import('@near-js/transactions')
  const { wallet, accountId } = await connectTestnetWallet({})
  const pool = await readPool(params.poolId)
  if (!pool) throw new Error('POOL_MISSING')
  if (pool.admin_id && !mayAct(pool, accountId)) throw new Error('NOT_ADMIN')
  const actions = [
    ...(pool.state === 'distributed' ? [actionCreators.functionCall('reopen_pool', { pool_id: params.poolId }, 30_000_000_000_000n, 0n)] : []),
    ...(pool.state === 'draft' ? [actionCreators.functionCall('start_collection', { pool_id: params.poolId }, 30_000_000_000_000n, 0n)] : []),
    actionCreators.functionCall('open_payment_session', { pool_id: params.poolId, payment_ref: params.paymentRef, expected_amount: params.amount.toString() }, 50_000_000_000_000n, 0n),
  ]
  const outcome = await wallet.signAndSendTransaction({ signerId: accountId, receiverId: VAULT_ACCOUNT_ID, actions })
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

const distributionKey = (poolId: string) => `tipshift-distribution-${poolId}`
export function savedDistributionTx(poolId: string): string | null {
  try { return window.localStorage.getItem(distributionKey(poolId)) } catch { return null }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitForPool(poolId: string, accept: (pool: PoolSummary) => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pool = await readPool(poolId).catch(() => null)
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
export type RosterMember = { worker_ref: string; near_wallet: string; share_bps: number }

export async function closeAndDistribute(poolId: string, onStep: (step: 'closing' | 'paying' | 'confirming') => void, roster?: RosterMember[]) {
  const { wallet, accountId } = await connectTestnetWallet({})
  let pool = await readPool(poolId)
  if (pool?.admin_id && !mayAct(pool, accountId)) throw new Error('NOT_ADMIN')
  if (!pool) throw new Error('This location’s pool isn’t available.')
  if (pool.state === 'distributed') throw new Error('ALREADY_DISTRIBUTED')
  const { actionCreators } = await import('@near-js/transactions')
  let lastHash: string | null = null

  if (pool.state === 'collecting' || pool.state === 'distributable') {
    onStep('closing')
    const actions = [
      ...(roster ? [call(actionCreators, 'set_roster', { pool_id: poolId, roster }, 0n, 30_000_000_000_000n)] : []),
      ...(pool.state === 'collecting' ? [call(actionCreators, 'close_collection', { pool_id: poolId }, 0n, 30_000_000_000_000n)] : []),
      call(actionCreators, 'prepare_distribution', { pool_id: poolId }, 0n, 60_000_000_000_000n),
    ]
    await wallet.signAndSendTransactions({ transactions: [{ signerId: accountId, receiverId: VAULT_ACCOUNT_ID, actions }] })
    pool = await waitForPool(poolId, (p) => p.state === 'paying')
  }
  if (pool.state !== 'paying') throw new Error(`The pool is in state "${pool.state}" and cannot be distributed.`)

  onStep('paying')
  const send = (index: number) => ({
    signerId: accountId,
    receiverId: VAULT_ACCOUNT_ID,
    actions: [call(actionCreators, 'dispatch_payout', { pool_id: poolId, payout_index: index }, 1n)],
  })
  const indexes = Array.from({ length: pool.payout_count }, (_, index) => index)
  if (pool.delivered_payout_count === 0) {
    // Nothing paid yet: one approval covers every payout.
    const outcomes = await wallet.signAndSendTransactions({ transactions: indexes.map(send) })
    const list = Array.isArray(outcomes) ? outcomes : []
    lastHash = list.length ? transactionHash(list[list.length - 1]) : null
  } else {
    // A retry: the contract does not say which payouts are done, and it rejects the paid ones. Try each alone.
    for (const index of indexes) {
      try {
        const outcome = await wallet.signAndSendTransaction(send(index))
        lastHash = transactionHash(outcome) ?? lastHash
      } catch { /* already delivered or still failing; the final count tells which */ }
    }
  }

  onStep('confirming')
  let done: PoolSummary
  try {
    done = await waitForPool(poolId, (p) => p.state === 'distributed')
  } catch {
    const latest = await readPool(poolId)
    if (latest && latest.delivered_payout_count < latest.payout_count) throw new Error(`PARTIAL:${latest.delivered_payout_count}/${latest.payout_count}`)
    throw new Error('The network has not confirmed the payouts yet. Refresh in a few seconds.')
  }
  if (lastHash) { try { window.localStorage.setItem(distributionKey(poolId), lastHash) } catch { /* link is only a convenience */ } }
  return { pool: done, hash: lastHash }
}

/** A NEP-141 token only delivers to accounts that registered storage with it once. */
export async function usdcRegistered(accountId: string) {
  const balance = await viewCall<{ total: string } | null>(TOKEN_ACCOUNT_ID, 'storage_balance_of', { account_id: accountId })
  return balance !== null
}

export async function registerUsdc(accountId: string) {
  const { actionCreators } = await import('@near-js/transactions')
  const { wallet } = await connectTestnetWallet({})
  await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: TOKEN_ACCOUNT_ID,
    actions: [actionCreators.functionCall('storage_deposit', { account_id: accountId, registration_only: true }, 30_000_000_000_000n, 1_250_000_000_000_000_000_000n)],
  })
}

/** Decodes the base64url nonce a wallet must sign. The browser Buffer polyfill does not know the "base64url" encoding, so it is decoded by hand. */
export function nonceBuffer(value: string) {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(standard + '='.repeat((4 - standard.length % 4) % 4))
  return Buffer.from(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}
