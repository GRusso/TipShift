import { useEffect, useState } from 'react'
import { TOKEN_ACCOUNT_ID, connectTestnetWallet, explorerTransaction, payTip, readDemoPool, toAtomicUsdc, type PoolSummary } from '../../near'
import { useCopy } from '../i18n'
import { PublicFrame } from '../layout'

const copy = {
  en: {
    ribbon: 'TESTNET CHECKOUT · Test funds only',
    eyebrow: 'LEAVE A TIP', title: 'Thank the team for today’s shift',
    lead: 'You pay an exact amount. TipShift never shows employee names, wallets or percentages at checkout.',
    amount: 'EXACT TIP', reference: 'PAYMENT REFERENCE', referenceHint: 'Opaque, one-time reference. It does not reveal the shift or who is on it.',
    cost: 'You control the cost.', costText: ' The business pays the final distribution gas; it is never taken from your tip.',
    pay: 'Connect wallet and pay', working: 'Waiting for your wallet…', checking: 'Checking the shift…',
    closedTitle: 'This shift is not collecting tips', closedText: 'The QR is only valid while the shift is open. Thank you anyway!',
    paidTitle: 'Payment sent. Thank you!', paidText: 'Your wallet submitted the tip. The final state is visible in the explorer.', receipt: 'Explorer receipt ↗',
    failed: 'The payment could not be sent.',
    note: 'Testnet only. No real money moves and no seed phrase is requested.',
  },
  es: {
    ribbon: 'CHECKOUT TESTNET · Solo fondos de prueba',
    eyebrow: 'DEJÁ UNA PROPINA', title: 'Agradecé al equipo por el turno de hoy',
    lead: 'Pagás un monto exacto. TipShift nunca muestra nombres, wallets ni porcentajes en el checkout.',
    amount: 'PROPINA EXACTA', reference: 'REFERENCIA DE PAGO', referenceHint: 'Referencia opaca de un solo uso. No revela el turno ni quién trabaja en él.',
    cost: 'Vos controlás el costo.', costText: ' El local paga el gas del reparto final; nunca se descuenta de tu propina.',
    pay: 'Conectar wallet y pagar', working: 'Esperando tu wallet…', checking: 'Verificando el turno…',
    closedTitle: 'Este turno no recibe propinas', closedText: 'El QR solo vale mientras el turno está abierto. ¡Gracias igual!',
    paidTitle: 'Pago enviado. ¡Gracias!', paidText: 'Tu wallet envió la propina. El estado final se ve en el explorer.', receipt: 'Comprobante en explorer ↗',
    failed: 'No se pudo enviar el pago.',
    note: 'Solo testnet. No se mueve dinero real y nunca se pide frase semilla.',
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
