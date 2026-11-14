import { useEffect, useMemo, useState } from 'react'
import { splitShiftTips } from '../../../../../src/core/group-split.mjs'
import { connectTestnetWallet, disconnectTestnetWallet, explorerTransaction, readPool, nonceBuffer } from '../../near'
import { callTipshift, publicClient, type PublicClient } from '../client'
import { downloadCsv } from '../csv'
import { disputeRows, effectiveShares, type Dispute } from '../dispute'
import { DisputeList, OpenForm } from './Dispute'
import { useCopy, useErrorText } from '../i18n'
import { PublicFrame } from '../layout'

type Group = { groupRef: string; label: string | null; shareBps: number; signedCount: number; people: { employeeId: string; initials: string }[] }
type Report = { turnRef: string; branchLabel: string; startsAt: string; endsAt: string; poolId?: string | null; distributionTx: string | null; closed?: boolean; closingBalance?: string | null; myGroupRef: string; myEmployeeId: string; myInitials: string; groups: Group[]; disputes: Dispute[] }
type Challenge = { nonce: string; recipient: string; messageList: string }

const copy = {
  en: {
    ribbon: 'My shifts · Testnet',
    eyebrow: 'MY SHIFTS', title: 'Your earnings',
    lead: 'Sign with your wallet to see your shifts.',
    connect: 'Connect wallet', other: 'Use another wallet', working: 'Approve in your wallet…', failed: 'Couldn’t load your shifts. Use the wallet you registered with.', noSig: 'No signature received.',
    none: 'No shifts yet. Scan your group’s QR when a shift starts.',
    group: 'Group', yourShare: 'YOUR SHARE', groupTotal: 'Group total', team: 'Your group', presentIn: 'present',
    download: 'Download CSV', hide: 'Hide', hideConfirm: 'Hide this report from your view?', hideFail: 'Couldn’t hide the report.',
    actionFail: 'That didn’t work. Try again.',
    retention: 'Reports are removed after 30 days. The payout stays on-chain.', onchain: 'View on-chain ↗', balanceNote: 'Location pool balance (testnet).', poolNow: 'Tips collected so far', splitTotal: 'Total shared', closedNote: 'This shift is closed and paid. Disputes are no longer possible.',
  },
  es: {
    ribbon: 'Mis turnos · Testnet',
    eyebrow: 'MIS TURNOS', title: 'Tus ganancias',
    lead: 'Firmá con tu wallet para ver tus turnos.',
    connect: 'Conectar wallet', other: 'Usar otra wallet', working: 'Aprobá en tu wallet…', failed: 'No se pudieron cargar tus turnos. Usá la wallet con la que te registraste.', noSig: 'No se recibió la firma.',
    none: 'Todavía no hay turnos. Escaneá el QR de tu grupo cuando empiece uno.',
    group: 'Grupo', yourShare: 'TU PARTE', groupTotal: 'Total del grupo', team: 'Tu grupo', presentIn: 'presentes',
    download: 'Descargar CSV', hide: 'Ocultar', hideConfirm: '¿Ocultar este reporte de tu vista?', hideFail: 'No se pudo ocultar el reporte.',
    actionFail: 'No funcionó. Probá de nuevo.',
    retention: 'Los reportes se borran a los 30 días. El pago queda en la blockchain.', onchain: 'Ver en la blockchain ↗', poolNow: 'Propinas juntadas hasta ahora', splitTotal: 'Total repartido', closedNote: 'Este turno está cerrado y pagado. Ya no se pueden hacer disputas.', balanceNote: 'Saldo del pool del local (testnet).',
  },
}

const usdc = (value: bigint) => `USDC ${(Number(value) / 1_000_000).toFixed(2)}`
const statement = (purpose: string) => `TipShift shift report access (${purpose}). This signature proves control of this NEAR account; it moves no funds.`

async function sign(client: PublicClient, purpose: string, noSig: string) {
  const challenge = await callTipshift<Challenge>(client, { action: 'report_start', ...(purpose === 'list' ? {} : { turnRef: purpose.split(' ')[1] }) })
  if (!challenge?.nonce) throw new Error('unavailable')
  const { wallet } = await connectTestnetWallet({})
  const signed = await wallet.signMessage({ message: statement(purpose), recipient: challenge.recipient, nonce: nonceBuffer(challenge.nonce) })
  if (!signed?.accountId || !signed.publicKey || !signed.signature) throw new Error(noSig)
  return { nonce: challenge.nonce, accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature }
}

