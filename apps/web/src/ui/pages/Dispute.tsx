import { useState } from 'react'
import { isOpen, type Dispute } from '../dispute'
import { useCopy } from '../i18n'

const copy = {
  en: {
    title: 'Disputes', open: 'Dispute this split', notePh: 'What looks wrong? (optional)', send: 'Send objection', cancel: 'Cancel',
    state: { voting: 'The team is voting', accepted: 'Objection accepted. Waiting for the manager’s proposal.', rejected: 'Objection rejected. The split stands.', withdrawn: 'Withdrawn.', correction_voting: 'The team is voting on the corrected split', corrected: 'Corrected split applied', correction_rejected: 'Correction rejected. The original split stands.' },
    agree: 'Agree', disagree: 'Disagree', withdraw: 'Withdraw', voted: 'You voted', counts: (y: number, n: number, e: number) => `${y} agree · ${n} disagree · ${e} present`,
    rule: 'More than half of the people present must agree.', proposed: 'Proposed split', note: 'Manager’s note', opened: 'Opened', yours: 'Yours',
    propose: 'Propose a corrected split', percent: '% of tips', proposalPh: 'Why? (optional)', sendProposal: 'Send proposal', sum: 'Must add up to 100%.', waiting: 'Waiting for your proposal.',
    why: 'Employees who were present can object. The team votes, and the result is recorded in this report.',
  },
  es: {
    title: 'Disputas', open: 'Disputar este reparto', notePh: '¿Qué te parece mal? (opcional)', send: 'Enviar objeción', cancel: 'Cancelar',
    state: { voting: 'El equipo está votando', accepted: 'Objeción aceptada. Esperando la propuesta del gerente.', rejected: 'Objeción rechazada. El reparto se mantiene.', withdrawn: 'Retirada.', correction_voting: 'El equipo está votando el reparto corregido', corrected: 'Reparto corregido aplicado', correction_rejected: 'Corrección rechazada. Se mantiene el reparto original.' },
    agree: 'De acuerdo', disagree: 'En desacuerdo', withdraw: 'Retirar', voted: 'Ya votaste', counts: (y: number, n: number, e: number) => `${y} a favor · ${n} en contra · ${e} presentes`,
    rule: 'Hace falta más de la mitad de los presentes.', proposed: 'Reparto propuesto', note: 'Nota del gerente', opened: 'Abierta', yours: 'Tuya',
    propose: 'Proponer un reparto corregido', percent: '% de propinas', proposalPh: '¿Por qué? (opcional)', sendProposal: 'Enviar propuesta', sum: 'Debe sumar 100%.', waiting: 'Esperando tu propuesta.',
    why: 'Quien estuvo presente puede objetar. El equipo vota y el resultado queda en este reporte.',
  },
}

type Actions = {
  busy: boolean
  onOpen?: (note: string) => void
  onVote?: (d: Dispute, phase: 'dispute' | 'correction', support: boolean) => void
  onWithdraw?: (d: Dispute) => void
  onPropose?: (d: Dispute, shares: { groupRef: string; shareBps: number }[], note: string) => void
}

export function OpenForm({ busy, onOpen }: { busy: boolean; onOpen: (note: string) => void }) {
  const c = useCopy(copy)
  const [show, setShow] = useState(false)
  const [note, setNote] = useState('')
  if (!show) return <button className="ts-btn quiet small" disabled={busy} onClick={() => setShow(true)}>{c.open}</button>
  return <div style={{ width: '100%' }}>
    <textarea className="ts-input" rows={2} maxLength={280} value={note} placeholder={c.notePh} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} />
    <div className="ts-actions" style={{ marginTop: 8 }}>
      <button className="ts-btn primary small" disabled={busy} onClick={() => { onOpen(note); setShow(false); setNote('') }}>{c.send}</button>
      <button className="ts-btn quiet small" onClick={() => setShow(false)}>{c.cancel}</button>
    </div>
  </div>
}

