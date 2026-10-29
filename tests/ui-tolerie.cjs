const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  await p.evaluate(() => window.__gl.loadExample('equerre')); await p.waitForTimeout(2500);
  await p.click('#tabs >> text=Tôlerie'); await p.click('.cbtn:has-text("Mise à plat")'); await p.waitForTimeout(800);
  await p.screenshot({ path: '/tmp/x1.png' });
  await p.evaluate(()=>document.querySelectorAll('.modal-bg').forEach(x=>x.remove()));
  await p.evaluate(() => window.__gl.loadExample('cadre')); await p.waitForTimeout(2500);
  await p.dblclick('.ti:has-text("Cadre 40")'); await p.waitForTimeout(1000);
  await p.selectOption('select[data-k="corner"]','none'); await p.waitForTimeout(500);
  await p.evaluate(() => { const f = window.__gl.pm.feature; }); 
  console.log(errs);
  await b.close();
})();
