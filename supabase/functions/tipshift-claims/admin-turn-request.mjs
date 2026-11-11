// Shared by the Edge Function and its Node tests; never imported by the browser.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid(message = 'Invalid administrative turn request.') {
  throw new TypeError(message)
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid()
  return value
}

function positiveInteger(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) invalid()
  return value
}

function base64url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function hashHex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function timestamp(value, now) {
  if (typeof value !== 'string') invalid()
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed <= now || parsed.getTime() > now.getTime() + 31 * 24 * 60 * 60 * 1000) invalid()
  return parsed.toISOString()
}

/**
 * Converts an administrator's slot-only request into the RPC payload. Tokens
 * are generated here (server-side only) and their plaintext is returned only
 * as fragment links; the RPC receives the SHA-256 hashes.
 *
 * @param {unknown} input
 * @param {{appUrl: string, now?: Date, randomValues?: (bytes: Uint8Array) => Uint8Array}} options
 */
export async function buildAdminTurnRequest(input, { appUrl, now = new Date(), randomValues = crypto.getRandomValues.bind(crypto) }) {
  if (!input || typeof input !== 'object' || !appUrl) invalid()
  const venueRef = uuid(input.venueRef)
  const branchRef = uuid(input.branchRef)
  const hasSchedule = input.scheduledStartsAt !== undefined || input.scheduledEndsAt !== undefined
  if (hasSchedule && (input.scheduledStartsAt === undefined || input.scheduledEndsAt === undefined)) invalid()
  const scheduledStartsAt = hasSchedule ? timestamp(input.scheduledStartsAt, now) : null
  const scheduledEndsAt = hasSchedule ? timestamp(input.scheduledEndsAt, now) : null
  const claimWindowEndsAt = hasSchedule ? scheduledStartsAt : timestamp(input.claimWindowEndsAt, now)
  if (scheduledStartsAt && scheduledEndsAt && (new Date(scheduledEndsAt) <= new Date(scheduledStartsAt) || new Date(scheduledEndsAt).getTime() > new Date(scheduledStartsAt).getTime() + 24 * 60 * 60 * 1000)) invalid()
  if (!Array.isArray(input.groups) || input.groups.length < 1 || input.groups.length > 20) invalid()
  if (!Array.isArray(input.recipients) || input.recipients.length < 1 || input.recipients.length > 100) invalid()

  const groupRefs = new Set()
  const groups = input.groups.map((group) => {
    if (!group || typeof group !== 'object') invalid()
    const groupRef = uuid(group.groupRef)
    if (groupRefs.has(groupRef)) invalid()
    groupRefs.add(groupRef)
    return { groupRef, shareBps: positiveInteger(group.shareBps, 10_000) }
  })
  if (groups.reduce((total, group) => total + group.shareBps, 0) !== 10_000) invalid()

  const slots = new Set()
  const recipients = input.recipients.map((recipient) => {
    if (!recipient || typeof recipient !== 'object' || !groupRefs.has(recipient.groupRef)) invalid()
    const recipientSlot = positiveInteger(recipient.recipientSlot, 10_000)
    if (slots.has(recipientSlot)) invalid()
    slots.add(recipientSlot)
    return {
      groupRef: recipient.groupRef,
      recipientSlot,
      shareWeight: positiveInteger(recipient.shareWeight, 1_000_000_000),
    }
  })

  const base = new URL(appUrl)
  const claims = []
  const claimLinks = []
  for (const recipient of recipients) {
    const bytes = new Uint8Array(32)
    randomValues(bytes)
    const token = base64url(bytes)
    const link = new URL(base)
    link.hash = `claim=${token}`
    claims.push({
      capabilityHash: await hashHex(token),
      groupRef: recipient.groupRef,
      recipientSlot: recipient.recipientSlot,
      shareWeight: recipient.shareWeight,
      expiresAt: claimWindowEndsAt,
    })
    claimLinks.push({ recipientSlot: recipient.recipientSlot, url: link.toString() })
  }

  return {
    rpcArgs: hasSchedule ? {
      p_venue_ref: venueRef,
      p_branch_ref: branchRef,
      p_claim_window_ends_at: claimWindowEndsAt,
      p_scheduled_starts_at: scheduledStartsAt,
      p_scheduled_ends_at: scheduledEndsAt,
      p_groups: groups,
      p_claims: claims,
    } : {
      p_venue_ref: venueRef,
      p_branch_ref: branchRef,
      p_claim_window_ends_at: claimWindowEndsAt,
      p_groups: groups,
      p_claims: claims,
    },
    claimLinks,
  }
}
