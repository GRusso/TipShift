const copy = {
  en: {
    ribbon: 'DEMO ADMIN VIEW · Claim QR codes are previews only',
    eyebrow: 'LUNCH SHIFT · DRAFT',
    title: 'Link each tip recipient',
    lead: 'Set percentages first. Then give each recipient their own private QR to connect a receiving wallet—without names, emails, or passwords.',
    infoTitle: 'Private QR, not customer QR.',
    infoText: ' Each recipient QR is one-time and private. The public customer QR is a separate flow for paying tips.',
    recipientOne: 'Tip recipient 01', recipientTwo: 'Tip recipient 02', recipientThree: 'Tip recipient 03',
    linked: 'Wallet linked and verified', waiting: 'Private link is ready to share', noLink: 'No private link issued yet',
    verified: 'Verified', notClaimed: 'Awaiting claim', needsLink: 'Needs link',
    view: 'View link', showQr: 'Show private QR', generate: 'Generate QR',
    lockNote: 'You cannot start this shift until every recipient has a verified wallet and total shares equal 100%.',
    adminNote: 'The branch admin controls participants and percentages; recipients control their own wallet destination.',
    qrEyebrow: 'PRIVATE CLAIM QR · DEMO PREVIEW', qrTitle: 'Only for tip recipient 02',
    qrText: 'In production, this QR encodes a one-time opaque HTTPS claim link. It does not contain a wallet, name, or the public payment session.',
    done: 'Done',
    claimRibbon: 'DEMO RECIPIENT CLAIM · No wallet will be connected',
    contextEyebrow: 'PRIVATE RECIPIENT LINK',
    contextText: 'This link connects a receiving wallet to one tip recipient in an upcoming shift.',
    shift: 'Lunch shift · 12:00–16:00', share: 'Your assigned share: 35%',
    step: 'STEP 1 OF 3', claimTitle: 'Confirm your destination',
    claimLead: 'You are claiming one recipient place. You do not need a TipShift account or personal details.',
    walletLabel: 'WALLET STATUS', walletPending: 'Not connected in this demo', walletVerified: 'Receiving wallet verified', connect: 'Connect wallet (demo)',
    notice: 'A real flow asks your wallet to sign a one-time message. It never asks for a seed phrase.',
    confirmStep: 'STEP 2 OF 3', confirmTitle: 'Wallet ready to verify',
    confirmText: 'Your wallet would sign a message linking it to this recipient place and this upcoming shift.',
    confirm: 'Confirm association (demo)', successStep: 'RECIPIENT LINKED · DEMO',
    successTitle: 'Your wallet is linked to this shift.',
    successText: 'The branch admin can now see that your destination is verified, but not use or change your wallet.',
    openTips: 'Open my tips →', night: 'Night', day: 'Day',
  },
  es: {
    ribbon: 'VISTA DEMO DEL ADMIN · Los QR de asociación son solo vistas previas',
    eyebrow: 'TURNO ALMUERZO · BORRADOR',
    title: 'Vinculá a cada destinatario de propina',
    lead: 'Primero definí los porcentajes. Luego entregá a cada destinatario su QR privado para conectar una wallet receptora, sin nombres, emails ni contraseñas.',
    infoTitle: 'QR privado, no QR del cliente.',
    infoText: ' Cada QR de destinatario es único y privado. El QR público del cliente es un flujo separado para pagar propinas.',
    recipientOne: 'Destinatario de propina 01', recipientTwo: 'Destinatario de propina 02', recipientThree: 'Destinatario de propina 03',
    linked: 'Wallet vinculada y verificada', waiting: 'El link privado está listo para compartir', noLink: 'Todavía no se emitió un link privado',
    verified: 'Verificado', notClaimed: 'Pendiente de asociación', needsLink: 'Falta emitir link',
    view: 'Ver link', showQr: 'Ver QR privado', generate: 'Generar QR',
    lockNote: 'No podés iniciar este turno hasta que cada destinatario tenga una wallet verificada y los porcentajes sumen 100%.',
    adminNote: 'El admin de sucursal controla participantes y porcentajes; cada destinatario controla su wallet.',
    qrEyebrow: 'QR PRIVADO DE ASOCIACIÓN · VISTA DEMO', qrTitle: 'Solo para destinatario 02',
    qrText: 'En producción, este QR codifica un link HTTPS opaco de un solo uso. No contiene una wallet, nombre ni la sesión pública de pago.',
    done: 'Listo',
    claimRibbon: 'ASOCIACIÓN DEMO DEL DESTINATARIO · No se conectará ninguna wallet',
    contextEyebrow: 'LINK PRIVADO DEL DESTINATARIO',
    contextText: 'Este link conecta una wallet receptora a un destinatario de un turno próximo.',
    shift: 'Turno almuerzo · 12:00–16:00', share: 'Tu porcentaje asignado: 35%',
    step: 'PASO 1 DE 3', claimTitle: 'Confirmá tu destino',
    claimLead: 'Estás asociando un lugar de destinatario. No necesitás una cuenta TipShift ni datos personales.',
    walletLabel: 'ESTADO DE WALLET', walletPending: 'No conectada en esta demo', walletVerified: 'Wallet receptora verificada', connect: 'Conectar wallet (demo)',
    notice: 'Un flujo real pide a tu wallet firmar un mensaje de un solo uso. Nunca pide una seed phrase.',
    confirmStep: 'PASO 2 DE 3', confirmTitle: 'Wallet lista para verificar',
    confirmText: 'Tu wallet firmaría un mensaje que la vincula a este destinatario y a este turno próximo.',
    confirm: 'Confirmar asociación (demo)', successStep: 'DESTINATARIO VINCULADO · DEMO',
    successTitle: 'Tu wallet quedó vinculada a este turno.',
    successText: 'El admin de sucursal ahora ve que tu destino está verificado, pero no puede usar ni cambiar tu wallet.',
    openTips: 'Abrir mis propinas →', night: 'Noche', day: 'Día',
  },
};

