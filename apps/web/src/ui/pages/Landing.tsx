import { PublicFrame } from '../layout'
import { Brand } from '../layout'
import { useCopy } from '../i18n'

const copy = {
  en: {
    ribbon: 'TESTNET · Test funds only. No real payments are made.',
    how: 'How it works', signIn: 'Manager sign-in', setUp: 'Set up a business',
    eyebrow: 'TIP OPERATIONS FOR NEAR',
    title: 'Tips stay fair when the rules stay visible.',
    lead: 'TipShift helps a business share USDC tips by shift. Staff confirm they are present by scanning a QR and signing with their own wallet, and tips are split among the people who showed up, without TipShift ever holding their funds.',
    explore: 'Explore the demo ↗',
    micro: 'No employee seed phrases. No personal-data marketplace. No ads in the product.',
    cardTop: 'SHIFT · LUNCH', cardSub: '6 present · distribution proposed',
    steps: ['Present', 'Tips collected', 'Review', 'Paid'],
    miniLeft: 'Present at close', miniRight: 'Split equally in each group',
    principles: [
      { n: '01', t: 'Non-custodial', p: 'Employees control their own public receiving wallets. TipShift does not hold private keys.' },
      { n: '02', t: 'Presence decides', p: 'Only people who scanned the shift QR and signed are included. Nobody who did not show up gets paid.' },
      { n: '03', t: 'Auditable disputes', p: 'Objections and corrections are tied to the shift balance, and the team votes on them.' },
    ],
    flowEyebrow: 'ONE CLEAR FLOW', flowTitle: 'From a local’s setup to a final distribution.',
    flow: [
      { t: 'Business setup', p: 'An owner registers the company and its locations, and invites a manager for each.' },
      { t: 'Team registers once', p: 'Each employee registers with the wallet where they want to receive tips.' },
      { t: 'Shift and QR', p: 'The manager opens a shift with its groups. Employees scan their group’s QR and sign to say “I am here”.' },
      { t: 'Tips, review and payout', p: 'Customers scan a public QR and tip. When the shift ends the split is proposed; any objection is voted by the team.' },
    ],
    footer: 'Testnet product demo · no sponsors or advertising',
  },
  es: {
    ribbon: 'TESTNET · Solo fondos de prueba. No se hacen pagos reales.',
    how: 'Cómo funciona', signIn: 'Ingreso de gerentes', setUp: 'Registrar mi negocio',
    eyebrow: 'OPERACIÓN DE PROPINAS SOBRE NEAR',
    title: 'Las propinas son justas cuando las reglas son visibles.',
    lead: 'TipShift ayuda a un negocio a repartir propinas en USDC por turno. El equipo confirma que está presente escaneando un QR y firmando con su propia wallet, y la propina se reparte entre quienes se presentaron, sin que TipShift guarde nunca sus fondos.',
    explore: 'Explorar la demo ↗',
    micro: 'Sin frases semilla de empleados. Sin venta de datos personales. Sin publicidad en el producto.',
    cardTop: 'TURNO · ALMUERZO', cardSub: '6 presentes · distribución propuesta',
    steps: ['Presentes', 'Propinas', 'Revisión', 'Pagado'],
    miniLeft: 'Presentes al cierre', miniRight: 'Reparto igual en cada grupo',
    principles: [
      { n: '01', t: 'Sin custodia', p: 'Cada empleado controla su propia wallet pública de cobro. TipShift no guarda claves privadas.' },
      { n: '02', t: 'La presencia decide', p: 'Solo entran quienes escanearon el QR del turno y firmaron. Quien no se presentó no cobra.' },
      { n: '03', t: 'Disputas auditables', p: 'Las objeciones y correcciones quedan atadas al saldo del turno, y el equipo vota.' },
    ],
    flowEyebrow: 'UN FLUJO CLARO', flowTitle: 'Del alta de un local al reparto final.',
    flow: [
      { t: 'Alta del negocio', p: 'Un dueño registra la empresa y sus locales, e invita a un gerente por local.' },
      { t: 'El equipo se registra una vez', p: 'Cada empleado se registra con la wallet donde quiere recibir sus propinas.' },
      { t: 'Turno y QR', p: 'El gerente abre un turno con sus grupos. Cada empleado escanea el QR de su grupo y firma para decir “estoy acá”.' },
      { t: 'Propinas, revisión y pago', p: 'Los clientes escanean un QR público y dejan propina. Al terminar el turno se propone el reparto; cualquier objeción la vota el equipo.' },
    ],
    footer: 'Demo de producto en testnet · sin patrocinadores ni publicidad',
  },
}

export function Landing() {
  const c = useCopy(copy)
  return <PublicFrame ribbon={c.ribbon} nav={<>
    <a href="#how">{c.how}</a>
    <a href="#/console" className="ts-chip">{c.signIn}</a>
  </>}>
    <section className="ts-hero">
      <div>
        <p className="ts-eyebrow">{c.eyebrow}</p>
        <h1 className="ts-h1">{c.title}</h1>
        <p className="ts-lead">{c.lead}</p>
        <div className="ts-actions">
          <a className="ts-btn primary" href="#/company">{c.setUp}</a>
          <a className="ts-btn quiet" href="#/demo">{c.explore}</a>
        </div>
        <p className="ts-muted" style={{ marginTop: 18 }}>{c.micro}</p>
      </div>
      <div className="ts-hero-card" aria-hidden="true">
        <span className="ts-status">{c.cardTop}</span>
        <strong>USDC 480.00</strong>
        <p className="ts-muted">{c.cardSub}</p>
        <div className="ts-track"><span /></div>
        <div className="ts-steps">{c.steps.map((step, index) => <span key={step} className={index <= 2 ? 'on' : undefined}>{step}</span>)}</div>
        <div className="ts-row" style={{ gridTemplateColumns: '1fr auto', marginTop: 16 }}><span className="ts-muted">{c.miniLeft}</span><b style={{ fontSize: 12 }}>{c.miniRight}</b></div>
      </div>
    </section>

    <section className="ts-principles" aria-label="Principles">
      {c.principles.map((item) => <article key={item.n}><span>{item.n}</span><h2>{item.t}</h2><p>{item.p}</p></article>)}
    </section>

    <section className="ts-section" id="how">
      <p className="ts-eyebrow">{c.flowEyebrow}</p>
      <h2 className="ts-h2" style={{ maxWidth: 640 }}>{c.flowTitle}</h2>
      <div className="ts-flow">
        {c.flow.map((item, index) => <article key={item.t}><div className="num">{index + 1}</div><h3 className="ts-h3">{item.t}</h3><p>{item.p}</p></article>)}
      </div>
    </section>

    <div className="ts-footer"><Brand /><p>{c.footer}</p></div>
  </PublicFrame>
}
