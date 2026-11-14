import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toDataURL } from 'qrcode'
import { disputeRows, effectiveShares, type Dispute } from '../dispute'
import { DisputeList } from './Dispute'
import { splitShiftTips } from '../../../../../src/core/group-split.mjs'
import { downloadCsv } from '../csv'
import { DEMO_ADMIN_ID, startCollection, closeAndDistributeDemo, savedDistributionTx, connectTestnetWallet, explorerTransaction, openPaymentSession, paymentRef, readDemoPool, toAtomicUsdc, type PoolSummary } from '../../near'
import { adminClient, previousAuthEvent, signInLinkError, AUTH_EVENT_KEY } from '../../admin'
import { useCopy } from '../i18n'
import { ConsoleShell, PublicFrame, type NavItem } from '../layout'

type Scope = { venue_ref: string; organization_name: string | null; branch_ref: string | null; branch_label: string | null; branch_address: string | null; role: 'organization_admin' | 'branch_admin' }
type Invitation = { invitation_id: string; branch_label: string; manager_email: string; status: 'invited' | 'active' | 'revoked' }
type Block = { weekday: number; startsAt: string; endsAt: string; label: string }
type Employee = { employee_id: string; initials: string; created_at: string }
type Group = { groupRef: string; label: string; shareBps: number; capacity: number }
type Checkin = { group_ref: string; capacity: number; employee_id: string | null; initials: string | null; signed: boolean | null }
type SavedShift = { userId: string; turnRef: string; branchRef: string; startsAt: string; endsAt: string; groups: { groupRef: string; label: string; url: string; shareBps?: number }[] }
type Tab = 'dashboard' | 'company' | 'schedule' | 'shift' | 'employees' | 'tips' | 'report'
const TABS: Tab[] = ['dashboard', 'company', 'schedule', 'shift', 'employees', 'tips', 'report']

