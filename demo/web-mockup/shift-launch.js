const copy = {
  en: {
    ribbon:'DEMO ADMIN VIEW · Starting a shift does not write on-chain', eyebrow:'CAFÉ NÓMADA · CÓRDOBA',
    title:'Ready to start this shift?', lead:'Starting locks the recipients and percentages for this shift. New tips can then be collected through the public customer QR.',
    back:'← Review recipients', shiftEyebrow:'UPCOMING SHIFT', shift:'Lunch shift · 12:00–16:00', draft:'Draft',
    checkRecipients:'3 tip recipients verified', checkRecipientsDetail:'Each recipient linked their own wallet.',
    checkAllocation:'Tip allocation is complete', checkAllocationDetail:'Percentages total 100%; no unassigned remainder.',
    checkWindow:'Collection window is set', checkWindowDetail:'Customers can tip only while this shift is open.',
    lockTitle:'What locks when you start?', lockText:' The recipient places and percentages. The admin still cannot view, choose, or alter a recipient wallet.',
    start:'Start and lock shift (demo)', live:'Live', liveEyebrow:'SHIFT IS LIVE · DEMO',
    liveTitle:'The rule is now locked for this shift.', liveText:'Guests can use one public QR to start a tip. It does not show wallets, names, or how the tip will be divided.',
    openQr:'Open public tip QR →', openShift:'View live shift', night:'Night', day:'Day'
  },
  es: {
    ribbon:'VISTA DEMO DEL ADMIN · Iniciar un turno no escribe en cadena', eyebrow:'CAFÉ NÓMADA · CÓRDOBA',
    title:'¿Listo para iniciar este turno?', lead:'Al iniciar se bloquean los destinatarios y porcentajes de este turno. Las nuevas propinas se reciben con el QR público del cliente.',
    back:'← Revisar destinatarios', shiftEyebrow:'PRÓXIMO TURNO', shift:'Turno almuerzo · 12:00–16:00', draft:'Borrador',
    checkRecipients:'3 destinatarios de propina verificados', checkRecipientsDetail:'Cada destinatario vinculó su propia wallet.',
    checkAllocation:'La distribución de propinas está completa', checkAllocationDetail:'Los porcentajes suman 100%; no queda remanente sin asignar.',
    checkWindow:'La ventana de cobro está definida', checkWindowDetail:'Los clientes pueden dejar propina solo mientras el turno esté abierto.',
    lockTitle:'¿Qué se bloquea al iniciar?', lockText:' Los lugares de destinatario y porcentajes. El admin no puede ver, elegir ni modificar una wallet de destinatario.',
    start:'Iniciar y bloquear turno (demo)', live:'En curso', liveEyebrow:'TURNO EN CURSO · DEMO',
    liveTitle:'La regla quedó bloqueada para este turno.', liveText:'Los clientes pueden usar un QR público para iniciar una propina. No muestra wallets, nombres ni cómo se divide la propina.',
    openQr:'Abrir QR público de propinas →', openShift:'Ver turno en curso', night:'Noche', day:'Día'
  }
};
let language='en'; let theme='day';
const t=()=>copy[language];
function render(){
  document.documentElement.lang=language;
  document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t()[el.dataset.i18n]);
  document.querySelector('#language-switch').textContent=language==='en'?'ES':'EN';
  document.querySelector('#theme-label').textContent=theme==='day'?t().night:t().day;
  document.querySelector('#theme-switch span').textContent=theme==='day'?'☾':'☀';
  document.title=language==='en'?'TipShift — Start a shift':'TipShift — Iniciar un turno';
}
document.querySelector('#language-switch').addEventListener('click',()=>{language=language==='en'?'es':'en';render()});
document.querySelector('#theme-switch').addEventListener('click',()=>{theme=theme==='day'?'night':'day';document.body.dataset.theme=theme;render()});
document.querySelector('#start-shift').addEventListener('click',()=>{
  document.querySelector('#launch-card').hidden=true;
  document.querySelector('#live-card').hidden=false;
  document.querySelector('#status').className='status live';
  document.querySelector('#status').textContent=t().live;
});
render();
