import { Buffer } from 'buffer'
import { useEffect, useMemo, useState } from 'react'
import { connectTestnetWallet } from '../../near'
import { callTipshift, publicClient } from '../client'
import { useCopy } from '../i18n'
import { PublicFrame } from '../layout'

type Start = { branchLabel: string; branchRef: string; nonce: string; message: string; recipient: string }
type Done = { employee: { initials: string; branchLabel: string } }

const copy = {
  en: {
    ribbon: 'EMPLOYEE REGISTRATION · Testnet',
    eyebrow: 'ONE-TIME REGISTRATION', titleAt: (branch: string) => `Register at ${branch}`, title: 'Register as an employee',
    lead: 'You register once per location. The wallet you connect becomes the address where your tips are paid.',
    checking: 'Checking your registration link…',
    invalid: 'This registration link is unavailable or has been replaced. Ask your manager for a new one.',
    ready: 'Enter your initials, then connect the NEAR wallet where you want to receive your tips.',
    initials: 'Your initials (1–4 letters)', connect: 'Connect NEAR wallet and register', working: 'Verifying…',
    preparing: 'Preparing a one-time signature…', verifying: 'Verifying wallet control…',
    noLink: 'Use the registration link or QR your manager gave you.', noLinkTitle: 'Registration link required',
    config: 'Configuration required',
    failed: 'The registration could not be completed. Check that your initials are 1 to 4 letters.',
    noSig: 'The wallet did not return a signature.', unusable: 'This registration link can no longer be used.',
    doneTitle: 'You are registered.', doneText: 'Your manager sees only your initials, never your wallet. Next, scan the QR for your group at the start of each shift.',
    privacy: 'Privacy by design.', privacyText: ' TipShift never asks for your name, email, phone or seed phrase. Signing proves you control the wallet; it moves no funds.',
  },
  es: {
    ribbon: 'REGISTRO DE EMPLEADO · Testnet',
    eyebrow: 'REGISTRO ÚNICO', titleAt: (branch: string) => `Registrarse en ${branch}`, title: 'Registrarse como empleado',
    lead: 'Te registrás una sola vez por local. La wallet que conectes será la dirección donde cobrás tus propinas.',
    checking: 'Verificando tu link de registro…',
    invalid: 'Este link de registro no está disponible o fue reemplazado. Pedile uno nuevo a tu gerente.',
    ready: 'Ingresá tus iniciales y conectá la wallet NEAR donde querés recibir tus propinas.',
    initials: 'Tus iniciales (1 a 4 letras)', connect: 'Conectar wallet NEAR y registrarme', working: 'Verificando…',
    preparing: 'Preparando una firma de un solo uso…', verifying: 'Verificando el control de la wallet…',
    noLink: 'Usá el link o el QR de registro que te dio tu gerente.', noLinkTitle: 'Hace falta un link de registro',
    config: 'Falta configuración',
    failed: 'No se pudo completar el registro. Revisá que tus iniciales sean de 1 a 4 letras.',
    noSig: 'La wallet no devolvió una firma.', unusable: 'Este link de registro ya no se puede usar.',
    doneTitle: 'Ya estás registrado.', doneText: 'Tu gerente ve solo tus iniciales, nunca tu wallet. Ahora, al comenzar cada turno, escaneá el QR de tu grupo.',
    privacy: 'Privacidad por diseño.', privacyText: ' TipShift nunca te pide nombre, email, teléfono ni frase semilla. Firmar demuestra que controlás la wallet; no mueve fondos.',
  },
}

export function EmployeeRegister({ token }: { token: string }) {
  const c = useCopy(copy)
  const client = useMemo(publicClient, [])
  const [branchLabel, setBranchLabel] = useState<string | null>(null)
  const [initials, setInitials] = useState('')
  const [message, setMessage] = useState(c.checking)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!client) return
    void callTipshift<Start>(client, { action: 'register_start', token }).then((response) => {
      if (!response?.branchLabel) { setMessage(c.invalid); return }
      setBranchLabel(response.branchLabel); setMessage(c.ready)
    })
    // The language only changes the displayed text, not whether the link is valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, token])

  // The link stays in the address bar only until it has been read.
  useEffect(() => {
    const safe = new URL(window.location.href); safe.hash = ''
    window.history.replaceState(null, '', safe)
  }, [])

  const register = async () => {
    if (!client) return
    setBusy(true); setMessage(c.preparing)
    try {
      const proof = await callTipshift<Start>(client, { action: 'register_start', token })
      if (!proof?.nonce) throw new Error(c.unusable)
      const { wallet } = await connectTestnetWallet({})
      const signed = await wallet.signMessage({ message: proof.message, recipient: proof.recipient, nonce: Buffer.from(proof.nonce, 'base64url'), callbackUrl: window.location.href })
      if (!signed?.accountId || !signed.publicKey || !signed.signature) throw new Error(c.noSig)
      setMessage(c.verifying)
      const finished = await callTipshift<Done>(client, { action: 'register_complete', token, branchRef: proof.branchRef, nonce: proof.nonce, initials: initials.trim(), accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature })
      if (!finished?.employee) throw new Error(c.failed)
      setBranchLabel(finished.employee.branchLabel); setDone(true); setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : c.failed)
    } finally { setBusy(false) }
  }

  const valid = /^[A-Za-zÀ-ÿ]{1,4}$/.test(initials.trim())
  let body
  if (!client) body = <div className="ts-card"><h2 className="ts-h2">{c.config}</h2></div>
  else if (done) body = <div className="ts-card"><span className="ts-status">{branchLabel}</span><h1 className="ts-h2" style={{ marginTop: 14 }}>{c.doneTitle}</h1><p className="ts-lead">{c.doneText}</p></div>
  else body = <div className="ts-card">
    <div className="ts-stepper"><span className={branchLabel ? 'active' : undefined}>1</span><span>2</span></div>
    <p className="ts-eyebrow">{c.eyebrow}</p>
    <h1 className="ts-h2">{branchLabel ? c.titleAt(branchLabel) : c.title}</h1>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.lead}</p>
    <label className="ts-field">{c.initials}<input value={initials} onChange={(event) => setInitials(event.target.value.toUpperCase())} maxLength={4} placeholder="MG" autoComplete="off" /></label>
    {message && <div className="ts-notice" role="status">{message}</div>}
    <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !branchLabel || !valid} onClick={() => void register()}>{busy ? c.working : c.connect}</button></div>
    <div className="ts-notice"><span>⊙</span><p><strong>{c.privacy}</strong>{c.privacyText}</p></div>
  </div>
  return <PublicFrame ribbon={c.ribbon}><div className="ts-solo">{body}</div></PublicFrame>
}
