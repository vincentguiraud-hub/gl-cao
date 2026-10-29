const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' ')));
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  const tool = async (tab, name) => { await p.click(`#tabs >> text=${tab}`); await p.locator('.cbtn').filter({ hasText: new RegExp('^' + name.replace(/[()/]/g,'.') + '$') }).first().click(); await p.waitForTimeout(900); };
  const state = async (label) => { const r = await p.evaluate(() => ({ n: window.__gl.doc.features.length, err: window.__gl.st.errors })); console.log(label.padEnd(28), 'feats=', r.n, JSON.stringify(r.err), errs.length ? 'ERRS ' + errs.splice(0).join(' | ') : ''); };
  await p.evaluate(() => window.__gl.loadExample('equerre')); await p.waitForTimeout(2500);
  // fonction mince sur le profil
  await p.click('.ti:has-text("Profil")'); await tool('Fonctions', 'Bossage extrudé'); await p.check('#c_thin'); await p.waitForTimeout(400);
  await p.fill('input[data-k="thinT"]','4'); await p.press('input[data-k="thinT"]','Tab'); await p.selectOption('select[data-k="end"]','mid'); await p.waitForTimeout(1500);
  console.log('pm err', await p.evaluate(()=>document.querySelector('#pm .err')?.textContent||''));
  await p.click('#pmNo'); await p.waitForTimeout(800);
  // perçage depuis esquisse (esquisse Profil sans points => message)
  await tool('Fonctions', 'Assistance perçage'); await p.selectOption('select[data-k="ptsSketch"]', { index: 1 }); await p.waitForTimeout(1200);
  console.log('pm hole', await p.evaluate(()=>document.querySelector('#pm .err')?.textContent||''));
  await p.click('#pmNo'); await p.waitForTimeout(500);
  await tool('Fonctions', 'Déplacer / copier le corps'); await p.waitForTimeout(1200); await p.click('#pmOk'); await p.waitForTimeout(1200); await state('déplacer');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(1200); await state('annuler');
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(800); await p.screenshot({ path: '/tmp/m2.png' });
  console.log(errs.join('\n'));
  await b.close();
})();