const SHIFTS_KEY = 'tipshift-group-shifts'
const readShifts = (): SavedShift[] => {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(SHIFTS_KEY) ?? '[]')
    return Array.isArray(raw) ? (raw as SavedShift[]).filter((s) => s && typeof s.endsAt === 'string' && Date.parse(s.endsAt) > Date.now() - 6 * 3_600_000) : []
  } catch { return [] }
}
const writeShifts = (list: SavedShift[]) => { try { window.localStorage.setItem(SHIFTS_KEY, JSON.stringify(list)) } catch { /* storage unavailable */ } }
// The server builds links from its configured public URL; the link must open the app the manager is using now.
const localUrl = (url: string) => `${window.location.origin}${window.location.pathname}${new URL(url).hash}`
const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const nextDateFor = (weekday: number) => {
  const d = new Date()
  for (let i = 0; i < 7; i += 1) { if (((d.getDay() + 6) % 7) + 1 === weekday) return isoDate(d); d.setDate(d.getDate() + 1) }
  return isoDate(new Date())
}
const tokenOf = () => { const b = crypto.getRandomValues(new Uint8Array(32)); let t = ''; for (const x of b) t += String.fromCharCode(x); return btoa(t).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') }
const equalize = (groups: Group[]): Group[] => groups.map((g, i) => ({ ...g, shareBps: Math.floor(10_000 / groups.length) + (i < 10_000 % groups.length ? 1 : 0) }))

const copy = {
  en: {
    ribbon: 'Manager · Testnet',
    nav: { dashboard: 'Dashboard', company: 'Company', schedule: 'Schedule', shift: 'Shifts', employees: 'Team', tips: 'Customer QR', report: 'Reports' },
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    configTitle: 'Configuration required', configText: 'The public Supabase URL and key are missing.',
    signingIn: 'One moment…',
    signInTitle: 'Sign in', signInLead: 'Use your email and a password. New here? Create an account.', email: 'Work email', password: 'Password (8+ characters)', send: 'Sign in', create: 'Create account',
    sent: 'Check your inbox.', sendFail: 'Wrong email or password.', accountFail: 'Couldn’t create the account. Use 8+ characters.',
    linkError: (e: string) => `That link didn’t work (${e}). Request a new one and open it right away.`,
    signOut: 'Sign out', noScope: 'No location yet for this account.',
    company: 'Company', orgName: 'Company name', saveOrg: 'Save', edit: 'Edit', cancel: 'Cancel', orgFirst: 'Name your company first.',
    locations: 'Locations', noLocations: 'No locations yet.', locName: 'Location name', locAddress: 'Address (optional)', addLoc: 'Add location', open: 'Open',
    managers: 'Managers', managersLead: 'One manager per location. They never see employee wallets.', managerEmail: 'Manager email', chooseLoc: 'Choose a location', invite: 'Invite', revoke: 'Revoke',
    invited: 'Invited. They can sign in with that email.', inviteFail: 'Couldn’t send the invitation.',
    orgFail: 'Use 1 to 80 characters.', locFail: 'Couldn’t add the location. Name your company first and use a unique name.',
    autosaves: 'Changes save automatically.', scheduleLead: 'When this location works. A block that ends before it starts runs past midnight.', blockName: 'Shift name (e.g. Morning)', starts: 'Starts', ends: 'Ends', add: 'Add', remove: 'Remove', saveSchedule: 'Save schedule', scheduleSaved: 'Schedule saved.', scheduleFail: 'Couldn’t save. Check the blocks.',
    newShift: 'New shift', pickBlock: 'Shift', chooseBlock: 'Choose a shift', date: 'Date', needSchedule: 'Save your schedule first.',
    groupsTitle: 'Groups', groupsLead: 'One QR per group. People in a group split equally.', groupName: 'Group name', share: '% of tips', capacity: 'People', addGroup: 'Add group', createShift: 'Create shift', created: 'Shift created. Show each QR to its group.',
    shareWarn: 'Percentages must add up to 100%.', createFail: 'Couldn’t create the shift. Check the dates and groups.',
    dashActive: 'Active shifts', dashGroups: 'Groups', dashPresent: 'People present', dashTips: 'Tips collected', dashNone: 'No active shifts right now. Create one in Shifts.', dashOf: 'of', dashPool: 'Tip pool (demo pool)',
    activeShifts: 'Active shifts', noShifts: 'No active shifts.', refresh: 'Refresh', checkedIn: 'checked in', reserved: 'reserved', reserve: 'Reserve a place', pickEmployee: 'Pick a person', regTitle: 'Join link', regSub: 'ONCE PER PERSON', regHint: 'Your team scans this once to join.', openLink: 'Open', copyLink: 'Copy link', copied: 'Copied. Send it on WhatsApp.', enlarge: 'Enlarge QR', close: 'Close', shiftOf: 'SHIFT', scanHint: 'Scan and sign to check in.', placesLeft: 'places',
    updated: 'Updated.', regLead: 'Everyone joins once with their own wallet. You see only initials.', issue: 'Create join link', replace: 'Replace join link', issued: 'New link created. The old one no longer works.', issueFail: 'Couldn’t create the link.',
    registered: 'Team', nobody: 'Nobody has joined yet.', registeredOn: 'Joined',
    working: 'Working…',
    download: 'Download CSV', deleteReport: 'Delete', confirmDelete: 'Delete this report? The payout stays on-chain.', deleteFail: 'Couldn’t delete the report.', retention: 'Reports are removed after 30 days. The payout stays on-chain.', onchain: 'View on-chain ↗',
    tipsLead: 'Show this QR to a customer. Each QR works for one payment: the customer chooses the amount.', poolState: 'Pool', poolBalance: 'Balance', connectAdmin: 'Authorize with the location wallet', notAdmin: 'This isn’t the location’s admin wallet.', tipAmount: 'Tip (test USDC, optional)', anyAmount: 'Any amount', openSession: 'Create QR', sessionOpened: 'Ready. Show this QR to the customer.', waitingPool: 'The pool isn’t active yet.', customerQr: 'Customer QR', customerHint: 'Reveals no pool, wallet or percentage.', connectedAs: 'Connected', closeTitle: 'Close shift', closeText: 'Closes the shift, splits the tips and pays everyone. You’ll confirm twice in your wallet. Demo only, once.', closeBtn: 'Close shift and pay', closeConfirm: 'This pays out the demo pool and can’t be repeated. Continue?', closing: 'Closing…', paying: 'Paying…', confirming: 'Confirming…', closeDone: 'Done. Everyone has been paid.', closeAgain: 'Already paid out.', partial: (done: string) => `${done} paid. The rest failed, usually because a wallet isn’t set up for USDC. Fix it and press again: only the missing ones are paid.`, viewTx: 'View on-chain',
    reportLead: 'The proposed split, based on who checked in. Empty groups get nothing.', noReport: 'No active shifts yet.', group: 'Group', present: 'Present', groupAmount: 'Group', each: 'Each', total: 'Total', balanceNote: 'Demo pool balance (testnet).', person: 'Person', amount: 'Amount', nobody2: 'Nobody checked in', splitTitle: 'Proposed split',
  },
  es: {
    ribbon: 'Gerente · Testnet',
    nav: { dashboard: 'Panel', company: 'Empresa', schedule: 'Horario', shift: 'Turnos', employees: 'Equipo', tips: 'QR del cliente', report: 'Reportes' },
    days: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
    configTitle: 'Falta configuración', configText: 'Faltan la URL pública de Supabase y la clave.',
    signingIn: 'Un momento…',
    signInTitle: 'Ingresá', signInLead: 'Usá tu email y una contraseña. ¿Primera vez? Creá tu cuenta.', email: 'Email de trabajo', password: 'Contraseña (8+ caracteres)', send: 'Ingresar', create: 'Crear cuenta',
    sent: 'Revisá tu correo.', sendFail: 'Email o contraseña incorrectos.', accountFail: 'No se pudo crear la cuenta. Usá 8+ caracteres.',
    linkError: (e: string) => `Ese link no funcionó (${e}). Pedí uno nuevo y abrilo enseguida.`,
    signOut: 'Salir', noScope: 'Esta cuenta todavía no tiene locales.',
    company: 'Empresa', orgName: 'Nombre de la empresa', saveOrg: 'Guardar', edit: 'Editar', cancel: 'Cancelar', orgFirst: 'Primero poné nombre a tu empresa.',
    locations: 'Locales', noLocations: 'Todavía no hay locales.', locName: 'Nombre del local', locAddress: 'Dirección (opcional)', addLoc: 'Agregar local', open: 'Abrir',
    managers: 'Gerentes', managersLead: 'Un gerente por local. Nunca ve las wallets del equipo.', managerEmail: 'Email del gerente', chooseLoc: 'Elegí un local', invite: 'Invitar', revoke: 'Revocar',
    invited: 'Invitado. Puede ingresar con ese email.', inviteFail: 'No se pudo enviar la invitación.',
    orgFail: 'Usá de 1 a 80 caracteres.', locFail: 'No se pudo agregar el local. Poné nombre a tu empresa y usá un nombre único.',
    autosaves: 'Los cambios se guardan solos.', scheduleLead: 'Cuándo trabaja este local. Un bloque que termina antes de empezar sigue pasada la medianoche.', blockName: 'Nombre del turno (ej. Mañana)', starts: 'Empieza', ends: 'Termina', add: 'Agregar', remove: 'Quitar', saveSchedule: 'Guardar horario', scheduleSaved: 'Horario guardado.', scheduleFail: 'No se pudo guardar. Revisá los bloques.',
    newShift: 'Nuevo turno', pickBlock: 'Turno', chooseBlock: 'Elegí un turno', date: 'Fecha', needSchedule: 'Primero guardá tu horario.',
    groupsTitle: 'Grupos', groupsLead: 'Un QR por grupo. Dentro de un grupo se reparte en partes iguales.', groupName: 'Nombre del grupo', share: '% de propinas', capacity: 'Personas', addGroup: 'Agregar grupo', createShift: 'Crear turno', created: 'Turno creado. Mostrá cada QR a su grupo.',
    shareWarn: 'Los porcentajes deben sumar 100%.', createFail: 'No se pudo crear el turno. Revisá las fechas y los grupos.',
    dashActive: 'Turnos activos', dashGroups: 'Grupos', dashPresent: 'Personas presentes', dashTips: 'Propinas juntadas', dashNone: 'No hay turnos activos ahora. Creá uno en Turnos.', dashOf: 'de', dashPool: 'Pozo de propinas (pool demo)',
    activeShifts: 'Turnos activos', noShifts: 'No hay turnos activos.', refresh: 'Actualizar', checkedIn: 'presentes', reserved: 'reservado', reserve: 'Reservar un lugar', pickEmployee: 'Elegí una persona', regTitle: 'Link de alta', regSub: 'UNA VEZ POR PERSONA', regHint: 'Tu equipo lo escanea una vez para sumarse.', openLink: 'Abrir', copyLink: 'Copiar link', copied: 'Copiado. Mandalo por WhatsApp.', enlarge: 'Agrandar QR', close: 'Cerrar', shiftOf: 'TURNO', scanHint: 'Escaneá y firmá para entrar.', placesLeft: 'lugares',
    updated: 'Actualizado.', regLead: 'Cada persona se suma una vez con su propia wallet. Vos ves solo las iniciales.', issue: 'Crear link de alta', replace: 'Reemplazar link de alta', issued: 'Link nuevo creado. El anterior ya no funciona.', issueFail: 'No se pudo crear el link.',
    registered: 'Equipo', nobody: 'Todavía no se sumó nadie.', registeredOn: 'Se sumó',
    working: 'Procesando…',
    download: 'Descargar CSV', deleteReport: 'Eliminar', confirmDelete: '¿Eliminar este reporte? El pago queda en la blockchain.', deleteFail: 'No se pudo eliminar el reporte.', retention: 'Los reportes se borran a los 30 días. El pago queda en la blockchain.', onchain: 'Ver en la blockchain ↗',
    tipsLead: 'Mostrale este QR a un cliente. Cada QR sirve para un pago: el cliente elige el monto.', poolState: 'Pool', poolBalance: 'Saldo', connectAdmin: 'Autorizar con la wallet del local', notAdmin: 'Esta no es la wallet administradora del local.', tipAmount: 'Propina (USDC de prueba, opcional)', anyAmount: 'Cualquier monto', openSession: 'Crear QR', sessionOpened: 'Listo. Mostrale este QR al cliente.', waitingPool: 'El pool todavía no está activo.', customerQr: 'QR del cliente', customerHint: 'No revela pool, wallets ni porcentajes.', connectedAs: 'Conectada', closeTitle: 'Cerrar turno', closeText: 'Cierra el turno, reparte las propinas y paga a todos. Vas a confirmar dos veces en tu wallet. Solo demo, una vez.', closeBtn: 'Cerrar turno y pagar', closeConfirm: 'Esto paga el pool de demostración y no se puede repetir. ¿Continuar?', closing: 'Cerrando…', paying: 'Pagando…', confirming: 'Confirmando…', closeDone: 'Listo. Todos cobraron.', closeAgain: 'Ya se pagó.', partial: (done: string) => `${done} pagados. El resto falló, normalmente porque una wallet no está preparada para USDC. Corregilo y volvé a pulsar: solo se pagan los que faltan.`, viewTx: 'Ver en la blockchain',
    reportLead: 'El reparto propuesto, según quién hizo check-in. Los grupos vacíos no cobran.', noReport: 'Todavía no hay turnos activos.', group: 'Grupo', present: 'Presentes', groupAmount: 'Grupo', each: 'Cada uno', total: 'Total', balanceNote: 'Saldo del pool de demostración (testnet).', person: 'Persona', amount: 'Monto', nobody2: 'Nadie hizo check-in', splitTitle: 'Reparto propuesto',
  },
}

const invoke = async <T,>(body: Record<string, unknown>): Promise<T | null> => {
  if (!adminClient) return null
  const { data, error } = await adminClient.functions.invoke('tipshift-claims', { body })
  return error || !data ? null : data as T
}

function QrModal({ title, sub, qr, hint, onClose }: { title: string; sub: string; qr: string; hint: string; onClose: () => void }) {
  const c = useCopy(copy)
  return <div className="ts-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
    <div className="ts-modal-card" onClick={(e) => e.stopPropagation()}>
      <p className="ts-eyebrow">{sub}</p>
      <h2 style={{ fontSize: 44, letterSpacing: '-.04em', margin: '0 0 18px', lineHeight: 1.05 }}>{title}</h2>
      <div className="ts-qr"><img src={qr} alt={`QR ${title}`} /></div>
      <p className="ts-muted" style={{ marginTop: 16, fontSize: 15 }}>{hint}</p>
      <div className="ts-actions" style={{ justifyContent: 'center' }}><button type="button" className="ts-btn primary" autoFocus onClick={onClose}>{c.close}</button></div>
    </div>
  </div>
}

function SignIn() {
  const c = useCopy(copy)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const run = async (create: boolean) => {
    if (!adminClient) return
    setBusy(true); setMessage(null)
    const { error } = create ? await adminClient.auth.signUp({ email, password }) : await adminClient.auth.signInWithPassword({ email, password })
    setBusy(false); if (error) setMessage(create ? c.accountFail : c.sendFail)
  }
  return <PublicFrame ribbon={c.ribbon}><div className="ts-solo"><div className="ts-card">
    <p className="ts-eyebrow">TIPSHIFT</p>
    <h1 className="ts-h2">{c.signInTitle}</h1>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.signInLead}</p>
    {signInLinkError && <div className="ts-notice bad" role="alert">{c.linkError(signInLinkError)}</div>}
    {!signInLinkError && previousAuthEvent && <div className="ts-notice">{previousAuthEvent}</div>}
    <label className="ts-field">{c.email}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
    <label className="ts-field">{c.password}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
    {message && <div className="ts-notice bad" role="alert">{message}</div>}
    <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !email || password.length < 8} onClick={() => void run(false)}>{c.send}</button><button className="ts-btn" disabled={busy || !email || password.length < 8} onClick={() => void run(true)}>{c.create}</button></div>
  </div></div></PublicFrame>
}

