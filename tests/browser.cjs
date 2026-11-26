// Usa Playwright desde el runtime configurado, sin instalar dependencias en el proyecto.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const artifacts = process.env.TEST_ARTIFACTS || path.join(root, '..', 'browser-check');
const allowed = new Set(['/', '/index.html', '/plan.js', '/sw.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']);
const server = http.createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname;
  if (!allowed.has(file)) { res.writeHead(404).end(); return; }
  try {
    const body = await fs.readFile(path.join(root, file === '/' ? 'index.html' : file));
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : file.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html; charset=utf-8');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Panama', acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#personalPlan').getByText('Disponible esta semana').waitFor();
    // Configuración sintética, nunca información financiera del usuario.
    await page.evaluate(async () => { state.services = []; state.cycles = []; await persist(); });
    async function entry(mode, amount, category) {
      await page.locator('#bottomNav [data-go="add"]').click();
      await page.locator(`[data-entry="${mode}"]`).click();
      await page.locator('#entryAmount').fill(amount);
      if (category) await page.locator(mode === 'income' ? '#incomeSource' : '#expenseCategory').selectOption(category);
      await page.locator('#saveEntry').click();
      await page.locator('#view-home.active').waitFor();
    }
    for (const a of ['10','20','10','20']) await entry('income', a);
    assert.equal(await page.evaluate(() => offeringOutstanding()), 600);
    assert.equal(await page.evaluate(() => physicalChecking()), 6000);
    await page.locator('[data-offering-pay]').click();
    assert.equal(await page.locator('#expenseCategory').inputValue(), 'Ofrenda');
    await page.locator('#entryAmount').fill('2');
    await page.locator('#saveEntry').click();
    await page.locator('#view-home.active').waitFor();
    assert.equal(await page.evaluate(() => offeringOutstanding()), 400);
    await entry('income', '100.79', 'Ahorro recuperado');
    assert.equal(await page.evaluate(() => totals().mi), 6000);
    assert.equal(await page.evaluate(() => physicalChecking()), 15879);
    await entry('expense', '1', 'Transporte');
    await entry('expense', '3', 'Invitaciones');
    assert.equal(await page.evaluate(() => envelopeTotals().essentials), 0);
    assert.equal(await page.evaluate(() => spendingRoom().spent), 300);
    await page.reload();
    await page.locator('#personalPlan').getByText('Disponible esta semana').waitFor();
    assert.equal(await page.evaluate(() => offeringOutstanding()), 400);
    assert.equal(await page.evaluate(() => state.movements.length), 8);
    // Corrección histórica conserva saldo.
    await entry('income', '5');
    const before = await page.evaluate(() => physicalChecking());
    await page.locator('#bottomNav [data-go="history"]').click();
    await page.locator('[data-recovered-saving]').first().click();
    await page.waitForFunction(() => state.movements.at(-1).capitalReturn === true);
    assert.equal(await page.evaluate(() => physicalChecking()), before);
    assert.equal(await page.evaluate(() => offeringOutstanding()), 400);
    await page.locator('#bottomNav [data-go="settings"]').click();
    await page.locator('#essentialsWeekly').fill('1');
    await page.locator('#funWeeklyCap').fill('5');
    await page.locator('#emergencyGoal').fill('100');
    await page.locator('#settingsForm button[type="submit"]').click();
    await page.locator('#view-home.active').waitFor();
    await page.locator('#bottomNav [data-go="settings"]').click();
    // Exportación CSV y protección de fórmulas.
    await page.evaluate(() => { state.movements[0].note = '=HYPERLINK("https://example.invalid")'; });
    const csvPromise = page.waitForEvent('download');
    await page.locator('#exportCSV').click();
    const csvDownload = await csvPromise;
    const csv = await fs.readFile(await csvDownload.path(), 'utf8');
    assert.ok(csv.includes('"\'=HYPERLINK('));
    assert.ok(csv.includes('"Impacta saldo"'));
    assert.ok(csv.includes('"Ahorro recuperado, no ingreso nuevo"'));
    // JSON exportado y restaurado por el formulario real.
    const backupPromise = page.waitForEvent('download');
    await page.locator('#exportJSON').click();
    const backup = await backupPromise;
    const backupPath = await backup.path();
    await page.locator('#importFile').setInputFiles(backupPath);
    await page.locator('#view-home.active').waitFor();
    assert.equal(await page.evaluate(() => offeringOutstanding()), 400);
    const legacy = await page.evaluate(() => {
      const data=mkState();data.services=[];
      for(const k of ['essentialsWeekly','funWeeklyCap','emergencyGoal','offeringStart'])delete data.settings[k];
      data.movements=[{id:'legacy-income',type:'income',amount:2000,date:sd(),created:1,source:'Otro ingreso',alloc:{food:1000,services:0,debt:450,emergency:350,fun:200}}];
      return {format:'MiDinero-backup',version:1,data};
    });
    await page.locator('#bottomNav [data-go="settings"]').click();
    await page.locator('#importFile').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
    await page.locator('#view-home.active').waitFor();
    assert.equal(await page.evaluate(() => offeringOutstanding()), 0);
    assert.equal(await page.evaluate(() => physicalChecking()), 2000);
    assert.equal(await page.evaluate(() => envelopeTotals().fun), 200);
    await page.locator('#bottomNav [data-go="settings"]').click();
    await page.locator('#importFile').setInputFiles(backupPath);
    await page.locator('#view-home.active').waitFor();
    // Todas las pantallas sin desbordamiento a 320, 390 y 1280 px.
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const view of ['home', 'add', 'history', 'debts', 'settings']) {
        await page.locator(`#bottomNav [data-go="${view}"]`).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${view}: overflow at ${width}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#bottomNav [data-go="home"]').click();
    await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('show'));
    await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await page.locator('#personalPlan').getByText('Disponible esta semana').waitFor();
    assert.equal(await page.evaluate(() => offeringOutstanding()), 400);
    await entry('income', '10');
    assert.equal(await page.evaluate(() => offeringOutstanding()), 500);
    await page.reload();
    await page.locator('#personalPlan').getByText('Disponible esta semana').waitFor();
    assert.equal(await page.evaluate(() => offeringOutstanding()), 500);
    assert.deepEqual(errors, []);
    console.log('PASS: registro, ofrenda parcial, ahorro recuperado, corrección, persistencia, ajustes, CSV seguro, respaldo/restauración, 15 vistas responsivas y registro offline.');
    await context.close();
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
