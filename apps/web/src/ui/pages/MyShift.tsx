import { Buffer } from 'buffer'
import { useEffect, useMemo, useState } from 'react'
import { splitShiftTips } from '../../../../../src/core/group-split.mjs'
import { connectTestnetWallet, explorerTransaction, readDemoPool } from '../../near'
import { callTipshift, publicClient, type PublicClient } from '../client'
import { downloadCsv } from '../csv'
import { useCopy } from '../i18n'
import { PublicFrame } from '../layout'

type Group = { groupRef: string; label: string | null; shareBps: number; signedCount: number; people: { employeeId: string; initials: string }[] }
type Report = { turnRef: string; branchLabel: string; startsAt: string; endsAt: string; distributionTx: string | null; myGroupRef: string; myEmployeeId: string; myInitials: string; groups: Group[] }
type Challenge = { nonce: string; recipient: string; messageList: string }

const copy = {
  en: {
    ribbon: 'MY SHIFTS · Testnet',
    eyebrow: 'EMPLOYEE VIEW', title: 'What I earned in my shifts',
    lead: 'Sign with the wallet you registered to see the shifts you were present for. Your manager never sees your wallet.',
    connect: 'Connect wallet and see my shifts', working: 'Waiting for your wallet…', failed: 'Your shifts could not be loaded. Use the wallet you registered with.', noSig: 'The wallet did not return a signature.',
    none: 'No shifts to show. Check in with your group’s QR at the start of a shift.',
    group: 'Group', yourShare: 'YOUR SHARE', groupTotal: 'Group total', team: 'Your group', presentIn: 'present in your group',
    download: 'Download CSV', hide: 'Hide', hideConfirm: 'Hide this report from your view? It does not delete it for the business.', hideFail: 'The report could not be hidden.',
    dispute: 'Dispute this distribution', disputeSoon: 'Disputes with team voting arrive in the next version.',
    retention: 'Reports disappear automatically 30 days after the shift. The final distribution stays on-chain.', onchain: 'Distribution on-chain ↗', balanceNote: 'Based on the demonstration pool balance (testnet).',
  },
  es: {
    ribbon: 'MIS TURNOS · Testnet',
    eyebrow: 'VISTA DEL EMPLEADO', title: 'Lo que gané en mis turnos',
    lead: 'Firmá con la wallet que registraste para ver los turnos en los que estuviste presente. Tu gerente nunca ve tu wallet.',
    connect: 'Conectar wallet y ver mis turnos', working: 'Esperando tu wallet…', failed: 'No se pudieron cargar tus turnos. Usá la wallet con la que te registraste.', noSig: 'La wallet no devolvió una firma.',
    none: 'No hay turnos para mostrar. Hacé el check-in con el QR de tu grupo al comenzar un turno.',
    group: 'Grupo', yourShare: 'TU PARTE', groupTotal: 'Total del grupo', team: 'Tu grupo', presentIn: 'presentes en tu grupo',
    download: 'Descargar CSV', hide: 'Ocultar', hideConfirm: '¿Ocultar este reporte de tu vista? No lo elimina para el local.', hideFail: 'No se pudo ocultar el reporte.',
    dispute: 'Disputar este reparto', disputeSoon: 'Las disputas con votación del equipo llegan en la próxima versión.',
    retention: 'Los reportes desaparecen solos 30 días después del turno. La distribución final queda en la blockchain.', onchain: 'Distribución en la blockchain ↗', balanceNote: 'Calculado con el saldo del pool de demostración (testnet).',
  },
}

const usdc = (value: bigint) => `USDC ${(Number(value) / 1_000_000).toFixed(2)}`
const statement = (purpose: string) => `TipShift shift report access (${purpose}). This signature proves control of this NEAR account; it moves no funds.`

async function sign(client: PublicClient, purpose: string, noSig: string) {
  const challenge = await callTipshift<Challenge>(client, { action: 'report_start', ...(purpose === 'list' ? {} : { turnRef: purpose.split(' ')[1] }) })
  if (!challenge?.nonce) throw new Error('unavailable')
  const { wallet } = await connectTestnetWallet({})
  const signed = await wallet.signMessage({ message: statement(purpose), recipient: challenge.recipient, nonce: Buffer.from(challenge.nonce, 'base64url'), callbackUrl: window.location.href })
  if (!signed?.accountId || !signed.publicKey || !signed.signature) throw new Error(noSig)
  return { nonce: challenge.nonce, accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature }
}

