// Shared by the Edge Function and its Node tests; never imported by the browser.
// Builds the RPC payload for a shift with one check-in QR per group. Tokens are generated
// here; the database receives only their SHA-256 hashes and the plaintext leaves only as links.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid() {
  throw new TypeError('Invalid group turn request.')
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid()
  return value
}

function integerBetween(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid()
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

// A shift may have started already (late set-up), at most 24 h ago; it must end in the future.
function timestamp(value, now, allowPast) {
  if (typeof value !== 'string') invalid()
  const parsed = new Date(value)
  const earliest = allowPast ? now.getTime() - 24 * 60 * 60 * 1000 : now.getTime()
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= earliest || parsed.getTime() > now.getTime() + 31 * 24 * 60 * 60 * 1000) invalid()
  return parsed.toISOString()
}

/**
 * @param {unknown} input
 * @param {{appUrl: string, now?: Date, randomValues?: (bytes: Uint8Array) => Uint8Array}} options
 */
export async function buildAdminGroupTurnRequest(input, { appUrl, now = new Date(), randomValues = crypto.getRandomValues.bind(crypto) }) {
  if (!input || typeof input !== 'object' || !appUrl) invalid()
  const venueRef = uuid(input.venueRef)
  const branchRef = uuid(input.branchRef)
  const scheduledStartsAt = timestamp(input.scheduledStartsAt, now, true)
  const scheduledEndsAt = timestamp(input.scheduledEndsAt, now, false)
  const startsMs = new Date(scheduledStartsAt).getTime()
  const endsMs = new Date(scheduledEndsAt).getTime()
  if (endsMs <= startsMs || endsMs > startsMs + 24 * 60 * 60 * 1000) invalid()
  if (!Array.isArray(input.groups) || input.groups.length < 1 || input.groups.length > 20) invalid()

  const seen = new Set()
  const groups = input.groups.map((group) => {
    if (!group || typeof group !== 'object') invalid()
    const groupRef = uuid(group.groupRef)
    if (seen.has(groupRef)) invalid()
    seen.add(groupRef)
    // The group name is optional and only used to label reports; it is limited to 48 characters.
    const label = typeof group.label === 'string' ? group.label.trim().slice(0, 48) : ''
    return { groupRef, shareBps: integerBetween(group.shareBps, 1, 10_000), capacity: integerBetween(group.capacity, 1, 100), label }
  })
  if (groups.reduce((total, group) => total + group.shareBps, 0) !== 10_000) invalid()

  const base = new URL(appUrl)
  const links = []
  const checkinLinks = []
  for (const group of groups) {
    const bytes = new Uint8Array(32)
    randomValues(bytes)
    const token = base64url(bytes)
    const url = new URL(base)
    url.hash = `checkin=${token}`
    links.push({ capabilityHash: await hashHex(token), groupRef: group.groupRef, capacity: group.capacity })
    checkinLinks.push({ groupRef: group.groupRef, url: url.toString() })
  }

  return {
    rpcArgs: {
      p_venue_ref: venueRef,
      p_branch_ref: branchRef,
      p_scheduled_starts_at: scheduledStartsAt,
      p_scheduled_ends_at: scheduledEndsAt,
      p_groups: groups.map(({ groupRef, shareBps, label }) => (label ? { groupRef, shareBps, label } : { groupRef, shareBps })),
      p_links: links,
    },
    checkinLinks,
  }
}
