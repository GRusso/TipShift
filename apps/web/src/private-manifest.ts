export type ManifestGroup = { label: string; shareBps: number }
export type ManifestRecipient = { alias: string; groupIndex: number; shareBps: number }
export type PrivateTurnManifest = { version: 1; revision: string; startsAt: string; endsAt: string; groups: ManifestGroup[]; recipients: ManifestRecipient[] }
export type PrivateManifestEnvelope = { ciphertext: string; key: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const MAX_CIPHERTEXT_CHARS = 2_400
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function base64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64url(value: string) {
  if (!/^[A-Za-z0-9_-]{16,4096}$/.test(value)) throw new TypeError('Invalid private manifest.')
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  return Uint8Array.from(atob(`${normalized}${'='.repeat((4 - normalized.length % 4) % 4)}`), (character) => character.charCodeAt(0))
}

async function gzip(value: Uint8Array) {
  const stream = new Blob([value]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(value: Uint8Array) {
  const stream = new Blob([value]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function assertManifest(value: unknown): asserts value is PrivateTurnManifest {
  const manifest = value as Partial<PrivateTurnManifest>
  const startsAt = new Date(String(manifest?.startsAt ?? ''))
  const endsAt = new Date(String(manifest?.endsAt ?? ''))
  if (!manifest || manifest.version !== 1 || typeof manifest.revision !== 'string' || !UUID.test(manifest.revision) || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || endsAt.getTime() > startsAt.getTime() + 24 * 60 * 60 * 1000 || !Array.isArray(manifest.groups) || !Array.isArray(manifest.recipients) || manifest.groups.length < 1 || manifest.groups.length > 20 || manifest.recipients.length < 1 || manifest.recipients.length > 100) throw new TypeError('Invalid private manifest.')
  let groupTotal = 0
  for (const group of manifest.groups) {
    if (!group || typeof group.label !== 'string' || group.label.length > 48 || !Number.isInteger(group.shareBps) || group.shareBps < 1 || group.shareBps > 10_000) throw new TypeError('Invalid private manifest.')
    groupTotal += group.shareBps
  }
  if (groupTotal !== 10_000) throw new TypeError('Invalid private manifest.')
  const recipientTotals = Array.from({ length: manifest.groups.length }, () => 0)
  for (const recipient of manifest.recipients) {
    if (!recipient || typeof recipient.alias !== 'string' || !/^[A-Z0-9]{0,3}$/.test(recipient.alias) || !Number.isInteger(recipient.groupIndex) || recipient.groupIndex < 0 || recipient.groupIndex >= manifest.groups.length || !Number.isInteger(recipient.shareBps) || recipient.shareBps < 1 || recipient.shareBps > 10_000) throw new TypeError('Invalid private manifest.')
    recipientTotals[recipient.groupIndex] += recipient.shareBps
  }
  if (recipientTotals.some((total) => total !== 10_000)) throw new TypeError('Invalid private manifest.')
}

export function buildPrivateTurnManifest(input: { startsAt: string; endsAt: string; groups: Array<{ groupRef: string; shareBps: number }>; recipients: Array<{ groupRef: string; recipientSlot: number; shareWeight: number }>; groupLabels: Record<string, string>; recipientLabels: Record<string, string> }): PrivateTurnManifest {
  const groupIndex = new Map(input.groups.map((group, index) => [group.groupRef, index]))
  const slotCount = new Map<string, number>()
  for (const recipient of input.recipients) slotCount.set(recipient.groupRef, (slotCount.get(recipient.groupRef) ?? 0) + 1)
  const manifest: PrivateTurnManifest = {
    version: 1,
    revision: crypto.randomUUID(),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    groups: input.groups.map((group, index) => ({ label: (input.groupLabels[group.groupRef] ?? `Group ${index + 1}`).trim().slice(0, 48), shareBps: group.shareBps })),
    recipients: input.recipients.map((recipient) => ({
      alias: (input.recipientLabels[String(recipient.recipientSlot)] ?? '').trim().toUpperCase(),
      groupIndex: groupIndex.get(recipient.groupRef) ?? -1,
      shareBps: recipient.shareWeight,
    })),
  }
  assertManifest(manifest)
  return manifest
}

export async function sealPrivateManifest(manifest: PrivateTurnManifest): Promise<PrivateManifestEnvelope> {
  assertManifest(manifest)
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = await gzip(encoder.encode(JSON.stringify(manifest)))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  const payload = new Uint8Array(iv.byteLength + encrypted.byteLength)
  payload.set(iv); payload.set(encrypted, iv.byteLength)
  const ciphertext = base64url(payload)
  if (ciphertext.length > MAX_CIPHERTEXT_CHARS) throw new RangeError('The private manifest is too large for a reliable QR. Shorten group labels or reduce recipient slots.')
  return { ciphertext, key: base64url(keyBytes) }
}

export function attachPrivateManifest(url: string, envelope: PrivateManifestEnvelope) {
  const link = new URL(url)
  const fragment = new URLSearchParams(link.hash.slice(1))
  if (!fragment.get('claim')) throw new TypeError('Missing private claim capability.')
  fragment.set('pm', envelope.ciphertext)
  fragment.set('pk', envelope.key)
  link.hash = fragment.toString()
  return link.toString()
}

export async function openPrivateManifest(fragment = window.location.hash): Promise<PrivateTurnManifest | null> {
  try {
    const params = new URLSearchParams(fragment.replace(/^#/, ''))
    const ciphertext = params.get('pm'); const rawKey = params.get('pk')
    if (!ciphertext || !rawKey || ciphertext.length > MAX_CIPHERTEXT_CHARS) return null
    const payload = fromBase64url(ciphertext)
    const key = await crypto.subtle.importKey('raw', fromBase64url(rawKey), { name: 'AES-GCM' }, false, ['decrypt'])
    if (payload.byteLength < 29) return null
    const compressed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.slice(0, 12) }, key, payload.slice(12))
    const manifest = JSON.parse(decoder.decode(await gunzip(new Uint8Array(compressed))))
    assertManifest(manifest)
    return manifest
  } catch { return null }
}
