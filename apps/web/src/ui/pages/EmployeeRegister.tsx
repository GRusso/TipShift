import { Buffer } from 'buffer'
import { useEffect, useMemo, useState } from 'react'
import { connectTestnetWallet, registerUsdc, usdcRegistered } from '../../near'
import { callTipshift, publicClient } from '../client'
import { useCopy } from '../i18n'
import { PublicFrame } from '../layout'

type Start = { branchLabel: string; branchRef: string; nonce: string; message: string; recipient: string }
type Done = { employee: { initials: string; branchLabel: string } }

const copy = {
  en: {
    ribbon: 'Registration · Testnet',
    eyebrow: 'JOIN', titleAt: (branch: string) => `Join ${branch}`, title: 'Join your team',
    lead: 'Do this once. Tips are paid to the wallet you connect.',
    checking: 'One moment…',
    invalid: 'This link isn’t valid anymore. Ask your manager for a new one.',
    ready: 'Enter your initials, then connect your NEAR wallet.',
    initials: 'Initials (1–4 letters)', connect: 'Connect wallet and join', working: 'Verifying…',
    preparing: 'Preparing…', verifying: 'Verifying…',
    noLink: 'Use the link or QR from your manager.', noLinkTitle: 'Link required',
    config: 'Configuration required',
    failed: 'Registration failed. Use 1 to 4 letters for your initials.',
    noSig: 'No signature received.', unusable: 'This link can’t be used anymore.',
    doneTitle: 'You’re in.', doneText: 'Next time, just scan your group’s QR at the start of a shift.',
    usdcTitle: 'One last step', usdcText: 'Set up your wallet to receive USDC. It costs about 0.00125 NEAR, once.', usdcBtn: 'Set up USDC', usdcOk: 'Ready to receive USDC.', usdcFail: 'USDC setup failed. Try again.',
    privacy: 'Private.', privacyText: ' No name, email or phone. Signing moves no funds.',
  },
  es: {
    ribbon: 'Registro · Testnet',
    eyebrow: 'SUMATE', titleAt: (branch: string) => `Sumate a ${branch}`, title: 'Sumate a tu equipo',
    lead: 'Se hace una sola vez. Las propinas se pagan a la wallet que conectes.',
    checking: 'Un momento…',
    invalid: 'Este link ya no es válido. Pedile uno nuevo a tu gerente.',
    ready: 'Ingresá tus iniciales y conectá tu wallet NEAR.',
    initials: 'Iniciales (1 a 4 letras)', connect: 'Conectar wallet y sumarme', working: 'Verificando…',
    preparing: 'Preparando…', verifying: 'Verificando…',
    noLink: 'Usá el link o el QR de tu gerente.', noLinkTitle: 'Hace falta un link',
    config: 'Falta configuración',
    failed: 'No se pudo completar el registro. Usá de 1 a 4 letras para tus iniciales.',
    noSig: 'No se recibió la firma.', unusable: 'Este link ya no se puede usar.',
    doneTitle: 'Listo, ya estás.', doneText: 'La próxima vez, escaneá el QR de tu grupo al empezar el turno.',
    usdcTitle: 'Un último paso', usdcText: 'Preparemos tu wallet para recibir USDC. Cuesta unos 0,00125 NEAR, una sola vez.', usdcBtn: 'Preparar USDC', usdcOk: 'Lista para recibir USDC.', usdcFail: 'No se pudo preparar USDC. Probá de nuevo.',
    privacy: 'Privado.', privacyText: ' Sin nombre, email ni teléfono. Firmar no mueve fondos.',
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
  const [payee, setPayee] = useState<string | null>(null)
  const [usdc, setUsdc] = useState<'unknown' | 'ready' | 'missing'>('unknown')
  const [usdcNote, setUsdcNote] = useState('')

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
      const signed = await wallet.signMessage({ message: proof.message, recipient: proof.recipient, nonce: Buffer.from(proof.nonce, 'base64url') })
      if (!signed?.accountId || !signed.publicKey || !signed.signature) throw new Error(c.noSig)
      setMessage(c.verifying)
      const finished = await callTipshift<Done>(client, { action: 'register_complete', token, branchRef: proof.branchRef, nonce: proof.nonce, initials: initials.trim(), accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature })
      if (!finished?.employee) throw new Error(c.failed)
      setBranchLabel(finished.employee.branchLabel); setDone(true); setMessage(''); setPayee(signed.accountId)
      void usdcRegistered(signed.accountId).then((ok) => setUsdc(ok ? 'ready' : 'missing')).catch(() => undefined)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : c.failed)
    } finally { setBusy(false) }
  }

  const registerToken = async () => {
    if (!payee) return
    setBusy(true); setUsdcNote('')
    try { await registerUsdc(payee); setUsdc((await usdcRegistered(payee)) ? 'ready' : 'missing') }
    catch { setUsdcNote(c.usdcFail) } finally { setBusy(false) }
  }
  const valid = /^[A-Za-zÀ-ÿ]{1,4}$/.test(initials.trim())
  let body
  if (!client) body = <div className="ts-card"><h2 className="ts-h2">{c.config}</h2></div>
  else if (done) body = <div className="ts-card"><span className="ts-status">{branchLabel}</span><h1 className="ts-h2" style={{ marginTop: 14 }}>{c.doneTitle}</h1><p className="ts-lead">{c.doneText}</p>
    {usdc === 'missing' && <div className="ts-notice" role="status"><div><strong>{c.usdcTitle}</strong><p>{c.usdcText}</p>{usdcNote && <p>{usdcNote}</p>}<div className="ts-actions"><button className="ts-btn primary" disabled={busy} onClick={() => void registerToken()}>{c.usdcBtn}</button></div></div></div>}
    {usdc === 'ready' && <div className="ts-notice" role="status">{c.usdcOk}</div>}</div>
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
