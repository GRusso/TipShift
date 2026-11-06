const objectButton = document.querySelector('#object-button');
const withdrawButton = document.querySelector('#withdraw-button');
const roleSwitch = document.querySelector('#role-switch');
const languageSwitch = document.querySelector('#language-switch');
const themeSwitch = document.querySelector('#theme-switch');
const toast = document.querySelector('#toast');

const copy = {
  en: {
    ribbon: 'DEMO ENVIRONMENT · No wallets or real payments', workspace: 'ORGANIZATION', navTurns: 'Shifts', navActivity: 'Activity', navReports: 'Reports', localAdmin: 'Local administrator', pageTitle: "Today's shift", shiftName: 'Lunch shift · 12:00–16:00', lockedRule: 'Rule locked at start · version 1', shiftPool: 'SHIFT POOL', participants: '12 participants', progressRule: 'Rule locked', progressTips: 'Tips received', progressDistribution: 'Distribution', currentProposal: 'CURRENT PROPOSAL', distributionV1: 'Distribution v1', viewRule: 'View rule', moreParticipants: '9 more participants', securityNote: 'Wallets are pseudonyms. TipShift does not store names, emails, or keys.', teamReview: 'TEAM REVIEW', objectionDispute: 'Objection / dispute', voteThreshold: 'Funds are isolated if more than 50% support a dispute.', objectButton: 'I object to this distribution', withdrawButton: 'Withdraw my objection', shiftTraceability: 'SHIFT TRACEABILITY', auditTitle: 'Every change is recorded', exportReport: 'Export report', timelineRule: 'Rule v1 locked', timelineRuleDetail: '12 participants · 100% allocated · 12:00', timelinePool: 'Tip pool recorded', timelinePoolDetail: 'USDC 480.00 · demo reference', timelineDistribution: 'Final distribution', timelineDistributionDetail: 'The business covers gas. Allocated amounts are never reduced.', statusProposed: 'Distribution proposed', statusObjected: 'Objection opened', reviewClear: 'No active objections', reviewObjected: 'Your objection opens the vote', reviewClearCopy: 'The proposal is visible to all 12 participants in this shift.', reviewObjectedCopy: 'All 12 participants can vote. The rule does not change while the dispute is evaluated.', voteClear: '0 of 12', voteObjected: '1 of 12', progressReview: 'Review', progressDispute: 'Dispute', timelineWaiting: 'Waiting for participant review', timelineVoting: 'Dispute vote is open', timelineWaitingDetail: 'An objection opens a vote; it does not alter the rule.', timelineVotingDetail: 'Funds are isolated only if more than 50% support a dispute.', objectToast: 'Objection recorded in this demonstration.', withdrawToast: 'Objection withdrawn in this demonstration.', participantToast: 'Participant view: other wallets are hidden in the real product.', adminToast: 'Administrator view restored.', day: 'Day', night: 'Night', adminView: 'View: administrator', participantView: 'View: participant'
  },
  es: {
    ribbon: 'ENTORNO DEMO · Sin wallets ni pagos reales', workspace: 'ORGANIZACIÓN', navTurns: 'Turnos', navActivity: 'Actividad', navReports: 'Reportes', localAdmin: 'Administrador local', pageTitle: 'Turno de hoy', shiftName: 'Turno almuerzo · 12:00–16:00', lockedRule: 'Regla bloqueada al iniciar · versión 1', shiftPool: 'POOL DEL TURNO', participants: '12 participantes', progressRule: 'Regla bloqueada', progressTips: 'Propinas recibidas', progressDistribution: 'Distribución', currentProposal: 'PROPUESTA ACTUAL', distributionV1: 'Distribución v1', viewRule: 'Ver regla', moreParticipants: '9 participantes más', securityNote: 'Las wallets son seudónimos. TipShift no guarda nombres, correos ni claves.', teamReview: 'REVISIÓN DEL EQUIPO', objectionDispute: 'Objeción / disputa', voteThreshold: 'Se aíslan los fondos si más del 50% apoya disputar.', objectButton: 'Me opongo a esta distribución', withdrawButton: 'Retirar mi objeción', shiftTraceability: 'TRAZABILIDAD DEL TURNO', auditTitle: 'Todo cambio queda registrado', exportReport: 'Exportar reporte', timelineRule: 'Regla v1 bloqueada', timelineRuleDetail: '12 participantes · 100% asignado · 12:00', timelinePool: 'Pool de propinas registrado', timelinePoolDetail: 'USDC 480,00 · referencia demo', timelineDistribution: 'Distribución final', timelineDistributionDetail: 'El negocio cubre el gas. El importe asignado no se descuenta.', statusProposed: 'Distribución propuesta', statusObjected: 'Objeción abierta', reviewClear: 'Sin objeciones activas', reviewObjected: 'Tu objeción abre la votación', reviewClearCopy: 'La propuesta está visible para los 12 participantes del turno.', reviewObjectedCopy: 'Los 12 participantes pueden votar. La regla no cambia mientras la disputa se evalúa.', voteClear: '0 de 12', voteObjected: '1 de 12', progressReview: 'Revisión', progressDispute: 'Disputa', timelineWaiting: 'Esperando revisión de participantes', timelineVoting: 'Votación de disputa abierta', timelineWaitingDetail: 'Una objeción abre la votación, no modifica la regla.', timelineVotingDetail: 'Se aíslan los fondos solo si más del 50% apoya disputar.', objectToast: 'Objeción registrada en esta demostración.', withdrawToast: 'Objeción retirada en esta demostración.', participantToast: 'Vista de participante: las demás wallets se ocultan en el producto real.', adminToast: 'Vista de administrador restaurada.', day: 'Día', night: 'Noche', adminView: 'Vista: administrador', participantView: 'Vista: participante'
  }
};

