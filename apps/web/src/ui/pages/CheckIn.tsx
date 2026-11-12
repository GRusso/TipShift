import { Buffer } from 'buffer'
import { useEffect, useMemo, useState } from 'react'
import { connectTestnetWallet } from '../../near'
import { callTipshift, publicClient } from '../client'
import { useCopy, useLang } from '../i18n'
import { PublicFrame } from '../layout'

type Start = {
  turnRef: string; groupRef: string; branchRef: string; branchLabel: string; capacity: number; taken: number
  scheduledStartsAt: string; scheduledEndsAt: string; nonce: string; message: string; recipient: string
}
type Complete = { status: 'ok' | 'not_registered' | 'full' | 'other_group'; initials: string | null }

const copy = {
  en: {
    ribbon: 'SHIFT CHECK-IN · Testnet',
    eyebrow: 'I AM HERE', title: 'Confirm you are present for this shift',
    lead: 'Signing with your wallet is your proof of presence. Tips for this shift are shared among the people who sign.',
    loading: 'Checking this shift QR…',
    unavailable: 'This QR is unavailable. The shift may have ended, or the QR was replaced. Ask your manager.',
    shift: 'Shift', spots: 'Places taken', of: 'of',
    connect: 'Connect wallet and sign', working: 'Verifying…', preparing: 'Preparing a one-time signature…', verifying: 'Verifying wallet control…',
    noSig: 'The wallet did not return a signature.', failed: 'The check-in could not be completed. Try again or ask your manager.',
    okTitle: 'You are checked in.', okText: 'You will share the tips of this shift. You can close this page.',
    notRegisteredTitle: 'This wallet is not registered here', notRegisteredText: 'Register once with your location’s registration link (ask your manager), then scan this QR again.',
    fullTitle: 'This group is full', fullText: 'All places in this group are taken. Tell your manager so they can adjust the group.',
    otherTitle: 'You belong to another group', otherText: 'Your manager placed you in a different group for this shift. Scan that group’s QR.',
    privacy: 'Privacy by design.', privacyText: ' Your manager sees only your initials. Signing moves no funds.',
    config: 'Configuration required',
  },
  es: {
    ribbon: 'CHECK-IN DE TURNO · Testnet',
    eyebrow: 'ESTOY ACÁ', title: 'Confirmá que estás presente en este turno',
    lead: 'Firmar con tu wallet es tu prueba de presencia. Las propinas de este turno se reparten entre quienes firman.',
    loading: 'Verificando el QR del turno…',
    unavailable: 'Este QR no está disponible. Puede que el turno haya terminado o que el QR se haya reemplazado. Consultá a tu gerente.',
    shift: 'Turno', spots: 'Lugares ocupados', of: 'de',
    connect: 'Conectar wallet y firmar', working: 'Verificando…', preparing: 'Preparando una firma de un solo uso…', verifying: 'Verificando el control de la wallet…',
    noSig: 'La wallet no devolvió una firma.', failed: 'No se pudo completar el check-in. Probá de nuevo o consultá a tu gerente.',
    okTitle: 'Ya hiciste el check-in.', okText: 'Vas a participar del reparto de las propinas de este turno. Podés cerrar esta página.',
    notRegisteredTitle: 'Esta wallet no está registrada acá', notRegisteredText: 'Registrate una vez con el link de registro de tu local (pedíselo a tu gerente) y volvé a escanear este QR.',
    fullTitle: 'Este grupo está completo', fullText: 'Ya se ocuparon todos los lugares de este grupo. Avisale a tu gerente para que lo ajuste.',
    otherTitle: 'Pertenecés a otro grupo', otherText: 'Tu gerente te ubicó en otro grupo para este turno. Escaneá el QR de ese grupo.',
    privacy: 'Privacidad por diseño.', privacyText: ' Tu gerente ve solo tus iniciales. Firmar no mueve fondos.',
    config: 'Falta configuración',
  },
}

export function CheckIn({ token }: { token: string }) {
  const c = useCopy(copy)
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
      const signed = await wallet.signMessage({ message: proof.message, recipient: proof.recipient, nonce: Buffer.from(proof.nonce, 'base64url'), callbackUrl: window.location.href })
      if (!signed?.accountId || !signed.publicKey || !signed.signature) throw new Error(c.noSig)
      setMessage(c.verifying)
      const done = await callTipshift<Complete>(client, { action: 'checkin_complete', token, turnRef: proof.turnRef, groupRef: proof.groupRef, branchRef: proof.branchRef, nonce: proof.nonce, accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature })
      if (!done?.status) throw new Error(c.failed)
      setResult(done); setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : c.failed)
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
