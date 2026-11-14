import { useEffect, useMemo, useState } from 'react'
import { connectTestnetWallet, nonceBuffer } from '../../near'
import { callTipshift, publicClient } from '../client'
import { useCopy, useErrorText, useLang } from '../i18n'
import { PublicFrame } from '../layout'

type Start = {
  turnRef: string; groupRef: string; branchRef: string; branchLabel: string; capacity: number; taken: number
  scheduledStartsAt: string; scheduledEndsAt: string; nonce: string; message: string; recipient: string
}
type Complete = { status: 'ok' | 'not_registered' | 'full' | 'other_group'; initials: string | null }

const copy = {
  en: {
    ribbon: 'Check-in · Testnet',
    eyebrow: 'CHECK-IN', title: 'Are you here?',
    lead: 'Sign with your wallet to join this shift’s tips.',
    loading: 'One moment…',
    unavailable: 'This QR isn’t valid anymore. Ask your manager.',
    shift: 'Shift', spots: 'Places taken', of: 'of',
    connect: 'Connect wallet and sign', working: 'Verifying…', preparing: 'Preparing…', verifying: 'Verifying…',
    noSig: 'No signature received.', failed: 'Check-in failed. Try again or ask your manager.',
    okTitle: 'You’re in.', okText: 'You’ll share this shift’s tips. You can close this page.',
    notRegisteredTitle: 'Wallet not registered', notRegisteredText: 'Register once with your manager’s link, then scan this QR again.',
    fullTitle: 'This group is full', fullText: 'Tell your manager.',
    otherTitle: 'Wrong group', otherText: 'Scan the QR for the group your manager gave you.',
    privacy: 'Private.', privacyText: ' Your manager sees only your initials. Signing moves no funds.',
    config: 'Configuration required',
  },
  es: {
    ribbon: 'Check-in · Testnet',
    eyebrow: 'CHECK-IN', title: '¿Estás acá?',
    lead: 'Firmá con tu wallet para entrar al reparto de este turno.',
    loading: 'Un momento…',
    unavailable: 'Este QR ya no es válido. Consultá a tu gerente.',
    shift: 'Turno', spots: 'Lugares ocupados', of: 'de',
    connect: 'Conectar wallet y firmar', working: 'Verificando…', preparing: 'Preparando…', verifying: 'Verificando…',
    noSig: 'No se recibió la firma.', failed: 'No se pudo hacer el check-in. Probá de nuevo o consultá a tu gerente.',
    okTitle: 'Listo, ya estás.', okText: 'Vas a compartir las propinas de este turno. Podés cerrar esta página.',
    notRegisteredTitle: 'Wallet sin registrar', notRegisteredText: 'Registrate una vez con el link de tu gerente y volvé a escanear este QR.',
    fullTitle: 'Este grupo está completo', fullText: 'Avisale a tu gerente.',
    otherTitle: 'Grupo equivocado', otherText: 'Escaneá el QR del grupo que te asignó tu gerente.',
    privacy: 'Privado.', privacyText: ' Tu gerente ve solo tus iniciales. Firmar no mueve fondos.',
    config: 'Falta configuración',
  },
}

export function CheckIn({ token }: { token: string }) {
  const c = useCopy(copy)
  const errText = useErrorText()
  const { lang } = useLang()
  const client = useMemo(publicClient, [])
  const [info, setInfo] = useState<Start | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<Complete | null>(null)

  useEffect(() => {
    if (!client) return
    void callTipshift<Start>(client, { action: 'checkin_start', token }).then((response) => { setInfo(response); setLoaded(true) })
  }, [client, token])

  useEffect(() => {
    const safe = new URL(window.location.href); safe.hash = ''
    window.history.replaceState(null, '', safe)
  }, [])

  const checkIn = async () => {
    if (!client) return
    setBusy(true); setMessage(c.preparing)
    try {
      const proof = await callTipshift<Start>(client, { action: 'checkin_start', token })
      if (!proof?.nonce) throw new Error(c.unavailable)
      const { wallet } = await connectTestnetWallet({})
      const signed = await wallet.signMessage({ message: proof.message, recipient: proof.recipient, nonce: nonceBuffer(proof.nonce) })
      if (!signed?.accountId || !signed.publicKey || !signed.signature) throw new Error(c.noSig)
      setMessage(c.verifying)
      const done = await callTipshift<Complete>(client, { action: 'checkin_complete', token, turnRef: proof.turnRef, groupRef: proof.groupRef, branchRef: proof.branchRef, nonce: proof.nonce, accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature })
      if (!done?.status) throw new Error(c.failed)
      setResult(done); setMessage('')
    } catch (error) {
      setMessage(errText(error, c.failed))
    } finally { setBusy(false) }
  }

  const time = (value: string) => new Date(value).toLocaleTimeString(lang === 'es' ? 'es-AR' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
  let body
  if (!client) body = <div className="ts-card"><h2 className="ts-h2">{c.config}</h2></div>
  else if (result?.status === 'ok') body = <div className="ts-card"><span className="ts-status">{info?.branchLabel}</span><h1 className="ts-h2" style={{ marginTop: 14 }}>{c.okTitle}</h1>{result.initials && <p className="ts-mono" style={{ margin: '14px 0', fontSize: 28, fontWeight: 500 }}>{result.initials}</p>}<p className="ts-lead">{c.okText}</p></div>
  else if (result) {
    const m = { not_registered: [c.notRegisteredTitle, c.notRegisteredText], full: [c.fullTitle, c.fullText], other_group: [c.otherTitle, c.otherText] }[result.status]
    body = <div className="ts-card"><span className="ts-status bad">{info?.branchLabel}</span><h1 className="ts-h2" style={{ marginTop: 14 }}>{m[0]}</h1><p className="ts-lead">{m[1]}</p></div>
  } else if (loaded && !info) body = <div className="ts-card"><div className="ts-notice bad" role="alert">{c.unavailable}</div></div>
  else body = <div className="ts-card">
    <p className="ts-eyebrow">{c.eyebrow}</p>
    <h1 className="ts-h2">{c.title}</h1>
    <p className="ts-lead" style={{ fontSize: 14 }}>{c.lead}</p>
    {info ? <div className="ts-rows" style={{ marginTop: 20 }}>
      <div className="ts-row" style={{ gridTemplateColumns: '1fr auto' }}><span className="ts-muted">{info.branchLabel}</span><b>{c.shift} {time(info.scheduledStartsAt)}–{time(info.scheduledEndsAt)}</b></div>
      <div className="ts-row" style={{ gridTemplateColumns: '1fr auto' }}><span className="ts-muted">{c.spots}</span><b className="ts-mono">{info.taken} {c.of} {info.capacity}</b></div>
    </div> : <div className="ts-notice">{c.loading}</div>}
    {message && <div className="ts-notice" role="status">{message}</div>}
    <div className="ts-actions"><button className="ts-btn primary" disabled={busy || !info} onClick={() => void checkIn()}>{busy ? c.working : c.connect}</button></div>
    <div className="ts-notice"><span>⊙</span><p><strong>{c.privacy}</strong>{c.privacyText}</p></div>
  </div>
  return <PublicFrame ribbon={c.ribbon}><div className="ts-solo">{body}</div></PublicFrame>
}
