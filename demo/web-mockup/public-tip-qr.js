const copy = {
  en: {
    ribbon:'DEMO CUSTOMER QR · Visual only, not scannable', merchantEyebrow:'CAFÉ NÓMADA',
    posterTitle:'Leave a tip for today’s team', posterText:'Scan, choose your amount, and approve only from your own wallet.',
    posterFoot:'This demonstration QR does not encode an address or payment request.', sessionEyebrow:'CUSTOMER ENTRY POINT',
    activeLabel:'Public tip session active', activeTitle:'One public QR. No customer account.',
    activeText:'This QR starts a private payment session for the active lunch shift. It is separate from the private QR used by each tip recipient.',
    activeHelp:'A real QR must be short-lived, signed by the service, and accepted only while this shift is open.',
    privacyTitle:'What guests do not see:', privacyText:' recipient names, wallet addresses, distribution percentages, or an on-chain pool identifier.',
    pay:'Open customer payment demo →', preview:'DEMO STATE PREVIEW', stateActive:'Active shift', stateNotStarted:'Not started', stateClosed:'Shift closed', stateExpired:'QR expired',
    stateNote:'These are customer-safe responses: no pool, wallet, or participant details are exposed.',
    notStartedLabel:'Tips are not open yet', notStartedTitle:'This shift has not started.', notStartedText:'Please ask the team when tips open. Nothing has been charged and no wallet connection is requested.',
    notStartedHelp:'The business must finish recipient verification and lock the shift before this QR accepts a payment.',
    closedLabel:'Tip session unavailable', closedTitle:'This shift has ended.', closedText:'Thanks for visiting. This QR is no longer accepting tips, so your wallet will not be opened.',
    closedHelp:'A new shift receives a separate public session; an old session never rolls tips forward.',
    expiredLabel:'QR needs a refresh', expiredTitle:'This QR has expired.', expiredText:'Ask the team for the current display QR. Nothing has been charged and you do not need to reconnect a wallet.',
    expiredHelp:'Expiry limits replay and accidental payment into an older session.', back:'← Back to shift activation',
    footer:'Demo only · no QR or payment session is created', night:'Night', day:'Day'
  },
  es: {
    ribbon:'QR DEL CLIENTE DEMO · Solo visual, no escaneable', merchantEyebrow:'CAFÉ NÓMADA',
    posterTitle:'Dejá una propina al equipo de hoy', posterText:'Escaneá, elegí un importe y aprobá solamente desde tu propia wallet.',
    posterFoot:'Este QR de demostración no codifica una dirección ni una solicitud de pago.', sessionEyebrow:'PUNTO DE ENTRADA DEL CLIENTE',
    activeLabel:'Sesión pública de propinas activa', activeTitle:'Un QR público. Sin cuenta de cliente.',
    activeText:'Este QR inicia una sesión de pago privada para el turno de almuerzo activo. Es distinto del QR privado que usa cada destinatario.',
    activeHelp:'Un QR real debe ser de corta duración, firmado por el servicio y aceptado solo mientras el turno esté abierto.',
    privacyTitle:'Lo que no ve el cliente:', privacyText:' nombres de destinatarios, direcciones de wallet, porcentajes de distribución ni identificador del pool en cadena.',
    pay:'Abrir demo de pago del cliente →', preview:'VISTA PREVIA DE ESTADOS DEMO', stateActive:'Turno activo', stateNotStarted:'Aún no inició', stateClosed:'Turno cerrado', stateExpired:'QR vencido',
    stateNote:'Son respuestas seguras para el cliente: no exponen pool, wallet ni detalles de participantes.',
    notStartedLabel:'Las propinas aún no están abiertas', notStartedTitle:'Este turno todavía no inició.', notStartedText:'Preguntá al equipo cuándo se habilitan las propinas. No se cobró nada ni se pide conectar una wallet.',
    notStartedHelp:'El negocio debe terminar de verificar destinatarios y bloquear el turno antes de aceptar un pago.',
    closedLabel:'Sesión de propinas no disponible', closedTitle:'Este turno terminó.', closedText:'Gracias por tu visita. Este QR ya no acepta propinas y no se abrirá tu wallet.',
    closedHelp:'Un nuevo turno recibe una sesión pública distinta; una sesión anterior nunca mueve propinas hacia adelante.',
    expiredLabel:'El QR necesita actualizarse', expiredTitle:'Este QR venció.', expiredText:'Pedí al equipo el QR actual. No se cobró nada y no necesitás reconectar una wallet.',
    expiredHelp:'El vencimiento limita reintentos y pagos accidentales en una sesión anterior.', back:'← Volver a activación del turno',
    footer:'Solo demo · no se crea ningún QR ni sesión de pago', night:'Noche', day:'Día'
  }
};
let language='en'; let theme='day'; let state='active';
const t=()=>copy[language];
const states={active:['activeLabel','activeTitle','activeText','activeHelp'], 'not-started':['notStartedLabel','notStartedTitle','notStartedText','notStartedHelp'],closed:['closedLabel','closedTitle','closedText','closedHelp'],expired:['expiredLabel','expiredTitle','expiredText','expiredHelp']};
function render(){
  document.documentElement.lang=language;
  document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t()[el.dataset.i18n]);
  const current=states[state];
  document.querySelector('#status-label').textContent=t()[current[0]];
  document.querySelector('#session-title').textContent=t()[current[1]];
  document.querySelector('#session-text').textContent=t()[current[2]];
  document.querySelector('#help').textContent=t()[current[3]];
  const active=state==='active';
  document.querySelector('#pay-link').hidden=!active;
  document.querySelector('#status-dot').parentElement.style.color=active?'var(--green)':'var(--alert)';
  document.querySelector('#language-switch').textContent=language==='en'?'ES':'EN';
  document.querySelector('#theme-label').textContent=theme==='day'?t().night:t().day;
  document.querySelector('#theme-switch span').textContent=theme==='day'?'☾':'☀';
  document.title=language==='en'?'TipShift — Public tip QR':'TipShift — QR público de propinas';
  document.querySelectorAll('[data-state]').forEach(button=>button.classList.toggle('active',button.dataset.state===state));
}
document.querySelector('#language-switch').addEventListener('click',()=>{language=language==='en'?'es':'en';render()});
document.querySelector('#theme-switch').addEventListener('click',()=>{theme=theme==='day'?'night':'day';document.body.dataset.theme=theme;render()});
document.querySelectorAll('[data-state]').forEach(button=>button.addEventListener('click',()=>{state=button.dataset.state;render()}));
render();