function Propose({ d, groups, busy, onPropose }: { d: Dispute; groups: { groupRef: string; label: string; shareBps: number }[]; busy: boolean; onPropose: NonNullable<Actions['onPropose']> }) {
  const c = useCopy(copy)
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((g) => [g.groupRef, String(g.shareBps / 100)])))
  const [note, setNote] = useState('')
  const total = Math.round(groups.reduce((sum, g) => sum + (Number(values[g.groupRef]) || 0) * 100, 0))
  const ok = total === 10000
  return <div style={{ marginTop: 10 }}>
    <p className="ts-muted">{c.propose}</p>
    {groups.map((g) => <label key={g.groupRef} className="ts-row" style={{ gridTemplateColumns: '1fr 110px' }}>
      <span>{g.label} <small>{c.percent}</small></span>
      <input className="ts-input" type="number" min={0} max={100} step={0.01} value={values[g.groupRef]} onChange={(e) => setValues({ ...values, [g.groupRef]: e.target.value })} />
    </label>)}
    {!ok && <div className="ts-notice bad">{c.sum}</div>}
    <input className="ts-input" maxLength={280} value={note} placeholder={c.proposalPh} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
    <div className="ts-actions" style={{ marginTop: 8 }}>
      <button className="ts-btn primary small" disabled={busy || !ok} onClick={() => onPropose(d, groups.map((g) => ({ groupRef: g.groupRef, shareBps: Math.round((Number(values[g.groupRef]) || 0) * 100) })), note)}>{c.sendProposal}</button>
    </div>
  </div>
}

/** The history of disputes of one shift, newest first. Employees get vote buttons, managers get the proposal form. */
export function DisputeList({ disputes, groups, ...actions }: { disputes: Dispute[]; groups: { groupRef: string; label: string; shareBps: number }[] } & Actions) {
  const c = useCopy(copy)
  const label = (ref: string) => groups.find((g) => g.groupRef === ref)?.label ?? ''
  return <div style={{ marginTop: 14 }}>
    {disputes.map((d) => <div key={d.disputeId} className="ts-notice" style={{ display: 'block' }}>
      <span className={`ts-status${d.state === 'rejected' || d.state === 'correction_rejected' ? ' bad' : isOpen(d) ? ' wait' : ''}`}>{c.state[d.state]}</span>
      <p style={{ margin: '8px 0 0' }}>{d.note ? `“${d.note}”` : ''} <small className="ts-muted">{c.opened} {new Date(d.createdAt).toLocaleString()}{d.mine?.opener ? ` · ${c.yours}` : ''}</small></p>
      <p className="ts-muted" style={{ margin: '4px 0 0' }}>{c.counts(d.disputeYes, d.disputeNo, d.eligible)}{d.state === 'voting' ? ` · ${c.rule}` : ''}</p>
      {d.proposedShares && <p style={{ margin: '8px 0 0' }}><strong>{c.proposed}:</strong> {d.proposedShares.map((s) => `${label(s.groupRef)} ${(Number(s.shareBps) / 100).toFixed(0)}%`).join(' · ')}{d.proposalNote ? ` · ${c.note}: “${d.proposalNote}”` : ''}
        <span className="ts-muted"> · {c.counts(d.correctionYes, d.correctionNo, d.eligible)}</span></p>}
      {d.mine && <div className="ts-actions" style={{ marginTop: 8 }}>
        {d.state === 'voting' && (d.mine.disputeVote === null
          ? <><button className="ts-btn primary small" disabled={actions.busy} onClick={() => actions.onVote?.(d, 'dispute', true)}>{c.agree}</button><button className="ts-btn quiet small" disabled={actions.busy} onClick={() => actions.onVote?.(d, 'dispute', false)}>{c.disagree}</button></>
          : <span className="ts-muted">{c.voted}</span>)}
        {d.state === 'correction_voting' && (d.mine.correctionVote === null
          ? <><button className="ts-btn primary small" disabled={actions.busy} onClick={() => actions.onVote?.(d, 'correction', true)}>{c.agree}</button><button className="ts-btn quiet small" disabled={actions.busy} onClick={() => actions.onVote?.(d, 'correction', false)}>{c.disagree}</button></>
          : <span className="ts-muted">{c.voted}</span>)}
        {d.mine.opener && (d.state === 'voting' || d.state === 'accepted') && <button className="ts-btn danger small" disabled={actions.busy} onClick={() => actions.onWithdraw?.(d)}>{c.withdraw}</button>}
      </div>}
      {actions.onPropose && d.state === 'accepted' && <Propose d={d} groups={groups} busy={actions.busy} onPropose={actions.onPropose} />}
    </div>)}
  </div>
}

export const disputeCopy = copy
