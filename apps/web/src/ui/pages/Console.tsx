import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toDataURL } from 'qrcode'
import { disputeRows, effectiveShares, type Dispute } from '../dispute'
import { DisputeList } from './Dispute'
import { splitShiftTips } from '../../../../../src/core/group-split.mjs'
import { downloadCsv } from '../csv'
import { connectTestnetWallet, connectedAccountId, walletIsConnected, type RosterMember, closeAndDistribute, createBranchPool, rechargePoolStorage, savedDistributionTx, formatNear, explorerTransaction, handPoolTo, mayAct, parseNear, sendNear, openPaymentSession, paymentRef, readNearBalance, readPool, readStorageCredit, toAtomicUsdc, type PoolSummary, nonceBuffer } from '../../near'
import { adminClient, signInLinkError } from '../../admin'
import { useCopy, useErrorText } from '../i18n'
import { ConsoleShell, PublicFrame, type NavItem } from '../layout'

type Scope = { venue_ref: string; organization_name: string | null; branch_ref: string | null; branch_label: string | null; branch_address: string | null; role: 'organization_admin' | 'branch_admin'; branch_pool_id: string | null }
type Invitation = { invitation_id: string; branch_ref: string; branch_label: string; manager_email: string | null; pseudonym: string | null; manager_wallet: string | null; status: 'invited' | 'active' | 'revoked'; funding_requested: string | null }
type BranchManager = { pseudonym: string; manager_wallet: string; funding_requested: string | null }
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
    signInTitle: 'Sign in', signInLead: 'Sign in with your wallet, or with email and password. New here? Your wallet creates your account the first time.', email: 'Work email', password: 'Password (8+ characters)', send: 'Sign in', create: 'Create account',
    genericFail: 'Something went wrong. Try again.',
    walletConnected: 'Wallet connected. Press “Continue with Meteor” again to sign in.',
    emailBtn: 'Continue with email', walletCancelled: 'The wallet request was cancelled or closed.',
    wallet: 'Continue with Meteor', walletWorking: 'Approve in your wallet…', walletFail: 'Couldn’t sign in with the wallet. Try again.', or: 'or',
    forgot: 'Forgot your password?', resetSent: 'If that email has an account, we sent a link to reset the password.', resetFail: 'Couldn’t send the email. Try again in a minute.', recoveryTitle: 'Choose a new password', recoveryLead: 'Pick a new password for your account (8+ characters).', newPassword: 'New password', savePassword: 'Save password', passwordSaved: 'Password updated.',
    sent: 'Check your inbox.', sendFail: 'Wrong email or password.', accountFail: 'Couldn’t create the account. Use 8+ characters.',
    linkError: (e: string) => `That link didn’t work (${e}). Request a new one and open it right away.`,
    signOut: 'Sign out', soloRuleTips: 'One location run by you: your wallet is enough, no other wallet needed. If another person runs a location, or you have several, each location needs its own manager wallet.', ownerKeeps: 'You keep control of every pool you create: if a manager leaves, you can still close shifts and pay out.', soloRule: 'They never see employee wallets. One location run by you: your wallet is enough, no other wallet needed. If another person runs a location, or you have several, each location needs its own manager wallet.', pseudonym: 'Pseudonym (3 letters)', createManagerQr: 'Create manager QR', managerQrReady: 'Show this QR only to that manager. It works once.', managerQrFail: 'Couldn’t create the QR. Use 3 letters not already used at this location.', waitingSign: 'waiting for signature', sendNear: 'Send NEAR', sendAmount: 'NEAR', sentNear: 'NEAR sent.', sendNearFail: 'Couldn’t send the NEAR.', askedFor: (n: string) => `Asked for ${n} NEAR`, managerLine: 'Manager', handOver: (name: string) => `Hand the pool to ${name}`, handDone: 'Done. The manager’s wallet now runs this pool.', handFail: 'Couldn’t hand over the pool.', askOwner: 'Ask the owner for NEAR', askAmount: 'NEAR needed', askSentMsg: 'Request sent to the owner.', askFail: 'Couldn’t send the request.', signedAs: 'Signed in as', roleOwner: 'Company owner', roleAdmin: 'Location admin', viaWallet: 'wallet', viaEmail: 'email', walletConnectedNow: 'Connected wallet', walletNotConnected: 'No wallet connected', walletConnectBtn: 'Connect wallet', walletNoPool: 'No pool yet for this location. This is the wallet balance that will pay the network fees.', noScope: 'No location yet for this account.',
    company: 'Company', orgName: 'Company name', saveOrg: 'Save', edit: 'Edit', cancel: 'Cancel', orgFirst: 'Name your company first.',
    locations: 'Locations', noLocations: 'No locations yet.', locName: 'Location name', locAddress: 'Address (optional)', addLoc: 'Add location', open: 'Open',
    managers: 'Managers', managersLead: '', managerEmail: 'Manager email', chooseLoc: 'Choose a location', invite: 'Invite', revoke: 'Revoke',
    invited: 'Invited. They can sign in with that email.', inviteFail: 'Couldn’t send the invitation.',
    orgFail: 'Use 1 to 80 characters.', locFail: 'Couldn’t add the location. Name your company first and use a unique name.',
    autosaves: 'Changes save automatically.', scheduleLead: 'When this location works. A block that ends before it starts runs past midnight.', blockName: 'Shift name (e.g. Morning)', starts: 'Starts', ends: 'Ends', add: 'Add', remove: 'Remove', saveSchedule: 'Save schedule', scheduleSaved: 'Schedule saved.', scheduleFail: 'Couldn’t save. Check the blocks.',
    newShift: 'New shift', pickBlock: 'Shift', chooseBlock: 'Choose a shift', date: 'Date', needSchedule: 'Save your schedule first.',
    groupsTitle: 'Groups', groupsLead: 'One QR per group. People in a group split equally.', groupName: 'Group name', share: '% of tips', capacity: 'People', addGroup: 'Add group', createShift: 'Create shift', created: 'Shift created. Show each QR to its group.',
    shareWarn: 'Percentages must add up to 100%.', createFail: 'Couldn’t create the shift. Check the dates and groups.',
    noRoster: 'Nobody has signed in to a shift yet, so there is nobody to pay.',
    dashActive: 'Active shifts', dashGroups: 'Groups', dashPresent: 'People present', dashTips: 'Tips collected', dashNone: 'No active shifts right now. Create one in Shifts.', dashOf: 'of', dashPool: 'Tip pool of this location',
    activeShifts: 'Active shifts', noShifts: 'No active shifts.', refresh: 'Refresh', checkedIn: 'checked in', reserved: 'reserved', reserve: 'Reserve a place', pickEmployee: 'Pick a person', regTitle: 'Join link', regSub: 'ONCE PER PERSON', regHint: 'Your team scans this once to join.', openLink: 'Open', copyLink: 'Copy link', copied: 'Copied. Send it on WhatsApp.', enlarge: 'Enlarge QR', close: 'Close', shiftOf: 'SHIFT', scanHint: 'Scan and sign to check in.', placesLeft: 'places',
    updated: 'Updated.', regLead: 'Everyone joins once with their own wallet. You see only initials.', issue: 'Create join link', replace: 'Replace join link', issued: 'New link created. The old one no longer works.', issueFail: 'Couldn’t create the link.',
    registered: 'Team', nobody: 'Nobody has joined yet.', registeredOn: 'Joined',
    working: 'Working…',
    download: 'Download CSV', deleteReport: 'Delete', confirmDelete: 'Delete this report? The payout stays on-chain.', deleteFail: 'Couldn’t delete the report.', retention: 'Reports are removed after 30 days. The payout stays on-chain.', onchain: 'View on-chain ↗',
    tipsLead: 'Show this QR to a customer. Each QR works for one payment: the customer chooses the amount.', poolState: 'Pool', poolBalance: 'Balance', connectAdmin: 'Authorize with the location wallet', notAdmin: 'This isn’t the location’s admin wallet.', tipAmount: 'Tip (test USDC, optional)', anyAmount: 'Any amount', openSession: 'Create QR', sessionOpened: 'Ready. Show this QR to the customer.', waitingPool: 'The pool isn’t active yet.', customerQr: 'Customer QR', customerHint: 'Reveals no pool, wallet or percentage.', connectedAs: 'Connected', closeTitle: 'Close shift', closeText: 'Closes the shift, splits the tips and pays everyone. You’ll confirm twice in your wallet.', closeBtn: 'Close shift and pay', closeConfirm: 'This closes the shift and pays everyone from the pool. It can’t be repeated. Continue?', closing: 'Closing…', paying: 'Paying…', confirming: 'Confirming…', closeDone: 'Done. Everyone has been paid.', closeAgain: 'Already paid out.', partial: (done: string) => `${done} paid. The rest failed, usually because a wallet isn’t set up for USDC. Fix it and press again: only the missing ones are paid.`, viewTx: 'View on-chain',
    revokePool: 'Revoke this pool and create another', revokeConfirm: 'This unlinks the pool from this location so you can create a new one. Continue?', revokeConfirmFunds: (amount: string) => `The pool still holds ${amount}. Those tips stay in the old pool and only its administrator wallet can pay them out. Unlink it anyway?`, revokeFail: 'Couldn’t revoke the pool.', revoked: 'Pool unlinked. You can create a new one.',
    poolStates: { draft: 'Draft', collecting: 'Collecting tips', distributable: 'Ready to pay', paying: 'Paying', distributed: 'Paid' } as Record<string, string>, inviteStates: { invited: 'invited', active: 'active', revoked: 'revoked' } as Record<string, string>,
    noPoolTitle: 'Set up this location’s tip pool', ownerCreatesPool: 'The company owner has to create this location’s pool first. Ask them to do it from the “Customer QR” tab.', noPoolText: 'One time only, by the company owner. Your wallet creates the pool that holds this location’s tips and becomes its administrator. It pays the small storage reserve and the gas of each close.', createPool: 'Create pool with my wallet', creatingPool: 'Creating…', poolCreated: 'Pool created. You can now create customer QRs.', poolSaveFail: 'The pool was created but couldn’t be saved. Try again.',
    walletTitle: 'Location wallet', walletText: 'The wallet that closes shifts and pays the network fee. Only managers and owners see this.', walletGas: 'NEAR for fees', walletReserve: 'Pool storage reserve', walletAccount: 'Administrator wallet', walletLow: 'Low NEAR balance. Add NEAR to this wallet so you can close shifts.', recharge: 'Add to reserve (0.2 NEAR)', rechargeDone: 'Reserve topped up.', rechargeFail: 'Couldn’t top up.',
    disputeOpen: 'A dispute is still open. Settle it in Reports before closing the shift.',
    reportLead: 'The proposed split, based on who checked in. Empty groups get nothing.', noReport: 'No active shifts yet.', group: 'Group', present: 'Present', groupAmount: 'Group', each: 'Each', total: 'Total', balanceNote: 'Location pool balance (testnet).', person: 'Person', amount: 'Amount', nobody2: 'Nobody checked in', splitTitle: 'Proposed split',
  },
  es: {
    ribbon: 'Gerente · Testnet',
    nav: { dashboard: 'Panel', company: 'Empresa', schedule: 'Horario', shift: 'Turnos', employees: 'Equipo', tips: 'QR del cliente', report: 'Reportes' },
    days: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
    configTitle: 'Falta configuración', configText: 'Faltan la URL pública de Supabase y la clave.',
    signingIn: 'Un momento…',
    signInTitle: 'Ingresá', signInLead: 'Ingresá con tu wallet, o con email y contraseña. ¿Primera vez? Tu wallet crea tu cuenta al ingresar.', email: 'Email de trabajo', password: 'Contraseña (8+ caracteres)', send: 'Ingresar', create: 'Crear cuenta',
    genericFail: 'Algo salió mal. Probá de nuevo.',
    walletConnected: 'Wallet conectada. Tocá “Continuar con Meteor” otra vez para ingresar.',
    emailBtn: 'Continuar con email', walletCancelled: 'Se canceló o se cerró la solicitud de la wallet.',
    wallet: 'Continuar con Meteor', walletWorking: 'Aprobá en tu wallet…', walletFail: 'No se pudo ingresar con la wallet. Probá de nuevo.', or: 'o',
    forgot: '¿Olvidaste tu contraseña?', resetSent: 'Si ese email tiene una cuenta, te enviamos un enlace para restablecer la contraseña.', resetFail: 'No se pudo enviar el correo. Probá de nuevo en un minuto.', recoveryTitle: 'Elegí una nueva contraseña', recoveryLead: 'Elegí una contraseña nueva para tu cuenta (8+ caracteres).', newPassword: 'Contraseña nueva', savePassword: 'Guardar contraseña', passwordSaved: 'Contraseña actualizada.',
    sent: 'Revisá tu correo.', sendFail: 'Email o contraseña incorrectos.', accountFail: 'No se pudo crear la cuenta. Usá 8+ caracteres.',
    linkError: (e: string) => `Ese link no funcionó (${e}). Pedí uno nuevo y abrilo enseguida.`,
    signOut: 'Salir', soloRuleTips: 'Un solo local gestionado por vos: tu wallet alcanza, no hace falta otra. Si otra persona gestiona un local, o tenés varios, cada local necesita su propia wallet de gerente.', ownerKeeps: 'Vos conservás el control de cada pool que creás: si un gerente se va, podés seguir cerrando turnos y pagando.', soloRule: 'Nunca ven las wallets del equipo. Un solo local gestionado por vos: tu wallet alcanza, no hace falta otra. Si otra persona gestiona un local, o tenés varios, cada local necesita su propia wallet de gerente.', pseudonym: 'Seudónimo (3 letras)', createManagerQr: 'Crear QR de gerente', managerQrReady: 'Mostrá este QR solo a ese gerente. Sirve una vez.', managerQrFail: 'No se pudo crear el QR. Usá 3 letras que no estén usadas en este local.', waitingSign: 'esperando la firma', sendNear: 'Enviar NEAR', sendAmount: 'NEAR', sentNear: 'NEAR enviados.', sendNearFail: 'No se pudieron enviar los NEAR.', askedFor: (n: string) => `Pidió ${n} NEAR`, managerLine: 'Gerente', handOver: (name: string) => `Pasarle el pool a ${name}`, handDone: 'Listo. La wallet del gerente ahora administra este pool.', handFail: 'No se pudo pasar el pool.', askOwner: 'Pedirle NEAR al dueño', askAmount: 'NEAR necesarios', askSentMsg: 'Pedido enviado al dueño.', askFail: 'No se pudo enviar el pedido.', signedAs: 'Sesión de', roleOwner: 'Dueño de la empresa', roleAdmin: 'Admin del local', viaWallet: 'wallet', viaEmail: 'email', walletConnectedNow: 'Wallet conectada', walletNotConnected: 'Sin wallet conectada', walletConnectBtn: 'Conectar wallet', walletNoPool: 'Este local todavía no tiene pool. Este es el saldo de la wallet que pagará las comisiones de red.', noScope: 'Esta cuenta todavía no tiene locales.',
    company: 'Empresa', orgName: 'Nombre de la empresa', saveOrg: 'Guardar', edit: 'Editar', cancel: 'Cancelar', orgFirst: 'Primero poné nombre a tu empresa.',
    locations: 'Locales', noLocations: 'Todavía no hay locales.', locName: 'Nombre del local', locAddress: 'Dirección (opcional)', addLoc: 'Agregar local', open: 'Abrir',
    managers: 'Gerentes', managersLead: '', managerEmail: 'Email del gerente', chooseLoc: 'Elegí un local', invite: 'Invitar', revoke: 'Revocar',
    invited: 'Invitado. Puede ingresar con ese email.', inviteFail: 'No se pudo enviar la invitación.',
    orgFail: 'Usá de 1 a 80 caracteres.', locFail: 'No se pudo agregar el local. Poné nombre a tu empresa y usá un nombre único.',
    autosaves: 'Los cambios se guardan solos.', scheduleLead: 'Cuándo trabaja este local. Un bloque que termina antes de empezar sigue pasada la medianoche.', blockName: 'Nombre del turno (ej. Mañana)', starts: 'Empieza', ends: 'Termina', add: 'Agregar', remove: 'Quitar', saveSchedule: 'Guardar horario', scheduleSaved: 'Horario guardado.', scheduleFail: 'No se pudo guardar. Revisá los bloques.',
    newShift: 'Nuevo turno', pickBlock: 'Turno', chooseBlock: 'Elegí un turno', date: 'Fecha', needSchedule: 'Primero guardá tu horario.',
    groupsTitle: 'Grupos', groupsLead: 'Un QR por grupo. Dentro de un grupo se reparte en partes iguales.', groupName: 'Nombre del grupo', share: '% de propinas', capacity: 'Personas', addGroup: 'Agregar grupo', createShift: 'Crear turno', created: 'Turno creado. Mostrá cada QR a su grupo.',
    shareWarn: 'Los porcentajes deben sumar 100%.', createFail: 'No se pudo crear el turno. Revisá las fechas y los grupos.',
    noRoster: 'Todavía nadie firmó el ingreso a un turno, no hay a quién pagar.',
    dashActive: 'Turnos activos', dashGroups: 'Grupos', dashPresent: 'Personas presentes', dashTips: 'Propinas juntadas', dashNone: 'No hay turnos activos ahora. Creá uno en Turnos.', dashOf: 'de', dashPool: 'Pool de propinas de este local',
    activeShifts: 'Turnos activos', noShifts: 'No hay turnos activos.', refresh: 'Actualizar', checkedIn: 'presentes', reserved: 'reservado', reserve: 'Reservar un lugar', pickEmployee: 'Elegí una persona', regTitle: 'Link de alta', regSub: 'UNA VEZ POR PERSONA', regHint: 'Tu equipo lo escanea una vez para sumarse.', openLink: 'Abrir', copyLink: 'Copiar link', copied: 'Copiado. Mandalo por WhatsApp.', enlarge: 'Agrandar QR', close: 'Cerrar', shiftOf: 'TURNO', scanHint: 'Escaneá y firmá para entrar.', placesLeft: 'lugares',
    updated: 'Actualizado.', regLead: 'Cada persona se suma una vez con su propia wallet. Vos ves solo las iniciales.', issue: 'Crear link de alta', replace: 'Reemplazar link de alta', issued: 'Link nuevo creado. El anterior ya no funciona.', issueFail: 'No se pudo crear el link.',
    registered: 'Equipo', nobody: 'Todavía no se sumó nadie.', registeredOn: 'Se sumó',
    working: 'Procesando…',
    download: 'Descargar CSV', deleteReport: 'Eliminar', confirmDelete: '¿Eliminar este reporte? El pago queda en la blockchain.', deleteFail: 'No se pudo eliminar el reporte.', retention: 'Los reportes se borran a los 30 días. El pago queda en la blockchain.', onchain: 'Ver en la blockchain ↗',
    tipsLead: 'Mostrale este QR a un cliente. Cada QR sirve para un pago: el cliente elige el monto.', poolState: 'Pool', poolBalance: 'Saldo', connectAdmin: 'Autorizar con la wallet del local', notAdmin: 'Esta no es la wallet administradora del local.', tipAmount: 'Propina (USDC de prueba, opcional)', anyAmount: 'Cualquier monto', openSession: 'Crear QR', sessionOpened: 'Listo. Mostrale este QR al cliente.', waitingPool: 'El pool todavía no está activo.', customerQr: 'QR del cliente', customerHint: 'No revela pool, wallets ni porcentajes.', connectedAs: 'Conectada', closeTitle: 'Cerrar turno', closeText: 'Cierra el turno, reparte las propinas y paga a todos. Vas a confirmar dos veces en tu wallet.', closeBtn: 'Cerrar turno y pagar', closeConfirm: 'Esto cierra el turno y paga a todos desde el pool. No se puede repetir. ¿Continuar?', closing: 'Cerrando…', paying: 'Pagando…', confirming: 'Confirmando…', closeDone: 'Listo. Todos cobraron.', closeAgain: 'Ya se pagó.', partial: (done: string) => `${done} pagados. El resto falló, normalmente porque una wallet no está preparada para USDC. Corregilo y volvé a pulsar: solo se pagan los que faltan.`, viewTx: 'Ver en la blockchain',
    revokePool: 'Revocar este pool y crear otro', revokeConfirm: 'Esto desvincula el pool de este local para que puedas crear uno nuevo. ¿Continuar?', revokeConfirmFunds: (amount: string) => `El pool todavía tiene ${amount}. Esas propinas quedan en el pool anterior y solo su wallet administradora puede pagarlas. ¿Desvincularlo igual?`, revokeFail: 'No se pudo revocar el pool.', revoked: 'Pool desvinculado. Ya podés crear uno nuevo.',
    poolStates: { draft: 'Borrador', collecting: 'Juntando propinas', distributable: 'Lista para pagar', paying: 'Pagando', distributed: 'Pagada' } as Record<string, string>, inviteStates: { invited: 'invitado', active: 'activo', revoked: 'revocado' } as Record<string, string>,
    noPoolTitle: 'Configurá el pool de propinas de este local', ownerCreatesPool: 'El dueño de la empresa tiene que crear primero el pool de este local. Pedile que lo haga desde la pestaña “QR del cliente”.', noPoolText: 'Se hace una sola vez, por el dueño de la empresa. Tu wallet crea el pool que guarda las propinas del local y queda como su administradora. Paga una pequeña reserva de almacenamiento y el gas de cada cierre.', createPool: 'Crear pool con mi wallet', creatingPool: 'Creando…', poolCreated: 'Pool creado. Ya podés crear QR para los clientes.', poolSaveFail: 'Se creó el pool pero no se pudo guardar. Probá de nuevo.',
    walletTitle: 'Wallet del local', walletText: 'La wallet que cierra los turnos y paga la comisión de red. Solo la ven gerentes y dueños.', walletGas: 'NEAR para comisiones', walletReserve: 'Reserva de almacenamiento del pool', walletAccount: 'Wallet administradora', walletLow: 'Saldo de NEAR bajo. Cargá NEAR en esta wallet para poder cerrar turnos.', recharge: 'Sumar a la reserva (0,2 NEAR)', rechargeDone: 'Reserva recargada.', rechargeFail: 'No se pudo recargar.',
    disputeOpen: 'Hay una disputa abierta. Resolvela en Reportes antes de cerrar el turno.',
    reportLead: 'El reparto propuesto, según quién hizo check-in. Los grupos vacíos no cobran.', noReport: 'Todavía no hay turnos activos.', group: 'Grupo', present: 'Presentes', groupAmount: 'Grupo', each: 'Cada uno', total: 'Total', balanceNote: 'Saldo del pool del local (testnet).', person: 'Persona', amount: 'Monto', nobody2: 'Nadie hizo check-in', splitTitle: 'Reparto propuesto',
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

function Recovery({ onDone }: { onDone: () => void }) {
  const c = useCopy(copy)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const save = async () => {
    if (!adminClient) return
    setBusy(true); setMessage(null)
    const { error } = await adminClient.auth.updateUser({ password })
    setBusy(false)
    if (error) setMessage(c.accountFail); else onDone()
  }
  return <PublicFrame ribbon={c.ribbon}><div className="ts-solo"><div className="ts-card">
    <p className="ts-eyebrow">TIPSHIFT</p>
    <h1 className="ts-h2">{c.recoveryTitle}</h1>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.recoveryLead}</p>
    <label className="ts-field">{c.newPassword}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
    {message && <div className="ts-notice bad" role="alert">{message}</div>}
    <div className="ts-actions"><button className="ts-btn primary" disabled={busy || password.length < 8} onClick={() => void save()}>{c.savePassword}</button></div>
  </div></div></PublicFrame>
}