export function Console() {
  const c = useCopy(copy)
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    if (!adminClient) return
    void adminClient.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = adminClient.auth.onAuthStateChange((event, next) => {
      try { window.localStorage.setItem(AUTH_EVENT_KEY, `${event} at ${new Date().toLocaleTimeString()}`) } catch { /* ignore */ }
      setSession(next); setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])
  if (!adminClient) return <PublicFrame ribbon={c.ribbon}><div className="ts-solo"><div className="ts-card"><h1 className="ts-h2">{c.configTitle}</h1><p className="ts-lead">{c.configText}</p></div></div></PublicFrame>
  if (!ready) return <PublicFrame ribbon={c.ribbon}><div className="ts-solo"><div className="ts-card"><div className="ts-notice">{c.signingIn}</div></div></div></PublicFrame>
  if (!session) return <SignIn />
  return <Signed session={session} />
}

function Signed({ session }: { session: Session }) {
  const c = useCopy(copy)
  const client = adminClient!
  const [scopes, setScopes] = useState<Scope[]>([])
  const [branchRef, setBranchRef] = useState('')
  const explicitTab = useRef(TABS.some((t) => window.location.hash === `#/console/${t}`))
  const [tab, setTab] = useState<Tab>(() => TABS.find((t) => window.location.hash === `#/console/${t}`) ?? 'dashboard')
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const on = () => { const t = TABS.find((x) => window.location.hash === `#/console/${x}`); if (t) { explicitTab.current = true; setTab(t) } }
    window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on)
  }, [])

  const refreshScopes = useCallback(async () => {
    const r = await invoke<{ scopes?: Scope[] }>({ action: 'admin_scopes' })
    if (!r?.scopes) return
    setScopes(r.scopes)
    const first = r.scopes.find((s) => s.branch_ref)
    setBranchRef((cur) => r.scopes!.some((s) => s.branch_ref === cur) ? cur : first?.branch_ref ?? '')
  }, [])
  useEffect(() => { void refreshScopes() }, [refreshScopes, session.access_token])

  const owner = scopes.find((s) => s.role === 'organization_admin')
  const branches = scopes.filter((s): s is Scope & { branch_ref: string; branch_label: string } => Boolean(s.branch_ref && s.branch_label))
  const current = branches.find((b) => b.branch_ref === branchRef)
  const venueRef = current?.venue_ref ?? owner?.venue_ref ?? ''
  // A new owner lands on Company (name, locations, managers) instead of Shifts.
  useEffect(() => {
    if (explicitTab.current || scopes.length === 0) return
    explicitTab.current = true
    setTab(owner && (!owner.organization_name || branches.length === 0) ? 'company' : 'dashboard')
  }, [scopes, owner, branches.length])

  const nav: NavItem[] = [
    { id: 'dashboard', label: c.nav.dashboard, icon: '◈', href: '#/console/dashboard' },
    ...(owner ? [{ id: 'company', label: c.nav.company, icon: '▣', href: '#/console/company' }] : []),
    { id: 'schedule', label: c.nav.schedule, icon: '◷', href: '#/console/schedule' },
    { id: 'shift', label: c.nav.shift, icon: '◉', href: '#/console/shift' },
    { id: 'employees', label: c.nav.employees, icon: '☺', href: '#/console/employees' },
    { id: 'tips', label: c.nav.tips, icon: '▦', href: '#/console/tips' },
    { id: 'report', label: c.nav.report, icon: '≡', href: '#/console/report' },
  ]
  const active: Tab = tab === 'company' && !owner ? 'shift' : tab
  useEffect(() => { setNote(null) }, [active, branchRef])
  const titles: Record<Tab, string> = c.nav

  return <ConsoleShell
    workspace={owner?.organization_name ?? 'TipShift'}
    location={branches.length > 1
      ? <select aria-label={c.locations} value={branchRef} onChange={(e) => setBranchRef(e.target.value)} style={{ width: '100%', background: 'transparent', color: 'inherit', border: 0, font: 'inherit' }}>{branches.map((b) => <option key={b.branch_ref} value={b.branch_ref}>{b.branch_label}</option>)}</select>
      : current?.branch_label ?? c.noScope}
    nav={nav} active={active} title={titles[active]} eyebrow={current?.branch_label?.toUpperCase()}
    actions={<button type="button" className="ts-chip" onClick={() => void client.auth.signOut()}>{c.signOut}</button>}>
    {note && <div className={`ts-notice${note.bad ? ' bad' : ''}`} role="status">{note.text}</div>}
    {active === 'dashboard' && (current ? <DashboardTab userId={session.user.id} branchRef={branchRef} /> : <p className="ts-muted">{c.noScope}</p>)}
    {active === 'company' && owner && <CompanyTab owner={owner} branches={branches} busy={busy} setBusy={setBusy} setNote={setNote} reload={refreshScopes} onOpen={(ref) => { setBranchRef(ref); window.location.hash = '#/console/shift' }} />}
    {active === 'schedule' && (current ? <ScheduleTab branchRef={branchRef} busy={busy} setBusy={setBusy} setNote={setNote} /> : <p className="ts-muted">{c.noScope}</p>)}
    {active === 'shift' && (current ? <ShiftTab branchLabel={current.branch_label} userId={session.user.id} venueRef={venueRef} branchRef={branchRef} busy={busy} setBusy={setBusy} setNote={setNote} /> : <p className="ts-muted">{c.noScope}</p>)}
    {active === 'tips' && (current ? <TipsTab branchLabel={current.branch_label} setNote={setNote} /> : <p className="ts-muted">{c.noScope}</p>)}
    {active === 'report' && (current ? <ReportTab branchLabel={current.branch_label} branchRef={branchRef} busy={busy} setBusy={setBusy} setNote={setNote} /> : <p className="ts-muted">{c.noScope}</p>)}
    {active === 'employees' && (current ? <EmployeesTab userId={session.user.id} venueRef={venueRef} branchRef={branchRef} busy={busy} setBusy={setBusy} setNote={setNote} /> : <p className="ts-muted">{c.noScope}</p>)}
  </ConsoleShell>
}

