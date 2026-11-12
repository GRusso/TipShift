import { createClient, type Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'
import { toDataURL } from 'qrcode'
import { loadPrivateLabels, savePrivateLabels, type PrivateLabels } from './private-labels'
import { attachPrivateManifest, buildPrivateTurnManifest, sealPrivateManifest } from './private-manifest'

type Group = { groupRef: string; shareBps: number }
type Recipient = { groupRef: string; recipientSlot: number; shareWeight: number }
type ClaimLink = { recipientSlot: number; url: string }
type TurnStatus = { turnRef: string; state: 'claiming' | 'collecting'; recipientCount: number; verifiedCount: number; scheduledStartsAt: string; scheduledEndsAt: string }
type AdminScope = { venue_ref: string; branch_ref: string | null; branch_label: string | null; role: 'organization_admin' | 'branch_admin' }

const PERCENT_SCALE = 10_000
const uuid = () => crypto.randomUUID()
const localDateTime = (value: Date) => {
  value.setSeconds(0, 0)
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const nextShiftStart = () => localDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000))
const nextShiftEnd = () => localDateTime(new Date(Date.now() + 32 * 60 * 60 * 1000))

function configuredClient() {
  const url = import.meta.env.VITE_TIPSHIFT_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_TIPSHIFT_SUPABASE_ANON_KEY?.trim()
  return url && key ? createClient(url, key, { auth: { persistSession: true, detectSessionInUrl: true } }) : null
}

function updateAt<T>(items: T[], index: number, value: T) {
  return items.map((item, current) => current === index ? value : item)
}

function equalizeGroup(recipients: Recipient[], groupRef: string) {
  const slots = recipients.filter((recipient) => recipient.groupRef === groupRef)
  if (!slots.length) return recipients
  const base = Math.floor(PERCENT_SCALE / slots.length)
  const remainder = PERCENT_SCALE % slots.length
  let position = 0
  return recipients.map((recipient) => {
    if (recipient.groupRef !== groupRef) return recipient
    const shareWeight = base + (position < remainder ? 1 : 0)
    position += 1
    return { ...recipient, shareWeight }
  })
}

