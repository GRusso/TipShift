import { useState } from 'react'

type Language = 'en' | 'es'
type Screen = 'allocation' | 'launch' | 'customer' | 'recipient'

const text = {
  en: {
    ribbon: 'DEVELOPMENT PREVIEW · No wallet, QR or payment is live',
    admin: 'ADMIN INTERFACE',
    title: 'Tips with accountable distribution.',
    lead: 'A frontend foundation built from the approved TipShift design. Every action below is intentionally local demo state.',
    allocation: 'Tip allocation',
    launch: 'Start shift',
    customer: 'Public tip QR',
    recipient: 'Recipient claim',
    allocationTitle: 'Link each tip recipient',
    allocationLead: 'A recipient proves their own receiving wallet through a private one-time claim. The branch admin cannot choose it.',
    statuses: ['Verified', 'Awaiting claim', 'Needs link'],
    launchTitle: 'Ready to start this shift?',
    launchLead: 'Recipients and percentages lock together only once every recipient is verified and the allocation totals 100%.',
    start: 'Start and lock shift',
    live: 'Shift live — demo state',
    customerTitle: 'One public QR. No customer account.',
    customerLead: 'The customer QR is separate from private recipient claims. It never reveals recipients, wallets, percentages, or pool identifiers.',
    unavailable: 'Preview safe unavailable state',
    expired: 'QR needs a refresh. Nothing has been charged.',
    recipientTitle: 'Confirm your destination',
    recipientLead: 'A future implementation will verify a one-time, domain-bound wallet signature for this recipient place.',
    walletStatus: 'WALLET STATUS', walletPending: 'Not connected in this demo', connect: 'Private flow inactive in this demo',
    safety: 'Implementation boundary',
    safetyText: 'This app has no backend, persistence, signatures, payment adapter, secret, or real QR. Those integrations must be implemented and tested separately.',
  },
  es: {
    ribbon: 'VISTA DE DESARROLLO · No hay wallet, QR ni pago activo',
    admin: 'INTERFAZ DE ADMIN',
    title: 'Propinas con distribución verificable.',
    lead: 'Base de frontend creada desde el diseño aprobado de TipShift. Cada acción de abajo es estado demo local a propósito.',
    allocation: 'Destinatarios de propina',
    launch: 'Iniciar turno',
    customer: 'QR público',
    recipient: 'Asociar destinatario',
    allocationTitle: 'Vinculá a cada destinatario de propina',
    allocationLead: 'Cada destinatario prueba su propia wallet receptora mediante una asociación privada de un solo uso. El admin no puede elegirla.',
    statuses: ['Verificado', 'Pendiente de asociación', 'Falta link privado'],
    launchTitle: '¿Listo para iniciar este turno?',
    launchLead: 'Los destinatarios y porcentajes se bloquean juntos sólo cuando cada destinatario está verificado y la asignación suma 100%.',
    start: 'Iniciar y bloquear turno',
    live: 'Turno en curso — estado demo',
    customerTitle: 'Un QR público. Sin cuenta de cliente.',
    customerLead: 'El QR del cliente es distinto de las asociaciones privadas. Nunca revela destinatarios, wallets, porcentajes ni identificadores de pool.',
    unavailable: 'Vista de estado seguro no disponible',
    expired: 'El QR necesita actualizarse. No se cobró nada.',
    recipientTitle: 'Confirmá tu destino',
    recipientLead: 'Una implementación futura verificará una firma de wallet única y vinculada al dominio para este lugar de destinatario.',
    walletStatus: 'ESTADO DE WALLET', walletPending: 'No conectada en esta demo', connect: 'Flujo privado inactivo en esta demo',
    safety: 'Límite de implementación',
    safetyText: 'Esta aplicación no tiene backend, persistencia, firmas, adaptador de pagos, secretos ni QR real. Esas integraciones se implementan y prueban por separado.',
  },
} as const

const shares = ['40%', '35%', '25%']

