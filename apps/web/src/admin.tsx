import { createClient, type Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'

type Group = { groupRef: string; shareBps: number }
type Recipient = { groupRef: string; recipientSlot: number; shareWeight: number }
type ClaimLink = { recipientSlot: number; url: string }

const uuid = () => crypto.randomUUID()
const tomorrow = () => {
  const value = new Date(Date.now() + 24 * 60 * 60 * 1000)
  value.setSeconds(0, 0)
  return value.toISOString().slice(0, 16)
}

function configuredClient() {
  const url = import.meta.env.VITE_TIPSHIFT_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_TIPSHIFT_SUPABASE_ANON_KEY?.trim()
  return url && key ? createClient(url, key, { auth: { persistSession: true, detectSessionInUrl: true } }) : null
}

function updateAt<T>(items: T[], index: number, value: T) {
  return items.map((item, current) => current === index ? value : item)
}

export function AdminTurnCreator() {
  const client = useMemo(configuredClient, [])
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [venueRef, setVenueRef] = useState('')
  const [branchRef, setBranchRef] = useState('')
  const [claimWindowEndsAt, setClaimWindowEndsAt] = useState(tomorrow)
  const [groups, setGroups] = useState<Group[]>([{ groupRef: uuid(), shareBps: 10_000 }])
  const [recipients, setRecipients] = useState<Recipient[]>([{ groupRef: groups[0].groupRef, recipientSlot: 1, shareWeight: 1 }])
  const [claimLinks, setClaimLinks] = useState<ClaimLink[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!client) return
    void client.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => subscription.subscription.unsubscribe()
  }, [client])

  const sendMagicLink = async () => {
    if (!client) return
    setBusy(true); setMessage(null)
    const redirect = new URL(window.location.href)
    redirect.search = '?admin=1'
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect.toString() } })
    setBusy(false)
    setMessage(error ? 'Unable to start the private sign-in flow.' : 'Check the sign-in link sent by your identity provider.')
  }

  const createTurn = async () => {
    if (!client || !session) return
    const windowEnd = new Date(claimWindowEndsAt)
    if (!Number.isFinite(windowEnd.getTime())) {
      setMessage('Choose a valid private claim window.')
      return
    }
    setBusy(true); setMessage(null); setClaimLinks([])
    const { data, error } = await client.functions.invoke('tipshift-claims', {
      body: {
        action: 'admin_create_turn',
        venueRef,
        branchRef,
        claimWindowEndsAt: windowEnd.toISOString(),
        groups,
        recipients,
      },
    })
    setBusy(false)
    const result = data as { turnRef?: string; claimLinks?: ClaimLink[] } | null
    if (error || !result || !Array.isArray(result.claimLinks)) {
      setMessage('Turn was not created. Confirm your organization and branch scope, then review the slot distribution.')
      return
    }
    setClaimLinks(result.claimLinks)
    setMessage(`Private shift created: ${String(result.turnRef)}`)
  }

  if (!client) return <main className="private-admin"><section><p className="eyebrow">TIPSHIFT · PRIVATE ADMIN</p><h1>Configuration required</h1><p>This screen needs the public Supabase URL and anonymous key. It never accepts service-role credentials or recipient wallets.</p></section></main>
  if (!session) return <main className="private-admin"><section><p className="eyebrow">TIPSHIFT · PRIVATE ADMIN</p><h1>Private shift access</h1><p>Only an authorized ClariaLabs session can create anonymous recipient slots and private claim links.</p><label>Work email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" /></label><button className="primary" disabled={busy || !email} onClick={() => void sendMagicLink()}>Send sign-in link</button>{message && <p className="admin-message">{message}</p>}</section></main>

  const shareTotal = groups.reduce((total, group) => total + Number(group.shareBps), 0)
  return <main className="private-admin"><section>
    <header><div><p className="eyebrow">TIPSHIFT · PRIVATE ADMIN</p><h1>Create a private shift</h1></div><button className="secondary" onClick={() => void client.auth.signOut()}>Sign out</button></header>
    <p>Admins define anonymous slots, groups and shares. Recipient wallets are never requested, shown or editable here.</p>
    <div className="admin-grid"><label>Organization scope UUID<input value={venueRef} onChange={(event) => setVenueRef(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label><label>Branch scope UUID<input value={branchRef} onChange={(event) => setBranchRef(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label><label>Private claim window<input value={claimWindowEndsAt} onChange={(event) => setClaimWindowEndsAt(event.target.value)} type="datetime-local" /></label></div>
    <h2>Groups · {shareTotal / 100}% allocated</h2>
    {groups.map((group, index) => <div className="admin-row" key={group.groupRef}><code>{group.groupRef}</code><label>Basis points<input type="number" min="1" max="10000" value={group.shareBps} onChange={(event) => setGroups(updateAt(groups, index, { ...group, shareBps: Number(event.target.value) }))} /></label><button className="secondary" disabled={groups.length === 1} onClick={() => { setGroups(groups.filter((_, item) => item !== index)); setRecipients(recipients.filter((recipient) => recipient.groupRef !== group.groupRef)) }}>Remove</button></div>)}
    <button className="secondary" disabled={groups.length >= 20} onClick={() => setGroups([...groups, { groupRef: uuid(), shareBps: 1 }])}>Add group</button>
    <h2>Anonymous recipient slots</h2>
    {recipients.map((recipient, index) => <div className="admin-row" key={`${recipient.groupRef}-${recipient.recipientSlot}`}><label>Slot<input type="number" min="1" max="10000" value={recipient.recipientSlot} onChange={(event) => setRecipients(updateAt(recipients, index, { ...recipient, recipientSlot: Number(event.target.value) }))} /></label><label>Group<select value={recipient.groupRef} onChange={(event) => setRecipients(updateAt(recipients, index, { ...recipient, groupRef: event.target.value }))}>{groups.map((group) => <option key={group.groupRef} value={group.groupRef}>{group.groupRef}</option>)}</select></label><label>Weight<input type="number" min="1" value={recipient.shareWeight} onChange={(event) => setRecipients(updateAt(recipients, index, { ...recipient, shareWeight: Number(event.target.value) }))} /></label><button className="secondary" disabled={recipients.length === 1} onClick={() => setRecipients(recipients.filter((_, item) => item !== index))}>Remove</button></div>)}
    <button className="secondary" disabled={recipients.length >= 100} onClick={() => setRecipients([...recipients, { groupRef: groups[0]?.groupRef ?? '', recipientSlot: Math.max(...recipients.map((recipient) => recipient.recipientSlot)) + 1, shareWeight: 1 }])}>Add anonymous slot</button>
    <div className="actions"><button className="primary" disabled={busy || shareTotal !== 10_000 || !venueRef || !branchRef} onClick={() => void createTurn()}>Create shift and private links</button></div>
    {message && <p className="admin-message">{message}</p>}
    {claimLinks.length > 0 && <div className="claim-links"><h2>Private recipient links</h2><p>Distribute each link privately. The fragment token is never written to the server database.</p>{claimLinks.map((link) => <article key={link.recipientSlot}><strong>Anonymous slot {link.recipientSlot}</strong><a href={link.url}>{link.url}</a></article>)}</div>}
  </section></main>
}
