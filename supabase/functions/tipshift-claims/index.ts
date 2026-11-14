import { JsonRpcProvider } from 'npm:near-api-js@7.4.0'
import { verifyMessage } from 'npm:near-api-js@7.4.0/nep413'
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { buildAdminTurnRequest } from './admin-turn-request.mjs'
import { buildAdminGroupTurnRequest } from './admin-group-turn-request.mjs'

const encoder = new TextEncoder()
const MAX_BODY_BYTES = 4_096
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function requiredText(value: unknown, field: string, maximum = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TypeError(`Invalid ${field}.`)
  return value.trim()
}

function requiredUuid(value: unknown, field: string) {
  const uuid = requiredText(value, field, 36)
  if (!UUID.test(uuid)) throw new TypeError(`Invalid ${field}.`)
  return uuid
}

function base64(value: unknown, field: string, urlSafe = false) {
  const raw = requiredText(value, field, 2_048)
  const normalized = (urlSafe ? raw.replaceAll('-', '+').replaceAll('_', '/') : raw).replace(/=+$/, '')
  if (!/^[A-Za-z0-9+/]+$/.test(normalized) || normalized.length % 4 === 1) throw new TypeError(`Invalid ${field}.`)
  const bytes = Uint8Array.from(atob(`${normalized}${'='.repeat((4 - normalized.length % 4) % 4)}`), (character) => character.charCodeAt(0))
  if (!bytes.byteLength) throw new TypeError(`Invalid ${field}.`)
  return bytes
}

