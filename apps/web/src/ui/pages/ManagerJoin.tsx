import { useEffect, useMemo, useState } from 'react'
import { connectTestnetWallet, walletIsConnected, nonceBuffer } from '../../near'
import { adminClient } from '../../admin'
import { callTipshift, publicClient } from '../client'
import { useCopy } from '../i18n'
import { PublicFrame } from '../layout'

type Start = { branchLabel: string; pseudonym: string; nonce: string; message: string; recipient: string }
type Done = { tokenHash: string; branchLabel: string; accountId: string }

const copy = {
  en: {
    ribbon: 'Manager · Testnet', eyebrow: 'MANAGER', title: 'Manage a location',
    titleAt: (branch: string) => `Manage ${branch}`,
    lead: (name: string) => `You were invited as ${name}. Your wallet becomes this location’s administrator: it closes shifts, pays the team and covers the small network fees. No email or password needed.`,
    checking: 'One moment…', invalid: 'This invitation isn’t valid anymore. Ask the owner for a new QR.',
    connect: 'Connect wallet and join', sign: 'Sign and join', working: 'Verifying…',
    connected: 'Wallet connected. Press the button again to sign.',
    cancelled: 'The wallet request was cancelled or closed.',
    already: 'This wallet already has a role in TipShift. Use a different wallet for this location.',
    failed: 'Couldn’t complete the registration. Try again or ask for a new QR.',
    done: 'You’re in. Opening your console…',
    fees: 'Keep a little NEAR in this wallet for network fees. You can ask the owner for more from the console.',
    privacy: 'Private.', privacyText: ' Signing moves no funds.',
  },
  es: {
    ribbon: 'Gerente · Testnet', eyebrow: 'GERENTE', title: 'Gestioná un local',
    titleAt: (branch: string) => `Gestioná ${branch}`,
    lead: (name: string) => `Te invitaron como ${name}. Tu wallet pasa a ser la administradora de este local: cierra turnos, paga al equipo y cubre las pequeñas comisiones de red. No hace falta email ni contraseña.`,
    checking: 'Un momento…', invalid: 'Esta invitación ya no es válida. Pedile al dueño un QR nuevo.',
    connect: 'Conectar wallet y unirme', sign: 'Firmar y unirme', working: 'Verificando…',
    connected: 'Wallet conectada. Volvé a pulsar el botón para firmar.',
    cancelled: 'La solicitud a la wallet se canceló o se cerró.',
    already: 'Esta wallet ya tiene un rol en TipShift. Usá otra wallet para este local.',
    failed: 'No se pudo completar el registro. Probá de nuevo o pedí un QR nuevo.',
    done: 'Listo. Abriendo tu consola…',
    fees: 'Dejá un poco de NEAR en esta wallet para las comisiones de red. Podés pedirle más al dueño desde la consola.',
    privacy: 'Privado.', privacyText: ' Firmar no mueve fondos.',
  },
}

export function ManagerJoin({ token }: { token: string }) {
  const c = useCopy(copy)
  const client = useMemo(publicClient, [])
  const [info, setInfo] = useState<{ branchLabel: string; pseudonym: string } | null>(null)
  const [message, setMessage] = useState(c.checking)
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!client) return
    void callTipshift<Start>(client, { action: 'manager_join_start', token }).then((r) => {
      if (!r?.branchLabel) { setMessage(c.invalid); return }
      setInfo({ branchLabel: r.branchLabel, pseudonym: r.pseudonym }); setMessage('')
    })
    void walletIsConnected().then(setConnected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, token])
  useEffect(() => { const safe = new URL(window.location.href); safe.hash = ''; window.history.replaceState(null, '', safe) }, [])

  const join = async () => {
    if (!client) return
    setBusy(true); setMessage('')
    try {
      // A browser lets one click open one wallet window: connecting is the first click, signing the second.
      if (!(await walletIsConnected())) { await connectTestnetWallet({}); setConnected(true); setMessage(c.connected); return }
      const proof = await callTipshift<Start>(client, { action: 'manager_join_start', token })
      if (!proof?.nonce) throw new Error('invalid')
      const { wallet } = await connectTestnetWallet({})
      let signed
      try { signed = await wallet.signMessage({ message: proof.message, recipient: proof.recipient, nonce: nonceBuffer(proof.nonce) }) }
      catch { setMessage(c.cancelled); return }
      if (!signed?.accountId || !signed.publicKey || !signed.signature) { setMessage(c.cancelled); return }
      const reply = await client.functions.invoke('tipshift-claims', { body: { action: 'manager_join_complete', token, nonce: proof.nonce, accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature } })
      const done = reply.data as Done | null
      if (reply.error || !done?.tokenHash) {
        const status = (reply.error as { context?: Response } | null)?.context?.status
        setMessage(status === 409 ? c.already : c.failed); return
      }
      if (!adminClient) { setMessage(c.failed); return }
      const { error } = await adminClient.auth.verifyOtp({ token_hash: done.tokenHash, type: 'magiclink' })
      if (error) { setMessage(c.failed); return }
      setMessage(c.done)
      window.setTimeout(() => window.location.assign(`${window.location.origin}/?admin=1#/console/tips`), 900)
    } catch { setMessage(c.failed) } finally { setBusy(false) }
  }

  return <PublicFrame ribbon={c.ribbon}><div className="ts-solo">
    {!client ? <div className="ts-card"><h2 className="ts-h2">Configuration required</h2></div> : <div className="ts-card">
      <p className="ts-eyebrow">{c.eyebrow}</p>
      <h1 className="ts-h2">{info ? c.titleAt(info.branchLabel) : c.title}</h1>
      {info && <><span className="ts-status">{info.pseudonym}</span><p className="ts-lead" style={{ fontSize: 14, marginTop: 12 }}>{c.lead(info.pseudonym)}</p></>}
      {message && <div className="ts-notice" role="status">{message}</div>}
      <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !info} onClick={() => void join()}>{busy ? c.working : connected ? c.sign : c.connect}</button></div>
      <div className="ts-notice"><span>⊙</span><p>{c.fees}</p></div>
      <div className="ts-notice"><span>⊙</span><p><strong>{c.privacy}</strong>{c.privacyText}</p></div>
    </div>}
  </div></PublicFrame>
}
