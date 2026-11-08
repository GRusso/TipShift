import { useMemo, useState } from 'react'
// @ts-expect-error The deterministic core intentionally remains dependency-free JavaScript.
import { TipShiftVault } from '../../../src/core/tipshift-vault.mjs'

type Language = 'en' | 'es'
type Screen = 'allocation' | 'launch' | 'customer' | 'recipient'
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
    ribbon: 'FUNCTIONAL LOCAL DEMO · No wallet, QR or payment is live', admin: 'ADMIN INTERFACE', title: 'Tips with accountable distribution.',
    lead: 'This interface executes the deterministic TipShift rules covered by the core tests. It never creates a blockchain transaction.',
    allocation: 'Tip allocation', launch: 'Start shift', customer: 'Public tip QR', recipient: 'Recipient review',
    allocationTitle: 'Anonymous recipients, locked shares', allocationLead: 'The branch administrator manages recipient slots and percentages, never a recipient wallet.',
    verified: 'Private link verified', launchTitle: 'Ready to start this shift?', launchLead: 'Starting locks recipients and shares. The local engine rejects later roster edits.',
    start: 'Start and lock shift', customerTitle: 'Customer tip entry point', customerLead: 'The QR is decorative. The test button below credits a local amount through the TipShift state machine.',
    addTip: 'Credit USDC 5 test tip', close: 'Close collection', recipientTitle: 'Dispute and correction review',
    recipientLead: 'This panel demonstrates employee protections using pseudonymous recipient references only.',
    object: 'Recipient 01 raises objection', support: 'Recipient 02 supports objection', correct: 'Admin publishes corrected rule',
    accept: 'Recipients accept correction', release: 'Release deterministic distribution', released: 'Distribution prepared',
    state: 'SHIFT STATE', balance: 'LOCAL TEST BALANCE', event: 'LATEST EVENT', error: 'Rule rejected', reset: 'Reset local demo',
    safety: 'Integration boundary', safetyText: 'Local interactions invoke the TipShift core only. Wallet signatures, persistence, NEAR Intents and NEP-141 transfers remain separate testnet work.',
    states: { draft: 'Draft', collecting: 'Collecting', distributable: 'Ready to distribute', dispute_voting: 'Dispute voting', disputed: 'Disputed', correction_review: 'Correction review', distributed: 'Distributed' },
  },
  es: {
    ribbon: 'DEMO FUNCIONAL LOCAL · No hay wallet, QR ni pago activo', admin: 'INTERFAZ DE ADMIN', title: 'Propinas con distribución verificable.',
    lead: 'Esta interfaz ejecuta las reglas deterministas de TipShift cubiertas por las pruebas del núcleo. Nunca crea una transacción blockchain.',
    allocation: 'Destinatarios de propina', launch: 'Iniciar turno', customer: 'QR público', recipient: 'Revisión de destinatarios',
    allocationTitle: 'Destinatarios anónimos, porcentajes bloqueados', allocationLead: 'El administrador gestiona lugares y porcentajes, nunca la wallet de un destinatario.',
    verified: 'Link privado verificado', launchTitle: '¿Listo para iniciar este turno?', launchLead: 'Iniciar bloquea destinatarios y porcentajes. El motor local rechaza cambios posteriores.',
    start: 'Iniciar y bloquear turno', customerTitle: 'Entrada de propina del cliente', customerLead: 'El QR es decorativo. El botón acredita un monto local de prueba mediante la máquina de estados TipShift.',
    addTip: 'Acreditar propina de prueba USDC 5', close: 'Cerrar recaudación', recipientTitle: 'Objeción y revisión corregida',
    recipientLead: 'Este panel demuestra protecciones de empleados usando sólo referencias seudónimas.',
    object: 'Destinatario 01 abre objeción', support: 'Destinatario 02 apoya objeción', correct: 'Admin publica regla corregida',
    accept: 'Destinatarios aceptan corrección', release: 'Liberar distribución determinista', released: 'Distribución preparada',
    state: 'ESTADO DEL TURNO', balance: 'SALDO LOCAL DE PRUEBA', event: 'ÚLTIMO EVENTO', error: 'Regla rechazada', reset: 'Reiniciar demo local',
    safety: 'Límite de integración', safetyText: 'Las interacciones locales invocan sólo el núcleo TipShift. Firmas, persistencia, NEAR Intents y transferencias NEP-141 siguen siendo trabajo separado de testnet.',
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
    <div className="ribbon">{copy.ribbon}</div><div className="container">
      <header><div className="brand"><span>T</span><strong>tipshift</strong><small>{copy.admin}</small></div><div className="controls">
        <button onClick={() => setLanguage(language === 'en' ? 'es' : 'en')}>{language === 'en' ? 'ES' : 'EN'}</button><button onClick={() => setNight(!night)}>{night ? '☀' : '☾'}</button><button onClick={reset}>{copy.reset}</button>
      </div></header>
      <section className="hero"><p className="eyebrow">TIPSHIFT · FUNCTIONAL ENGINE DEMO</p><h1>{copy.title}</h1><p>{copy.lead}</p></section>
      <nav className="flow">{(['allocation', 'launch', 'customer', 'recipient'] as Screen[]).map((item, index) => <button key={item} className={screen === item ? 'selected' : ''} onClick={() => setScreen(item)}>{index + 1}. {copy[item]}</button>)}</nav>
      <section className="panel">
        <Status copy={copy} state={state} balance={view.balance} event={event} />
        {error && <p className="error" role="alert"><strong>{copy.error}:</strong> {error}</p>}
        {screen === 'allocation' && <Allocation copy={copy} />}
        {screen === 'launch' && <Launch copy={copy} state={state} start={() => run(() => vault.startShift({ poolId, adminRef }))} />}
        {screen === 'customer' && <Customer copy={copy} state={state} fund={fund} close={() => run(() => vault.closeCollection({ poolId, adminRef }))} />}
        {screen === 'recipient' && <Review copy={copy} state={state} object={() => run(() => vault.raiseObjection({ poolId, workerRef: 'recipient-01', note: 'Demo review.' }))} support={() => run(() => vault.castDisputeVote({ poolId, workerRef: 'recipient-02', supports: true }))} correct={() => run(() => vault.submitCorrectedDistribution({ poolId, adminRef, roster }))} accept={() => run(() => ['recipient-01', 'recipient-02', 'recipient-03'].forEach((workerRef) => vault.castCorrectionVote({ poolId, workerRef, accepts: true })))} release={release} payouts={payouts} />}
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