export function AdminTurnCreator() {
  const client = useMemo(configuredClient, [])
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [scopes, setScopes] = useState<AdminScope[]>([])
  const [selectedBranchRef, setSelectedBranchRef] = useState('')
  const [newBranchLabel, setNewBranchLabel] = useState('')
  const [scheduledStartsAt, setScheduledStartsAt] = useState(nextShiftStart)
  const [scheduledEndsAt, setScheduledEndsAt] = useState(nextShiftEnd)
  const [groups, setGroups] = useState<Group[]>([{ groupRef: uuid(), shareBps: 10_000 }])
  const [recipients, setRecipients] = useState<Recipient[]>([{ groupRef: groups[0].groupRef, recipientSlot: 1, shareWeight: PERCENT_SCALE }])
  const [equalSplitGroups, setEqualSplitGroups] = useState<Record<string, boolean>>({})
  const [labels, setLabels] = useState<PrivateLabels>({ groups: {}, recipients: {} })
  const [labelsReady, setLabelsReady] = useState(false)
  const [claimLinks, setClaimLinks] = useState<ClaimLink[]>([])
  const [claimQrs, setClaimQrs] = useState<Record<number, string>>({})
  const [turnRef, setTurnRef] = useState<string | null>(null)
  const [turnStatus, setTurnStatus] = useState<TurnStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!client) return
    void client.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => subscription.subscription.unsubscribe()
  }, [client])

  useEffect(() => { void loadPrivateLabels().then((value) => { setLabels(value); setLabelsReady(true) }) }, [])
  useEffect(() => { if (labelsReady) void savePrivateLabels(labels) }, [labels, labelsReady])
  useEffect(() => { void Promise.all(claimLinks.map(async (link) => [link.recipientSlot, await toDataURL(link.url, { width: 220, margin: 1 })] as const)).then((pairs) => setClaimQrs(Object.fromEntries(pairs))) }, [claimLinks])

  const refreshScopes = async () => {
    if (!client || !session) return
    const { data, error } = await client.functions.invoke('tipshift-claims', { body: { action: 'admin_scopes' } })
    const next = data as { scopes?: AdminScope[] } | null
    if (error || !next || !Array.isArray(next.scopes)) {
      // Non-sensitive diagnostic only: error class and the function's error code.
      let detail = error?.name ?? 'unexpected_response'
      const response = (error as { context?: unknown } | null)?.context
      if (response instanceof Response) {
        const body = await response.clone().json().catch(() => null) as { error?: string } | null
        detail = `${response.status} ${body?.error ?? ''}`.trim()
      }
      setMessage(`Your private branch access could not be loaded (${detail}).`)
      return
    }
    const authorizedScopes = next.scopes
    setScopes(authorizedScopes)
    const firstBranch = authorizedScopes.find((scope) => scope.branch_ref)
    setSelectedBranchRef((current) => authorizedScopes.some((scope) => scope.branch_ref === current) ? current : firstBranch?.branch_ref ?? '')
  }

  useEffect(() => {
    if (!session) { setScopes([]); setSelectedBranchRef(''); return }
    void refreshScopes()
  // The callback uses the active Supabase session; its token is the stable trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token])

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
    const scope = scopes.find((candidate) => candidate.branch_ref === selectedBranchRef)
    if (!scope?.branch_ref) {
      setMessage('Choose an authorized branch before creating a shift.')
      return
    }
    if (turnRef) {
      setMessage('This QR manifest is already locked. Create a new private shift to change its schedule or distribution.')
      return
    }
    const start = new Date(scheduledStartsAt)
    const end = new Date(scheduledEndsAt)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() > start.getTime() + 24 * 60 * 60 * 1000) {
      setMessage('Choose a valid shift: it must end after it starts and last no more than 24 hours.')
      return
    }
    let privateManifest
    try {
      privateManifest = await sealPrivateManifest(buildPrivateTurnManifest({
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        groups,
        recipients,
        groupLabels: labels.groups,
        recipientLabels: labels.recipients,
      }))
    } catch {
      setMessage('The private QR manifest is too large or invalid. Shorten group labels or reduce anonymous slots.')
      return
    }
    setBusy(true); setMessage(null); setClaimLinks([]); setClaimQrs({}); setTurnRef(null); setTurnStatus(null)
    const { data, error } = await client.functions.invoke('tipshift-claims', {
      body: {
        action: 'admin_create_turn',
        venueRef: scope.venue_ref,
        branchRef: scope.branch_ref,
        scheduledStartsAt: start.toISOString(),
        scheduledEndsAt: end.toISOString(),
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
    setClaimLinks(result.claimLinks.map((link) => ({ ...link, url: attachPrivateManifest(link.url, privateManifest) })))
    setTurnRef(result.turnRef ?? null)
    setTurnStatus(result.turnRef ? { turnRef: result.turnRef, state: 'claiming', recipientCount: result.claimLinks.length, verifiedCount: 0, scheduledStartsAt: start.toISOString(), scheduledEndsAt: end.toISOString() } : null)
    setMessage(`Private shift created: ${String(result.turnRef)}`)
  }

  const refreshTurnStatus = async () => {
    if (!client || !turnRef) return
    const { data, error } = await client.functions.invoke('tipshift-claims', { body: { action: 'admin_turn_status', turnRef } })
    const result = data as { turn?: TurnStatus } | null
    if (!error && result?.turn) setTurnStatus(result.turn)
  }
  const startTurn = async () => {
    if (!client || !turnRef) return
    setBusy(true); const { error } = await client.functions.invoke('tipshift-claims', { body: { action: 'admin_start_turn', turnRef } }); setBusy(false)
    if (error) { setMessage('Every recipient must verify before the shift can start.'); return }
    await refreshTurnStatus(); setMessage('Shift started. Groups and recipients are now locked.')
  }

  const registerBranch = async () => {
    if (!client || !session) return
    const organization = scopes.find((scope) => scope.role === 'organization_admin')
    if (!organization) {
      setMessage('Only an organization administrator can register a branch.')
      return
    }
    setBusy(true); setMessage(null)
    const { error } = await client.functions.invoke('tipshift-claims', { body: { action: 'admin_register_branch', venueRef: organization.venue_ref, branchLabel: newBranchLabel } })
    setBusy(false)
    if (error) {
      setMessage('Branch was not registered. Use a unique commercial label and try again.')
      return
    }
    setNewBranchLabel('')
    await refreshScopes()
  }

  const isEqualSplit = (groupRef: string) => equalSplitGroups[groupRef] !== false
  const setEqualSplit = (groupRef: string, enabled: boolean) => {
    setEqualSplitGroups((current) => ({ ...current, [groupRef]: enabled }))
    if (enabled) setRecipients((current) => equalizeGroup(current, groupRef))
  }
  const removeRecipient = (index: number) => {
    const groupRef = recipients[index]?.groupRef
    const next = recipients.filter((_, current) => current !== index)
    setRecipients(groupRef && isEqualSplit(groupRef) ? equalizeGroup(next, groupRef) : next)
  }
  const moveRecipient = (index: number, groupRef: string) => {
    const previousGroupRef = recipients[index]?.groupRef
    let next = updateAt(recipients, index, { ...recipients[index], groupRef })
    if (previousGroupRef && isEqualSplit(previousGroupRef)) next = equalizeGroup(next, previousGroupRef)
    if (isEqualSplit(groupRef)) next = equalizeGroup(next, groupRef)
    setRecipients(next)
  }
  const addRecipient = () => {
    const groupRef = groups[0]?.groupRef ?? ''
    const next = [...recipients, { groupRef, recipientSlot: Math.max(...recipients.map((recipient) => recipient.recipientSlot)) + 1, shareWeight: 1 }]
    setRecipients(isEqualSplit(groupRef) ? equalizeGroup(next, groupRef) : next)
  }
  const setGroupLabel = (groupRef: string, label: string) => setLabels((current) => ({ ...current, groups: { ...current.groups, [groupRef]: label } }))
  const setRecipientLabel = (slot: number, label: string) => setLabels((current) => ({ ...current, recipients: { ...current.recipients, [String(slot)]: label } }))

  if (!client) return <main className="private-admin"><section><p className="eyebrow">TIPSHIFT · PRIVATE ADMIN</p><h1>Configuration required</h1><p>This screen needs the public Supabase URL and anonymous key. It never accepts service-role credentials or recipient wallets.</p></section></main>
  if (!session) return <main className="private-admin"><section><p className="eyebrow">TIPSHIFT · PRIVATE ADMIN</p><h1>Private shift access</h1><p>Only an authorized ClariaLabs session can create anonymous recipient slots and private claim links.</p><label>Work email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" /></label><button className="primary" disabled={busy || !email} onClick={() => void sendMagicLink()}>Send sign-in link</button>{message && <p className="admin-message">{message}</p>}</section></main>

  const shareTotal = groups.reduce((total, group) => total + Number(group.shareBps), 0)
  const recipientPercentagesValid = groups.every((group) => recipients.filter((recipient) => recipient.groupRef === group.groupRef).reduce((total, recipient) => total + Number(recipient.shareWeight), 0) === PERCENT_SCALE)
  const branchScopes = scopes.filter((scope): scope is AdminScope & { branch_ref: string; branch_label: string } => Boolean(scope.branch_ref && scope.branch_label))
  const canRegisterBranch = scopes.some((scope) => scope.role === 'organization_admin')
  const configLocked = Boolean(turnRef)
  return <main className="private-admin"><section>
    <header><div><p className="eyebrow">TIPSHIFT · PRIVATE ADMIN</p><h1>Create a private shift</h1></div><button className="secondary" onClick={() => void client.auth.signOut()}>Sign out</button></header>
    <p>Admins define anonymous slots, groups and shares. Recipient wallets are never requested, shown or editable here.</p>
    {branchScopes.length > 0 ? <div className="admin-grid"><label>Authorized branch<select disabled={configLocked} value={selectedBranchRef} onChange={(event) => setSelectedBranchRef(event.target.value)}>{branchScopes.map((scope) => <option key={scope.branch_ref} value={scope.branch_ref}>{scope.branch_label}</option>)}</select></label><label>Shift starts<input disabled={configLocked} value={scheduledStartsAt} onChange={(event) => setScheduledStartsAt(event.target.value)} type="datetime-local" /></label><label>Shift ends<input disabled={configLocked} value={scheduledEndsAt} onChange={(event) => setScheduledEndsAt(event.target.value)} type="datetime-local" /></label></div> : <div className="admin-grid"><p className="admin-message">No active branch is registered for this private organization.</p></div>}
    {canRegisterBranch && <div className="admin-grid"><p className="admin-message">Organization branches: {branchScopes.length ? branchScopes.map((scope) => scope.branch_label).join(' · ') : 'none yet'}</p><label>Add a branch<input disabled={configLocked} value={newBranchLabel} onChange={(event) => setNewBranchLabel(event.target.value)} maxLength={80} placeholder="Downtown café" /></label><button className="secondary" disabled={busy || configLocked || !newBranchLabel.trim()} onClick={() => void registerBranch()}>Register branch</button></div>}
    <p className="admin-message">Recipient claims close when the shift starts. Tip collection can start only within the scheduled shift window.</p>
    <h2>Groups · {shareTotal / 100}% allocated</h2>
    {groups.map((group, index) => <div className="admin-row" key={group.groupRef}><label>Group name<input disabled={configLocked} value={labels.groups[group.groupRef] ?? ''} maxLength={48} placeholder="Waitstaff" onChange={(event) => setGroupLabel(group.groupRef, event.target.value)} /></label><label>Percentage of shift<input disabled={configLocked} type="number" min="0.01" max="100" step="0.01" value={group.shareBps / 100} onChange={(event) => setGroups(updateAt(groups, index, { ...group, shareBps: Math.round(Number(event.target.value) * 100) }))} /></label><label><input disabled={configLocked} type="checkbox" checked={isEqualSplit(group.groupRef)} onChange={(event) => setEqualSplit(group.groupRef, event.target.checked)} /> All recipients share this group equally</label><button className="secondary" disabled={configLocked || groups.length === 1} onClick={() => { setGroups(groups.filter((_, item) => item !== index)); setRecipients(recipients.filter((recipient) => recipient.groupRef !== group.groupRef)); setEqualSplitGroups((current) => ({ ...current, [group.groupRef]: false })) }}>Remove</button></div>)}
    <button className="secondary" disabled={configLocked || groups.length >= 20} onClick={() => { const groupRef = uuid(); setGroups([...groups, { groupRef, shareBps: 1 }]); setRecipients([...recipients, { groupRef, recipientSlot: Math.max(...recipients.map((recipient) => recipient.recipientSlot)) + 1, shareWeight: PERCENT_SCALE }]) }}>Add group</button>
    <h2>Anonymous recipient slots</h2>
    <p>Each recipient receives a percentage inside their group. Each group must total 100%.</p>
    {recipients.map((recipient, index) => <div className="admin-row" key={`${recipient.groupRef}-${recipient.recipientSlot}`}><label>Private alias (max. 3 letters/numbers)<input disabled={configLocked} value={labels.recipients[String(recipient.recipientSlot)] ?? ''} maxLength={3} placeholder="EJ1" onChange={(event) => setRecipientLabel(recipient.recipientSlot, event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3))} /></label><label>Group<select disabled={configLocked} value={recipient.groupRef} onChange={(event) => moveRecipient(index, event.target.value)}>{groups.map((group, groupIndex) => <option key={group.groupRef} value={group.groupRef}>{labels.groups[group.groupRef]?.trim() || `Group ${groupIndex + 1}`}</option>)}</select></label><label>Percentage within group<input type="number" min="0.01" max="100" step="0.01" disabled={configLocked || isEqualSplit(recipient.groupRef)} value={recipient.shareWeight / 100} onChange={(event) => setRecipients(updateAt(recipients, index, { ...recipient, shareWeight: Math.round(Number(event.target.value) * 100) }))} /></label><button className="secondary" disabled={configLocked || recipients.length === 1} onClick={() => removeRecipient(index)}>Remove</button></div>)}
    <button className="secondary" disabled={configLocked || recipients.length >= 100} onClick={addRecipient}>Add anonymous slot</button>
    {!recipientPercentagesValid && <p className="admin-message">Each group must allocate exactly 100% among its recipient slots.</p>}
    <div className="actions"><button className="primary" disabled={configLocked || busy || shareTotal !== PERCENT_SCALE || !recipientPercentagesValid || !selectedBranchRef} onClick={() => void createTurn()}>Create shift and private links</button></div>
    {turnStatus && <div className="admin-message"><strong>Recipient verification:</strong> {turnStatus.verifiedCount} / {turnStatus.recipientCount}. <button className="secondary" disabled={busy} onClick={() => void refreshTurnStatus()}>Refresh</button><button className="primary" disabled={busy || turnStatus.state !== 'claiming' || turnStatus.verifiedCount !== turnStatus.recipientCount} onClick={() => void startTurn()}>Start and lock shift</button></div>}
    {message && <p className="admin-message">{message}</p>}
    {claimLinks.length > 0 && <div className="claim-links"><h2>Private recipient QR codes</h2><p>Give each QR only to its assigned recipient. Its opaque capability and encrypted allocation manifest live only in the URL fragment; neither is persisted by TipShift.</p><p>These QR codes are locked to this schedule and allocation revision. To change either, create a new shift and distribute only its new links.</p>{claimLinks.map((link) => <article key={link.recipientSlot}><strong>{labels.recipients[String(link.recipientSlot)] || `Anonymous slot ${link.recipientSlot}`}</strong>{claimQrs[link.recipientSlot] && <img src={claimQrs[link.recipientSlot]} alt={`Private QR for recipient ${link.recipientSlot}`} />}<a href={link.url}>{link.url}</a></article>)}</div>}
  </section></main>
}
