/* Reglas de presupuesto en centavos. Sin red, pagos ni dependencias externas. */
function expenseBucket(m) {
  if (m.category === 'Ofrenda') return 'offering';
  if (m.category === 'Invitaciones') return 'fun';
  if (m.category === 'Comida U') return 'food';
  if (['Transporte', 'Necesidades'].includes(m.category) && m.planVersion === 1) return 'essentials';
  return 'fun'; // Mantiene el significado de los registros anteriores.
}
function offeringOutstanding() {
  return state.movements.reduce((n, m) => n +
    (m.type === 'income' && !m.earmarked ? (m.alloc?.offering || 0) :
      m.type === 'expense' && m.category === 'Ofrenda' ? -m.amount : 0), 0);
}
function essentialsWeekInfo(date = sd()) {
  const w = weekRange(date), snap = state.rebalance;
  const applies = snap && snap.date <= w.end;
  let before = applies ? (snap.alloc.essentials || 0) : (state.openingAlloc?.essentials || 0);
  let added = 0;
  if (applies && snap.date >= w.start) { added = Math.max(0, before); before = Math.min(0, before); }
  for (const m of state.movements) {
    if (!m.date || m.date > w.end || (applies && (m.created || 0) <= snap.created)) continue;
    const delta = m.type === 'income' && !m.earmarked ? (m.alloc?.essentials || 0) :
      m.type === 'expense' && expenseBucket(m) === 'essentials' ? -m.amount : 0;
    if (m.date < w.start) before += delta;
    else if (delta > 0) added += delta;
  }
  const funded = before + added;
  return { ...w, funded, need: Math.max(0, state.settings.essentialsWeekly - funded) };
}
function spendingRoom(date = sd()) {
  const b = envelopeTotals(), w = weekRange(date);
  const spent = state.movements.filter(m => m.type === 'expense' && expenseBucket(m) === 'fun' && m.date >= w.start && m.date <= w.end)
    .reduce((n, m) => n + m.amount, 0);
  const protectedCash = ['food', 'services', 'debt', 'essentials', 'offering'].reduce((n, k) => n + Math.max(0, b[k] || 0), 0)
    + Math.max(0, b.emergency - savingsBalance());
  const foodNeed = foodWeekInfo(date).need, essentialsNeed = essentialsWeekInfo(date).need;
  const room = Math.max(0, liquidBalance() - protectedCash - foodNeed - essentialsNeed);
  return { spent, available: Math.max(0, Math.min(b.fun, state.settings.funWeeklyCap - spent, room)),
    limit: state.settings.funWeeklyCap, foodNeed, essentialsNeed, b };
}
function displayPersonalPlan() {
  const p = spendingRoom(), pending = Math.max(0, offeringOutstanding()), sunday = weekRange(sd()).end;
  $('personalPlan').innerHTML = `<div class="card"><div class="hrow"><b>Para salidas esta semana</b><strong class="${p.available ? 'positive' : 'danger-text'}">${dol(p.available)}</strong></div>
    <p class="tip">Gastado en salidas y otros gustos: ${dol(p.spent)} de un tope de ${dol(p.limit)}. El disponible también respeta tus apartados y el efectivo propio.</p>
    ${p.foodNeed || p.essentialsNeed ? `<p class="tip danger-text">Falta cubrir esta semana: comida ${dol(p.foodNeed)} · necesidades ${dol(p.essentialsNeed)}.</p>` : ''}
    <p class="tip">Invitar es opcional. Si no alcanza este apartado, cada quien paga lo suyo. Espera 24 horas antes de una compra no necesaria.</p>
    </div>`;
  $('personalGoals').innerHTML = `<div class="card"><div class="hrow"><b>Ofrenda del domingo</b><strong>${dol(pending)}</strong></div>
    <p class="tip">Próximo domingo: ${dateNice(sunday)}. Reserva del 10 % por cada ingreso nuevo elegible registrado desde ${dateNice(state.settings.offeringStart)}. Lo pendiente se acumula aunque pase el domingo. No incluye préstamos, cobros de grupo ni ahorro recuperado.</p>
    <button type="button" class="outline" data-offering-pay ${pending <= 0 ? 'disabled' : ''}>Registrar lo que ya entregué</button>
    ${pending > Math.max(0, liquidBalance()) ? '<p class="tip danger-text">No hay suficiente efectivo propio para cubrir toda la reserva. Revisa los movimientos antes de entregar.</p>' : ''}
    <p class="tip">La app solo aparta y registra. Tú realizas la entrega. Una entrega no vuelve a descontarse del presupuesto de salidas.</p></div>
    <div class="card"><div class="hrow"><b>Primera meta de emergencia</b><strong>${dol(state.settings.emergencyGoal)}</strong></div>
    <p class="tip">Transferido a ahorro: ${guardedAmount(savingsBalance())} · Pendiente para la meta: ${guardedAmount(Math.max(0, state.settings.emergencyGoal - savingsBalance()))}.</p>
    <p class="tip">La meta es editable. Antes de invertir, cubre tus necesidades y forma una reserva que puedas usar sin vender inversiones.</p></div>`;
}
function prepareOfferingPayment() {
  const pending = Math.max(0, offeringOutstanding());
  if (!pending) return;
  showView('add'); setEntryMode('expense');
  $('expenseCategory').value = 'Ofrenda'; $('entryAmount').value = (pending / 100).toFixed(2);
  $('entryNote').value = 'Ofrenda entregada'; updateEntry();
}
function personalSettings() {
  const essentialsWeekly = moneyInput('essentialsWeekly'), funWeeklyCap = moneyInput('funWeeklyCap'), emergencyGoal = moneyInput('emergencyGoal');
  if (![essentialsWeekly, funWeeklyCap, emergencyGoal].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 999999999)) throw Error('Revisa necesidades, límite de salidas y meta de emergencia.');
  return { essentialsWeekly, funWeeklyCap, emergencyGoal };
}
async function markRecoveredSaving(id) {
  const m = state.movements.find(x => x.id === id && x.type === 'income' && !x.earmarked && !x.capitalReturn);
  if (!m || !confirm('¿Era ahorro tuyo que recuperaste, y no dinero nuevo? Se conserva el importe y el saldo. Cambiará su clasificación y se retirará su reserva de ofrenda, si existía.')) return;
  const previous = structuredClone(m);
  m.capitalReturn = true;
  m.source = 'Ahorro recuperado';
  if (m.alloc?.offering) { m.alloc.emergency = (m.alloc.emergency || 0) + m.alloc.offering; m.alloc.offering = 0; }
  if (!(await persist())) { Object.keys(m).forEach(k => delete m[k]); Object.assign(m, previous); return; }
  showToast('Clasificado como ahorro recuperado. El saldo y el importe no cambiaron.'); render();
}
