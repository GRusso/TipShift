import { useEffect, useMemo, useState } from 'react'
import './testnet.css'
// @ts-expect-error The deterministic core intentionally remains dependency-free JavaScript.
import { TipShiftVault } from '../../../src/core/tipshift-vault.mjs'
import { DEMO_ADMIN_ID, DEMO_POOL_ID, TOKEN_ACCOUNT_ID, VAULT_ACCOUNT_ID, connectTestnetWallet, explorerTransaction, openPaymentSession, payTip, paymentRef, readDemoPool, toAtomicUsdc, type PoolSummary } from './near'

type Language = 'en' | 'es'
type Screen = 'allocation' | 'launch' | 'customer' | 'recipient' | 'testnet'
type State = 'draft' | 'collecting' | 'distributable' | 'dispute_voting' | 'disputed' | 'correction_review' | 'distributed'
type Payout = { workerRef: string; amount: bigint }

const poolId = 'demo-cafe-nomada-lunch'
const adminRef = 'demo-branch-admin'
const roster = [
  { workerRef: 'recipient-01', nearWallet: 'bound-recipient-01', shareBps: 4_000 },
  { workerRef: 'recipient-02', nearWallet: 'bound-recipient-02', shareBps: 3_500 },
  { workerRef: 'recipient-03', nearWallet: 'bound-recipient-03', shareBps: 2_500 },
]

