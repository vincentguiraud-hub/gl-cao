// Session réaliste 5 : platine, perçage sur tube, répétition, symétrie, balayage (main courante)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const log = []; p.on('pageerror', e => log.push('PAGEERR ' + e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' ')));
  p.on('console', m => { if (m.type()==='error') log.push(m.type()+' '+m.text().slice(0,250)); });
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  let n = 0; const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: `/tmp/real/e${String(++n).padStart(2,'0')}-${name}.png` }); const st = await p.evaluate(() => ({ f: window.__gl.doc.features.map(f=>f.name), e: window.__gl.st?.errors, b: window.__gl.st?.bodies.length, toast: document.querySelector('#toast').style.display==='block'?document.querySelector('#toast').textContent:'' })); console.log(n, name, JSON.stringify(st).slice(0,500), log.splice(0).join(' || ')); };
  const tool = async name => { await p.locator('.cbtn').filter({ hasText: new RegExp('^' + name.replace(/[()/]/g,'.') + '$') }).first().click(); await p.waitForTimeout(150); };
  const tab = async t => { await p.click(`#tabs >> text=${t}`); await p.waitForTimeout(100); };
  const S = async (x, y) => p.evaluate(([x, y]) => window.__gl.scr([x, y]), [x, y]);
  const at = async (x, y) => { const [a, c] = await S(x, y); await p.mouse.move(a, c, { steps: 3 }); await p.waitForTimeout(30); await p.mouse.click(a, c); await p.waitForTimeout(60); };
  const P3 = async (x,y,z) => p.evaluate(([x,y,z]) => { const v = window.__gl.viewer(); const r = v.container.getBoundingClientRect(); const s = v.toScreen([x,y,z]); return [s[0]+r.left, s[1]+r.top]; }, [x,y,z]);
  const fit = async () => { await p.click('[data-k="iso"]'); await p.waitForTimeout(500); await p.click('[data-k="fit"]'); await p.waitForTimeout(600); };
  // poteau tube 80x80 sur platine 200x200x10
  await p.click('text=Plan de dessus'); await tab('Esquisse'); await tool('Esquisse'); await p.waitForTimeout(1000);
  await tool('Rectangle centré'); await at(0, 0); await p.keyboard.type('200;200'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  await p.click('#confirm .ok'); await p.waitForTimeout(1000);
  await tab('Fonctions'); await tool('Bossage extrudé'); await p.waitForTimeout(1000); await p.fill('input[data-k="depth"]','10'); await p.press('input[data-k="depth"]','Tab'); await p.waitForTimeout(800); await p.click('#pmOk'); await p.waitForTimeout(1200);
  await p.click('text=Plan de face'); await tab('Esquisse'); await tool('Esquisse'); await p.waitForTimeout(1000);
  await tool('Ligne'); await at(0, 10); const [mx, my] = await S(0, 60); await p.mouse.move(mx, my, {steps:3}); await p.keyboard.type('1000'); await p.keyboard.press('Enter'); await p.keyboard.press('Escape');
  await p.click('#confirm .ok'); await p.waitForTimeout(1000);
  await tab('Mécano-soudé'); await tool('Élément mécano-soudé'); await p.waitForTimeout(1200); await p.selectOption('select[data-k="size"]','80x80x3'); await p.waitForTimeout(800); await p.check('#c_caps'); await p.waitForTimeout(1200); await p.click('#pmOk'); await p.waitForTimeout(1500);
  await fit(); await shot('poteau');
  // perçage dans le tube (face avant z=40) à 900 de haut
  await tab('Fonctions'); await tool('Assistance perçage'); await p.waitForTimeout(800);
  const h = await P3(0, 900, 40); await p.mouse.click(h[0], h[1]); await p.waitForTimeout(800);
  await p.selectOption('select[data-k="std"]','M12'); await p.waitForTimeout(1200); await shot('percage-tube-pm');
  await p.click('#pmOk'); await p.waitForTimeout(1500); await shot('percage-tube');
  // 4 trous de fixation de la platine, puis répétition
  await tool('Assistance perçage'); await p.waitForTimeout(800);
  const t = await P3(75, 10, 75); await p.mouse.click(t[0], t[1]); await p.waitForTimeout(800);
  await p.click('#pmOk'); await p.waitForTimeout(1500);
  await p.click('.ti:has-text("Perçage2")'); await tool('Répétition circulaire'); await p.waitForTimeout(800); await p.fill('input[data-k="count"]','4'); await p.press('input[data-k="count"]','Tab'); await p.waitForTimeout(1500); await p.click('#pmOk'); await p.waitForTimeout(1500);
  await fit(); await shot('platine-percee');
  // mesure entre deux trous
  await tab('Évaluer'); await tool('Mesurer'); const m1 = await P3(75, 5, 75 - 6.6); await p.mouse.click(m1[0], m1[1]); await p.waitForTimeout(500); await shot('mesure');
  await p.keyboard.press('Escape');
  // mise en plan
  await tab('Mise en plan'); await tool('Créer la mise en plan'); await p.waitForTimeout(8000); await shot('plan');
  await b.close();
})();
