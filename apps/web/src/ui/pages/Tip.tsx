import { useEffect, useState } from 'react'
import { TOKEN_ACCOUNT_ID, connectTestnetWallet, explorerTransaction, payTip, readDemoPool, toAtomicUsdc, type PoolSummary } from '../../near'
import { useCopy } from '../i18n'
import { PublicFrame } from '../layout'

const copy = {
  en: {
    ribbon: 'Testnet · Test funds only',
    eyebrow: 'TIP', title: 'Thank the team',
    lead: 'Pay the exact amount. Names and wallets stay private.',
    amount: 'TIP', reference: 'REFERENCE', referenceHint: 'One-time. Reveals nothing about the shift.',
    cost: 'No fees for you.', costText: ' The business covers the cost.',
    pay: 'Pay with wallet', working: 'Approve in your wallet…', checking: 'One moment…',
    closedTitle: 'Tips are closed', closedText: 'This shift is over. Thank you anyway!',
    paidTitle: 'Thank you!', paidText: 'Your tip is on its way.', receipt: 'View receipt ↗',
    failed: 'Payment failed. Try again.',
    note: 'Testnet. No real money.',
  },
  es: {
    ribbon: 'Testnet · Solo fondos de prueba',
    eyebrow: 'PROPINA', title: 'Agradecé al equipo',
    lead: 'Pagás el monto exacto. Los nombres y wallets siguen privados.',
    amount: 'PROPINA', reference: 'REFERENCIA', referenceHint: 'De un solo uso. No revela nada del turno.',
    cost: 'Sin costos para vos.', costText: ' El local cubre el gasto.',
    pay: 'Pagar con wallet', working: 'Aprobá en tu wallet…', checking: 'Un momento…',
    closedTitle: 'Propinas cerradas', closedText: 'Este turno terminó. ¡Gracias igual!',
    paidTitle: '¡Gracias!', paidText: 'Tu propina va en camino.', receipt: 'Ver comprobante ↗',
    failed: 'No se pudo pagar. Probá de nuevo.',
    note: 'Testnet. Sin dinero real.',
  },
}

export function Tip({ paymentRef, amount }: { paymentRef: string; amount: string }) {
  const c = useCopy(copy)
  const [pool, setPool] = useState<PoolSummary | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [receipt, setReceipt] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)

  useEffect(() => { void readDemoPool().then(setPool).catch(() => setPool(null)) }, [])

  const pay = async () => {
    setBusy(true); setMessage('')
    try {
      const connection = await connectTestnetWallet({ contractId: TOKEN_ACCOUNT_ID, methodNames: ['ft_transfer_call'] })
      const hash = await payTip({ accountId: connection.accountId, paymentRef, amount: toAtomicUsdc(amount) })
      setReceipt(hash); setPaid(true)
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : c.failed) }
    finally { setBusy(false) }
  }

  const open = pool?.state === 'collecting'
  let body
  if (paid) body = <div className="ts-card"><span className="ts-status">USDC {amount}</span><h1 className="ts-h2" style={{ marginTop: 14 }}>{c.paidTitle}</h1><p className="ts-lead">{c.paidText}</p>{receipt && <div className="ts-actions"><a className="ts-btn quiet" href={explorerTransaction(receipt)} target="_blank" rel="noreferrer">{c.receipt}</a></div>}</div>
  else if (pool !== undefined && !open) body = <div className="ts-card"><span className="ts-status bad">—</span><h1 className="ts-h2" style={{ marginTop: 14 }}>{c.closedTitle}</h1><p className="ts-lead">{c.closedText}</p></div>
  else body = <div className="ts-card">
    <p className="ts-eyebrow">{c.eyebrow}</p>
    <h1 className="ts-h2">{c.title}</h1>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.lead}</p>
    <div className="ts-stat" style={{ marginTop: 22 }}><span>{c.amount}</span><strong>USDC {Number(amount).toFixed(2)}</strong></div>
    <div className="ts-rows" style={{ marginTop: 14 }}><div className="ts-row" style={{ gridTemplateColumns: '1fr' }}><span className="ts-muted">{c.reference}</span><b className="ts-mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>{paymentRef}</b><small>{c.referenceHint}</small></div></div>
    {message && <div className="ts-notice bad" role="alert">{message}</div>}
    <div className="ts-actions"><button className="ts-btn primary" disabled={busy || pool === undefined} onClick={() => void pay()}>{busy ? c.working : pool === undefined ? c.checking : c.pay}</button></div>
    <div className="ts-notice"><span>⊙</span><p><strong>{c.cost}</strong>{c.costText}</p></div>
    <p className="ts-muted" style={{ marginTop: 14, fontSize: 12 }}>{c.note}</p>
  </div>
  return <PublicFrame ribbon={c.ribbon}><div className="ts-solo">{body}</div></PublicFrame>
}
