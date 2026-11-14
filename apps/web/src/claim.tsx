import { createClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'
import { connectTestnetWallet, nonceBuffer } from './near'
import { openPrivateManifest, type PrivateTurnManifest } from './private-manifest'

type Claim = {
  turnRef: string
  groupRef: string
  groupShareBps: number
  recipientSlot: number
  shareWeight: number
  expiresAt: string
  state?: string
}

type OpenResponse = { claim: Claim }
type StartResponse = { claim: Claim; nonce: string; message: string; recipient: string }

function configuredClient() {
  const url = import.meta.env.VITE_TIPSHIFT_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_TIPSHIFT_SUPABASE_ANON_KEY?.trim()
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}

function fragmentToken() {
  const value = new URLSearchParams(window.location.hash.slice(1)).get('claim')
  return value && /^[A-Za-z0-9_-]{32,256}$/.test(value) ? value : null
}

export function RecipientClaim() {
  const client = useMemo(configuredClient, [])
  const [token] = useState(fragmentToken)
  const [claim, setClaim] = useState<Claim | null>(null)
  const [manifest, setManifest] = useState<PrivateTurnManifest | null>(null)
  const [message, setMessage] = useState('Loading your private recipient assignment…')
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)

  useEffect(() => {
    if (!client || !token) return
    void client.functions.invoke('tipshift-claims', { body: { action: 'open', token } }).then(({ data, error }) => {
      const response = data as OpenResponse | null
      if (error || !response?.claim) { setMessage('This private link is unavailable, expired, or has already been used.'); return }
      setClaim(response.claim)
      setMessage('Review the assignment, then connect your permanent public NEAR wallet.')
    })
  }, [client, token])

  useEffect(() => { void openPrivateManifest().then(setManifest) }, [])

  useEffect(() => {
    if (!token) return
    const safeUrl = new URL(window.location.href)
    safeUrl.hash = ''
    window.history.replaceState(null, '', safeUrl)
  }, [token])

  const signAndClaim = async () => {
    if (!client || !token || !claim) return
    setBusy(true); setMessage('Preparing a one-time NEAR signature…')
    try {
      const { data: started, error: startError } = await client.functions.invoke('tipshift-claims', { body: { action: 'start', token } })
      const proof = started as StartResponse | null
      if (startError || !proof?.nonce || !proof.message || !proof.recipient) throw new Error('This claim can no longer be signed.')
      const { wallet } = await connectTestnetWallet({})
      const signed = await wallet.signMessage({
        message: proof.message,
        recipient: proof.recipient,
        nonce: nonceBuffer(proof.nonce),
        callbackUrl: window.location.href,
      })
      if (!signed?.accountId || !signed.publicKey || !signed.signature) throw new Error('The wallet did not return a signature.')
      setMessage('Verifying wallet control…')
      const { data: finished, error: completeError } = await client.functions.invoke('tipshift-claims', {
        body: { action: 'complete', token, nonce: proof.nonce, accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature },
      })
      const response = finished as OpenResponse | null
      if (completeError || !response?.claim) throw new Error('The private claim could not be completed.')
      setClaim(response.claim); setComplete(true)
      setMessage('Your wallet is verified for this shift. The administrator cannot view or replace it.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The wallet claim could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  if (!client) return <main className="private-admin"><section><p className="eyebrow">TIPSHIFT · PRIVATE RECIPIENT</p><h1>Configuration required</h1><p>This private claim screen requires only the public Supabase URL and publishable key. It never accepts a seed phrase or private key.</p></section></main>
  if (!token) return <main className="private-admin"><section><p className="eyebrow">TIPSHIFT · PRIVATE RECIPIENT</p><h1>Private link required</h1><p>Use the one-time private link delivered by your shift administrator.</p></section></main>
  const scheduled = manifest ? `${new Date(manifest.startsAt).toLocaleString()} – ${new Date(manifest.endsAt).toLocaleString()}` : null
  return <main className="private-admin"><section><p className="eyebrow">TIPSHIFT · PRIVATE RECIPIENT</p><h1>Claim this tip assignment</h1><p>No employee name, email, or co-worker wallet is requested or revealed.</p>{manifest && <div className="private-manifest"><h2>Shift allocation overview</h2><p><strong>Scheduled shift:</strong> {scheduled}</p><p>Each listed recipient sees the same allocation overview. Wallet ownership remains private.</p><div className="rows">{manifest.groups.map((group, groupIndex) => <article key={`${manifest.revision}-${groupIndex}`}><b>{String(groupIndex + 1).padStart(2, '0')}</b><span><strong>{group.label || `Group ${groupIndex + 1}`}</strong><small>{manifest.recipients.filter((recipient) => recipient.groupIndex === groupIndex).map((recipient) => `${recipient.alias || 'Private slot'} ${recipient.shareBps / 100}%`).join(' · ')}</small></span><em>{group.shareBps / 100}% of tips</em></article>)}</div></div>}{claim && <div className="rows"><article><b>{String(claim.recipientSlot).padStart(2, '0')}</b><span><strong>Your recipient assignment</strong><small>Private shift recipient</small></span><em>{claim.groupShareBps / 100}% group share</em></article></div>}<p className="admin-message" role="status">{message}</p>{claim && !complete && <div className="actions"><button className="primary" disabled={busy} onClick={() => void signAndClaim()}>{busy ? 'Verifying…' : 'Connect NEAR wallet and sign'}</button></div>}{complete && <p className="checklist">✓ Wallet verified for this shift</p>}</section></main>
}