function base64url(bytes: Uint8Array) {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function bytea(bytes: Uint8Array) {
  return `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function corsFor(request: Request): Record<string, string> | null {
  const origin = request.headers.get('origin')
  const configured = Deno.env.get('TIPSHIFT_ALLOWED_ORIGINS')?.trim() || requiredEnvironment('TIPSHIFT_ALLOWED_ORIGIN')
  const allowed = configured.split(',').map((value) => value.trim()).filter(Boolean)
  if (origin && !allowed.includes(origin)) return null
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
  } : {}
}

function json(payload: unknown, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

async function body(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) throw new TypeError('Invalid body.')
  const text = await request.text()
  if (!text || text.length > MAX_BODY_BYTES) throw new TypeError('Invalid body.')
  return JSON.parse(text)
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function importKey(name: string, algorithm: AlgorithmIdentifier | AesKeyAlgorithm | HmacImportParams, usages: KeyUsage[]) {
  const bytes = base64(requiredEnvironment(name), name, true)
  if (bytes.byteLength !== 32) throw new Error(`Invalid ${name}.`)
  return crypto.subtle.importKey('raw', bytes, algorithm, false, usages)
}

async function unsealWallet(scope: string, sealed: Uint8Array) {
  if (sealed.byteLength < 29 || sealed[0] !== 1) throw new Error('Unsupported wallet seal.')
  const key = await importKey('TIPSHIFT_WALLET_ENCRYPTION_KEY', { name: 'AES-GCM', length: 256 }, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(1, 13), additionalData: encoder.encode(`TipShift wallet seal v1\n${scope}`) }, key, sealed.slice(13))
  return new TextDecoder().decode(plain)
}

function fromBytea(value: unknown) {
  // PostgREST returns bytea as a hex string such as "\\x0102".
  const hex = String(value).replace(/^\\x/, '')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function walletCommitment(turnRef: string, accountId: string) {
  // Preserve the deployed key names and domain separation; rotating either
  // requires a deliberate migration and decryption plan, not a code deploy.
  const key = await importKey('TIPSHIFT_WALLET_COMMITMENT_KEY', { name: 'HMAC', hash: 'SHA-256' }, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`TipShift wallet seal v1\n${turnRef}\n${accountId}`)))
}

async function sealWallet(turnRef: string, accountId: string) {
  const key = await importKey('TIPSHIFT_WALLET_ENCRYPTION_KEY', { name: 'AES-GCM', length: 256 }, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`TipShift wallet seal v1\n${turnRef}`) }, key, encoder.encode(accountId)))
  const sealed = new Uint8Array(1 + iv.byteLength + ciphertext.byteLength)
  sealed[0] = 1
  sealed.set(iv, 1); sealed.set(ciphertext, 1 + iv.byteLength)
  return sealed
}

function statement(claim: Record<string, unknown>) {
  return `TipShift recipient claim for turn ${String(claim.turnRef)} and slot ${String(claim.recipientSlot)}. This signature proves control of this NEAR account for this one-time private claim.`
}

function authorizationToken(request: Request) {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function clients() {
  const url = requiredEnvironment('SUPABASE_URL')
  return {
    anonymousKey: requiredEnvironment('SUPABASE_ANON_KEY'),
    service: createClient(url, requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } }),
    url,
  }
}

async function authenticatedAdmin(request: Request) {
  const token = authorizationToken(request)
  if (!token) return null
  const { service } = clients()
  // Validate the caller's JWT against the Auth server via the service client.
  const { data, error } = await service.auth.getUser(token)
  if (error || !data.user?.id) return null
  return { service, userId: data.user.id, email: data.user.email ?? null }
}

async function assertFullAccess(provider: JsonRpcProvider, accountId: string, publicKey: string) {
  const accessKey = await provider.query({ request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey }) as { permission?: unknown }
  if (accessKey.permission !== 'FullAccess') throw new TypeError('Restricted key.')
}

async function handleClaim(action: string, payload: Record<string, unknown>) {
  const { service } = clients()
  const token = requiredText(payload.token, 'token', 256)
  const capabilityHash = bytea(await sha256(token))
  if (action === 'open') {
    const { data, error } = await service.rpc('tipshift_claim_open', { p_capability_hash: capabilityHash })
    return error || !data ? null : { claim: data }
  }
  if (action === 'start') {
    const nonce = crypto.getRandomValues(new Uint8Array(32))
    const { data, error } = await service.rpc('tipshift_claim_start', { p_capability_hash: capabilityHash, p_challenge_nonce: bytea(nonce) })
    return error || !data ? null : {
      claim: data,
      nonce: base64url(nonce),
      // NEP-413 recipient/message are public signing context, not secrets.
      message: statement(data),
      recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT'),
    }
  }
  if (action === 'complete') {
    const accountId = requiredText(payload.accountId, 'accountId', 128)
    const publicKey = requiredText(payload.publicKey, 'publicKey', 256)
    const signature = base64(payload.signature, 'signature')
    const nonce = base64(payload.nonce, 'nonce', true)
    if (nonce.byteLength !== 32) return null
    const { data: claim, error: challengeError } = await service.rpc('tipshift_claim_challenge', { p_capability_hash: capabilityHash })
    if (challengeError || !claim || claim.challengeNonce !== btoa(String.fromCharCode(...nonce))) return null
    const provider = new JsonRpcProvider({ url: requiredEnvironment('TIPSHIFT_NEAR_RPC_URL') })
    await assertFullAccess(provider, accountId, publicKey)
    await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, payload: { message: statement(claim), nonce, recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT') }, signature, provider })
    const { data, error } = await service.rpc('tipshift_claim_complete', {
      p_capability_hash: capabilityHash,
      p_challenge_nonce: bytea(nonce),
      p_wallet_commitment: bytea(await walletCommitment(String(claim.turnRef), accountId)),
      p_wallet_ciphertext: bytea(await sealWallet(String(claim.turnRef), accountId)),
    })
    return error || !data ? null : { claim: data }
  }
  return undefined
}

async function handleAdminCreateTurn(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const appUrl = Deno.env.get('TIPSHIFT_PUBLIC_APP_URL')?.trim() || requiredEnvironment('TIPSHIFT_ALLOWED_ORIGIN')
  const turn = await buildAdminTurnRequest(payload, { appUrl })
  const { data: authorized, error: authorizationError } = await principal.service.rpc('tipshift_admin_authorized', {
    p_admin_user_id: principal.userId,
    p_venue_ref: turn.rpcArgs.p_venue_ref,
    p_branch_ref: turn.rpcArgs.p_branch_ref,
  })
  if (authorizationError || authorized !== true) return { status: 403, payload: { error: 'admin_forbidden' } }
  const { data: turnRef, error } = await principal.service.rpc('tipshift_admin_create_turn', { p_admin_user_id: principal.userId, ...turn.rpcArgs })
  if (error || !turnRef) return { status: 409, payload: { error: 'turn_unavailable' } }
  const { data: opened, error: openError } = await principal.service.rpc('tipshift_admin_open_claims', { p_admin_user_id: principal.userId, p_turn_ref: turnRef })
  if (openError || opened !== true) return { status: 409, payload: { error: 'turn_unavailable' } }
  return { status: 201, payload: { turnRef, claimLinks: turn.claimLinks } }
}

async function handleAdminTurn(request: Request, payload: Record<string, unknown>, action: 'admin_turn_status' | 'admin_start_turn') {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const turnRef = requiredUuid(payload.turnRef, 'turnRef')
  if (action === 'admin_turn_status') {
    const { data, error } = await principal.service.rpc('tipshift_admin_turn_status', { p_admin_user_id: principal.userId, p_turn_ref: turnRef })
    return error || !data ? { status: 404, payload: { error: 'turn_unavailable' } } : { status: 200, payload: { turn: data } }
  }
  const { data, error } = await principal.service.rpc('tipshift_admin_start_turn', { p_admin_user_id: principal.userId, p_turn_ref: turnRef })
  return error || data !== true ? { status: 409, payload: { error: 'turn_not_ready' } } : { status: 200, payload: { started: true } }
}

async function handleAdminScopes(request: Request) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  // A pending invitation for this verified e-mail becomes the manager's branch authorization.
  if (principal.email) await principal.service.rpc('tipshift_admin_claim_invitations', { p_user_id: principal.userId, p_email: principal.email })
  await principal.service.rpc('tipshift_admin_bootstrap', { p_admin_user_id: principal.userId })
  const { data, error } = await principal.service.rpc('tipshift_admin_scopes', { p_admin_user_id: principal.userId })
  if (error || !Array.isArray(data)) return { status: 503, payload: { error: 'admin_unavailable' } }
  return { status: 200, payload: { scopes: data } }
}

async function handleAdminInviteManager(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const venueRef = requiredUuid(payload.venueRef, 'venueRef')
  const branchRef = requiredUuid(payload.branchRef, 'branchRef')
  const email = requiredText(payload.email, 'email', 254).toLowerCase()
  const { data, error } = await principal.service.rpc('tipshift_admin_invite_manager', {
    p_admin_user_id: principal.userId,
    p_venue_ref: venueRef,
    p_branch_ref: branchRef,
    p_email: email,
  })
  if (error || !Array.isArray(data) || data.length !== 1) return { status: 409, payload: { error: 'invitation_unavailable' } }
  // Sign-ups are closed on this instance, so the invitation itself must create the manager's
  // Auth user and send the e-mail. Supabase enforces its redirect allow-list on redirectTo.
  // An already-registered manager simply signs in with a magic link.
  let emailSent = false
  const origin = request.headers.get('origin')
  if (origin) {
    const { error: inviteError } = await principal.service.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/?admin=1` })
    emailSent = !inviteError
  }
  return { status: 201, payload: { invitation: data[0], emailSent } }
}