function SignIn() {
  const c = useCopy(copy)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [showEmail, setShowEmail] = useState(false)
  const reset = async () => {
    if (!adminClient) return
    setBusy(true); setMessage(null); setInfo(null)
    const { error } = await adminClient.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/?admin=1` })
    setBusy(false)
    if (error) setMessage(c.resetFail); else setInfo(c.resetSent)
  }
  // The server says why it refused (restricted key, expired challenge…); it is shown so a failure can be understood.
  const refusal = async (error: unknown) => {
    try { const body = await (error as { context?: Response }).context?.json(); if (body?.error) return String(body.error) } catch { /* no body */ }
    return null
  }
  const walletLogin = async () => {
    if (!adminClient) return
    setBusy(true); setMessage(null); setInfo(c.walletWorking)
    try {
      // A browser only lets a click open one wallet window. The first time, connecting uses that click, so
      // signing needs a second one; once the wallet is connected a single click signs.
      if (!(await walletIsConnected())) {
        await connectTestnetWallet({})
        setInfo(c.walletConnected); return
      }
      const start = await adminClient.functions.invoke('tipshift-claims', { body: { action: 'wallet_login_start' } })
      const challenge = start.data as { nonce: string; recipient: string; message: string } | null
      if (start.error || !challenge?.nonce) throw new Error(`start:${(await refusal(start.error)) ?? 'unreachable'}`)
      const { wallet } = await connectTestnetWallet({})
      let signed
      try { signed = await wallet.signMessage({ message: challenge.message, recipient: challenge.recipient, nonce: nonceBuffer(challenge.nonce) }) }
      catch (err) { throw new Error(`cancelled:${err instanceof Error ? err.message : String(err)}`) }
      if (!signed?.accountId || !signed.publicKey || !signed.signature) throw new Error('cancelled:no signature')
      const done = await adminClient.functions.invoke('tipshift-claims', { body: { action: 'wallet_login_complete', accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: challenge.nonce } })
      const token = (done.data as { tokenHash?: string } | null)?.tokenHash
      if (done.error || !token) throw new Error(`complete:${(await refusal(done.error)) ?? 'unreachable'}`)
      const { error } = await adminClient.auth.verifyOtp({ token_hash: token, type: 'magiclink' })
      if (error) throw new Error(`session:${error.message}`)
      setInfo(null)
    } catch (e) {
      setInfo(null)
      const m = e instanceof Error ? e.message : ''
      console.error('wallet sign-in', e)
      setMessage(m.startsWith('cancelled') ? `${c.walletCancelled} (${m.slice(10)})` : `${c.walletFail}${m ? ` (${m})` : ''}`)
    } finally { setBusy(false) }
  }
  const run = async (create: boolean) => {
    if (!adminClient) return
    setBusy(true); setMessage(null); setInfo(null)
    const { error } = create ? await adminClient.auth.signUp({ email, password }) : await adminClient.auth.signInWithPassword({ email, password })
    setBusy(false); if (error) setMessage(create ? c.accountFail : c.sendFail)
  }
  return <PublicFrame ribbon={c.ribbon}><div className="ts-solo"><div className="ts-card">
    <p className="ts-eyebrow">TIPSHIFT</p>
    <h1 className="ts-h2">{c.signInTitle}</h1>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.signInLead}</p>
    {signInLinkError && <div className="ts-notice bad" role="alert">{c.linkError(signInLinkError)}</div>}
    {message && <div className="ts-notice bad" role="alert">{message}</div>}
    {info && <div className="ts-notice" role="status">{info}</div>}
    <div className="ts-actions">
      <button className="ts-btn primary" disabled={busy} onClick={() => void walletLogin()}>{c.wallet}</button>
      <button className="ts-btn" disabled={busy} aria-expanded={showEmail} onClick={() => setShowEmail((v) => !v)}>{c.emailBtn}</button>
    </div>
    {showEmail && <div style={{ marginTop: 18 }}>
      <label className="ts-field">{c.email}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
      <label className="ts-field">{c.password}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !email || password.length < 8} onClick={() => void run(false)}>{c.send}</button><button className="ts-btn" disabled={busy || !email || password.length < 8} onClick={() => void run(true)}>{c.create}</button></div>
      <div className="ts-actions"><button className="ts-btn quiet small" disabled={busy || !email} onClick={() => void reset()}>{c.forgot}</button></div>
    </div>}
  </div></div></PublicFrame>
}

export function Console() {
  const c = useCopy(copy)
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [recovery, setRecovery] = useState(false)
  useEffect(() => {
    if (!adminClient) return
    void adminClient.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = adminClient.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(next); setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])
  if (!adminClient) return <PublicFrame ribbon={c.ribbon}><div className="ts-solo"><div className="ts-card"><h1 className="ts-h2">{c.configTitle}</h1><p className="ts-lead">{c.configText}</p></div></div></PublicFrame>
  if (!ready) return <PublicFrame ribbon={c.ribbon}><div className="ts-solo"><div className="ts-card"><div className="ts-notice">{c.signingIn}</div></div></div></PublicFrame>
  if (!session) return <SignIn />
  if (recovery) return <Recovery onDone={() => setRecovery(false)} />
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
  const walletName = (session.user.app_metadata as { wallet?: string } | undefined)?.wallet ?? null

  return <ConsoleShell
    workspace={owner?.organization_name ?? 'TipShift'}
    location={branches.length > 1
      ? <select aria-label={c.locations} value={branchRef} onChange={(e) => setBranchRef(e.target.value)} style={{ width: '100%', background: 'transparent', color: 'inherit', border: 0, font: 'inherit' }}>{branches.map((b) => <option key={b.branch_ref} value={b.branch_ref}>{b.branch_label}</option>)}</select>
      : current?.branch_label ?? c.noScope}
    nav={nav} active={active} title={titles[active]} eyebrow={current?.branch_label?.toUpperCase()}
    actions={<button type="button" className="ts-chip" onClick={() => void client.auth.signOut()}>{c.signOut}</button>}>
    <div className="ts-card" style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
      <span><small className="ts-muted">{c.signedAs} ({walletName ? c.viaWallet : c.viaEmail})</small><br /><b className="ts-mono">{walletName ?? session.user.email}</b></span>
      <span className="ts-chip">{current?.role === 'organization_admin' ? c.roleOwner : c.roleAdmin}</span>
    </div>
    {note && <div className={`ts-notice${note.bad ? ' bad' : ''}`} role="status">{note.text}</div>}
    {active === 'dashboard' && (current ? <DashboardTab userId={session.user.id} branchRef={branchRef} poolId={current.branch_pool_id} isOwner={current.role === 'organization_admin'} /> : <p className="ts-muted">{c.noScope}</p>)}
    {active === 'company' && owner && <CompanyTab owner={owner} branches={branches} busy={busy} setBusy={setBusy} setNote={setNote} reload={refreshScopes} onOpen={(ref) => { setBranchRef(ref); window.location.hash = '#/console/shift' }} />}
    {active === 'schedule' && (current ? <ScheduleTab branchRef={branchRef} busy={busy} setBusy={setBusy} setNote={setNote} /> : <p className="ts-muted">{c.noScope}</p>)}
    {active === 'shift' && (current ? <ShiftTab branchLabel={current.branch_label} userId={session.user.id} venueRef={venueRef} branchRef={branchRef} busy={busy} setBusy={setBusy} setNote={setNote} /> : <p className="ts-muted">{c.noScope}</p>)}
    {active === 'tips' && (current ? <TipsTab branchLabel={current.branch_label} userId={session.user.id} branchRef={branchRef} poolId={current.branch_pool_id} isOwner={current.role === 'organization_admin'} reload={refreshScopes} setNote={setNote} /> : <p className="ts-muted">{c.noScope}</p>)}
    {active === 'report' && (current ? <ReportTab branchLabel={current.branch_label} branchRef={branchRef} poolId={current.branch_pool_id} busy={busy} setBusy={setBusy} setNote={setNote} /> : <p className="ts-muted">{c.noScope}</p>)}
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
  const [invitePseudo, setInvitePseudo] = useState('')
  const [managerQr, setManagerQr] = useState<{ name: string; link: string; small: string; big: string } | null>(null)
  const [managerZoom, setManagerZoom] = useState(false)
  const [sendAmounts, setSendAmounts] = useState<Record<string, string>>({})
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
        <label className="ts-field">{c.locName}<input value={locName} maxLength={80} onChange={(e) => setLocName(e.target.value)} placeholder="Downtown" /></label>
        <label className="ts-field">{c.locAddress}<input value={locAddress} maxLength={160} onChange={(e) => setLocAddress(e.target.value)} placeholder="123 Main St" /></label>
      </div>
      <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !locName.trim()} onClick={() => void run(async () => {
        if (!org) { setNote({ text: c.orgFirst, bad: true }); setEditingOrg(true); return }
        const r = await invoke({ action: 'admin_register_branch', venueRef: owner.venue_ref, branchLabel: locName, branchAddress: locAddress })
        if (!r) { setNote({ text: c.locFail, bad: true }); return }
        setLocName(''); setLocAddress(''); await reload()
      })}>{c.addLoc}</button></div>
    </div>
    <div className="ts-card" style={{ marginTop: 16 }}>
      <h2 className="ts-h3">{c.managers}</h2>
      <div className="ts-notice">{c.soloRule}</div>
      <div className="ts-form-grid">
        <label className="ts-field">{c.locations}<select value={inviteBranch} onChange={(e) => setInviteBranch(e.target.value)}><option value="">{c.chooseLoc}</option>{branches.map((b) => <option key={b.branch_ref} value={b.branch_ref}>{b.branch_label}</option>)}</select></label>
        <label className="ts-field">{c.pseudonym}<input value={invitePseudo} maxLength={3} placeholder="ANA" autoComplete="off" onChange={(e) => setInvitePseudo(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} /></label>
      </div>
      <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !inviteBranch || invitePseudo.length !== 3} onClick={() => void run(async () => {
        const token = tokenOf()
        const r = await invoke({ action: 'admin_create_manager_invite', venueRef: owner.venue_ref, branchRef: inviteBranch, pseudonym: invitePseudo, token })
        if (!r) { setNote({ text: c.managerQrFail, bad: true }); return }
        const link = `${window.location.origin}${window.location.pathname}#manager=${token}`
        setManagerQr({ name: invitePseudo, link, small: await toDataURL(link, { width: 240, margin: 1 }), big: await toDataURL(link, { width: 720, margin: 2 }) })
        setInvitePseudo(''); await loadInvites()
      })}>{c.createManagerQr}</button></div>
      {managerQr && <div className="ts-card" style={{ marginTop: 12, textAlign: 'center' }}>
        <strong>{managerQr.name}</strong>
        <div><button type="button" className="ts-qr ts-qr-btn" aria-label={c.enlarge} onClick={() => setManagerZoom(true)}><img src={managerQr.small} alt="QR" width={200} height={200} /></button></div>
        <p className="ts-muted" style={{ fontSize: 13 }}>{c.managerQrReady}</p>
        <div className="ts-actions" style={{ justifyContent: 'center' }}><button type="button" className="ts-btn quiet small" onClick={() => void navigator.clipboard?.writeText(managerQr.link)}>{c.copyLink}</button></div>
      </div>}
      {managerZoom && managerQr && <QrModal title={managerQr.name} sub={c.managers} qr={managerQr.big} hint={c.managerQrReady} onClose={() => setManagerZoom(false)} />}
      <div className="ts-rows" style={{ marginTop: 12 }}>{invites.filter((i) => i.status !== 'revoked').map((i) => {
        const want = i.funding_requested ? (Number(BigInt(i.funding_requested) / 10n ** 18n) / 1_000_000).toString() : ''
        return <div className="ts-row" key={i.invitation_id} style={{ flexWrap: 'wrap' }}><span className="ts-avatar pending">{(i.pseudonym ?? '@').slice(0, 3)}</span><span><strong>{i.pseudonym ?? i.manager_email}</strong><small>{i.branch_label} · {i.status === 'invited' && i.pseudonym ? c.waitingSign : c.inviteStates[i.status] ?? i.status}{i.manager_wallet ? ` · ${i.manager_wallet}` : ''}</small>{want && <small><b>{c.askedFor(want)}</b></small>}</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {i.manager_wallet && <><input aria-label={c.sendAmount} inputMode="decimal" style={{ width: 80 }} value={sendAmounts[i.invitation_id] ?? want} placeholder="1" onChange={(e) => setSendAmounts((cur) => ({ ...cur, [i.invitation_id]: e.target.value }))} /><button className="ts-btn quiet small" disabled={busy} onClick={() => void run(async () => {
              const amount = parseNear(sendAmounts[i.invitation_id] ?? want ?? '')
              if (!amount || !i.manager_wallet) { setNote({ text: c.sendNearFail, bad: true }); return }
              try { await sendNear({ to: i.manager_wallet, amount }); await invoke({ action: 'admin_clear_funding', invitationId: i.invitation_id }); setNote({ text: c.sentNear }); await loadInvites() } catch { setNote({ text: c.sendNearFail, bad: true }) }
            })}>{c.sendNear}</button></>}
            <button className="ts-btn quiet small" disabled={busy} onClick={() => void run(async () => { await invoke({ action: 'admin_revoke_manager', invitationId: i.invitation_id }); await loadInvites() })}>{c.revoke}</button>
          </span></div>
      })}</div>
    </div>
  </>
}

