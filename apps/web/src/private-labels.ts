export type PrivateLabels = { groups: Record<string, string>; recipients: Record<string, string> }

const DATABASE = 'tipshift-private-ui'
const STORE = 'labels'
const KEY = 'admin-label-key-v1'
const VALUE = 'admin-labels-v1'

function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error) })
}

async function storage() {
  const open = indexedDB.open(DATABASE, 1)
  open.onupgradeneeded = () => open.result.createObjectStore(STORE)
  return request(open)
}

async function key(database: IDBDatabase) {
  const transaction = database.transaction(STORE, 'readwrite')
  const store = transaction.objectStore(STORE)
  let value = await request(store.get(KEY)) as CryptoKey | undefined
  if (!value) { value = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); store.put(value, KEY) }
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) })
  return value
}

function empty(): PrivateLabels { return { groups: {}, recipients: {} } }
function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)) }
function decode(value: string) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)) }

export async function loadPrivateLabels(): Promise<PrivateLabels> {
  try {
    const database = await storage(); const secret = await key(database)
    const transaction = database.transaction(STORE, 'readonly'); const payload = await request(transaction.objectStore(STORE).get(VALUE)) as string | undefined
    if (!payload) return empty()
    const bytes = decode(payload); const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, secret, bytes.slice(12))
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as PrivateLabels
    return parsed?.groups && parsed?.recipients ? parsed : empty()
  } catch { return empty() }
}

export async function savePrivateLabels(value: PrivateLabels) {
  const database = await storage(); const secret = await key(database); const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, secret, new TextEncoder().encode(JSON.stringify(value))))
  const payload = new Uint8Array(iv.length + ciphertext.length); payload.set(iv); payload.set(ciphertext, iv.length)
  const transaction = database.transaction(STORE, 'readwrite'); transaction.objectStore(STORE).put(encode(payload), VALUE)
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) })
}