async function handleAdminRevokeManager(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const invitationId = requiredUuid(payload.invitationId, 'invitationId')
  const { data, error } = await principal.service.rpc('tipshift_admin_revoke_manager', {
    p_admin_user_id: principal.userId,
    p_invitation_id: invitationId,
  })
  if (error || !Array.isArray(data) || data.length !== 1) return { status: 409, payload: { error: 'invitation_unavailable' } }
  return { status: 200, payload: { invitation: data[0] } }
}

async function handleAdminManagerInvitations(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const venueRef = requiredUuid(payload.venueRef, 'venueRef')
  const { data, error } = await principal.service.rpc('tipshift_admin_manager_invitations', { p_admin_user_id: principal.userId, p_venue_ref: venueRef })
  if (error || !Array.isArray(data)) return { status: 503, payload: { error: 'admin_unavailable' } }
  return { status: 200, payload: { invitations: data } }
}

async function handleAdminBranchSchedule(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const branchRef = requiredUuid(payload.branchRef, 'branchRef')
  const { data, error } = await principal.service.rpc('tipshift_admin_branch_schedule', { p_admin_user_id: principal.userId, p_branch_ref: branchRef })
  if (error || !Array.isArray(data)) return { status: 503, payload: { error: 'admin_unavailable' } }
  return { status: 200, payload: { blocks: data } }
}