export function MyShift() {
  const c = useCopy(copy)
  const errText = useErrorText()
  const client = useMemo(publicClient, [])
  const [reports, setReports] = useState<Report[] | null>(null)
  const [balances, setBalances] = useState<Record<string, bigint>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const poolIds = [...new Set((reports ?? []).map((r) => r.poolId).filter((x): x is string => Boolean(x)))].join(',')
  useEffect(() => {
    if (!poolIds) return
    const read = () => poolIds.split(',').forEach((id) => void readPool(id).then((p) => setBalances((cur) => ({ ...cur, [id]: p ? BigInt(p.balance) : 0n }))).catch(() => undefined))
    read(); const t = window.setInterval(read, 10_000); return () => window.clearInterval(t)
  }, [poolIds])
  const liveBalance = (report: Report) => (report.poolId ? balances[report.poolId] : undefined) ?? 0n

  const switchWallet = async () => { await disconnectTestnetWallet().catch(() => undefined); setReports(null); setMessage('') }

  const load = async () => {
    if (!client) return
    setBusy(true); setMessage('')
    try {
      const proof = await sign(client, 'list', c.noSig)
      const r = await callTipshift<{ reports: Report[] }>(client, { action: 'report_list', ...proof })
      if (!r?.reports) throw new Error(c.failed)
      setReports(r.reports)
    } catch (e) { setMessage(e instanceof Error && e.message !== 'unavailable' ? errText(e, c.failed) : c.failed) }
    finally { setBusy(false) }
  }
  const hide = async (report: Report) => {
    if (!client || !window.confirm(c.hideConfirm)) return
    setBusy(true); setMessage('')
    try {
      const proof = await sign(client, `hide ${report.turnRef}`, c.noSig)
      const r = await callTipshift(client, { action: 'report_hide', turnRef: report.turnRef, ...proof })
      if (!r) throw new Error(c.hideFail)
      setReports((cur) => (cur ?? []).filter((x) => x.turnRef !== report.turnRef))
    } catch (e) { setMessage(e instanceof Error && e.message !== 'unavailable' ? errText(e, c.hideFail) : c.hideFail) }
    finally { setBusy(false) }
  }

  // Every dispute action is signed with the wallet; the server answers with the updated reports.
  const act = async (purpose: string, body: Record<string, unknown>) => {
    if (!client) return
    setBusy(true); setMessage('')
    try {
      const proof = await sign(client, purpose, c.noSig)
      const r = await callTipshift<{ reports?: Report[] }>(client, { ...body, ...proof })
      if (!r) throw new Error(c.actionFail)
      if (Array.isArray(r.reports)) setReports(r.reports)
    } catch (e) { setMessage(e instanceof Error && e.message !== 'unavailable' ? errText(e, c.actionFail) : c.actionFail) }
    finally { setBusy(false) }
  }
  const compute = (report: Report) => splitShiftTips({ balance: report.closed && report.closingBalance ? BigInt(report.closingBalance) : liveBalance(report), groups: effectiveShares(report.groups, report.disputes).map((g) => ({
    groupRef: g.groupRef, shareBps: g.shareBps,
    // Other groups only expose a headcount; any distinct ids give the same group totals.
    employeeIds: g.groupRef === report.myGroupRef ? g.people.map((p) => p.employeeId) : Array.from({ length: g.signedCount }, (_, i) => `${g.groupRef}:${i}`),
  })) })
  const time = (v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const download = (report: Report) => {
    const mine = compute(report).find((g) => g.groupRef === report.myGroupRef)
    const group = report.groups.find((g) => g.groupRef === report.myGroupRef)
    downloadCsv(`tipshift-my-shift-${report.startsAt.slice(0, 10)}.csv`, [['location', 'shift_start', 'shift_end', 'group', 'initials', 'amount_usdc'],
      ...(mine?.people ?? []).map((p) => [report.branchLabel, report.startsAt, report.endsAt, group?.label ?? '', group?.people.find((x) => x.employeeId === p.employeeId)?.initials ?? '', (Number(p.amount) / 1_000_000).toFixed(6)]),
      ...disputeRows(report.disputes, (ref) => report.groups.find((g) => g.groupRef === ref)?.label ?? '')])
  }

  return <PublicFrame ribbon={c.ribbon}><div className="ts-solo" style={{ maxWidth: 720 }}>
    <div className="ts-card">
      <p className="ts-eyebrow">{c.eyebrow}</p>
      <h1 className="ts-h2">{c.title}</h1>
      <p className="ts-lead" style={{ fontSize: 14 }}>{c.lead}</p>
      {message && <div className="ts-notice bad" role="alert">{message}</div>}
      {!reports && <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !client} onClick={() => void load()}>{busy ? c.working : c.connect}</button></div>}
      {reports && <div className="ts-actions"><button className="ts-btn small" onClick={() => void switchWallet()}>{c.other}</button></div>}
    </div>
    {reports && reports.length === 0 && <div className="ts-notice">{c.none}</div>}
    {(reports ?? []).map((report) => {
      const result = compute(report)
      const mine = result.find((g) => g.groupRef === report.myGroupRef)
      const myGroup = report.groups.find((g) => g.groupRef === report.myGroupRef)
      const myAmount = mine?.people.find((p) => p.employeeId === report.myEmployeeId)?.amount ?? 0n
      return <div className="ts-card" key={report.turnRef} style={{ marginTop: 16 }}>
        <div className="ts-top" style={{ marginBottom: 10 }}><div><p className="ts-eyebrow">{report.branchLabel} · {myGroup?.label || c.group}</p><h2 style={{ fontSize: 20, margin: 0 }}>{new Date(report.startsAt).toLocaleDateString()} · {time(report.startsAt)}–{time(report.endsAt)}</h2></div></div>
        <div className="ts-stat" style={{ marginBottom: 12 }}><span>{report.closed ? c.splitTotal : c.poolNow}</span><strong>{usdc(report.closed && report.closingBalance ? BigInt(report.closingBalance) : liveBalance(report))}</strong></div>
        <div className="ts-grid2">
          <div className="ts-stat"><span>{c.yourShare}</span><strong style={{ fontSize: 34 }}>{usdc(myAmount)}</strong></div>
          <div className="ts-stat"><span>{c.groupTotal}</span><strong>{usdc(mine?.amount ?? 0n)}</strong></div>
        </div>
        <p className="ts-muted" style={{ marginTop: 14 }}>{c.team}: {(myGroup?.people ?? []).map((p) => p.initials).join(' · ')}</p>
        {!report.closed && <p className="ts-muted" style={{ fontSize: 11 }}>{c.balanceNote}</p>}
        {report.distributionTx && <p style={{ marginTop: 10 }}><a href={explorerTransaction(report.distributionTx)} target="_blank" rel="noreferrer">{c.onchain}</a></p>}
        <div className="ts-actions">
          <button className="ts-btn quiet small" onClick={() => download(report)}>{c.download}</button>
          <button className="ts-btn danger small" disabled={busy} onClick={() => void hide(report)}>{c.hide}</button>
        </div>
        <div className="ts-actions">{!report.closed && !(report.disputes ?? []).some((d) => d.state === 'voting' || d.state === 'accepted' || d.state === 'correction_voting') && <OpenForm busy={busy} onOpen={(note) => void act(`dispute ${report.turnRef}`, { action: 'report_dispute_open', turnRef: report.turnRef, note })} />}</div>
        {report.closed && <p className="ts-muted" style={{ marginTop: 10 }}>{c.closedNote}</p>}
        {(report.disputes ?? []).length > 0 && <DisputeList disputes={report.disputes} busy={busy}
          groups={report.groups.map((g, i) => ({ groupRef: g.groupRef, label: g.label || `${c.group} ${i + 1}`, shareBps: g.shareBps }))}
          onVote={(d, phase, support) => void act(`vote ${d.disputeId} ${phase} ${support ? 'yes' : 'no'}`, { action: 'report_dispute_vote', disputeId: d.disputeId, phase, support })}
          onWithdraw={(d) => void act(`withdraw ${d.disputeId}`, { action: 'report_dispute_withdraw', disputeId: d.disputeId })} />}
      </div>
    })}
    {reports && <p className="ts-muted" style={{ fontSize: 12, marginTop: 14 }}>{c.retention}</p>}
  </div></PublicFrame>
}