function DashboardTab({ userId, branchRef, poolId, isOwner }: { userId: string; branchRef: string; poolId: string | null; isOwner: boolean }) {
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
      if (poolId) readPool(poolId).then((p) => { if (live) setBalance(p ? BigInt(p.balance) : 0n) }).catch(() => undefined)
    }
    void read(); const t = window.setInterval(() => void read(), 10_000)
    return () => { live = false; window.clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, poolId])
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
    <WalletCard poolId={poolId} canAsk={!isOwner} />
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

function WalletCard({ poolId, canAsk = false }: { poolId: string | null; canAsk?: boolean }) {
  const c = useCopy(copy)
  const errText = useErrorText()
  const [info, setInfo] = useState<{ admin: string; near: bigint; reserve: bigint | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const load = useCallback(async () => {
    try {
      const connected = await connectedAccountId()
      const pool = poolId ? await readPool(poolId) : null
      const admin = pool && connected && mayAct(pool, connected) ? connected : pool?.admin_id ?? connected
      if (!admin) { setInfo(null); return }
      const [near, reserve] = await Promise.all([readNearBalance(admin), poolId && pool ? readStorageCredit(poolId) : Promise.resolve(null)])
      setInfo({ admin, near, reserve })
    } catch { /* the card simply stays empty */ }
  }, [poolId])
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(t) }, [load])
  const [askAmount, setAskAmount] = useState('1')
  const ask = async () => {
    const amount = parseNear(askAmount)
    if (!amount) return
    setBusy(true); setMsg(null)
    const r = await invoke({ action: 'manager_request_funds', amount: amount.toString() })
    setMsg(r ? { text: c.askSentMsg } : { text: c.askFail, bad: true }); setBusy(false)
  }
  const low = info !== null && info.near < 100_000_000_000_000_000_000_000n
  const recharge = async () => {
    setBusy(true); setMsg(null)
    try { if (!poolId) { await connectTestnetWallet({}) } else { await rechargePoolStorage({ poolId }) }; setMsg({ text: c.rechargeDone }); await load() }
    catch (e) { setMsg({ text: errText(e, c.rechargeFail), bad: true }) }
    finally { setBusy(false) }
  }
  return <div className="ts-card" style={{ marginTop: 16 }}>
    <h3 className="ts-h3">{c.walletTitle}</h3>
    <p className="ts-muted" style={{ fontSize: 13 }}>{c.walletText}</p>
    <div className="ts-grid2" style={{ marginTop: 12 }}>
      <div className="ts-stat"><span>{c.walletGas}</span><strong>{info ? `${formatNear(info.near)} NEAR` : '—'}</strong></div>
      {poolId && <div className="ts-stat"><span>{c.walletReserve}</span><strong>{info?.reserve != null ? `${formatNear(info.reserve)} NEAR` : '—'}</strong></div>}
    </div>
    {!info && <p className="ts-muted" style={{ marginTop: 10, fontSize: 13 }}>{c.walletNotConnected}</p>}
    {!poolId && info && <p className="ts-muted" style={{ marginTop: 10, fontSize: 12 }}>{c.walletNoPool}</p>}
    {info && <p className="ts-muted" style={{ marginTop: 10, fontSize: 12 }}>{c.walletAccount}: <b className="ts-mono">{info.admin}</b></p>}
    {low && <div className="ts-notice bad" role="alert">{c.walletLow}</div>}
    {msg && <div className={`ts-notice${msg.bad ? ' bad' : ''}`} role="status">{msg.text}</div>}
    {canAsk && <div className="ts-form-grid" style={{ marginTop: 12 }}>
      <label className="ts-field">{c.askAmount}<input inputMode="decimal" value={askAmount} onChange={(e) => setAskAmount(e.target.value)} /></label>
      <div className="ts-actions" style={{ alignSelf: 'end' }}><button type="button" className="ts-btn primary small" disabled={busy || !parseNear(askAmount)} onClick={() => void ask()}>{c.askOwner}</button></div>
    </div>}
    <div className="ts-actions">{poolId ? <button type="button" className="ts-btn quiet small" disabled={busy || !info} onClick={() => void recharge()}>{busy ? c.working : c.recharge}</button> : <button type="button" className="ts-btn quiet small" disabled={busy} onClick={() => void recharge().then(load)}>{busy ? c.working : c.walletConnectBtn}</button>}</div>
  </div>
}

