import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'
import { splitShiftTips } from '../../../../../src/core/group-split.mjs'
import { downloadCsv } from '../csv'
import { DEMO_ADMIN_ID, closeAndDistributeDemo, savedDistributionTx, connectTestnetWallet, explorerTransaction, openPaymentSession, paymentRef, readDemoPool, toAtomicUsdc, type PoolSummary } from '../../near'
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
type Tab = 'company' | 'schedule' | 'shift' | 'employees' | 'tips' | 'report'
const TABS: Tab[] = ['company', 'schedule', 'shift', 'employees', 'tips', 'report']

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
    ribbon: 'MANAGER CONSOLE · Testnet',
    nav: { company: 'Company & locations', schedule: 'Weekly schedule', shift: 'Shifts & check-in', employees: 'Employees', tips: 'Customer QR', report: 'Reports' },
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    configTitle: 'Configuration required', configText: 'This screen needs the public Supabase URL and anonymous key.',
    signingIn: 'Checking your private session…',
    signInTitle: 'Sign in to your company', signInLead: 'We e-mail you a one-time link. No passwords.', email: 'Work e-mail', send: 'Send sign-in link',
    sent: 'Check your inbox for the sign-in link.', sendFail: 'Unable to start the sign-in flow.',
    linkError: (e: string) => `That sign-in link was not accepted (${e}). Request one new link and open it right away.`,
    signOut: 'Sign out', noScope: 'No location is available for this account yet.',
    company: 'Company', orgName: 'Company name', saveOrg: 'Save company', edit: 'Edit', cancel: 'Cancel', orgFirst: 'Name your company first. Locations are registered under it.',
    locations: 'Locations', noLocations: 'No locations yet.', locName: 'Location name', locAddress: 'Address (optional)', addLoc: 'Register location', open: 'Open',
    managers: 'Location managers', managersLead: 'One manager per location. A manager sees only that location and never any employee wallet.', managerEmail: 'Manager e-mail', chooseLoc: 'Choose a location', invite: 'Invite manager', revoke: 'Revoke',
    invited: 'Invitation recorded. The manager can sign in with that e-mail.', inviteFail: 'The invitation could not be created.',
    orgFail: 'The company name was not saved (1–80 characters).', locFail: 'Location not registered. Name the company first and use a unique name.',
    scheduleLead: 'When this location works. A block that ends earlier than it starts continues past midnight.', blockName: 'Shift name (e.g. Morning)', starts: 'Starts', ends: 'Ends', add: 'Add block', remove: 'Remove', saveSchedule: 'Save weekly schedule', scheduleSaved: 'Weekly schedule saved.', scheduleFail: 'The schedule was not saved. Check the blocks.',
    newShift: 'New shift', pickBlock: 'Shift from the weekly schedule', chooseBlock: 'Choose a block', date: 'Date', needSchedule: 'Save the weekly schedule first. Shifts are created from its blocks.',
    groupsTitle: 'Groups for this shift', groupsLead: 'Each group gets ONE check-in QR. Employees inside a group split equally; a group with nobody checked in weighs 0.', groupName: 'Group name', share: '% of shift', capacity: 'People', addGroup: 'Add group', createShift: 'Create shift and QR codes', created: 'Shift created. Show each QR to its group.',
    shareWarn: 'The percentages must add up to 100%.', createFail: 'The shift could not be created. Check the dates and groups.',
    activeShifts: 'Active shifts', noShifts: 'No active shifts.', refresh: 'Refresh', checkedIn: 'checked in', reserved: 'reserved', reserve: 'Reserve a place', pickEmployee: 'Pick an employee', regTitle: 'Employee registration', regSub: 'ONE-TIME · PER LOCATION', regHint: 'Employees scan this QR once and register their wallet.', openLink: 'Open', copyLink: 'Copy link', copied: 'Link copied. You can send it by WhatsApp.', enlarge: 'Enlarge QR', close: 'Close', shiftOf: 'SHIFT', scanHint: 'Employees scan this QR and sign with their wallet.', placesLeft: 'places',
    updated: 'List updated.', regLead: 'Employees register once per location with their own wallet. You see only initials.', issue: 'Create registration link', replace: 'Replace registration link', issued: 'New registration link created. The previous one no longer works.', issueFail: 'The registration link could not be created.',
    registered: 'Registered employees', nobody: 'Nobody has registered yet.', registeredOn: 'Registered',
    working: 'Working…',
    download: 'Download CSV', deleteReport: 'Delete', confirmDelete: 'Delete this report? The final distribution stays on-chain.', deleteFail: 'The report could not be deleted.', retention: 'Reports are deleted automatically 30 days after the shift. The final distribution stays on-chain.', onchain: 'Distribution on-chain ↗',
    tipsLead: 'One public QR for customers. Each QR is an exact, one-time payment session for the pool of the active shift.', poolState: 'Pool status', poolBalance: 'Pool balance', connectAdmin: 'Connect branch wallet', notAdmin: 'This wallet is not the configured branch administrator.', tipAmount: 'Tip amount (test USDC)', openSession: 'Open payment session and create QR', sessionOpened: 'Payment session opened. Show this QR to the customer.', waitingPool: 'The presentation pool is not active yet.', customerQr: 'Customer payment QR', customerHint: 'It only contains an opaque reference: no pool, wallets or percentages.', connectedAs: 'Connected', closeTitle: 'Demo shift close', closeText: 'Closes collection, freezes the split and pays every employee on testnet. Your wallet signs two confirmations. It uses the demonstration pool, whose team is fixed, and it can only be done once.', closeBtn: 'Demo shift close and payout', closeConfirm: 'This closes the demonstration pool and pays out its balance. It cannot be repeated. Continue?', closing: 'Closing the shift…', paying: 'Paying employees…', confirming: 'Waiting for network confirmation…', closeDone: 'Shift closed and tips paid on-chain.', closeAgain: 'This pool was already distributed.', partial: (done: string) => `Only ${done} payouts were delivered. The rest failed, usually because an employee wallet is not registered for USDC. Fix it and press the button again: only the missing ones are paid.`, viewTx: 'View the on-chain distribution',
    reportLead: 'Proposed split of the shift tips, computed from who checked in. A group with nobody present weighs 0; inside a group everyone gets the same.', noReport: 'No active shifts to report yet.', group: 'Group', present: 'Present', groupAmount: 'Group amount', each: 'Each', total: 'Total to distribute', balanceNote: 'Balance of the demonstration pool (testnet).', person: 'Person', amount: 'Amount', nobody2: 'Nobody checked in', splitTitle: 'Distribution proposal',
  },
  es: {
    ribbon: 'CONSOLA DEL GERENTE · Testnet',
    nav: { company: 'Empresa y locales', schedule: 'Horario semanal', shift: 'Turnos y check-in', employees: 'Empleados', tips: 'QR del cliente', report: 'Reportes' },
    days: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
    configTitle: 'Falta configuración', configText: 'Esta pantalla necesita la URL pública de Supabase y la clave anónima.',
    signingIn: 'Verificando tu sesión privada…',
    signInTitle: 'Ingresá a tu empresa', signInLead: 'Te enviamos un link de un solo uso por e-mail. Sin contraseñas.', email: 'E-mail de trabajo', send: 'Enviar link de acceso',
    sent: 'Revisá tu correo: te enviamos el link de acceso.', sendFail: 'No se pudo iniciar el acceso.',
    linkError: (e: string) => `Ese link no fue aceptado (${e}). Pedí uno nuevo y abrilo enseguida.`,
    signOut: 'Salir', noScope: 'Todavía no hay ningún local disponible para esta cuenta.',
    company: 'Empresa', orgName: 'Nombre de la empresa', saveOrg: 'Guardar empresa', edit: 'Editar', cancel: 'Cancelar', orgFirst: 'Primero poné nombre a tu empresa. Los locales se registran dentro de ella.',
    locations: 'Locales', noLocations: 'Todavía no hay locales.', locName: 'Nombre del local', locAddress: 'Dirección (opcional)', addLoc: 'Registrar local', open: 'Abrir',
    managers: 'Gerentes de local', managersLead: 'Un gerente por local. Ve solo ese local y nunca las wallets de los empleados.', managerEmail: 'E-mail del gerente', chooseLoc: 'Elegí un local', invite: 'Invitar gerente', revoke: 'Revocar',
    invited: 'Invitación registrada. El gerente puede ingresar con ese e-mail.', inviteFail: 'No se pudo crear la invitación.',
    orgFail: 'No se guardó el nombre (1 a 80 caracteres).', locFail: 'No se registró el local. Poné nombre a la empresa y usá un nombre único.',
    scheduleLead: 'Cuándo trabaja este local. Un bloque que termina antes de empezar sigue pasada la medianoche.', blockName: 'Nombre del turno (ej. Mañana)', starts: 'Empieza', ends: 'Termina', add: 'Agregar bloque', remove: 'Quitar', saveSchedule: 'Guardar horario semanal', scheduleSaved: 'Horario semanal guardado.', scheduleFail: 'No se guardó el horario. Revisá los bloques.',
    newShift: 'Nuevo turno', pickBlock: 'Turno del horario semanal', chooseBlock: 'Elegí un bloque', date: 'Fecha', needSchedule: 'Primero guardá el horario semanal. Los turnos se crean a partir de sus bloques.',
    groupsTitle: 'Grupos de este turno', groupsLead: 'Cada grupo tiene UN QR de check-in. Dentro de un grupo se reparte en partes iguales; un grupo sin nadie presente pesa 0.', groupName: 'Nombre del grupo', share: '% del turno', capacity: 'Personas', addGroup: 'Agregar grupo', createShift: 'Crear turno y QR', created: 'Turno creado. Mostrá cada QR a su grupo.',
    shareWarn: 'Los porcentajes deben sumar 100%.', createFail: 'No se pudo crear el turno. Revisá las fechas y los grupos.',
    activeShifts: 'Turnos activos', noShifts: 'No hay turnos activos.', refresh: 'Actualizar', checkedIn: 'presentes', reserved: 'reservado', reserve: 'Reservar un lugar', pickEmployee: 'Elegí un empleado', regTitle: 'Registro de empleados', regSub: 'UNA SOLA VEZ · POR LOCAL', regHint: 'Los empleados escanean este QR una vez y registran su wallet.', openLink: 'Abrir', copyLink: 'Copiar link', copied: 'Link copiado. Podés mandarlo por WhatsApp.', enlarge: 'Agrandar QR', close: 'Cerrar', shiftOf: 'TURNO', scanHint: 'Los empleados escanean este QR y firman con su wallet.', placesLeft: 'lugares',
    updated: 'Lista actualizada.', regLead: 'Los empleados se registran una vez por local con su propia wallet. Vos ves solo las iniciales.', issue: 'Crear link de registro', replace: 'Reemplazar link de registro', issued: 'Nuevo link de registro creado. El anterior ya no funciona.', issueFail: 'No se pudo crear el link de registro.',
    registered: 'Empleados registrados', nobody: 'Todavía no se registró nadie.', registeredOn: 'Registrado',
    working: 'Procesando…',
    download: 'Descargar CSV', deleteReport: 'Eliminar', confirmDelete: '¿Eliminar este reporte? La distribución final queda en la blockchain.', deleteFail: 'No se pudo eliminar el reporte.', retention: 'Los reportes se eliminan solos 30 días después del turno. La distribución final queda en la blockchain.', onchain: 'Distribución en la blockchain ↗',
    tipsLead: 'Un QR público para clientes. Cada QR es una sesión de pago exacta y de un solo uso para el pool del turno activo.', poolState: 'Estado del pool', poolBalance: 'Saldo del pool', connectAdmin: 'Conectar wallet del local', notAdmin: 'Esta wallet no es la administradora configurada del local.', tipAmount: 'Monto de la propina (USDC de prueba)', openSession: 'Abrir sesión de pago y crear QR', sessionOpened: 'Sesión de pago abierta. Mostrale este QR al cliente.', waitingPool: 'El pool de la presentación todavía no está activo.', customerQr: 'QR de pago del cliente', customerHint: 'Solo contiene una referencia opaca: ni pool, ni wallets, ni porcentajes.', connectedAs: 'Conectada', closeTitle: 'Demo cierre de turno', closeText: 'Cierra la recolección, congela el reparto y paga a cada empleado en testnet. Tu wallet firma dos confirmaciones. Usa el pool de demostración, cuyo equipo es fijo, y solo se puede hacer una vez.', closeBtn: 'Demo cierre de turno y pago', closeConfirm: 'Esto cierra el pool de demostración y paga su saldo. No se puede repetir. ¿Continuar?', closing: 'Cerrando el turno…', paying: 'Pagando a los empleados…', confirming: 'Esperando la confirmación de la red…', closeDone: 'Turno cerrado y propinas pagadas on-chain.', closeAgain: 'Este pool ya fue repartido.', partial: (done: string) => `Solo se entregaron ${done} pagos. El resto falló, normalmente porque la wallet de un empleado no está registrada para USDC. Corregilo y volvé a pulsar el botón: solo se pagan los que faltan.`, viewTx: 'Ver la distribución on-chain',
    reportLead: 'Reparto propuesto de las propinas del turno según quién hizo check-in. Un grupo sin nadie presente pesa 0; dentro de un grupo todos reciben lo mismo.', noReport: 'Todavía no hay turnos activos para reportar.', group: 'Grupo', present: 'Presentes', groupAmount: 'Monto del grupo', each: 'Cada uno', total: 'Total a repartir', balanceNote: 'Saldo del pool de demostración (testnet).', person: 'Persona', amount: 'Monto', nobody2: 'Nadie hizo check-in', splitTitle: 'Propuesta de reparto',
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
  const send = async () => {
    if (!adminClient) return
    setBusy(true); setMessage(null)
    const redirect = new URL(window.location.href); redirect.search = '?admin=1'; redirect.hash = ''
    const { error } = await adminClient.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect.toString() } })
    setBusy(false); setMessage(error ? c.sendFail : c.sent)
  }
  return <PublicFrame ribbon={c.ribbon}><div className="ts-solo"><div className="ts-card">
    <p className="ts-eyebrow">TIPSHIFT</p>
    <h1 className="ts-h2">{c.signInTitle}</h1>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.signInLead}</p>
    {signInLinkError && <div className="ts-notice bad" role="alert">{c.linkError(signInLinkError)}</div>}
    {!signInLinkError && previousAuthEvent && <div className="ts-notice">{previousAuthEvent}</div>}
    <label className="ts-field">{c.email}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
    {message && <div className="ts-notice" role="status">{message}</div>}
    <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !email} onClick={() => void send()}>{c.send}</button></div>
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
  const [tab, setTab] = useState<Tab>(() => TABS.find((t) => window.location.hash === `#/console/${t}`) ?? 'shift')
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const on = () => { const t = TABS.find((x) => window.location.hash === `#/console/${x}`); if (t) setTab(t) }
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

  const nav: NavItem[] = [
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

function ScheduleTab({ branchRef, busy, setBusy, setNote }: TabProps & { branchRef: string }) {
  const c = useCopy(copy)
  const [blocks, setBlocks] = useState<Block[]>([])
  const load = useCallback(async () => {
    const r = await invoke<{ blocks?: { weekday: number; starts_at: string; ends_at: string; block_label: string | null }[] }>({ action: 'admin_branch_schedule', branchRef })
    setBlocks(Array.isArray(r?.blocks) ? r.blocks.map((b) => ({ weekday: b.weekday, startsAt: b.starts_at, endsAt: b.ends_at, label: b.block_label ?? '' })) : [])
  }, [branchRef])
  useEffect(() => { void load() }, [load])
  const patch = (i: number, p: Partial<Block>) => setBlocks((cur) => cur.map((b, k) => k === i ? { ...b, ...p } : b))
  const save = async () => {
    setBusy(true); setNote(null)
    const r = await invoke({ action: 'admin_set_branch_schedule', branchRef, blocks })
    setBusy(false)
    if (!r) { setNote({ text: c.scheduleFail, bad: true }); return }
    setNote({ text: c.scheduleSaved }); await load()
  }
  return <>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.scheduleLead}</p>
    {c.days.map((day, di) => <div className="ts-card" key={day} style={{ marginTop: 12 }}>
      <h2 className="ts-h3">{day}</h2>
      {blocks.map((b, i) => b.weekday === di + 1 ? <div className="ts-form-grid" key={i} style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', alignItems: 'end' }}>
        <label className="ts-field">{c.blockName}<input value={b.label} maxLength={40} placeholder="Morning" onChange={(e) => patch(i, { label: e.target.value })} /></label>
        <label className="ts-field">{c.starts}<input type="time" value={b.startsAt} onChange={(e) => patch(i, { startsAt: e.target.value })} /></label>
        <label className="ts-field">{c.ends}<input type="time" value={b.endsAt} onChange={(e) => patch(i, { endsAt: e.target.value })} /></label>
        <button className="ts-btn quiet small" onClick={() => setBlocks((cur) => cur.filter((_, k) => k !== i))}>{c.remove}</button>
      </div> : null)}
      <div className="ts-actions"><button className="ts-btn quiet small" disabled={blocks.length >= 70} onClick={() => setBlocks((cur) => [...cur, { weekday: di + 1, startsAt: '09:00', endsAt: '17:00', label: '' }])}>{c.add}</button></div>
    </div>)}
    <div className="ts-actions"><button className="ts-btn primary" disabled={busy} onClick={() => void save()}>{c.saveSchedule}</button></div>
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
  const [amount, setAmount] = useState('5')
  const [qr, setQr] = useState<{ small: string; big: string; link: string } | null>(null)
  const [zoom, setZoom] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [distTx, setDistTx] = useState<string | null>(savedDistributionTx())
  const load = useCallback(() => readDemoPool().then(setPool).catch(() => setPool(null)), [])
  useEffect(() => { void load() }, [load])
  const fail = (e: unknown) => setNote({ text: e instanceof Error ? e.message : String(e), bad: true })
  const connect = async () => {
    setBusy(true); setNote(null)
    try {
      const { accountId } = await connectTestnetWallet({ contractId: undefined, methodNames: ['open_payment_session'] })
      if (accountId !== DEMO_ADMIN_ID) throw new Error(c.notAdmin)
      setAccount(accountId)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const open = async () => {
    if (!account) return
    setBusy(true); setNote(null)
    try {
      const ref = paymentRef()
      await openPaymentSession({ accountId: account, paymentRef: ref, amount: toAtomicUsdc(amount) })
      const link = `${window.location.origin}${window.location.pathname}?payment_ref=${ref}&amount=${encodeURIComponent(amount)}`
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
      {account ? <p className="ts-muted">{c.connectedAs}: <b className="ts-mono">{account}</b></p> : <div className="ts-actions" style={{ marginTop: 0 }}><button className="ts-btn quiet" disabled={busy} onClick={() => void connect()}>{c.connectAdmin}</button></div>}
      <label className="ts-field">{c.tipAmount}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !account || pool?.state !== 'collecting'} onClick={() => void open()}>{c.openSession}</button></div>
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
    </div>}
    {zoom && qr && <QrModal title={`USDC ${amount}`} sub={branchLabel} qr={qr.big} hint={c.customerHint} onClose={() => setZoom(false)} />}
  </>
}

type ReportPerson = { employeeId: string; initials: string; signed: boolean }
type ReportGroup = { groupRef: string; label: string | null; shareBps: number; capacity: number; people: ReportPerson[] }
type Report = { turnRef: string; startsAt: string; endsAt: string; distributionTx: string | null; groups: ReportGroup[] }

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
  const split = (report: Report) => splitShiftTips({ balance, groups: report.groups.map((g) => ({ groupRef: g.groupRef, shareBps: g.shareBps, employeeIds: g.people.filter((p) => p.signed).map((p) => p.employeeId) })) })
  const label = (g: ReportGroup, i: number) => g.label || `${c.group} ${i + 1}`

  const download = (report: Report) => {
    const result = split(report)
    const rows: (string | number)[][] = [['location', 'shift_start', 'shift_end', 'group', 'initials', 'amount_usdc']]
    report.groups.forEach((g, i) => {
      const part = result.find((x) => x.groupRef === g.groupRef)
      for (const person of part?.people ?? []) rows.push([branchLabel, report.startsAt, report.endsAt, label(g, i), g.people.find((p) => p.employeeId === person.employeeId)?.initials ?? '', (Number(person.amount) / 1_000_000).toFixed(6)])
    })
    downloadCsv(`tipshift-report-${report.startsAt.slice(0, 10)}.csv`, rows)
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
        {report.distributionTx && <p style={{ marginTop: 12 }}><a href={explorerTransaction(report.distributionTx)} target="_blank" rel="noreferrer">{c.onchain}</a></p>}
      </div>
    })}
    <div className="ts-actions"><button className="ts-btn quiet" onClick={() => void load()}>{c.refresh}</button></div>
  </>
}
