import { PublicFrame } from '../layout'
import { Brand } from '../layout'
import { useCopy } from '../i18n'

const copy = {
  en: {
    ribbon: 'Testnet · Test funds only',
    how: 'How it works', signIn: 'Manager sign-in', mine: 'My shifts', setUp: 'Set up a business',
    eyebrow: 'TIPS ON NEAR',
    title: 'Tips, shared fairly.',
    lead: 'Check in. Get tipped. Everyone who was there gets paid, straight to their own wallet.',
    explore: 'See the demo ↗',
    micro: 'No seed phrases. No ads. No custody.',
    cardTop: 'SHIFT · LUNCH', cardSub: '6 present',
    steps: ['Present', 'Tipped', 'Split', 'Paid'],
    miniLeft: 'Present at close', miniRight: 'Split equally',
    principles: [
      { n: '01', t: 'Yours', p: 'Tips go straight to each person’s wallet. We never hold them.' },
      { n: '02', t: 'Fair', p: 'If you were there, you’re paid. If not, you’re not.' },
      { n: '03', t: 'Transparent', p: 'Every shift has a report. Objections will be recorded in it too. Coming soon.' },
    ],
    flowEyebrow: 'HOW IT WORKS', flowTitle: 'Four steps.',
    flow: [
      { t: 'Set up', p: 'Add your business and its locations.' },
      { t: 'Join', p: 'Each person adds their wallet, once.' },
      { t: 'Check in', p: 'Scan the shift QR. Sign. Done.' },
      { t: 'Get paid', p: 'Customers tip with a QR. When the shift ends, tips are split and sent.' },
    ],
    footer: 'Testnet demo',
  },
  es: {
    ribbon: 'Testnet · Solo fondos de prueba',
    how: 'Cómo funciona', signIn: 'Ingreso de gerentes', mine: 'Mis turnos', setUp: 'Registrar mi negocio',
    eyebrow: 'PROPINAS EN NEAR',
    title: 'Propinas, repartidas con justicia.',
    lead: 'Entrá al turno. Recibí propinas. Cobran todos los que estuvieron, directo a su propia wallet.',
    explore: 'Ver la demo ↗',
    micro: 'Sin frases semilla. Sin publicidad. Sin custodia.',
    cardTop: 'TURNO · ALMUERZO', cardSub: '6 presentes',
    steps: ['Presentes', 'Propinas', 'Reparto', 'Pagado'],
    miniLeft: 'Presentes al cierre', miniRight: 'Reparto igual',
    principles: [
      { n: '01', t: 'Tuyas', p: 'Las propinas van directo a la wallet de cada persona. Nunca las guardamos.' },
      { n: '02', t: 'Justo', p: 'Si estuviste, cobrás. Si no, no.' },
      { n: '03', t: 'Transparente', p: 'Cada turno tiene su reporte. Las objeciones también quedarán registradas ahí. Próximamente.' },
    ],
    flowEyebrow: 'CÓMO FUNCIONA', flowTitle: 'Cuatro pasos.',
    flow: [
      { t: 'Alta', p: 'Sumá tu negocio y sus locales.' },
      { t: 'Sumate', p: 'Cada persona agrega su wallet, una sola vez.' },
      { t: 'Entrá al turno', p: 'Escaneá el QR del turno. Firmá. Listo.' },
      { t: 'Cobrá', p: 'Los clientes dejan propina con un QR. Al cerrar el turno, se reparte y se envía.' },
    ],
    footer: 'Demo en testnet',
  },
}

export function Landing() {
  const c = useCopy(copy)
  return <PublicFrame ribbon={c.ribbon} nav={<>
    <a href="#how">{c.how}</a>
    <a href="#/me">{c.mine}</a>
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
