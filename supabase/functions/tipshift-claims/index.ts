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
async function handleEmployeeReports(action: 'report_start' | 'report_list' | 'report_hide', payload: Record<string, unknown>) {
  const { service } = clients()
  const purpose = action === 'report_hide' ? `hide ${requiredUuid(payload.turnRef, 'turnRef')}` : 'list'
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
  const { data, error } = await service.rpc('tipshift_employee_hide_report', { p_commitments: commitments, p_turn_ref: requiredUuid(payload.turnRef, 'turnRef') })
  return error || data !== true ? null : { hidden: true }
}

async function handleAdminBranchReports(request: Request, payload: Record<string, unknown>) {
  const principal = await authenticatedAdmin(request)
  if (!principal) return { status: 401, payload: { error: 'admin_unauthorized' } }
  const { data, error } = await principal.service.rpc('tipshift_admin_branch_reports', { p_admin_user_id: principal.userId, p_branch_ref: requiredUuid(payload.branchRef, 'branchRef') })
  return error || !Array.isArray(data) ? { status: 403, payload: { error: 'reports_unavailable' } } : { status: 200, payload: { reports: data } }
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
    if (action === 'admin_reserve_place') {
      const result = await handleAdminReservePlace(request, payload)
      return json(result.payload, result.status, cors)
    }
    if (action === 'checkin_start' || action === 'checkin_complete') {
      const result = await handleCheckin(action, payload)
      return result ? json(result, 200, cors) : json({ error: 'checkin_unavailable' }, 404, cors)
    }
    if (action === 'report_start' || action === 'report_list' || action === 'report_hide') {
      const result = await handleEmployeeReports(action, payload)
      return result ? json(result, 200, cors) : json({ error: 'reports_unavailable' }, 404, cors)
    }
    if (action === 'admin_branch_reports') {
      const result = await handleAdminBranchReports(request, payload)
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