type TabProps = { busy: boolean; setBusy: (v: boolean) => void; setNote: (n: { text: string; bad?: boolean } | null) => void }

function CompanyTab({ owner, branches, busy, setBusy, setNote, reload, onOpen }: TabProps & { owner: Scope; branches: (Scope & { branch_ref: string; branch_label: string })[]; reload: () => Promise<void>; onOpen: (ref: string) => void }) {
  const c = useCopy(copy)
  const [orgName, setOrgName] = useState('')
  const [editingOrg, setEditingOrg] = useState(false)
  const [locName, setLocName] = useState('')
  const [locAddress, setLocAddress] = useState('')
  const [invites, setInvites] = useState<Invitation[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteBranch, setInviteBranch] = useState('')
  const loadInvites = useCallback(async () => {
    const r = await invoke<{ invitations?: Invitation[] }>({ action: 'admin_manager_invitations', venueRef: owner.venue_ref })
    setInvites(Array.isArray(r?.invitations) ? r.invitations : [])
  }, [owner.venue_ref])
  useEffect(() => { void loadInvites() }, [loadInvites])
  const run = async (fn: () => Promise<void>) => { setBusy(true); setNote(null); await fn(); setBusy(false) }
  const org = owner.organization_name

  return <>
    <div className="ts-card">
      {org && !editingOrg ? <div className="ts-top" style={{ margin: 0 }}>
        <div><p className="ts-eyebrow">{c.company}</p><h2 className="ts-h3" style={{ fontSize: 22 }}>{org}</h2></div>
        <button className="ts-btn quiet small" onClick={() => { setOrgName(org); setEditingOrg(true) }}>{c.edit}</button>
      </div> : <>
        {!org && <div className="ts-notice" style={{ marginTop: 0 }}>{c.orgFirst}</div>}
        <label className="ts-field">{c.orgName}<input autoFocus={editingOrg} value={orgName} maxLength={80} placeholder="Good Morning Coffee" onChange={(e) => setOrgName(e.target.value)} /></label>
        <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !orgName.trim() || orgName.trim() === org} onClick={() => void run(async () => {
          const r = await invoke({ action: 'admin_set_organization', venueRef: owner.venue_ref, organizationName: orgName })
          if (!r) { setNote({ text: c.orgFail, bad: true }); return }
          setOrgName(''); setEditingOrg(false); await reload()
        })}>{c.saveOrg}</button>{org && <button className="ts-btn quiet" onClick={() => { setEditingOrg(false); setOrgName('') }}>{c.cancel}</button>}</div>
      </>}
    </div>
    <div className="ts-card" style={{ marginTop: 16 }}>
      <h2 className="ts-h3">{c.locations}</h2>
      {branches.length === 0 ? <p className="ts-muted">{c.noLocations}</p> : <div className="ts-rows">{branches.map((b) => <div className="ts-row" key={b.branch_ref}><span className="ts-avatar">{b.branch_label.slice(0, 2).toUpperCase()}</span><span><strong>{b.branch_label}</strong><small>{b.branch_address ?? ''}</small></span><button className="ts-btn quiet small" onClick={() => onOpen(b.branch_ref)}>{c.open}</button></div>)}</div>}
      <div className="ts-form-grid">
        <label className="ts-field">{c.locName}<input disabled={!org} value={locName} maxLength={80} onChange={(e) => setLocName(e.target.value)} placeholder="Downtown" /></label>
        <label className="ts-field">{c.locAddress}<input disabled={!org} value={locAddress} maxLength={160} onChange={(e) => setLocAddress(e.target.value)} placeholder="123 Main St" /></label>
      </div>
      <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !org || !locName.trim()} onClick={() => void run(async () => {
        const r = await invoke({ action: 'admin_register_branch', venueRef: owner.venue_ref, branchLabel: locName, branchAddress: locAddress })
        if (!r) { setNote({ text: c.locFail, bad: true }); return }
        setLocName(''); setLocAddress(''); await reload()
      })}>{c.addLoc}</button></div>
    </div>
    <div className="ts-card" style={{ marginTop: 16 }}>
      <h2 className="ts-h3">{c.managers}</h2>
      <p className="ts-lead" style={{ fontSize: 14 }}>{c.managersLead}</p>
      <div className="ts-form-grid">
        <label className="ts-field">{c.locations}<select value={inviteBranch} onChange={(e) => setInviteBranch(e.target.value)}><option value="">{c.chooseLoc}</option>{branches.map((b) => <option key={b.branch_ref} value={b.branch_ref}>{b.branch_label}</option>)}</select></label>
        <label className="ts-field">{c.managerEmail}<input type="email" value={inviteEmail} maxLength={254} onChange={(e) => setInviteEmail(e.target.value)} /></label>
      </div>
      <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !inviteBranch || !inviteEmail.trim()} onClick={() => void run(async () => {
        const r = await invoke({ action: 'admin_invite_manager', venueRef: owner.venue_ref, branchRef: inviteBranch, email: inviteEmail })
        if (!r) { setNote({ text: c.inviteFail, bad: true }); return }
        setNote({ text: c.invited }); setInviteEmail(''); await loadInvites()
      })}>{c.invite}</button></div>
      <div className="ts-rows" style={{ marginTop: 12 }}>{invites.filter((i) => i.status !== 'revoked').map((i) => <div className="ts-row" key={i.invitation_id}><span className="ts-avatar pending">@</span><span><strong>{i.manager_email}</strong><small>{i.branch_label} · {i.status}</small></span><button className="ts-btn quiet small" disabled={busy} onClick={() => void run(async () => { await invoke({ action: 'admin_revoke_manager', invitationId: i.invitation_id }); await loadInvites() })}>{c.revoke}</button></div>)}</div>
    </div>
  </>
}