function TipsTab({ branchLabel, userId, branchRef, poolId, isOwner, reload, setNote }: { branchLabel: string; userId: string; branchRef: string; poolId: string | null; isOwner: boolean; reload: () => Promise<void>; setNote: TabProps['setNote'] }) {
  const c = useCopy(copy)
  const errText = useErrorText()
  const [pool, setPool] = useState<PoolSummary | null | undefined>(undefined)
  const [amount, setAmount] = useState('')
  const [qr, setQr] = useState<{ small: string; big: string; link: string } | null>(null)
  const [zoom, setZoom] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [distTx, setDistTx] = useState<string | null>(poolId ? savedDistributionTx(poolId) : null)
  const [manager, setManager] = useState<BranchManager | null>(null)
  useEffect(() => { void invoke<{ manager?: BranchManager | null }>({ action: 'admin_branch_manager', branchRef }).then((r) => setManager(r?.manager ?? null)) }, [branchRef, poolId])
  const load = useCallback(async () => { if (poolId) await readPool(poolId).then(setPool).catch(() => setPool(null)) }, [poolId])
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(t) }, [load])
  const fail = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); setNote({ text: m === 'NOT_ADMIN' ? c.notAdmin : m === 'POOL_MISSING' ? c.waitingPool : errText(e, c.genericFail), bad: true }) }
  const createPool = async () => {
    setBusy(true); setNote(null)
    try {
      const id = `tsp-${branchRef.replaceAll('-', '').slice(0, 12)}-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(16).padStart(2, '0')).join('')}`
      await createBranchPool({ poolId: id, handTo: manager?.manager_wallet })
      const saved = await invoke({ action: 'admin_set_branch_pool', branchRef, poolId: id })
      if (!saved) throw new Error(c.poolSaveFail)
      await reload(); setNote({ text: c.poolCreated })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const handOver = async () => {
    if (!poolId || !manager) return
    setBusy(true); setNote(null)
    try { await handPoolTo({ poolId, newAdmin: manager.manager_wallet }); await load(); setNote({ text: c.handDone }) }
    catch (e) { setNote({ text: (e instanceof Error && e.message === 'NOT_ADMIN') ? c.notAdmin : errText(e, c.handFail), bad: true }) }
    finally { setBusy(false) }
  }
  const revokePool = async () => {
    const held = pool ? BigInt(pool.balance) : 0n
    if (!window.confirm(held > 0n ? c.revokeConfirmFunds(usdc(held)) : c.revokeConfirm)) return
    setBusy(true); setNote(null)
    try {
      const cleared = await invoke({ action: 'admin_clear_branch_pool', branchRef })
      if (!cleared) throw new Error(c.revokeFail)
      setQr(null); await reload(); setNote({ text: c.revoked })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const open = async () => {
    if (!poolId) return
    setBusy(true); setNote(null)
    try {
      const ref = paymentRef()
      await openPaymentSession({ poolId, paymentRef: ref, amount: amount.trim() ? toAtomicUsdc(amount) : 0n })
      const link = `${window.location.origin}${window.location.pathname}?payment_ref=${ref}&amount=${amount.trim() ? encodeURIComponent(amount) : 'open'}&pool=${encodeURIComponent(poolId)}`
      setQr({ link, small: await toDataURL(link, { width: 240, margin: 1 }), big: await toDataURL(link, { width: 720, margin: 2 }) })
      setNote({ text: c.sessionOpened }); await load()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  // The real roster: everyone who signed in to the latest shift with check-ins, split like the report (group share, then equal parts).
  // An approved correction replaces the original group shares. Returns the shift too, so closing can freeze it.
  const shiftRoster = async (): Promise<{ turnRef: string; roster: RosterMember[] }> => {
    const turns = readShifts().filter((s) => s.userId === userId && s.branchRef === branchRef).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
    for (const turn of turns) {
      const r = await invoke<{ roster?: { groupRef: string; shareBps: number; employeeId: string; wallet: string }[] }>({ action: 'admin_turn_roster', turnRef: turn.turnRef })
      const people = r?.roster ?? []
      if (people.length === 0) continue
      const reports = await invoke<{ reports?: { turnRef: string; disputes?: Dispute[] }[] }>({ action: 'admin_branch_reports', branchRef })
      const disputes = reports?.reports?.find((x) => x.turnRef === turn.turnRef)?.disputes
      if ((disputes ?? []).some((d) => d.state === 'accepted' || d.state === 'correction_voting')) throw new Error('DISPUTE_OPEN')
      const base = [...new Set(people.map((p) => p.groupRef))].map((groupRef) => ({ groupRef, shareBps: people.find((p) => p.groupRef === groupRef)!.shareBps }))
      const shares = new Map(effectiveShares(base, disputes).map((g) => [g.groupRef, g.shareBps]))
      const groups = base.map((g) => ({ groupRef: g.groupRef, shareBps: shares.get(g.groupRef) ?? g.shareBps, employeeIds: people.filter((p) => p.groupRef === g.groupRef).map((p) => p.employeeId) }))
      const share = new Map(splitShiftTips({ balance: 10_000n, groups }).flatMap((g) => g.people.map((p) => [p.employeeId, Number(p.amount)] as const)))
      return { turnRef: turn.turnRef, roster: people.filter((p) => (share.get(p.employeeId) ?? 0) > 0).map((p) => ({ worker_ref: p.employeeId, near_wallet: p.wallet, share_bps: share.get(p.employeeId)! })) }
    }
    throw new Error(c.noRoster)
  }
  const closeShift = async () => {
    if (!window.confirm(c.closeConfirm)) return
    setBusy(true); setNote(null)
    try {
      // Resuming a payout that is already running keeps the frozen roster; otherwise freeze the shift first (no more disputes).
      const live = await readPool(poolId!)
      let turnRef: string | null = null
      let roster: RosterMember[] | undefined
      if (live?.state !== 'paying') {
        const picked = await shiftRoster()
        turnRef = picked.turnRef; roster = picked.roster
        const frozen = await invoke({ action: 'admin_close_turn', turnRef, balance: live?.balance ?? '0' })
        if (!frozen) throw new Error('DISPUTE_OPEN')
      }
      const done = await closeAndDistribute(poolId!, (next) => setStep(c[next]), roster)
      if (done.hash) {
        setDistTx(done.hash)
        turnRef ??= readShifts().filter((s) => s.userId === userId && s.branchRef === branchRef).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0]?.turnRef ?? null
        if (turnRef) await invoke({ action: 'admin_close_turn', turnRef, txHash: done.hash })
      }
      setNote({ text: c.closeDone }); await load()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setNote({ text: m === 'DISPUTE_OPEN' ? c.disputeOpen : m === 'NOT_ADMIN' ? c.notAdmin : m === 'POOL_MISSING' ? c.waitingPool : m === 'ALREADY_DISTRIBUTED' ? c.closeAgain : m.startsWith('PARTIAL:') ? c.partial(m.slice(8)) : errText(e, c.genericFail), bad: true })
    } finally { setBusy(false); setStep('') }
  }
  if (!poolId) return <>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.tipsLead}</p>
    <div className="ts-card" style={{ marginTop: 16 }}>
      <h3 className="ts-h3">{c.noPoolTitle}</h3>
      <p className="ts-muted" style={{ fontSize: 13 }}>{c.noPoolText}</p>
      {isOwner && <div className="ts-notice">{c.soloRuleTips}</div>}
      {manager && <p className="ts-muted" style={{ fontSize: 13 }}>{c.managerLine}: <b>{manager.pseudonym}</b> · <span className="ts-mono">{manager.manager_wallet}</span></p>}
      {isOwner
        ? <div className="ts-actions"><button type="button" className="ts-btn primary" disabled={busy} onClick={() => void createPool()}>{busy ? c.creatingPool : c.createPool}</button></div>
        : <div className="ts-notice">{c.ownerCreatesPool}</div>}
    </div>
  </>
  return <>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.tipsLead}</p>
    <div className="ts-grid2" style={{ marginTop: 18 }}>
      <div className="ts-stat ts-card"><span>{c.poolState}</span><strong>{pool ? (c.poolStates[pool.state] ?? pool.state) : pool === null ? '—' : '…'}</strong></div>
      <div className="ts-stat ts-card"><span>{c.poolBalance}</span><strong>{pool ? usdc(BigInt(pool.balance)) : '—'}</strong></div>
    </div>
    {pool === null && <div className="ts-notice bad">{c.waitingPool}</div>}
    {manager && <p className="ts-muted" style={{ marginTop: 12, fontSize: 13 }}>{c.managerLine}: <b>{manager.pseudonym}</b> · <span className="ts-mono">{manager.manager_wallet}</span>{isOwner ? ` · ${c.ownerKeeps}` : ''}</p>}
    {isOwner && manager && pool?.admin_id && pool.admin_id !== manager.manager_wallet && <div className="ts-actions"><button type="button" className="ts-btn primary small" disabled={busy} onClick={() => void handOver()}>{c.handOver(manager.pseudonym)}</button></div>}
    <WalletCard poolId={poolId} canAsk={!isOwner} />
    {isOwner && <div className="ts-actions" style={{ marginTop: 8 }}><button type="button" className="ts-btn danger small" disabled={busy} onClick={() => void revokePool()}>{c.revokePool}</button></div>}
    <div className="ts-card" style={{ marginTop: 16 }}>
      <label className="ts-field">{c.tipAmount}<input inputMode="decimal" value={amount} placeholder={c.anyAmount} onChange={(e) => setAmount(e.target.value)} /></label>
      <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !pool} onClick={() => void open()}>{c.openSession}</button></div>
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
type Report = { turnRef: string; startsAt: string; endsAt: string; distributionTx: string | null; closed?: boolean; closingBalance?: string | null; groups: ReportGroup[]; disputes?: Dispute[] }

function ReportTab({ branchLabel, branchRef, poolId, busy, setBusy, setNote }: TabProps & { branchLabel: string; branchRef: string; poolId: string | null }) {
  const c = useCopy(copy)
  const [pool, setPool] = useState<PoolSummary | null | undefined>(undefined)
  const [reports, setReports] = useState<Report[] | null>(null)
  const load = useCallback(async () => {
    if (poolId) readPool(poolId).then(setPool).catch(() => setPool(null))
    const r = await invoke<{ reports?: Report[] }>({ action: 'admin_branch_reports', branchRef })
    setReports(Array.isArray(r?.reports) ? r.reports : [])
  }, [branchRef, poolId])
  useEffect(() => { void load() }, [load])
  const balance = pool ? BigInt(pool.balance) : 0n
  const hhmm = (v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const split = (report: Report) => splitShiftTips({ balance: report.closed && report.closingBalance ? BigInt(report.closingBalance) : balance, groups: effectiveShares(report.groups, report.disputes).map((g) => ({ groupRef: g.groupRef, shareBps: g.shareBps, employeeIds: g.people.filter((p) => p.signed).map((p) => p.employeeId) })) })
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
        <div className="ts-top" style={{ marginBottom: 6 }}><div><p className="ts-eyebrow">{c.splitTitle}</p><h3 style={{ fontSize: 20, margin: 0 }}>{new Date(report.startsAt).toLocaleDateString()} · {hhmm(report.startsAt)}–{hhmm(report.endsAt)}{report.closed && report.closingBalance ? ` · ${usdc(BigInt(report.closingBalance))}` : ''}</h3></div>
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