let language = 'en';
let theme = 'day';
const screen = document.body.dataset.screen;
const text = () => copy[language];

function render() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = text()[element.dataset.i18n];
  });
  document.querySelector('#language').textContent = language === 'en' ? 'ES' : 'EN';
  document.querySelector('#theme-label').textContent = theme === 'day' ? text().night : text().day;
  document.querySelector('#theme span').textContent = theme === 'day' ? '☾' : '☀';
  document.title = screen === 'admin'
    ? (language === 'en' ? 'TipShift — Link tip recipients' : 'TipShift — Vincular destinatarios')
    : (language === 'en' ? 'TipShift — Claim tip recipient' : 'TipShift — Asociar destinatario');
}

document.querySelector('#language').addEventListener('click', () => {
  language = language === 'en' ? 'es' : 'en';
  render();
});
document.querySelector('#theme').addEventListener('click', () => {
  theme = theme === 'day' ? 'night' : 'day';
  document.body.dataset.theme = theme;
  render();
});

if (screen === 'admin') {
  const dialog = document.querySelector('#qr-dialog');
  document.querySelector('#show-qr').addEventListener('click', () => dialog.showModal());
  document.querySelector('#generate').addEventListener('click', () => {
    document.querySelector('#third-state').textContent = text().notClaimed;
    dialog.showModal();
  });
  document.querySelector('#close').addEventListener('click', () => dialog.close());
  document.querySelector('#done').addEventListener('click', () => dialog.close());
} else {
  document.querySelector('#connect').addEventListener('click', () => {
    document.querySelector('#claim-main').hidden = true;
    document.querySelector('#confirm-main').hidden = false;
  });
  document.querySelector('#confirm').addEventListener('click', () => {
    document.querySelector('#confirm-main').hidden = true;
    document.querySelector('#success-main').hidden = false;
  });
}

render();