function DashboardTab({ userId, branchRef }: { userId: string; branchRef: string }) {
  const c = useCopy(copy)
  const [rows, setRows] = useState<Record<string, Checkin[]>>({})
  const [balance, setBalance] = useState<bigint | null>(null)
  const active = readShifts().filter((s) => s.userId === userId && s.branchRef === branchRef && Date.parse(s.startsAt) <= Date.now() + 15 * 60_000 && Date.parse(s.endsAt) > Date.now())
  const key = active.map((s) => s.turnRef).join(',')
  useEffect(() => {
    let live = true
    const read = async () => {
      const next: Record<string, Checkin[]> = {}
      for (const s of active) {
        const r = await invoke<{ checkins?: Checkin[] }>({ action: 'admin_group_checkins', turnRef: s.turnRef })
        if (r?.checkins) next[s.turnRef] = r.checkins
      }
      if (live) setRows(next)
      readDemoPool().then((p) => { if (live) setBalance(p ? BigInt(p.balance) : 0n) }).catch(() => undefined)
    }
    void read(); const t = window.setInterval(() => void read(), 10_000)
    return () => { live = false; window.clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const present = (turnRef: string, groupRef?: string) => (rows[turnRef] ?? []).filter((r) => r.employee_id && (!groupRef || r.group_ref === groupRef)).length
  const totalPresent = active.reduce((n, s) => n + present(s.turnRef), 0)
  const totalGroups = active.reduce((n, s) => n + s.groups.length, 0)
  return <>
    <div className="ts-grid2">
      <div className="ts-stat ts-card"><span>{c.dashActive}</span><strong>{active.length}</strong></div>
      <div className="ts-stat ts-card"><span>{c.dashGroups}</span><strong>{totalGroups}</strong></div>
      <div className="ts-stat ts-card"><span>{c.dashPresent}</span><strong>{totalPresent}</strong></div>
      <div className="ts-stat ts-card"><span>{c.dashTips}</span><strong>{balance === null ? '—' : usdc(balance)}</strong></div>
    </div>
    {active.length === 0 && <div className="ts-notice" style={{ marginTop: 16 }}>{c.dashNone}</div>}
    {active.map((s) => <div className="ts-card" key={s.turnRef} style={{ marginTop: 16 }}>
      <p className="ts-eyebrow">{new Date(s.startsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} – {new Date(s.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
      <div className="ts-rows">{s.groups.map((g) => {
        const cap = (rows[s.turnRef] ?? []).filter((r) => r.group_ref === g.groupRef).length
        return <div className="ts-row" key={g.groupRef}><span className="ts-avatar">{(g.label || c.group).slice(0, 2).toUpperCase()}</span><span><strong>{g.label || c.group}</strong><small>{present(s.turnRef, g.groupRef)} {c.dashOf} {cap} {c.checkedIn}{g.shareBps ? ` · ${(g.shareBps / 100).toFixed(0)}%` : ''}</small></span></div>
      })}</div>
    </div>)}
    <p className="ts-muted" style={{ fontSize: 11, marginTop: 12 }}>{c.dashPool}</p>
  </>
}

function ScheduleTab({ branchRef, busy, setBusy, setNote }: TabProps & { branchRef: string }) {
  const c = useCopy(copy)
  const [blocks, setBlocks] = useState<Block[]>([])
  const load = useCallback(async () => {
    const r = await invoke<{ blocks?: { weekday: number; starts_at: string; ends_at: string; block_label: string | null }[] }>({ action: 'admin_branch_schedule', branchRef })
    setBlocks(Array.isArray(r?.blocks) ? r.blocks.map((b) => ({ weekday: b.weekday, startsAt: b.starts_at, endsAt: b.ends_at, label: b.block_label ?? '' })) : [])
  }, [branchRef])
  useEffect(() => { void load() }, [load])
  const dirty = useRef(false)
  const edit = (fn: (cur: Block[]) => Block[]) => { dirty.current = true; setBlocks(fn) }
  const patch = (i: number, p: Partial<Block>) => edit((cur) => cur.map((b, k) => k === i ? { ...b, ...p } : b))
  const save = useCallback(async () => {
    dirty.current = false
    setBusy(true); setNote(null)
    const r = await invoke({ action: 'admin_set_branch_schedule', branchRef, blocks })
    setBusy(false)
    if (!r) { dirty.current = true; setNote({ text: c.scheduleFail, bad: true }); return }
    setNote({ text: c.scheduleSaved })
  }, [blocks, branchRef, c, setBusy, setNote])
  // Autosave shortly after the last edit, like the groups do, so nothing depends on a button below the fold.
  useEffect(() => {
    if (!dirty.current) return
    const t = window.setTimeout(() => { void save() }, 800)
    return () => window.clearTimeout(t)
  }, [blocks, save])
  return <>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.scheduleLead}</p>
    {c.days.map((day, di) => <div className="ts-card" key={day} style={{ marginTop: 12 }}>
      <h2 className="ts-h3">{day}</h2>
      {blocks.map((b, i) => b.weekday === di + 1 ? <div className="ts-form-grid" key={i} style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', alignItems: 'end' }}>
        <label className="ts-field">{c.blockName}<input value={b.label} maxLength={40} placeholder="Morning" onChange={(e) => patch(i, { label: e.target.value })} /></label>
        <label className="ts-field">{c.starts}<input type="time" value={b.startsAt} onChange={(e) => patch(i, { startsAt: e.target.value })} /></label>
        <label className="ts-field">{c.ends}<input type="time" value={b.endsAt} onChange={(e) => patch(i, { endsAt: e.target.value })} /></label>
        <button className="ts-btn quiet small" onClick={() => edit((cur) => cur.filter((_, k) => k !== i))}>{c.remove}</button>
      </div> : null)}
      <div className="ts-actions"><button className="ts-btn quiet small" disabled={blocks.length >= 70} onClick={() => edit((cur) => [...cur, { weekday: di + 1, startsAt: '09:00', endsAt: '17:00', label: '' }])}>{c.add}</button></div>
    </div>)}
    <p className="ts-muted" style={{ fontSize: 13 }}>{c.autosaves}</p>
  </>
}

function ShiftTab({ branchLabel, userId, venueRef, branchRef, busy, setBusy, setNote }: TabProps & { branchLabel: string; userId: string; venueRef: string; branchRef: string }) {
  const c = useCopy(copy)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [choice, setChoice] = useState('')
  const [date, setDate] = useState('')
  const [groups, setGroups] = useState<Group[]>([{ groupRef: crypto.randomUUID(), label: '', shareBps: 10_000, capacity: 3 }])
  const [shifts, setShifts] = useState<SavedShift[]>(readShifts)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [rows, setRows] = useState<Record<string, Checkin[]>>({})
  const [qrs, setQrs] = useState<Record<string, string>>({})
  const [zoom, setZoom] = useState<{ title: string; sub: string; url: string; qr: string } | null>(null)
  const mine = shifts.filter((s) => s.userId === userId && s.branchRef === branchRef)

  useEffect(() => {
    void invoke<{ blocks?: { weekday: number; starts_at: string; ends_at: string; block_label: string | null }[] }>({ action: 'admin_branch_schedule', branchRef }).then((r) =>
      setBlocks(Array.isArray(r?.blocks) ? r.blocks.map((b) => ({ weekday: b.weekday, startsAt: b.starts_at, endsAt: b.ends_at, label: b.block_label ?? '' })) : []))
    void invoke<{ employees?: Employee[] }>({ action: 'admin_branch_employees', branchRef }).then((r) => setEmployees(Array.isArray(r?.employees) ? r.employees : []))
  }, [branchRef])
  useEffect(() => { const b = blocks[Number(choice)]; if (choice !== '' && b) setDate(nextDateFor(b.weekday)) }, [choice, blocks])
  useEffect(() => { void Promise.all(mine.flatMap((s) => s.groups.map(async (g) => [`${s.turnRef}:${g.groupRef}`, await toDataURL(localUrl(g.url), { width: 200, margin: 1 })] as const))).then((p) => setQrs(Object.fromEntries(p))) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, branchRef])

  const refresh = useCallback(async () => {
    const next: Record<string, Checkin[]> = {}
    for (const s of readShifts().filter((x) => x.userId === userId && x.branchRef === branchRef)) {
      const r = await invoke<{ checkins?: Checkin[] }>({ action: 'admin_group_checkins', turnRef: s.turnRef })
      if (r?.checkins) next[s.turnRef] = r.checkins
    }
    setRows(next)
  }, [userId, branchRef])
  useEffect(() => { void refresh(); const t = window.setInterval(() => void refresh(), 10_000); return () => window.clearInterval(t) }, [refresh, shifts])

  const total = groups.reduce((n, g) => n + g.shareBps, 0)
  const setGroup = (i: number, p: Partial<Group>) => setGroups((cur) => cur.map((g, k) => k === i ? { ...g, ...p } : g))
  const create = async () => {
    const b = blocks[Number(choice)]
    if (!b || !date) return
    const [y, m, d] = date.split('-').map(Number)
    const start = new Date(`${date}T${b.startsAt}`)
    const end = new Date(`${isoDate(new Date(y, m - 1, d + (b.endsAt <= b.startsAt ? 1 : 0)))}T${b.endsAt}`)
    setBusy(true); setNote(null)
    const r = await invoke<{ turnRef?: string; checkinLinks?: { groupRef: string; url: string }[] }>({
      action: 'admin_create_group_turn', venueRef, branchRef, scheduledStartsAt: start.toISOString(), scheduledEndsAt: end.toISOString(),
      groups: groups.map((g) => ({ groupRef: g.groupRef, shareBps: g.shareBps, capacity: g.capacity, label: g.label.trim() })),
    })
    setBusy(false)
    if (!r?.turnRef || !r.checkinLinks) { setNote({ text: c.createFail, bad: true }); return }
    const saved: SavedShift = { userId, turnRef: r.turnRef, branchRef, startsAt: start.toISOString(), endsAt: end.toISOString(), groups: r.checkinLinks.map((l) => ({ groupRef: l.groupRef, url: l.url, label: groups.find((g) => g.groupRef === l.groupRef)?.label.trim() || '', shareBps: groups.find((g) => g.groupRef === l.groupRef)?.shareBps })) }
    const kept = [...readShifts().filter((x) => x.turnRef !== saved.turnRef), saved]
    writeShifts(kept); setShifts(kept); setNote({ text: c.created })
  }
  const reserve = async (turnRef: string, groupRef: string, employeeId: string) => {
    setBusy(true)
    await invoke({ action: 'admin_reserve_place', turnRef, groupRef, employeeId })
    setBusy(false); await refresh()
  }
  const hhmm = (v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return <>
    {mine.length > 0 && <>
      <h2 className="ts-h3">{c.activeShifts}</h2>
      {mine.map((s) => {
        const data = rows[s.turnRef] ?? []
        const placed = new Set(data.map((r) => r.employee_id).filter(Boolean))
        return <div className="ts-card" key={s.turnRef} style={{ marginTop: 12 }}>
          <div className="ts-top" style={{ marginBottom: 14 }}><div><p className="ts-eyebrow">{c.shiftOf}</p><h3 style={{ fontSize: 26, letterSpacing: '-.03em', margin: 0 }}>{branchLabel}</h3><p style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0' }}>{new Date(s.startsAt).toLocaleDateString()} · {hhmm(s.startsAt)}–{hhmm(s.endsAt)}</p></div><button className="ts-btn quiet small" onClick={() => void refresh()}>{c.refresh}</button></div>
          <div className="ts-grid2">{s.groups.map((g, gi) => {
            const gr = data.filter((r) => r.group_ref === g.groupRef)
            const people = gr.filter((r) => r.employee_id)
            const cap = gr[0]?.capacity ?? 0
            const signed = people.filter((r) => r.signed).length
            return <div className="ts-card" key={g.groupRef} style={{ background: 'var(--paper)' }}>
              <h4 style={{ fontSize: 22, margin: 0, letterSpacing: '-.02em' }}>{g.label || `${c.groupName} ${gi + 1}`}</h4>
              <p className="ts-mono" style={{ fontSize: 22, margin: '12px 0 4px' }}>{signed} / {cap} {c.checkedIn}</p>
              <div className="ts-meter"><span style={{ width: `${cap ? Math.min(100, (signed / cap) * 100) : 0}%` }} /></div>
              {qrs[`${s.turnRef}:${g.groupRef}`] && <button type="button" className="ts-qr ts-qr-btn" aria-label={c.enlarge} onClick={() => void toDataURL(localUrl(g.url), { width: 720, margin: 2 }).then((qr) => setZoom({ title: g.label || `${c.groupName} ${gi + 1}`, sub: `${branchLabel} · ${hhmm(s.startsAt)}–${hhmm(s.endsAt)}`, url: localUrl(g.url), qr }))}><img src={qrs[`${s.turnRef}:${g.groupRef}`]} alt={`QR ${g.label}`} width={180} height={180} /></button>}
              <p className="ts-muted" style={{ fontSize: 12 }}>{c.scanHint}</p>
              <div className="ts-rows">{people.map((r) => <div className="ts-row" key={r.employee_id!}><span className={`ts-avatar${r.signed ? '' : ' pending'}`}>{r.initials}</span><span><strong>{r.initials}</strong><small>{r.signed ? c.checkedIn : c.reserved}</small></span><span /></div>)}</div>
              <label className="ts-field">{c.reserve}<select value="" onChange={(e) => e.target.value && void reserve(s.turnRef, g.groupRef, e.target.value)}><option value="">{c.pickEmployee}</option>{employees.filter((e) => !placed.has(e.employee_id)).map((e) => <option key={e.employee_id} value={e.employee_id}>{e.initials}</option>)}</select></label>
              <div className="ts-actions" style={{ marginTop: 14 }}><button type="button" className="ts-btn quiet small" onClick={() => void navigator.clipboard.writeText(localUrl(g.url)).then(() => setNote({ text: c.copied }))}>{c.copyLink}</button><a className="ts-btn quiet small" href={localUrl(g.url)} target="_blank" rel="noreferrer">{c.openLink}</a></div>
            </div>
          })}</div>
        </div>
      })}
    </>}

    {zoom && <QrModal {...zoom} hint={c.scanHint} onClose={() => setZoom(null)} />}
    <h2 className="ts-h3" style={{ marginTop: 28 }}>{c.newShift}</h2>
    {blocks.length === 0 ? <div className="ts-notice">{c.needSchedule}</div> : <div className="ts-card">
      <div className="ts-form-grid">
        <label className="ts-field">{c.pickBlock}<select value={choice} onChange={(e) => setChoice(e.target.value)}><option value="">{c.chooseBlock}</option>{blocks.map((b, i) => <option key={i} value={String(i)}>{c.days[b.weekday - 1].slice(0, 3)} {b.startsAt}–{b.endsAt}{b.label ? ` · ${b.label}` : ''}</option>)}</select></label>
        <label className="ts-field">{c.date}<input type="date" disabled={choice === ''} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <h3 className="ts-h3" style={{ marginTop: 22 }}>{c.groupsTitle}</h3>
      <p className="ts-lead" style={{ fontSize: 14 }}>{c.groupsLead}</p>
      {groups.map((g, i) => <div className="ts-form-grid" key={g.groupRef} style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', alignItems: 'end' }}>
        <label className="ts-field">{c.groupName}<input value={g.label} maxLength={48} placeholder={i === 0 ? 'Waitstaff' : 'Kitchen'} onChange={(e) => setGroup(i, { label: e.target.value })} /></label>
        <label className="ts-field">{c.share}<input type="number" min={0.01} max={100} step={0.01} value={g.shareBps / 100} onChange={(e) => setGroup(i, { shareBps: Math.round(Number(e.target.value) * 100) })} /></label>
        <label className="ts-field">{c.capacity}<input type="number" min={1} max={100} value={g.capacity} onChange={(e) => setGroup(i, { capacity: Math.max(1, Math.min(100, Math.round(Number(e.target.value)))) })} /></label>
        <button className="ts-btn quiet small" disabled={groups.length === 1} onClick={() => setGroups((cur) => equalize(cur.filter((_, k) => k !== i)))}>{c.remove}</button>
      </div>)}
      {total !== 10_000 && <div className="ts-notice bad">{c.shareWarn} ({total / 100}%)</div>}
      <div className="ts-actions"><button className="ts-btn quiet small" disabled={groups.length >= 20} onClick={() => setGroups((cur) => equalize([...cur, { groupRef: crypto.randomUUID(), label: '', shareBps: 0, capacity: 3 }]))}>{c.addGroup}</button></div>
      <div className="ts-actions" style={{ marginTop: 44, paddingTop: 28, borderTop: '1px solid var(--line)', justifyContent: 'flex-end' }}>
        <button className="ts-btn primary" disabled={busy || total !== 10_000 || choice === '' || !date} onClick={() => void create()}>{busy ? c.working : c.createShift}</button>
      </div>
    </div>}
  </>
}

function EmployeesTab({ userId, venueRef, branchRef, busy, setBusy, setNote }: TabProps & { userId: string; venueRef: string; branchRef: string }) {
  const c = useCopy(copy)
  const key = `tipshift-registration-link:${userId}:${branchRef}`
  const read = () => { try { return window.localStorage.getItem(key) } catch { return null } }
  const [employees, setEmployees] = useState<Employee[]>([])
  const [token, setToken] = useState<string | null>(read)
  const [qr, setQr] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const url = token ? `${window.location.origin}${window.location.pathname}#register=${token}` : null
  const load = useCallback(async () => {
    const r = await invoke<{ employees?: Employee[] }>({ action: 'admin_branch_employees', branchRef })
    setEmployees(Array.isArray(r?.employees) ? r.employees : [])
  }, [branchRef])
  useEffect(() => { setToken(read()); void load() }, [branchRef, load]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (url) void toDataURL(url, { width: 220, margin: 1 }).then(setQr); else setQr(null) }, [url])
  const issue = async () => {
    setBusy(true); setNote(null)
    const next = tokenOf()
    const r = await invoke({ action: 'admin_set_registration_link', venueRef, branchRef, token: next })
    setBusy(false)
    if (!r) { setNote({ text: c.issueFail, bad: true }); return }
    try { window.localStorage.setItem(key, next) } catch { /* storage unavailable */ }
    setToken(next); setNote({ text: c.issued })
  }
  return <>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.regLead}</p>
    <div className="ts-card">
      {qr && <button type="button" className="ts-qr ts-qr-btn" aria-label={c.enlarge} onClick={() => void toDataURL(url!, { width: 720, margin: 2 }).then((big) => setZoom(big))}><img src={qr} alt="QR" width={200} height={200} /></button>}
      {zoom && <QrModal title={c.regTitle} sub={c.regSub} qr={zoom} hint={c.regHint} onClose={() => setZoom(null)} />}
      {url && <a className="ts-muted" style={{ fontSize: 11, wordBreak: 'break-all' }} href={url}>{url}</a>}
      <div className="ts-actions">{token ? <button className="ts-btn quiet" disabled={busy} onClick={() => void load().then(() => setNote({ text: c.updated }))}>{c.refresh}</button> : <button className="ts-btn primary" disabled={busy} onClick={() => void issue()}>{c.issue}</button>}</div>
    </div>
    <h2 className="ts-h3" style={{ marginTop: 24 }}>{c.registered} ({employees.length})</h2>
    {employees.length === 0 ? <p className="ts-muted">{c.nobody}</p> : <div className="ts-card"><div className="ts-rows">{employees.map((e) => <div className="ts-row" key={e.employee_id}><span className="ts-avatar">{e.initials}</span><span><strong>{e.initials}</strong><small>{c.registeredOn} {new Date(e.created_at).toLocaleDateString()}</small></span><span /></div>)}</div></div>}
  </>
}

const usdc = (value: bigint) => `USDC ${(Number(value) / 1_000_000).toFixed(2)}`

function TipsTab({ branchLabel, setNote }: { branchLabel: string; setNote: TabProps['setNote'] }) {
  const c = useCopy(copy)
  const [pool, setPool] = useState<PoolSummary | null | undefined>(undefined)
  const [account, setAccount] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [qr, setQr] = useState<{ small: string; big: string; link: string } | null>(null)
  const [zoom, setZoom] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [distTx, setDistTx] = useState<string | null>(savedDistributionTx())
  const load = useCallback(() => readDemoPool().then(setPool).catch(() => setPool(null)), [])
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(t) }, [load])
  const fail = (e: unknown) => setNote({ text: e instanceof Error ? e.message : String(e), bad: true })
  const connect = async () => {
    const { accountId } = await connectTestnetWallet({ contractId: undefined, methodNames: ['start_collection', 'open_payment_session'] })
    if (accountId !== DEMO_ADMIN_ID) throw new Error(c.notAdmin)
    setAccount(accountId)
    return accountId
  }
  const open = async () => {
    setBusy(true); setNote(null)
    try {
      const account = await connect()
      if (pool?.state === 'draft') { await startCollection({ accountId: account }); await load() }
      const ref = paymentRef()
      await openPaymentSession({ accountId: account, paymentRef: ref, amount: amount.trim() ? toAtomicUsdc(amount) : 0n })
      const link = `${window.location.origin}${window.location.pathname}?payment_ref=${ref}&amount=${amount.trim() ? encodeURIComponent(amount) : 'open'}`
      setQr({ link, small: await toDataURL(link, { width: 240, margin: 1 }), big: await toDataURL(link, { width: 720, margin: 2 }) })
      setNote({ text: c.sessionOpened }); await load()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const closeShift = async () => {
    if (!window.confirm(c.closeConfirm)) return
    setBusy(true); setNote(null)
    try {
      const done = await closeAndDistributeDemo((next) => setStep(c[next]))
      if (done.hash) setDistTx(done.hash)
      setNote({ text: c.closeDone }); await load()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setNote({ text: m === 'NOT_ADMIN' ? c.notAdmin : m === 'ALREADY_DISTRIBUTED' ? c.closeAgain : m.startsWith('PARTIAL:') ? c.partial(m.slice(8)) : m, bad: true })
    } finally { setBusy(false); setStep('') }
  }
  return <>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.tipsLead}</p>
    <div className="ts-grid2" style={{ marginTop: 18 }}>
      <div className="ts-stat ts-card"><span>{c.poolState}</span><strong>{pool ? pool.state : pool === null ? '—' : '…'}</strong></div>
      <div className="ts-stat ts-card"><span>{c.poolBalance}</span><strong>{pool ? usdc(BigInt(pool.balance)) : '—'}</strong></div>
    </div>
    {pool === null && <div className="ts-notice bad">{c.waitingPool}</div>}
    <div className="ts-card" style={{ marginTop: 16 }}>
      {account && <p className="ts-muted">{c.connectedAs}: <b className="ts-mono">{account}</b></p>}
      <label className="ts-field">{c.tipAmount}<input inputMode="decimal" value={amount} placeholder={c.anyAmount} onChange={(e) => setAmount(e.target.value)} /></label>
      <div className="ts-actions"><button className="ts-btn primary" disabled={busy || (pool?.state !== 'collecting' && pool?.state !== 'draft')} onClick={() => void open()}>{c.openSession}</button></div>
    </div>
    <div className="ts-card" style={{ marginTop: 16 }}>
      <h3 className="ts-h3">{c.closeTitle}</h3>
      <p className="ts-muted" style={{ fontSize: 13 }}>{c.closeText}</p>
      {step && <div className="ts-notice" role="status">{step}</div>}
      {distTx && <p style={{ marginTop: 10 }}><a href={explorerTransaction(distTx)} target="_blank" rel="noreferrer">{c.viewTx} ↗</a></p>}
      <div className="ts-actions"><button className="ts-btn" disabled={busy || pool?.state === 'distributed' || (pool?.state === 'collecting' && BigInt(pool.balance) === 0n)} onClick={() => void closeShift()}>{c.closeBtn}</button></div>
    </div>
    {qr && <div className="ts-card" style={{ marginTop: 16, display: 'grid', justifyItems: 'center', textAlign: 'center' }}>
      <p className="ts-eyebrow">{c.customerQr}</p>
      <button type="button" className="ts-qr ts-qr-btn" aria-label={c.enlarge} onClick={() => setZoom(true)}><img src={qr.small} alt="QR" width={200} height={200} /></button>
      <p className="ts-muted" style={{ marginTop: 12 }}>{c.customerHint}</p>
      <a className="ts-muted" style={{ fontSize: 11, wordBreak: 'break-all' }} href={qr.link} target="_blank" rel="noreferrer">{qr.link}</a>
      <div className="ts-actions"><button type="button" className="ts-btn quiet small" onClick={() => void navigator.clipboard.writeText(qr.link).then(() => setNote({ text: c.copied }))}>{c.copyLink}</button><a className="ts-btn quiet small" href={qr.link} target="_blank" rel="noreferrer">{c.openLink}</a></div>
    </div>}
    {zoom && qr && <QrModal title={amount.trim() ? `USDC ${amount}` : 'USDC'} sub={branchLabel} qr={qr.big} hint={c.customerHint} onClose={() => setZoom(false)} />}
  </>
}

type ReportPerson = { employeeId: string; initials: string; signed: boolean }
type ReportGroup = { groupRef: string; label: string | null; shareBps: number; capacity: number; people: ReportPerson[] }
type Report = { turnRef: string; startsAt: string; endsAt: string; distributionTx: string | null; groups: ReportGroup[]; disputes?: Dispute[] }

function ReportTab({ branchLabel, branchRef, busy, setBusy, setNote }: TabProps & { branchLabel: string; branchRef: string }) {
  const c = useCopy(copy)
  const [pool, setPool] = useState<PoolSummary | null | undefined>(undefined)
  const [reports, setReports] = useState<Report[] | null>(null)
  const load = useCallback(async () => {
    readDemoPool().then(setPool).catch(() => setPool(null))
    const r = await invoke<{ reports?: Report[] }>({ action: 'admin_branch_reports', branchRef })
    setReports(Array.isArray(r?.reports) ? r.reports : [])
  }, [branchRef])
  useEffect(() => { void load() }, [load])
  const balance = pool ? BigInt(pool.balance) : 0n
  const hhmm = (v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const split = (report: Report) => splitShiftTips({ balance, groups: effectiveShares(report.groups, report.disputes).map((g) => ({ groupRef: g.groupRef, shareBps: g.shareBps, employeeIds: g.people.filter((p) => p.signed).map((p) => p.employeeId) })) })
  const label = (g: ReportGroup, i: number) => g.label || `${c.group} ${i + 1}`

  const download = (report: Report) => {
    const result = split(report)
    const rows: (string | number)[][] = [['location', 'shift_start', 'shift_end', 'group', 'initials', 'amount_usdc']]
    report.groups.forEach((g, i) => {
      const part = result.find((x) => x.groupRef === g.groupRef)
      for (const person of part?.people ?? []) rows.push([branchLabel, report.startsAt, report.endsAt, label(g, i), g.people.find((p) => p.employeeId === person.employeeId)?.initials ?? '', (Number(person.amount) / 1_000_000).toFixed(6)])
    })
    rows.push(...disputeRows(report.disputes, (ref) => { const i = report.groups.findIndex((g) => g.groupRef === ref); return i < 0 ? '' : label(report.groups[i], i) }))
    downloadCsv(`tipshift-report-${report.startsAt.slice(0, 10)}.csv`, rows)
  }
  const propose = async (d: Dispute, shares: { groupRef: string; shareBps: number }[], note: string) => {
    setBusy(true); setNote(null)
    const r = await invoke({ action: 'admin_dispute_propose', disputeId: d.disputeId, shares, note })
    setBusy(false)
    if (!r) { setNote({ text: c.deleteFail, bad: true }); return }
    await load()
  }
  const remove = async (report: Report) => {
    if (!window.confirm(c.confirmDelete)) return
    setBusy(true); setNote(null)
    const r = await invoke({ action: 'admin_delete_report', turnRef: report.turnRef })
    setBusy(false)
    if (!r) { setNote({ text: c.deleteFail, bad: true }); return }
    await load()
  }
  return <>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.reportLead}</p>
    <div className="ts-grid2" style={{ marginTop: 18 }}>
      <div className="ts-stat ts-card"><span>{c.total}</span><strong>{usdc(balance)}</strong><p className="ts-muted" style={{ fontSize: 11, marginTop: 6 }}>{c.balanceNote}</p></div>
      <div className="ts-stat ts-card"><span>{c.locations}</span><strong>{branchLabel}</strong></div>
    </div>
    <div className="ts-notice">{c.retention}</div>
    {reports && reports.length === 0 && <div className="ts-notice">{c.noReport}</div>}
    {(reports ?? []).map((report) => {
      const result = split(report)
      return <div className="ts-card" key={report.turnRef} style={{ marginTop: 16 }}>
        <div className="ts-top" style={{ marginBottom: 6 }}><div><p className="ts-eyebrow">{c.splitTitle}</p><h3 style={{ fontSize: 20, margin: 0 }}>{new Date(report.startsAt).toLocaleDateString()} · {hhmm(report.startsAt)}–{hhmm(report.endsAt)}</h3></div>
          <div className="ts-actions" style={{ marginTop: 0 }}><button className="ts-btn quiet small" onClick={() => download(report)}>{c.download}</button><button className="ts-btn danger small" disabled={busy} onClick={() => void remove(report)}>{c.deleteReport}</button></div></div>
        <div style={{ overflowX: 'auto' }}><table className="ts-table"><thead><tr><th>{c.group}</th><th>{c.present}</th><th>{c.groupAmount}</th><th>{c.person}</th></tr></thead><tbody>
          {report.groups.map((g, i) => {
            const part = result.find((x) => x.groupRef === g.groupRef)
            const present = g.people.filter((p) => p.signed)
            return <tr key={g.groupRef}><td><strong>{label(g, i)}</strong></td><td className="ts-mono">{present.length}</td><td className="ts-mono">{usdc(part?.amount ?? 0n)}</td><td>{present.length === 0 ? <span className="ts-muted">{c.nobody2}</span> : (part?.people ?? []).map((p) => <span key={p.employeeId} style={{ display: 'inline-flex', gap: 8, marginRight: 14 }}><span className="ts-avatar" style={{ width: 'auto', padding: '0 8px' }}>{present.find((x) => x.employeeId === p.employeeId)?.initials}</span><span className="ts-mono">{usdc(p.amount)}</span></span>)}</td></tr>
          })}
        </tbody></table></div>
        {(report.disputes ?? []).length > 0 && <DisputeList disputes={report.disputes ?? []} busy={busy} onPropose={(d, shares, note) => void propose(d, shares, note)}
          groups={report.groups.map((g, i) => ({ groupRef: g.groupRef, label: label(g, i), shareBps: g.shareBps }))} />}
        {report.distributionTx && <p style={{ marginTop: 12 }}><a href={explorerTransaction(report.distributionTx)} target="_blank" rel="noreferrer">{c.onchain}</a></p>}
      </div>
    })}
    <div className="ts-actions"><button className="ts-btn quiet" onClick={() => void load()}>{c.refresh}</button></div>
  </>
}