async function handleAdminSetBranchSchedule(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const branchRef = requiredUuid(payload.branchRef, 'branchRef')
  if (!Array.isArray(payload.blocks) || payload.blocks.length > 70) return { status: 400, payload: { error: 'schedule_invalid' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_set_branch_schedule', { p_admin_user_id: principal.userId, p_branch_ref: branchRef, p_blocks: payload.blocks })
  if (error || typeof data !== 'number' || data < 0) return { status: 409, payload: { error: 'schedule_unavailable' } }
  return { status: 200, payload: { saved: data } }
}

async function handleAdminSetOrganization(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const venueRef = requiredUuid(payload.venueRef, 'venueRef')
  const organizationName = requiredText(payload.organizationName, 'organizationName', 80)
  if (/[\u0000-\u001f\u007f]/.test(organizationName)) return { status: 400, payload: { error: 'organization_invalid' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_set_organization', {
    p_admin_user_id: principal.userId,
    p_venue_ref: venueRef,
    p_organization_name: organizationName,
  })
  if (error || !Array.isArray(data) || data.length !== 1) return { status: 409, payload: { error: 'organization_unavailable' } }
  return { status: 200, payload: { organization: data[0] } }
}

async function handleAdminRegisterBranch(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const venueRef = requiredUuid(payload.venueRef, 'venueRef')
  const branchLabel = requiredText(payload.branchLabel, 'branchLabel', 80)
  if (/[\u0000-\u001f\u007f]/.test(branchLabel)) return { status: 400, payload: { error: 'branch_invalid' } }
  // The address is optional: absent, null or blank all mean "no address".
  const rawAddress = typeof payload.branchAddress === 'string' ? payload.branchAddress.trim() : ''
  if (rawAddress.length > 160 || /[\u0000-\u001f\u007f]/.test(rawAddress)) return { status: 400, payload: { error: 'branch_invalid' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_register_branch', {
    p_admin_user_id: principal.userId,
    p_venue_ref: venueRef,
    p_branch_label: branchLabel,
    p_branch_address: rawAddress || null,
  })
  if (error || !Array.isArray(data) || data.length !== 1) return { status: 409, payload: { error: 'branch_unavailable' } }
  return { status: 201, payload: { branch: data[0] } }
}

function registrationStatement(branchRef: string) {
  return `TipShift employee registration for branch ${branchRef}. This signature proves control of this NEAR account, which will receive your tips.`
}

// Employee registration: public (the link is the capability), two steps like a claim.
async function handleRegistration(action: 'register_start' | 'register_complete', payload: Record<string, unknown>) {
  const { service } = clients()
  const capabilityHash = bytea(await sha256(requiredText(payload.token, 'token', 256)))
  if (action === 'register_start') {
    const nonce = crypto.getRandomValues(new Uint8Array(32))
    const { data, error } = await service.rpc('tipshift_registration_start', { p_capability_hash: capabilityHash, p_nonce: bytea(nonce) })
    if (error || !Array.isArray(data) || data.length !== 1) return null
    return {
      branchLabel: data[0].branch_label,
      nonce: base64url(nonce),
      message: registrationStatement(data[0].branch_ref),
      recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT'),
      branchRef: data[0].branch_ref,
    }
  }
  const accountId = requiredText(payload.accountId, 'accountId', 128)
  const publicKey = requiredText(payload.publicKey, 'publicKey', 256)
  const signature = base64(payload.signature, 'signature')
  const nonce = base64(payload.nonce, 'nonce', true)
  const initials = requiredText(payload.initials, 'initials', 4)
  const branchRef = requiredUuid(payload.branchRef, 'branchRef')
  if (nonce.byteLength !== 32) return null
  const provider = new JsonRpcProvider({ url: requiredEnvironment('TIPSHIFT_NEAR_RPC_URL') })
  await assertFullAccess(provider, accountId, publicKey)
  await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, payload: { message: registrationStatement(branchRef), nonce, recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT') }, signature, provider })
  const scope = `branch:${branchRef}`
  const { data, error } = await service.rpc('tipshift_registration_complete', {
    p_capability_hash: capabilityHash,
    p_nonce: bytea(nonce),
    p_initials: initials,
    p_wallet_commitment: bytea(await walletCommitment(scope, accountId)),
    p_wallet_ciphertext: bytea(await sealWallet(scope, accountId)),
  })
  if (error || !Array.isArray(data) || data.length !== 1) return null
  return { employee: { initials: data[0].initials, branchLabel: data[0].branch_label } }
}

async function handleAdminSetRegistrationLink(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const venueRef = requiredUuid(payload.venueRef, 'venueRef')
  const branchRef = requiredUuid(payload.branchRef, 'branchRef')
  // The manager's browser generates the link secret; only its hash is stored here.
  const token = requiredText(payload.token, 'token', 256)
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) return { status: 400, payload: { error: 'link_invalid' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_set_registration_link', {
    p_admin_user_id: principal.userId,
    p_venue_ref: venueRef,
    p_branch_ref: branchRef,
    p_capability_hash: bytea(await sha256(token)),
  })
  return error || data !== true ? { status: 409, payload: { error: 'link_unavailable' } } : { status: 200, payload: { saved: true } }
}

async function handleAdminBranchEmployees(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const branchRef = requiredUuid(payload.branchRef, 'branchRef')
  const { data, error } = await principal.service.rpc('tipshift_admin_branch_employees', { p_admin_user_id: principal.userId, p_branch_ref: branchRef })
  if (error || !Array.isArray(data)) return { status: 503, payload: { error: 'admin_unavailable' } }
  return { status: 200, payload: { employees: data } }
}

function checkinStatement(turnRef: string, groupRef: string) {
  return `TipShift shift check-in for turn ${turnRef} and group ${groupRef}. This signature proves control of this NEAR account and that you are present for this shift.`
}

// Employee check-in with the group's QR: two steps, like registration. The wallet must already
// be registered in the shift's branch; the database decides the outcome (ok / full / ...).
async function handleCheckin(action: 'checkin_start' | 'checkin_complete', payload: Record<string, unknown>) {
  const { service } = clients()
  const capabilityHash = bytea(await sha256(requiredText(payload.token, 'token', 256)))
  if (action === 'checkin_start') {
    const nonce = crypto.getRandomValues(new Uint8Array(32))
    const { data, error } = await service.rpc('tipshift_checkin_start', { p_capability_hash: capabilityHash, p_nonce: bytea(nonce) })
    if (error || !Array.isArray(data) || data.length !== 1) return null
    const row = data[0]
    return {
      turnRef: row.turn_ref, groupRef: row.group_ref, branchRef: row.branch_ref, branchLabel: row.branch_label,
      capacity: row.capacity, taken: Number(row.taken), scheduledStartsAt: row.scheduled_starts_at, scheduledEndsAt: row.scheduled_ends_at,
      nonce: base64url(nonce),
      message: checkinStatement(row.turn_ref, row.group_ref),
      recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT'),
    }
  }
  const accountId = requiredText(payload.accountId, 'accountId', 128)
  const publicKey = requiredText(payload.publicKey, 'publicKey', 256)
  const signature = base64(payload.signature, 'signature')
  const nonce = base64(payload.nonce, 'nonce', true)
  const turnRef = requiredUuid(payload.turnRef, 'turnRef')
  const groupRef = requiredUuid(payload.groupRef, 'groupRef')
  const branchRef = requiredUuid(payload.branchRef, 'branchRef')
  if (nonce.byteLength !== 32) return null
  const provider = new JsonRpcProvider({ url: requiredEnvironment('TIPSHIFT_NEAR_RPC_URL') })
  await assertFullAccess(provider, accountId, publicKey)
  await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, payload: { message: checkinStatement(turnRef, groupRef), nonce, recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT') }, signature, provider })
  // Same commitment scope as registration, so the wallet is matched to its registered employee.
  const { data, error } = await service.rpc('tipshift_checkin_complete', {
    p_capability_hash: capabilityHash,
    p_nonce: bytea(nonce),
    p_wallet_commitment: bytea(await walletCommitment(`branch:${branchRef}`, accountId)),
  })
  if (error || !Array.isArray(data) || data.length !== 1) return null
  return { status: data[0].status, initials: data[0].initials ?? null }
}

async function handleAdminCreateGroupTurn(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const appUrl = Deno.env.get('TIPSHIFT_PUBLIC_APP_URL')?.trim() || requiredEnvironment('TIPSHIFT_ALLOWED_ORIGIN')
  const turn = await buildAdminGroupTurnRequest(payload, { appUrl })
  const { data: turnRef, error } = await principal.service.rpc('tipshift_admin_create_group_turn', { p_admin_user_id: principal.userId, ...turn.rpcArgs })
  if (error || !turnRef) return { status: 409, payload: { error: 'turn_unavailable' } }
  return { status: 201, payload: { turnRef, checkinLinks: turn.checkinLinks } }
}

async function handleAdminGroupCheckins(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const turnRef = requiredUuid(payload.turnRef, 'turnRef')
  const { data, error } = await principal.service.rpc('tipshift_admin_group_checkins', { p_admin_user_id: principal.userId, p_turn_ref: turnRef })
  if (error || !Array.isArray(data)) return { status: 503, payload: { error: 'admin_unavailable' } }
  return { status: 200, payload: { checkins: data } }
}

// Manager / owner: remember which on-chain pool belongs to the location.
async function handleAdminSetBranchPool(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const branchRef = requiredUuid(payload.branchRef, 'branchRef')
  const poolId = requiredText(payload.poolId, 'poolId', 128)
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(poolId)) return { status: 400, payload: { error: 'pool_invalid' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_set_branch_pool', { p_admin_user_id: principal.userId, p_branch_ref: branchRef, p_pool_id: poolId })
  return error || data !== true ? { status: 409, payload: { error: 'pool_unavailable' } } : { status: 200, payload: { saved: true } }
}

// Owner only: unlink a location's pool so the owner can create a new one (for example if the old wallet is lost).
async function handleAdminClearBranchPool(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const branchRef = requiredUuid(payload.branchRef, 'branchRef')
  const { data, error } = await principal.service.rpc('tipshift_admin_set_branch_pool', { p_admin_user_id: principal.userId, p_branch_ref: branchRef, p_pool_id: null })
  return error || data !== true ? { status: 409, payload: { error: 'pool_unavailable' } } : { status: 200, payload: { cleared: true } }
}

// Manager closing a shift: the people who signed in and their wallets, so the on-chain roster is exactly them.
async function handleAdminTurnRoster(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const turnRef = requiredUuid(payload.turnRef, 'turnRef')
  const { data, error } = await principal.service.rpc('tipshift_admin_turn_roster', { p_admin_user_id: principal.userId, p_turn_ref: turnRef })
  if (error || !Array.isArray(data)) return { status: 503, payload: { error: 'admin_unavailable' } }
  try {
    const people = []
    for (const row of data) people.push({ groupRef: row.group_ref, shareBps: row.share_bps, employeeId: row.employee_id, wallet: await unsealWallet(`branch:${row.branch_ref}`, fromBytea(row.wallet_ciphertext)) })
    return { status: 200, payload: { roster: people } }
  } catch { return { status: 503, payload: { error: 'roster_unavailable' } } }
}

// Manager closing a shift: freezes disputes and keeps the balance that is being split; later links the on-chain transaction.
async function handleAdminCloseTurn(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const turnRef = requiredUuid(payload.turnRef, 'turnRef')
  const balance = payload.balance === undefined || payload.balance === null ? null : requiredText(payload.balance, 'balance', 30)
  if (balance !== null && !/^[0-9]{1,30}$/.test(balance)) return { status: 400, payload: { error: 'balance_invalid' } }
  const txHash = payload.txHash === undefined || payload.txHash === null ? null : requiredText(payload.txHash, 'txHash', 128)
  if (txHash !== null && !/^[A-Za-z0-9]{32,128}$/.test(txHash)) return { status: 400, payload: { error: 'tx_invalid' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_close_turn', { p_admin_user_id: principal.userId, p_turn_ref: turnRef, p_balance: balance, p_tx: txHash })
  return error || data !== true ? { status: 409, payload: { error: 'close_unavailable' } } : { status: 200, payload: { closed: true } }
}

function walletLoginStatement() {
  return 'TipShift sign-in. This signature proves control of this NEAR account; it moves no funds.'
}

// Sign in with a NEAR wallet instead of e-mail and password. The wallet signs a one-time challenge; the
// server maps the account to its own Auth user (a synthetic address that never receives mail) and returns
// a one-time token the browser exchanges for a normal session.
async function handleWalletLogin(action: 'wallet_login_start' | 'wallet_login_complete', payload: Record<string, unknown>): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { service } = clients()
  const refuse = (error: string, status = 401) => ({ status, payload: { error } })
  if (action === 'wallet_login_start') {
    const nonce = crypto.getRandomValues(new Uint8Array(32))
    const { error } = await service.rpc('tipshift_report_challenge_start', { p_nonce: bytea(nonce) })
    return error ? refuse('challenge_unavailable', 503) : { status: 200, payload: { nonce: base64url(nonce), recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT'), message: walletLoginStatement() } }
  }
  let accountId: string, publicKey: string, signature: Uint8Array, nonce: Uint8Array
  try {
    accountId = requiredText(payload.accountId, 'accountId', 64).toLowerCase()
    publicKey = requiredText(payload.publicKey, 'publicKey', 256)
    signature = base64(payload.signature, 'signature')
    nonce = base64(payload.nonce, 'nonce', true)
  } catch { return refuse('malformed_request', 400) }
  if (nonce.byteLength !== 32 || !/^[a-z0-9._-]{2,64}$/.test(accountId)) return refuse('invalid_account', 400)
  const provider = new JsonRpcProvider({ url: requiredEnvironment('TIPSHIFT_NEAR_RPC_URL') })
  try { await assertFullAccess(provider, accountId, publicKey) } catch { return refuse('restricted_key') }
  try { await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, payload: { message: walletLoginStatement(), nonce, recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT') }, signature, provider }) } catch { return refuse('bad_signature') }
  const consumed = await service.rpc('tipshift_report_challenge_consume', { p_nonce: bytea(nonce) })
  if (consumed.error || consumed.data !== true) return refuse('challenge_expired')
  const email = `${accountId}@wallet.tipshift.pages.dev`
  // Only accounts that this flow created may be signed in by it: an e-mail/password user who happened to
  // register the same synthetic address must never be taken over by a wallet (or the other way around).
  await service.auth.admin.createUser({ email, email_confirm: true, app_metadata: { wallet: accountId } })
  const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data?.properties?.hashed_token) return refuse('session_unavailable', 503)
  if (data.user?.app_metadata?.wallet !== accountId) return refuse('account_conflict')
  return { status: 200, payload: { tokenHash: data.properties.hashed_token } }
}

async function handleAdminCreateManagerInvite(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const token = requiredText(payload.token, 'token', 256)
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) return { status: 400, payload: { error: 'link_invalid' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_create_manager_invite', {
    p_admin_user_id: principal.userId,
    p_venue_ref: requiredUuid(payload.venueRef, 'venueRef'),
    p_branch_ref: requiredUuid(payload.branchRef, 'branchRef'),
    p_pseudonym: requiredText(payload.pseudonym, 'pseudonym', 3),
    p_capability_hash: bytea(await sha256(token)),
  })
  if (error || !Array.isArray(data) || data.length !== 1) return { status: 409, payload: { error: 'invitation_unavailable' } }
  return { status: 201, payload: { invitation: data[0] } }
}

function managerStatement(branchRef: string, pseudonym: string) {
  return `TipShift manager registration for branch ${branchRef} as ${pseudonym}. This signature proves control of this NEAR account, which will run this location and pay its network fees.`
}

// A manager joins a location by scanning the owner's QR and signing with a wallet; no e-mail involved.
async function handleManagerJoin(action: 'manager_join_start' | 'manager_join_complete', payload: Record<string, unknown>): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { service } = clients()
  const refuse = (error: string, status = 404) => ({ status, payload: { error } })
  const hash = bytea(await sha256(requiredText(payload.token, 'token', 256)))
  const found = await service.rpc('tipshift_manager_invite_lookup', { p_capability_hash: hash })
  if (found.error || !Array.isArray(found.data) || found.data.length !== 1) return refuse('invitation_unavailable')
  const { branch_ref: branchRef, branch_label: branchLabel, pseudonym } = found.data[0] as { branch_ref: string; branch_label: string; pseudonym: string }
  if (action === 'manager_join_start') {
    const nonce = crypto.getRandomValues(new Uint8Array(32))
    const { error } = await service.rpc('tipshift_report_challenge_start', { p_nonce: bytea(nonce) })
    if (error) return refuse('challenge_unavailable', 503)
    return { status: 200, payload: { branchLabel, pseudonym, nonce: base64url(nonce), recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT'), message: managerStatement(branchRef, pseudonym) } }
  }
  let accountId: string, publicKey: string, signature: Uint8Array, nonce: Uint8Array
  try {
    accountId = requiredText(payload.accountId, 'accountId', 64).toLowerCase()
    publicKey = requiredText(payload.publicKey, 'publicKey', 256)
    signature = base64(payload.signature, 'signature')
    nonce = base64(payload.nonce, 'nonce', true)
  } catch { return refuse('malformed_request', 400) }
  if (nonce.byteLength !== 32 || !/^[a-z0-9._-]{2,64}$/.test(accountId)) return refuse('invalid_account', 400)
  const provider = new JsonRpcProvider({ url: requiredEnvironment('TIPSHIFT_NEAR_RPC_URL') })
  try { await assertFullAccess(provider, accountId, publicKey) } catch { return refuse('restricted_key', 401) }
  try { await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, payload: { message: managerStatement(branchRef, pseudonym), nonce, recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT') }, signature, provider }) } catch { return refuse('bad_signature', 401) }
  const consumed = await service.rpc('tipshift_report_challenge_consume', { p_nonce: bytea(nonce) })
  if (consumed.error || consumed.data !== true) return refuse('challenge_expired', 401)
  const email = `${accountId}@wallet.tipshift.pages.dev`
  await service.auth.admin.createUser({ email, email_confirm: true, app_metadata: { wallet: accountId } })
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error || !link.data?.properties?.hashed_token || !link.data.user) return refuse('session_unavailable', 503)
  if (link.data.user.app_metadata?.wallet !== accountId) return refuse('account_conflict', 401)
  const claimed = await service.rpc('tipshift_manager_invite_claim', { p_capability_hash: hash, p_user_id: link.data.user.id, p_wallet: accountId })
  if (claimed.error || claimed.data !== true) return refuse('already_admin', 409)
  return { status: 200, payload: { tokenHash: link.data.properties.hashed_token, branchLabel, pseudonym, accountId } }
}

async function handleAdminBranchManager(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_branch_manager', { p_admin_user_id: principal.userId, p_branch_ref: requiredUuid(payload.branchRef, 'branchRef') })
  if (error || !Array.isArray(data)) return { status: 503, payload: { error: 'admin_unavailable' } }
  return { status: 200, payload: { manager: data[0] ?? null } }
}

async function handleManagerRequestFunds(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const amount = requiredText(payload.amount, 'amount', 30)
  if (!/^[1-9][0-9]{0,26}$/.test(amount)) return { status: 400, payload: { error: 'amount_invalid' } }
  const { data, error } = await principal.service.rpc('tipshift_manager_request_funds', { p_admin_user_id: principal.userId, p_amount_yocto: amount })
  return error || data !== true ? { status: 409, payload: { error: 'request_unavailable' } } : { status: 200, payload: { requested: true } }
}

async function handleAdminClearFunding(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_clear_funding', { p_admin_user_id: principal.userId, p_invitation_id: requiredUuid(payload.invitationId, 'invitationId') })
  return error || data !== true ? { status: 409, payload: { error: 'request_unavailable' } } : { status: 200, payload: { cleared: true } }
}

async function handleAdminReservePlace(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_reserve_place', {
    p_admin_user_id: principal.userId,
    p_turn_ref: requiredUuid(payload.turnRef, 'turnRef'),
    p_group_ref: requiredUuid(payload.groupRef, 'groupRef'),
    p_employee_id: requiredUuid(payload.employeeId, 'employeeId'),
  })
  return error || data !== true ? { status: 409, payload: { error: 'place_unavailable' } } : { status: 200, payload: { reserved: true } }
}

function reportStatement(purpose: string) {
  return `TipShift shift report access (${purpose}). This signature proves control of this NEAR account; it moves no funds.`
}

// An employee proves wallet control with a one-time signature, then sees only the reports of the
// shifts they were present for. The wallet is matched against every location's commitment.
type ReportAction = 'report_start' | 'report_list' | 'report_hide' | 'report_dispute_open' | 'report_dispute_vote' | 'report_dispute_withdraw'

// What the wallet signs for each action. The text is shown by the wallet, so it says what is being done.
function reportPurpose(action: ReportAction, payload: Record<string, unknown>) {
  if (action === 'report_hide') return `hide ${requiredUuid(payload.turnRef, 'turnRef')}`
  if (action === 'report_dispute_open') return `dispute ${requiredUuid(payload.turnRef, 'turnRef')}`
  if (action === 'report_dispute_vote') {
    const phase = payload.phase === 'correction' ? 'correction' : 'dispute'
    return `vote ${requiredUuid(payload.disputeId, 'disputeId')} ${phase} ${payload.support === true ? 'yes' : 'no'}`
  }
  if (action === 'report_dispute_withdraw') return `withdraw ${requiredUuid(payload.disputeId, 'disputeId')}`
  return 'list'
}

async function handleEmployeeReports(action: ReportAction, payload: Record<string, unknown>) {
  const { service } = clients()
  const purpose = reportPurpose(action, payload)
  if (action === 'report_start') {
    const nonce = crypto.getRandomValues(new Uint8Array(32))
    const { error } = await service.rpc('tipshift_report_challenge_start', { p_nonce: bytea(nonce) })
    return error ? null : { nonce: base64url(nonce), recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT'), messageList: reportStatement('list') }
  }
  const accountId = requiredText(payload.accountId, 'accountId', 128)
  const publicKey = requiredText(payload.publicKey, 'publicKey', 256)
  const signature = base64(payload.signature, 'signature')
  const nonce = base64(payload.nonce, 'nonce', true)
  if (nonce.byteLength !== 32) return null
  const provider = new JsonRpcProvider({ url: requiredEnvironment('TIPSHIFT_NEAR_RPC_URL') })
  await assertFullAccess(provider, accountId, publicKey)
  await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, payload: { message: reportStatement(purpose), nonce, recipient: requiredEnvironment('TIPSHIFT_NEP413_RECIPIENT') }, signature, provider })
  const consumed = await service.rpc('tipshift_report_challenge_consume', { p_nonce: bytea(nonce) })
  if (consumed.error || consumed.data !== true) return null
  const branches = await service.rpc('tipshift_all_branch_refs')
  if (branches.error || !Array.isArray(branches.data)) return null
  const commitments = await Promise.all((branches.data as string[]).map(async (branchRef) => bytea(await walletCommitment(`branch:${branchRef}`, accountId))))
  if (action === 'report_list') {
    const { data, error } = await service.rpc('tipshift_employee_reports', { p_commitments: commitments })
    return error ? null : { reports: data }
  }
  // After a dispute action the app needs the updated reports; returning them saves a second wallet signature.
  const freshReports = async () => (await service.rpc('tipshift_employee_reports', { p_commitments: commitments })).data
  if (action === 'report_dispute_open') {
    const note = typeof payload.note === 'string' ? payload.note.trim().slice(0, 280) : ''
    const { data, error } = await service.rpc('tipshift_employee_dispute_open', { p_commitments: commitments, p_turn_ref: requiredUuid(payload.turnRef, 'turnRef'), p_note: note })
    return error || typeof data !== 'string' ? null : { disputeId: data, reports: await freshReports() }
  }
  if (action === 'report_dispute_vote') {
    const { data, error } = await service.rpc('tipshift_employee_dispute_vote', { p_commitments: commitments, p_dispute_id: requiredUuid(payload.disputeId, 'disputeId'), p_phase: payload.phase === 'correction' ? 'correction' : 'dispute', p_support: payload.support === true })
    return error || data !== true ? null : { voted: true, reports: await freshReports() }
  }
  if (action === 'report_dispute_withdraw') {
    const { data, error } = await service.rpc('tipshift_employee_dispute_withdraw', { p_commitments: commitments, p_dispute_id: requiredUuid(payload.disputeId, 'disputeId') })
    return error || data !== true ? null : { withdrawn: true, reports: await freshReports() }
  }
  const { data, error } = await service.rpc('tipshift_employee_hide_report', { p_commitments: commitments, p_turn_ref: requiredUuid(payload.turnRef, 'turnRef') })
  return error || data !== true ? null : { hidden: true }
}

async function handleAdminBranchReports(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_branch_reports', { p_admin_user_id: principal.userId, p_branch_ref: requiredUuid(payload.branchRef, 'branchRef') })
  return error || !Array.isArray(data) ? { status: 403, payload: { error: 'reports_unavailable' } } : { status: 200, payload: { reports: data } }
}

async function handleAdminDisputePropose(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const shares = Array.isArray(payload.shares) ? payload.shares.slice(0, 20).map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>
    return { groupRef: requiredUuid(item.groupRef, 'groupRef'), shareBps: String(Math.trunc(Number(item.shareBps))) }
  }) : []
  const note = typeof payload.note === 'string' ? payload.note.trim().slice(0, 280) : ''
  const { data, error } = await principal.service.rpc('tipshift_admin_dispute_propose', { p_admin_user_id: principal.userId, p_dispute_id: requiredUuid(payload.disputeId, 'disputeId'), p_shares: shares, p_note: note })
  return error || data !== true ? { status: 409, payload: { error: 'dispute_unavailable' } } : { status: 200, payload: { proposed: true } }
}

async function handleAdminDeleteReport(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_delete_report', { p_admin_user_id: principal.userId, p_turn_ref: requiredUuid(payload.turnRef, 'turnRef') })
  return error || data !== true ? { status: 409, payload: { error: 'report_unavailable' } } : { status: 200, payload: { deleted: true } }
}

Deno.serve(async (request) => {
  let cors: Record<string, string>
  try {
    cors = corsFor(request) ?? {}
  } catch {
    return json({ error: 'request_unavailable' }, 503, {})
  }
  if (request.headers.get('origin') && !Object.keys(cors).length) return json({ error: 'origin_forbidden' }, 403, {})
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors)
  try {
    const payload = await body(request) as Record<string, unknown>
    const action = requiredText(payload.action, 'action', 32)
    if (action === 'admin_scopes') {
      const result = await handleAdminScopes(request)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_invite_manager') {
      const result = await handleAdminInviteManager(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_revoke_manager') {
      const result = await handleAdminRevokeManager(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_manager_invitations') {
      const result = await handleAdminManagerInvitations(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_create_manager_invite') {
      const result = await handleAdminCreateManagerInvite(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'manager_join_start' || action === 'manager_join_complete') {
      const result = await handleManagerJoin(action, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_branch_manager') {
      const result = await handleAdminBranchManager(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'manager_request_funds') {
      const result = await handleManagerRequestFunds(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_clear_funding') {
      const result = await handleAdminClearFunding(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_branch_schedule') {
      const result = await handleAdminBranchSchedule(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_set_branch_schedule') {
      const result = await handleAdminSetBranchSchedule(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_set_organization') {
      const result = await handleAdminSetOrganization(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_register_branch') {
      const result = await handleAdminRegisterBranch(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_create_group_turn') {
      const result = await handleAdminCreateGroupTurn(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_group_checkins') {
      const result = await handleAdminGroupCheckins(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_turn_roster') {
      const result = await handleAdminTurnRoster(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_set_branch_pool') {
      const result = await handleAdminSetBranchPool(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_clear_branch_pool') {
      const result = await handleAdminClearBranchPool(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_close_turn') {
      const result = await handleAdminCloseTurn(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_reserve_place') {
      const result = await handleAdminReservePlace(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'checkin_start' || action === 'checkin_complete') {
      const result = await handleCheckin(action, payload)
      return result ? json(result, 200, cors) : json({ error: 'checkin_unavailable' }, 404, cors)
    }
    if (action === 'report_start' || action === 'report_list' || action === 'report_hide' || action === 'report_dispute_open' || action === 'report_dispute_vote' || action === 'report_dispute_withdraw') {
      const result = await handleEmployeeReports(action, payload)
      return result ? json(result, 200, cors) : json({ error: 'reports_unavailable' }, 404, cors)
    }
    if (action === 'wallet_login_start' || action === 'wallet_login_complete') {
      const result = await handleWalletLogin(action, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_branch_reports') {
      const result = await handleAdminBranchReports(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_dispute_propose') {
      const result = await handleAdminDisputePropose(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_delete_report') {
      const result = await handleAdminDeleteReport(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_set_registration_link') {
      const result = await handleAdminSetRegistrationLink(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_branch_employees') {
      const result = await handleAdminBranchEmployees(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'register_start' || action === 'register_complete') {
      const result = await handleRegistration(action, payload)
      return result ? json(result, 200, cors) : json({ error: 'registration_unavailable' }, 404, cors)
    }
    if (action === 'admin_turn_status' || action === 'admin_start_turn') {
      const result = await handleAdminTurn(request, payload, action)
      return json(result.payload, result.status, cors)
    }
    if (action === 'admin_create_turn') {
      const result = await handleAdminCreateTurn(request, payload)
      return json(result.payload, result.status, cors)
    }
    const result = await handleClaim(action, payload)
    return result ? json(result, 200, cors) : json({ error: 'claim_unavailable' }, 404, cors)
  } catch {
    // Do not log capabilities, NEP-413 material, account IDs, or ciphertext.
    return json({ error: 'request_unavailable' }, 400, cors)
  }
})