let objected = false;
let employeeView = false;
let language = 'en';
let theme = 'day';

function announce(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function updateState() {
  const text = copy[language];
  document.querySelector('#status-text').textContent = objected ? text.statusObjected : text.statusProposed;
  document.querySelector('#review-title').textContent = objected ? text.reviewObjected : text.reviewClear;
  document.querySelector('#review-copy').textContent = objected ? text.reviewObjectedCopy : text.reviewClearCopy;
  document.querySelector('#vote-count').textContent = objected ? text.voteObjected : text.voteClear;
  document.querySelector('#vote-bar').style.width = objected ? '8.33%' : '0%';
  document.querySelector('#timeline-review').textContent = objected ? '!' : '3';
  document.querySelector('#timeline-text').textContent = objected ? text.timelineVoting : text.timelineWaiting;
  document.querySelector('#timeline-detail').textContent = objected ? text.timelineVotingDetail : text.timelineWaitingDetail;
  document.querySelector('#progress-current').textContent = objected ? text.progressDispute : text.progressReview;
  document.querySelector('#role-label').textContent = employeeView ? text.participantView : text.adminView;
  document.querySelector('#participants').style.opacity = employeeView ? '.42' : '1';
  document.querySelector('#theme-label').textContent = theme === 'night' ? text.day : text.night;
  themeSwitch.firstElementChild.textContent = theme === 'night' ? '☀' : '☾';
  objectButton.hidden = objected;
  withdrawButton.hidden = !objected;
}

function translateStatic() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = copy[language][element.dataset.i18n]; });
  languageSwitch.textContent = language === 'en' ? 'ES' : 'EN';
  languageSwitch.setAttribute('aria-label', language === 'en' ? 'Cambiar a español' : 'Switch to English');
  document.title = language === 'en' ? 'TipShift — Product demo' : 'TipShift — Demo de producto';
  updateState();
}

objectButton.addEventListener('click', () => { objected = true; updateState(); announce(copy[language].objectToast); });
withdrawButton.addEventListener('click', () => { objected = false; updateState(); announce(copy[language].withdrawToast); });
roleSwitch.addEventListener('click', () => { employeeView = !employeeView; updateState(); announce(copy[language][employeeView ? 'participantToast' : 'adminToast']); });
languageSwitch.addEventListener('click', () => { language = language === 'en' ? 'es' : 'en'; translateStatic(); });
themeSwitch.addEventListener('click', () => { theme = theme === 'day' ? 'night' : 'day'; document.body.dataset.theme = theme; updateState(); });