export function MyShift() {
  const c = useCopy(copy)
  const client = useMemo(publicClient, [])
  const [reports, setReports] = useState<Report[] | null>(null)
  const [balance, setBalance] = useState(0n)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { void readDemoPool().then((p) => setBalance(p ? BigInt(p.balance) : 0n)).catch(() => undefined) }, [])

  const load = async () => {
    if (!client) return
    setBusy(true); setMessage('')
    try {
      const proof = await sign(client, 'list', c.noSig)
      const r = await callTipshift<{ reports: Report[] }>(client, { action: 'report_list', ...proof })
      if (!r?.reports) throw new Error(c.failed)
      setReports(r.reports)
    } catch (e) { setMessage(e instanceof Error && e.message !== 'unavailable' ? e.message : c.failed) }
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
    } catch (e) { setMessage(e instanceof Error && e.message !== 'unavailable' ? e.message : c.hideFail) }
    finally { setBusy(false) }
  }

  const compute = (report: Report) => splitShiftTips({ balance, groups: report.groups.map((g) => ({
    groupRef: g.groupRef, shareBps: g.shareBps,
    // Other groups only expose a headcount; any distinct ids give the same group totals.
    employeeIds: g.groupRef === report.myGroupRef ? g.people.map((p) => p.employeeId) : Array.from({ length: g.signedCount }, (_, i) => `${g.groupRef}:${i}`),
  })) })
  const time = (v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const download = (report: Report) => {
    const mine = compute(report).find((g) => g.groupRef === report.myGroupRef)
    const group = report.groups.find((g) => g.groupRef === report.myGroupRef)
    downloadCsv(`tipshift-my-shift-${report.startsAt.slice(0, 10)}.csv`, [['location', 'shift_start', 'shift_end', 'group', 'initials', 'amount_usdc'],
      ...(mine?.people ?? []).map((p) => [report.branchLabel, report.startsAt, report.endsAt, group?.label ?? '', group?.people.find((x) => x.employeeId === p.employeeId)?.initials ?? '', (Number(p.amount) / 1_000_000).toFixed(6)])])
  }

  return <PublicFrame ribbon={c.ribbon}><div className="ts-solo" style={{ maxWidth: 720 }}>
    <div className="ts-card">
      <p className="ts-eyebrow">{c.eyebrow}</p>
      <h1 className="ts-h2">{c.title}</h1>
      <p className="ts-lead" style={{ fontSize: 14 }}>{c.lead}</p>
      {message && <div className="ts-notice bad" role="alert">{message}</div>}
      {!reports && <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !client} onClick={() => void load()}>{busy ? c.working : c.connect}</button></div>}
    </div>
    {reports && reports.length === 0 && <div className="ts-notice">{c.none}</div>}
    {(reports ?? []).map((report) => {
      const result = compute(report)
      const mine = result.find((g) => g.groupRef === report.myGroupRef)
      const myGroup = report.groups.find((g) => g.groupRef === report.myGroupRef)
      const myAmount = mine?.people.find((p) => p.employeeId === report.myEmployeeId)?.amount ?? 0n
      return <div className="ts-card" key={report.turnRef} style={{ marginTop: 16 }}>
        <div className="ts-top" style={{ marginBottom: 10 }}><div><p className="ts-eyebrow">{report.branchLabel} · {myGroup?.label || c.group}</p><h2 style={{ fontSize: 20, margin: 0 }}>{new Date(report.startsAt).toLocaleDateString()} · {time(report.startsAt)}–{time(report.endsAt)}</h2></div></div>
        <div className="ts-grid2">
          <div className="ts-stat"><span>{c.yourShare}</span><strong style={{ fontSize: 34 }}>{usdc(myAmount)}</strong></div>
          <div className="ts-stat"><span>{c.groupTotal}</span><strong>{usdc(mine?.amount ?? 0n)}</strong></div>
        </div>
        <p className="ts-muted" style={{ marginTop: 14 }}>{c.team}: {(myGroup?.people ?? []).map((p) => p.initials).join(' · ')}</p>
        <p className="ts-muted" style={{ fontSize: 11 }}>{c.balanceNote}</p>
        {report.distributionTx && <p style={{ marginTop: 10 }}><a href={explorerTransaction(report.distributionTx)} target="_blank" rel="noreferrer">{c.onchain}</a></p>}
        <div className="ts-actions">
          <button className="ts-btn quiet small" onClick={() => download(report)}>{c.download}</button>
          <button className="ts-btn quiet small" disabled title={c.disputeSoon}>{c.dispute}</button>
          <button className="ts-btn danger small" disabled={busy} onClick={() => void hide(report)}>{c.hide}</button>
        </div>
        <p className="ts-muted" style={{ fontSize: 11, marginTop: 10 }}>{c.disputeSoon}</p>
      </div>
    })}
    {reports && <p className="ts-muted" style={{ fontSize: 12, marginTop: 14 }}>{c.retention}</p>}
  </div></PublicFrame>
}