const text = {
  en: {
    ribbon: 'FUNCTIONAL LOCAL DEMO · No wallet, QR or payment is live', testnetRibbon: 'TESTNET CHECKOUT · Wallet action requires explicit confirmation', admin: 'ADMIN INTERFACE', title: 'Tips with accountable distribution.',
    lead: 'This interface executes the deterministic TipShift rules covered by the core tests. It never creates a blockchain transaction.',
    allocation: 'Tip allocation', launch: 'Start shift', customer: 'Public tip QR', recipient: 'Recipient review', testnet: 'Testnet checkout',
    allocationTitle: 'Anonymous recipients, locked shares', allocationLead: 'The branch administrator manages recipient slots and percentages, never a recipient wallet.',
    verified: 'Private link verified', launchTitle: 'Ready to start this shift?', launchLead: 'Starting locks recipients and shares. The local engine rejects later roster edits.',
    start: 'Start and lock shift', customerTitle: 'Customer tip entry point', customerLead: 'The QR is decorative. The test button below credits a local amount through the TipShift state machine.',
    addTip: 'Credit USDC 5 test tip', close: 'Close collection', recipientTitle: 'Dispute and correction review',
    recipientLead: 'This panel demonstrates employee protections using pseudonymous recipient references only.',
    object: 'Recipient 01 raises objection', support: 'Recipient 02 supports objection', correct: 'Admin publishes corrected rule',
    accept: 'Recipients accept correction', release: 'Release deterministic distribution', released: 'Distribution prepared',
    state: 'SHIFT STATE', balance: 'LOCAL TEST BALANCE', event: 'LATEST EVENT', error: 'Rule rejected', reset: 'Reset local demo',
    safety: 'Integration boundary', safetyText: 'Panels 1–4 invoke the local TipShift core only. The separate Testnet checkout is the only panel that requests a wallet transaction; persistence, recipient claims and disputes are still separate work.',
    testnetTitle: 'Real NEAR testnet checkout', testnetLead: 'The admin opens an exact test-USDC session. The customer connects Meteor Wallet and pays the opaque reference through NEP-141.',
    testnetPool: 'Pool status', refresh: 'Refresh testnet state', adminConnect: 'Connect as branch admin', customerConnect: 'Connect customer wallet', noSession: 'The branch admin must open an exact payment session first.',
    amount: 'Test-USDC amount', openSession: 'Open exact payment session', customerLink: 'Customer test link', publicQr: 'Public testnet payment QR', qrSafety: 'This QR contains only the opaque, one-time checkout reference. It never contains the pool, recipients, wallets or allocation.', pay: 'Pay exact tip on testnet',
    waiting: 'Waiting for an active pool', connected: 'Connected', sessionOpen: 'Session opened', paymentSubmitted: 'Payment submitted; verify its final state in the explorer.', testnetNote: 'Testnet only. The customer pays intake gas; the branch pays payout gas. No seed phrase is requested.',
    poolMissing: 'The presentation pool is not active yet.', notAdmin: 'This connected wallet is not the configured branch administrator.', transaction: 'Explorer receipt',
    states: { draft: 'Draft', collecting: 'Collecting', distributable: 'Ready to distribute', dispute_voting: 'Dispute voting', disputed: 'Disputed', correction_review: 'Correction review', distributed: 'Distributed' },
  },
  es: {
    ribbon: 'DEMO FUNCIONAL LOCAL · No hay wallet, QR ni pago activo', testnetRibbon: 'CHECKOUT TESTNET · La wallet requiere confirmación explícita', admin: 'INTERFAZ DE ADMIN', title: 'Propinas con distribución verificable.',
    lead: 'Esta interfaz ejecuta las reglas deterministas de TipShift cubiertas por las pruebas del núcleo. Nunca crea una transacción blockchain.',
    allocation: 'Destinatarios de propina', launch: 'Iniciar turno', customer: 'QR público', recipient: 'Revisión de destinatarios', testnet: 'Checkout testnet',
    allocationTitle: 'Destinatarios anónimos, porcentajes bloqueados', allocationLead: 'El administrador gestiona lugares y porcentajes, nunca la wallet de un destinatario.',
    verified: 'Link privado verificado', launchTitle: '¿Listo para iniciar este turno?', launchLead: 'Iniciar bloquea destinatarios y porcentajes. El motor local rechaza cambios posteriores.',
    start: 'Iniciar y bloquear turno', customerTitle: 'Entrada de propina del cliente', customerLead: 'El QR es decorativo. El botón acredita un monto local de prueba mediante la máquina de estados TipShift.',
    addTip: 'Acreditar propina de prueba USDC 5', close: 'Cerrar recaudación', recipientTitle: 'Objeción y revisión corregida',
    recipientLead: 'Este panel demuestra protecciones de empleados usando sólo referencias seudónimas.',
    object: 'Destinatario 01 abre objeción', support: 'Destinatario 02 apoya objeción', correct: 'Admin publica regla corregida',
    accept: 'Destinatarios aceptan corrección', release: 'Liberar distribución determinista', released: 'Distribución preparada',
    state: 'ESTADO DEL TURNO', balance: 'SALDO LOCAL DE PRUEBA', event: 'ÚLTIMO EVENTO', error: 'Regla rechazada', reset: 'Reiniciar demo local',
    safety: 'Límite de integración', safetyText: 'Los paneles 1–4 invocan sólo el núcleo local de TipShift. El checkout Testnet separado es el único panel que solicita una transacción wallet; persistencia, reclamos de destinatario y disputas siguen siendo trabajo separado.',
    testnetTitle: 'Checkout real en NEAR testnet', testnetLead: 'El administrador abre una sesión exacta de USDC de prueba. El cliente conecta Meteor Wallet y paga la referencia opaca mediante NEP-141.',
    testnetPool: 'Estado del pool', refresh: 'Actualizar estado testnet', adminConnect: 'Conectar como administrador', customerConnect: 'Conectar wallet del cliente', noSession: 'El administrador de sucursal debe abrir primero una sesión exacta de pago.',
    amount: 'Monto USDC de prueba', openSession: 'Abrir sesión de pago exacta', customerLink: 'Link de prueba del cliente', publicQr: 'QR público de pago testnet', qrSafety: 'Este QR sólo contiene la referencia opaca de checkout de un solo uso. Nunca contiene el pool, destinatarios, wallets ni porcentajes.', pay: 'Pagar propina exacta en testnet',
    waiting: 'Esperando un pool activo', connected: 'Conectada', sessionOpen: 'Sesión abierta', paymentSubmitted: 'Pago enviado; verificá su estado final en el explorer.', testnetNote: 'Sólo testnet. El cliente paga el gas de ingreso; la sucursal paga el gas de reparto. Nunca se pide seed phrase.',
    poolMissing: 'El pool de presentación todavía no está activo.', notAdmin: 'La wallet conectada no es la administradora configurada.', transaction: 'Comprobante en explorer',
    states: { draft: 'Borrador', collecting: 'Recaudando', distributable: 'Lista para distribuir', dispute_voting: 'Votación de disputa', disputed: 'En disputa', correction_review: 'Revisión corregida', distributed: 'Distribuida' },
  },
} as const