export function App() {
  const [language, setLanguage] = useState<Language>('en')
  const [night, setNight] = useState(false)
  const [screen, setScreen] = useState<Screen>('allocation')
  const [shiftLive, setShiftLive] = useState(false)
  const [showUnavailable, setShowUnavailable] = useState(false)
  const copy = text[language]
  const controls: Screen[] = ['allocation', 'launch', 'customer', 'recipient']

  return (
    <main className={night ? 'app night' : 'app'}>
      <div className="ribbon">{copy.ribbon}</div>
      <div className="container">
        <header>
          <div className="brand"><span>T</span><strong>tipshift</strong><small>{copy.admin}</small></div>
          <div className="controls">
            <button onClick={() => setLanguage(language === 'en' ? 'es' : 'en')}>{language === 'en' ? 'ES' : 'EN'}</button>
            <button onClick={() => setNight(!night)}>{night ? '☀' : '☾'}</button>
          </div>
        </header>

        <section className="hero">
          <p className="eyebrow">MVP FRONTEND FOUNDATION</p>
          <h1>{copy.title}</h1>
          <p>{copy.lead}</p>
        </section>

        <nav className="flow" aria-label="TipShift preview flow">
          {controls.map((item, index) => (
            <button key={item} className={screen === item ? 'selected' : ''} onClick={() => setScreen(item)}>
              {index + 1}. {copy[item]}
            </button>
          ))}
        </nav>

        <section className="panel">
          {screen === 'allocation' && <Allocation copy={copy} />}
          {screen === 'launch' && <Launch copy={copy} live={shiftLive} onStart={() => setShiftLive(true)} />}
          {screen === 'customer' && <Customer copy={copy} unavailable={showUnavailable} onToggle={() => setShowUnavailable(!showUnavailable)} />}
          {screen === 'recipient' && <Recipient copy={copy} />}
        </section>

        <aside className="safety"><strong>{copy.safety}.</strong> {copy.safetyText}</aside>
      </div>
    </main>
  )
}

function Allocation({ copy }: { copy: (typeof text)['en'] | (typeof text)['es'] }) {
  return <><p className="eyebrow">TIP ALLOCATION</p><h2>{copy.allocationTitle}</h2><p className="description">{copy.allocationLead}</p><div className="rows">{copy.statuses.map((status, index) => <article key={status}><b>0{index + 1}</b><span><strong>Tip recipient 0{index + 1}</strong><small>{status}</small></span><em>{shares[index]}</em></article>)}</div></>
}

function Launch({ copy, live, onStart }: { copy: (typeof text)['en'] | (typeof text)['es']; live: boolean; onStart: () => void }) {
  return <><p className="eyebrow">LUNCH SHIFT · DRAFT</p><h2>{copy.launchTitle}</h2><p className="description">{copy.launchLead}</p><div className="checklist"><span>✓ 3 recipients verified</span><span>✓ Allocation: 100%</span><span>✓ Collection window: 4 h</span></div><button className="primary" onClick={onStart}>{live ? copy.live : copy.start}</button></>
}

function Customer({ copy, unavailable, onToggle }: { copy: (typeof text)['en'] | (typeof text)['es']; unavailable: boolean; onToggle: () => void }) {
  return <div className="two-col"><div className="poster"><p>CAFÉ NÓMADA</p><div className="fake-qr" aria-label="Non-scannable QR demo">{Array.from({ length: 36 }, (_, index) => <i key={index} />)}</div><small>DEMO ONLY · NOT SCANNABLE</small></div><div><p className="eyebrow">CUSTOMER ENTRY POINT</p><h2>{unavailable ? copy.unavailable : copy.customerTitle}</h2><p className="description">{unavailable ? copy.expired : copy.customerLead}</p><button className="secondary" onClick={onToggle}>{unavailable ? 'Show active state' : 'Preview expired state'}</button></div></div>
}

function Recipient({ copy }: { copy: (typeof text)['en'] | (typeof text)['es'] }) {
  return <div className="two-col"><aside className="context"><p>PRIVATE RECIPIENT LINK</p><h3>Café Nómada</h3><small>Lunch shift · 12:00–16:00<br />Assigned share · 35%</small></aside><div><p className="eyebrow">STEP 1 OF 3</p><h2>{copy.recipientTitle}</h2><p className="description">{copy.recipientLead}</p><div className="wallet"><small>{copy.walletStatus}</small><code>{copy.walletPending}</code></div><button className="primary" disabled>{copy.connect}</button></div></div>
}
