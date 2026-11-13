import { PublicFrame } from '../layout'
import { useCopy } from '../i18n'

const copy = {
  en: {
    ribbon: 'Testnet · Test funds only',
    back: 'Home', console: 'Manager sign-in', mine: 'My shifts',
    eyebrow: 'THE DEMO', title: 'A shift, start to finish.', lead: 'Seven steps. Each one is a real screen you can try.',
    tryIt: 'Try it', disputeOpen: 'Team is voting', start: 'Set up a business',
    steps: [
      { t: 'Create your company', p: 'Name your business and add its locations.' },
      { t: 'Plan a shift', p: 'Pick the hours, then split the tips between groups.' },
      { t: 'Add your team', p: 'Everyone joins once with a link and their own wallet. You see initials only.' },
      { t: 'Start the shift', p: 'Each group scans its QR and signs. Only people who are there get paid.' },
      { t: 'Customers tip', p: 'A customer scans a QR, pays with a wallet and is done. No cash needed.' },
      { t: 'Raise a dispute', p: 'Something looks wrong? Anyone can object, the team votes, and the result goes in the shift report.' },
      { t: 'Close and pay', p: 'The split is final, everyone is paid in USDC, and the report is ready.' },
    ],
    company: 'Morning Coffee', north: 'North', center: 'Center', open: 'Open',
    lunch: 'Lunch · 12:00–16:00', floor: 'Floor', kitchen: 'Kitchen', of: 'of tips',
    joined: 'Joined', here: 'Here', away: 'Not yet',
    thank: 'Thank the team', pay: 'Pay with wallet', tip: 'TIP',
    objection: 'Objection', votes: 'Team vote', result: 'Corrected split',
    paid: 'Paid', csv: 'Download CSV', each: 'USDC',
  },
  es: {
    ribbon: 'Testnet · Solo fondos de prueba',
    back: 'Inicio', console: 'Ingreso de gerentes', mine: 'Mis turnos',
    eyebrow: 'LA DEMO', title: 'Un turno, de principio a fin.', lead: 'Siete pasos. Cada uno es una pantalla real que podés probar.',
    tryIt: 'Probarlo', disputeOpen: 'El equipo vota', start: 'Registrar mi negocio',
    steps: [
      { t: 'Creá tu empresa', p: 'Poné nombre a tu negocio y sumá sus locales.' },
      { t: 'Armá un turno', p: 'Elegí el horario y repartí las propinas entre grupos.' },
      { t: 'Sumá a tu equipo', p: 'Cada persona se suma una vez con un link y su propia wallet. Vos ves solo las iniciales.' },
      { t: 'Empezá el turno', p: 'Cada grupo escanea su QR y firma. Solo cobra quien está.' },
      { t: 'El cliente deja propina', p: 'Escanea un QR, paga con su wallet y listo. Sin efectivo.' },
      { t: 'Una disputa', p: '¿Algo no cierra? Cualquiera puede objetar, el equipo vota y el resultado queda en el reporte del turno.' },
      { t: 'Cerrá y pagá', p: 'El reparto queda firme, todos cobran en USDC y el reporte está listo.' },
    ],
    company: 'Morning Coffee', north: 'Norte', center: 'Centro', open: 'Abrir',
    lunch: 'Almuerzo · 12:00–16:00', floor: 'Salón', kitchen: 'Cocina', of: 'de las propinas',
    joined: 'Se sumó', here: 'Presente', away: 'Todavía no',
    thank: 'Agradecé al equipo', pay: 'Pagar con wallet', tip: 'PROPINA',
    objection: 'Objeción', votes: 'Voto del equipo', result: 'Reparto corregido',
    paid: 'Pagado', csv: 'Descargar CSV', each: 'USDC',
  },
}

type C = (typeof copy)['en']

function Row({ a, b, c }: { a: string; b?: string; c?: string }) {
  return <div className="ts-row" style={{ gridTemplateColumns: c ? '1fr auto auto' : '1fr auto' }}><strong>{a}</strong>{b && <span className="ts-muted">{b}</span>}{c && <b style={{ fontSize: 12 }}>{c}</b>}</div>
}

function Mock({ n, c }: { n: number; c: C }) {
  switch (n) {
    case 0: return <div className="ts-card"><span className="ts-status">{c.company}</span><div className="ts-rows"><Row a={c.north} b={c.open} /><Row a={c.center} b={c.open} /></div></div>
    case 1: return <div className="ts-card"><span className="ts-status">{c.lunch}</span><div className="ts-rows"><Row a={c.floor} b="60% " c={c.of} /><Row a={c.kitchen} b="40% " c={c.of} /></div></div>
    case 2: return <div className="ts-card"><div className="ts-rows"><Row a="AM" b={c.joined} /><Row a="JR" b={c.joined} /><Row a="LP" b={c.joined} /></div></div>
    case 3: return <div className="ts-card"><span className="ts-status">{c.floor} · 2/3</span><div className="ts-rows"><Row a="AM" b={c.here} /><Row a="JR" b={c.here} /><Row a="CD" b={c.away} /></div></div>
    case 4: return <div className="ts-card"><p className="ts-eyebrow">{c.tip}</p><h3 className="ts-h3">{c.thank}</h3><div className="ts-stat" style={{ marginTop: 14 }}><strong>USDC 10.00</strong></div><div className="ts-actions"><span className="ts-btn primary">{c.pay}</span></div></div>
    case 5: return <div className="ts-card"><span className="ts-status wait">{c.disputeOpen}</span><div className="ts-rows"><Row a={c.objection} b="LP" /><Row a={c.votes} b="3/4" /><Row a={c.result} b="✓" /></div></div>
    default: return <div className="ts-card"><span className="ts-status">{c.paid}</span><div className="ts-rows"><Row a="AM" c="3.00 USDC" /><Row a="JR" c="3.00 USDC" /><Row a="LP" c="4.00 USDC" /></div><div className="ts-actions"><span className="ts-btn quiet small">{c.csv}</span></div></div>
  }
}

export function Demo() {
  const c = useCopy(copy)
  return <PublicFrame ribbon={c.ribbon} nav={<><a href="#/">{c.back}</a><a href="#/me">{c.mine}</a><a href="#/console" className="ts-chip">{c.console}</a></>}>
    <section className="ts-section">
      <p className="ts-eyebrow">{c.eyebrow}</p>
      <h1 className="ts-h1">{c.title}</h1>
      <p className="ts-lead">{c.lead}</p>
    </section>
    {c.steps.map((s, i) => <section key={s.t} className="ts-section ts-demo-step">
      <div>
        <div className="num">{i + 1}</div>
        <h2 className="ts-h2">{s.t}</h2>
        <p className="ts-lead">{s.p}</p>
        <div className="ts-actions"><a className="ts-btn quiet" href={i === 5 ? '#/me' : '#/console'}>{c.tryIt} →</a></div>
      </div>
      <div aria-hidden="true"><Mock n={i} c={c} /></div>
    </section>)}
    <section className="ts-section"><div className="ts-actions"><a className="ts-btn primary" href="#/company">{c.start}</a></div></section>
  </PublicFrame>
}
