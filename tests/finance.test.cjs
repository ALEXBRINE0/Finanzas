const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const inline = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/main\(\);\s*$/, '');
function app() {
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [2026,10,25,12])); } static now() { return new TestDate().getTime(); } }
  const ctx = vm.createContext({ console, Date: TestDate, structuredClone, crypto: require('node:crypto').webcrypto, confirm: () => true });
  vm.runInContext(fs.readFileSync(path.join(root, 'plan.js'), 'utf8') + '\n' + inline, ctx);
  vm.runInContext("state=mkState();state.services=[];state.settings.offeringStart=sd();", ctx);
  return code => vm.runInContext(code, ctx);
}
test('10/20/10/20: each deposit reserves 10%, total cents reconcile', () => {
  const run = app();
  const actual = run(`let n=0;for(const amount of [1000,2000,1000,2000]){const alloc=allocate(amount,envelopeTotals(),{weekly:true,income:true,date:sd()});
    if(Object.values(alloc).reduce((a,b)=>a+b,0)!==amount)throw Error('Not reconciled');
    state.movements.push({id:String(n++),type:'income',amount,date:sd(),created:n,alloc});}offeringOutstanding()`);
  assert.equal(actual, 600);
  assert.equal(run('totals().cash'), 6000);
  assert.equal(run('envelopeTotals().food'), 1000);
  assert.equal(run('envelopeTotals().essentials'), 100);
});
test('donation reduces cash and offering once; does not consume fun', () => {
  const run = app();
  run(`state.movements.push({type:'income',amount:10000,date:sd(),alloc:allocate(10000,zeroBuckets(),{income:true,date:sd()})});var funBefore=envelopeTotals().fun;
    state.movements.push({type:'expense',category:'Ofrenda',amount:600,date:sd(),planVersion:1});`);
  assert.equal(run('offeringOutstanding()'), 400);
  assert.equal(run('totals().cash'), 9400);
  assert.equal(run('envelopeTotals().fun===funBefore'), true);
  assert.equal(run("weekRange('2026-11-29').end"), '2026-11-29');
  assert.equal(run("weekRange('2026-11-30').end"), '2026-12-06');
});
test('opening, recovered saving, old dates, loans and group receipts do not tithe', () => {
  const run = app();
  assert.equal(run('allocate(10079).offering'), 0);
  assert.equal(run("allocate(1000,zeroBuckets(),{income:true,date:'2026-11-24'}).offering"), 0);
  run(`state.movements.push({type:'income',capitalReturn:true,amount:10079,date:sd(),alloc:allocate(10079)});
    state.loans.push({id:'l',direction:'borrowed',principal:500,cash:true});
    state.cycles.push({id:'c',cost:1000,shares:[],paid:false});state.receipts.push({cycleId:'c',amount:200,cash:true});`);
  assert.equal(run('totals().mi'), 0);
  assert.equal(run('offeringOutstanding()'), 0);
  assert.equal(run('totals().earmarked'), 200);
});
test('legacy allocations remain unchanged and old transport still consumes fun', () => {
  const run = app();
  run(`var legacy=mkState();delete legacy.settings.essentialsWeekly;delete legacy.settings.funWeeklyCap;delete legacy.settings.emergencyGoal;delete legacy.settings.offeringStart;
    legacy.movements=[{type:'income',amount:2000,alloc:{food:1000,services:0,debt:450,emergency:350,fun:200},date:sd()},
    {type:'expense',category:'Transporte',amount:100,date:sd()}];state=normalise(legacy);`);
  assert.equal(run('envelopeTotals().fun'), 100);
  assert.equal(run('envelopeTotals().offering'), 0);
  assert.equal(run('state.movements[0].alloc.essentials'), undefined);
  run("state.movements.push({type:'expense',category:'Transporte',amount:50,date:sd(),planVersion:1})");
  assert.equal(run('envelopeTotals().essentials'), -50);
});
test('weekly necessities do not refill after spending; renew next Monday', () => {
  const run = app();
  run(`state.movements.push({type:'income',amount:2000,date:sd(),created:1,alloc:allocate(2000,zeroBuckets(),{weekly:true,income:true,date:sd()})});
    state.movements.push({type:'expense',category:'Transporte',amount:100,date:sd(),created:2,planVersion:1});`);
  assert.equal(run('essentialsWeekInfo().need'), 0);
  assert.equal(run("essentialsWeekInfo('2026-11-30').need"), 100);
});
test('rebalancing preserves offering and physical saving, and never tithes twice', async () => {
  const run = app();
  run(`persist=async()=>true;render=()=>{};showToast=()=>{};
    state.movements.push({type:'income',amount:10000,date:sd(),created:1,alloc:allocate(10000,zeroBuckets(),{income:true,date:sd()})});
    state.savingsTransfers.push({direction:'deposit',amount:500});`);
  await run('rebalanceBuckets()');
  assert.equal(run('envelopeTotals().offering'), 1000);
  assert.equal(run('Object.values(envelopeTotals()).reduce((n,x)=>n+x,0)'), 10000);
  assert.equal(run('savingsBalance()'), 500);
  await run('rebalanceBuckets()');
  assert.equal(run('envelopeTotals().offering'), 1000);
});
test('weekly cap, liquidity and reserves bound discretionary spending', () => {
  const run = app();
  run(`state.settings.foodDay=0;state.settings.essentialsWeekly=0;state.settings.pctDebt=0;state.settings.pctEmergency=0;state.settings.pctFun=100;
    state.movements=[{type:'income',amount:10000,date:sd(),alloc:allocate(10000,zeroBuckets(),{income:true,date:sd()})}];`);
  assert.equal(run('spendingRoom().available'), 500);
  run("state.movements.push({type:'expense',category:'Invitaciones',amount:450,date:sd(),planVersion:1})");
  assert.equal(run('spendingRoom().available'), 50);
  run("state.adjustments.push({delta:-9000})");
  assert.equal(run('spendingRoom().available'), 0);
});
test('invalid new settings and offering allocations are rejected', () => {
  const run = app();
  assert.throws(() => run('state.settings.funWeeklyCap=-1;normalise(state)'));
  assert.throws(() => run("state=mkState();state.movements=[{alloc:{offering:'10'}}];normalise(state)"));
});
test('all cent allocations reconcile, including very small income', () => {
  const run = app();
  assert.equal(run(`(()=>{for(let n=1;n<=20000;n++){const a=allocate(n,zeroBuckets(),{income:true,date:sd()});if(Object.values(a).some(x=>!Number.isSafeInteger(x)||x<0)||Object.values(a).reduce((n,x)=>n+x,0)!==n)return false;}return true})()`), true);
});
test('reclassification retains cash and removes income and offering; failed save rolls back', async () => {
  const run = app();
  run(`persist=async()=>true;render=()=>{};showToast=()=>{};state.movements=[{id:'a',type:'income',amount:10000,date:sd(),source:'Papa libre',alloc:allocate(10000,zeroBuckets(),{income:true,date:sd()})}];`);
  await run("markRecoveredSaving('a')");
  assert.equal(run('totals().cash'), 10000);
  assert.equal(run('totals().mi'), 0);
  assert.equal(run('offeringOutstanding()'), 0);
  run("state.movements[0].capitalReturn=false;persist=async()=>false");
  await run("markRecoveredSaving('a')");
  assert.equal(run('state.movements[0].capitalReturn'), false);
});
test('implicit legacy opening budget keeps its original allocation', () => {
  const run = app();
  run('state.settings.opening=2000');
  assert.equal(run('envelopeTotals().debt'), 450);
  assert.equal(run('envelopeTotals().emergency'), 350);
  assert.equal(run('envelopeTotals().fun'), 200);
  assert.equal(run('envelopeTotals().essentials'), 0);
});
test('offering carries over after Sunday and survives deletion after a snapshot', async () => {
  const run = app();
  run(`persist=async()=>true;render=()=>{};showToast=()=>{};
    state.movements=[{id:'income',type:'income',amount:10000,date:'2026-11-20',created:1,alloc:{food:1000,essentials:100,services:0,debt:3900,emergency:3000,fun:1000,offering:1000}}];`);
  await run('rebalanceBuckets()');
  assert.equal(run('offeringOutstanding()'), 1000);
  run("state.movements.push({id:'donation',type:'expense',category:'Ofrenda',amount:500,date:sd(),created:Date.now()+1})");
  assert.equal(run('envelopeTotals().offering'), 500);
  await run("deleteMovement('donation')");
  assert.equal(run('envelopeTotals().offering'), 1000);
});
test('transferring to savings cannot consume another envelope after cash loss', () => {
  const run = app();
  run(`state.movements=[{type:'income',amount:10000,date:sd(),alloc:allocate(10000,zeroBuckets(),{income:true,date:sd()})}];
    state.adjustments.push({delta:-9000});`);
  assert.equal(run('emergencyToTransfer()'), 0);
});
test('unreconciled envelopes never recommend voluntary debt payments', () => {
  const run = app();
  run(`state.settings.foodDay=0;state.settings.essentialsWeekly=0;state.settings.safetyWeeks=1;
    state.movements=[{type:'income',amount:10000,date:sd(),alloc:{debt:10000}}];
    state.adjustments.push({delta:-100});`);
  assert.equal(run('safePaymentInfo().budgetGap'), -100);
  assert.equal(run('safePaymentInfo().allowed'), 0);
});