type Copy = { [Key in Exclude<keyof typeof text.en, 'states'>]: string } & { states: Record<State, string> }
function createVault() {
  const vault = new TipShiftVault()
  vault.createPool({ poolId, organizationRef: 'demo-organization', locationRef: 'demo-location', adminRef, roster })
  return vault
}
function usdc(value: bigint) { return 'USDC ' + (Number(value) / 1_000_000).toFixed(2) }

export function App() {
  const [language, setLanguage] = useState<Language>('en')
  const [night, setNight] = useState(false)
  const [screen, setScreen] = useState<Screen>('allocation')
  const [vault, setVault] = useState(createVault)
  const [revision, setRevision] = useState(0)
  const [paymentCount, setPaymentCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [payouts, setPayouts] = useState<Payout[]>([])
  const copy = text[language]
  const isTestnet = screen === 'testnet'
  const view = useMemo(() => vault.getAdminView({ poolId, adminRef }), [vault, revision])
  const state = view.state as State
  const event = view.events.at(-1)?.type ?? 'pool_created'
  const run = (operation: () => void) => {
    try { operation(); setError(null); setRevision((value) => value + 1) }
    catch (caught) { setError(caught instanceof Error ? caught.message : copy.error) }
  }
  const reset = () => { setVault(createVault()); setRevision(0); setPaymentCount(0); setPayouts([]); setError(null); setScreen('allocation') }
  const fund = () => run(() => { const next = paymentCount + 1; vault.fundTip({ poolId, paymentRef: 'demo-payment-' + next, amount: 5_000_000n }); setPaymentCount(next) })
  const release = () => run(() => setPayouts(vault.release({ poolId, adminRef })))

  return <main className={night ? 'app night' : 'app'}>
    <div className="ribbon">{isTestnet ? copy.testnetRibbon : copy.ribbon}</div><div className="container">
      <header><div className="brand"><span>T</span><strong>tipshift</strong><small>{copy.admin}</small></div><div className="controls">
        <button onClick={() => setLanguage(language === 'en' ? 'es' : 'en')}>{language === 'en' ? 'ES' : 'EN'}</button><button onClick={() => setNight(!night)}>{night ? '☀' : '☾'}</button>{!isTestnet && <button onClick={reset}>{copy.reset}</button>}
      </div></header>
      <section className="hero"><p className="eyebrow">{isTestnet ? copy.testnetRibbon : 'TIPSHIFT · FUNCTIONAL ENGINE DEMO'}</p><h1>{copy.title}</h1><p>{isTestnet ? copy.testnetLead : copy.lead}</p></section>
      <nav className="flow">{(['allocation', 'launch', 'customer', 'recipient', 'testnet'] as Screen[]).map((item, index) => <button key={item} className={screen === item ? 'selected' : ''} onClick={() => setScreen(item)}>{index + 1}. {copy[item]}</button>)}</nav>
      <section className="panel">
        {!isTestnet && <Status copy={copy} state={state} balance={view.balance} event={event} />}
        {!isTestnet && error && <p className="error" role="alert"><strong>{copy.error}:</strong> {error}</p>}
        {screen === 'allocation' && <Allocation copy={copy} />}
        {screen === 'launch' && <Launch copy={copy} state={state} start={() => run(() => vault.startShift({ poolId, adminRef }))} />}
        {screen === 'customer' && <Customer copy={copy} state={state} fund={fund} close={() => run(() => vault.closeCollection({ poolId, adminRef }))} />}
        {screen === 'recipient' && <Review copy={copy} state={state} object={() => run(() => vault.raiseObjection({ poolId, workerRef: 'recipient-01', note: 'Demo review.' }))} support={() => run(() => vault.castDisputeVote({ poolId, workerRef: 'recipient-02', supports: true }))} correct={() => run(() => vault.submitCorrectedDistribution({ poolId, adminRef, roster }))} accept={() => run(() => ['recipient-01', 'recipient-02', 'recipient-03'].forEach((workerRef) => vault.castCorrectionVote({ poolId, workerRef, accepts: true })))} release={release} payouts={payouts} />}
        {screen === 'testnet' && <TestnetCheckout copy={copy} />}
      </section><aside className="safety"><strong>{copy.safety}.</strong> {copy.safetyText}</aside>
    </div>
  </main>
}
function Status({ copy, state, balance, event }: { copy: Copy; state: State; balance: bigint; event: string }) {
  return <div className="engine-status"><span><small>{copy.state}</small><strong>{copy.states[state]}</strong></span><span><small>{copy.balance}</small><strong>{usdc(balance)}</strong></span><span><small>{copy.event}</small><strong>{event.replaceAll('_', ' ')}</strong></span></div>
}
function Allocation({ copy }: { copy: Copy }) {
  const shares = ['40%', '35%', '25%']
  return <><p className="eyebrow">TIP ALLOCATION</p><h2>{copy.allocationTitle}</h2><p className="description">{copy.allocationLead}</p><div className="rows">{shares.map((share, index) => <article key={share}><b>0{index + 1}</b><span><strong>Tip recipient 0{index + 1}</strong><small>{copy.verified}</small></span><em>{share}</em></article>)}</div></>
}
function Launch({ copy, state, start }: { copy: Copy; state: State; start: () => void }) {
  return <><p className="eyebrow">LUNCH SHIFT · DRAFT</p><h2>{copy.launchTitle}</h2><p className="description">{copy.launchLead}</p><div className="checklist"><span>✓ 3 recipients verified</span><span>✓ Allocation: 100%</span><span>✓ Isolated pool: ready</span></div><button className="primary" disabled={state !== 'draft'} onClick={start}>{copy.start}</button></>
}
function Customer({ copy, state, fund, close }: { copy: Copy; state: State; fund: () => void; close: () => void }) {
  return <div className="two-col"><div className="poster"><p>CAFÉ NÓMADA</p><div className="fake-qr" aria-label="Non-scannable QR demo">{Array.from({ length: 36 }, (_, index) => <i key={index} />)}</div><small>DEMO ONLY · NOT SCANNABLE</small></div><div><p className="eyebrow">CUSTOMER ENTRY POINT</p><h2>{copy.customerTitle}</h2><p className="description">{copy.customerLead}</p><div className="actions"><button className="primary" disabled={state !== 'collecting'} onClick={fund}>{copy.addTip}</button><button className="secondary" disabled={state !== 'collecting'} onClick={close}>{copy.close}</button></div></div></div>
}
function Review({ copy, state, object, support, correct, accept, release, payouts }: { copy: Copy; state: State; object: () => void; support: () => void; correct: () => void; accept: () => void; release: () => void; payouts: Payout[] }) {
  const action = state === 'distributable' ? <><button className="secondary" onClick={object}>{copy.object}</button><button className="primary" onClick={release}>{copy.release}</button></> : state === 'dispute_voting' ? <button className="primary" onClick={support}>{copy.support}</button> : state === 'disputed' ? <button className="primary" onClick={correct}>{copy.correct}</button> : state === 'correction_review' ? <button className="primary" onClick={accept}>{copy.accept}</button> : null
  return <><p className="eyebrow">RECIPIENT PROTECTION</p><h2>{copy.recipientTitle}</h2><p className="description">{copy.recipientLead}</p><div className="actions">{action}</div>{payouts.length > 0 && <div className="payouts"><strong>{copy.released}</strong>{payouts.map((payout) => <span key={payout.workerRef}>{payout.workerRef.replace('recipient-', 'Tip recipient ')} · {usdc(payout.amount)}</span>)}</div>}</>
}

function TestnetCheckout({ copy }: { copy: Copy }) {
  const [pool, setPool] = useState<PoolSummary | null | undefined>(undefined)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [amount, setAmount] = useState('5')
  const [checkout, setCheckout] = useState<{ paymentRef: string; amount: string; link: string; qrDataUrl: string } | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const urlCheckout = useMemo(() => {
    const query = new URLSearchParams(window.location.search)
    const paymentRef = query.get('payment_ref')
    const paymentAmount = query.get('amount')
    return paymentRef && paymentAmount ? { paymentRef, amount: paymentAmount } : null
  }, [])
  const activeCheckout = checkout ?? urlCheckout

  const refresh = async () => {
    try { setPool(await readDemoPool()); setMessage(null) }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : copy.poolMissing) }
  }
  useEffect(() => { void refresh() }, [])

  const connectAdmin = async () => {
    setBusy(true)
    try {
      const connection = await connectTestnetWallet({ contractId: VAULT_ACCOUNT_ID, methodNames: ['open_payment_session'] })
      if (connection.accountId !== DEMO_ADMIN_ID) throw new Error(copy.notAdmin)
      setAccountId(connection.accountId); setMessage(`${copy.connected}: ${connection.accountId}`)
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }
  const openSession = async () => {
    if (!accountId) return setMessage(copy.notAdmin)
    setBusy(true)
    try {
      const atomic = toAtomicUsdc(amount)
      const reference = paymentRef()
      const hash = await openPaymentSession({ accountId, paymentRef: reference, amount: atomic })
      const link = new URL(window.location.href)
      link.searchParams.set('payment_ref', reference)
      link.searchParams.set('amount', amount)
      const { toDataURL } = await import('qrcode')
      const qrDataUrl = await toDataURL(link.toString(), { errorCorrectionLevel: 'M', margin: 1, width: 240 })
      setCheckout({ paymentRef: reference, amount, link: link.toString(), qrDataUrl })
      setReceipt(hash); setMessage(copy.sessionOpen); await refresh()
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }
  const pay = async () => {
    if (!activeCheckout) return
    setBusy(true)
    try {
      const connection = await connectTestnetWallet({ contractId: TOKEN_ACCOUNT_ID, methodNames: ['ft_transfer_call'] })
      const hash = await payTip({ accountId: connection.accountId, paymentRef: activeCheckout.paymentRef, amount: toAtomicUsdc(activeCheckout.amount) })
      setAccountId(connection.accountId); setReceipt(hash); setMessage(copy.paymentSubmitted); await refresh()
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }

  return <section className="testnet-checkout">
    <p className="eyebrow">LIVE TESTNET · NEP-141</p><h2>{copy.testnetTitle}</h2><p className="description">{copy.testnetLead}</p>
    <div className="testnet-meta"><span><small>{copy.testnetPool}</small><strong>{pool ? `${pool.state} · ${usdc(BigInt(pool.balance))}` : copy.waiting}</strong></span><span><small>CONTRACT</small><strong>{VAULT_ACCOUNT_ID}</strong></span></div>
    {pool === null && <p className="error">{copy.poolMissing}</p>}
    <div className="testnet-grid">
      <div><p className="eyebrow">BRANCH ADMIN</p><button className="secondary" disabled={busy} onClick={connectAdmin}>{copy.adminConnect}</button><label>{copy.amount}<input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} /></label><button className="primary" disabled={busy || !accountId || !pool || pool.state !== 'collecting'} onClick={openSession}>{copy.openSession}</button></div>
      <div><p className="eyebrow">CUSTOMER</p>{activeCheckout ? <><p className="checkout-ref">{activeCheckout.paymentRef}</p><p className="description">{activeCheckout.amount} test-USDC</p><button className="primary" disabled={busy || !pool || pool.state !== 'collecting'} onClick={pay}>{copy.pay}</button></> : <p className="description">{copy.noSession}</p>}</div>
    </div>
    {checkout && <div className="public-checkout-qr"><p className="eyebrow">{copy.publicQr}</p><img src={checkout.qrDataUrl} alt={copy.publicQr} /><p>{copy.qrSafety}</p><p className="share-link"><strong>{copy.customerLink}:</strong> <a href={checkout.link}>{checkout.link}</a></p></div>}
    {message && <p className="testnet-message">{message}</p>}
    {receipt && <p className="testnet-message"><a href={explorerTransaction(receipt)} target="_blank" rel="noreferrer">{copy.transaction} ↗</a></p>}
    <div className="actions"><button className="secondary" disabled={busy} onClick={() => void refresh()}>{copy.refresh}</button></div><aside className="safety"><strong>Testnet.</strong> {copy.testnetNote}</aside>
  </section>
}
