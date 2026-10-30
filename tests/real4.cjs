// Session réaliste 4 : édition d'esquisse au panneau, suppression, annulation, profil ouvert, tôle pliée via l'interface
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const log = []; p.on('pageerror', e => log.push('PAGEERR ' + e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' ')));
  p.on('console', m => { if (m.type()==='error') log.push(m.type()+' '+m.text().slice(0,250)); });
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  let n = 0; const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: `/tmp/real/d${String(++n).padStart(2,'0')}-${name}.png` }); const st = await p.evaluate(() => ({ f: window.__gl.doc.features.map(f=>f.name), e: window.__gl.st?.errors, sk: window.__gl.sk ? JSON.stringify(window.__gl.sk.ents.map(e=>[e.t,e.a||e.c,e.b||e.r])) : '', toast: document.querySelector('#toast').style.display==='block'?document.querySelector('#toast').textContent:'' })); console.log(n, name, JSON.stringify(st).slice(0, 600), log.splice(0).join(' || ')); };
  const tool = async name => { await p.locator('.cbtn').filter({ hasText: new RegExp('^' + name.replace(/[()/]/g,'.') + '$') }).first().click(); await p.waitForTimeout(150); };
  const tab = async t => { await p.click(`#tabs >> text=${t}`); await p.waitForTimeout(100); };
  const S = async (x, y) => p.evaluate(([x, y]) => window.__gl.scr([x, y]), [x, y]);
  const at = async (x, y) => { const [a, c] = await S(x, y); await p.mouse.move(a, c, { steps: 3 }); await p.waitForTimeout(30); await p.mouse.click(a, c); await p.waitForTimeout(60); };
  await p.click('text=Plan de face'); await tab('Esquisse'); await tool('Esquisse'); await p.waitForTimeout(1000);
  await tool('Ligne'); await at(0, 0); await at(80, 0); await at(80, 40); await p.keyboard.press('Escape'); await shot('2-lignes');
  // éditer la 2e ligne au panneau : taper X fin puis cliquer Y fin et taper
  await tool('Sélection'); await at(80, 20); await p.waitForTimeout(200);
  const bx = p.locator('#pm input[data-k="by"]'); await bx.click(); await bx.fill('60');
  const ax = p.locator('#pm input[data-k="len"]'); await ax.click(); await p.waitForTimeout(100); await shot('edition-panneau');
  await ax.fill('50'); await ax.press('Enter'); await p.waitForTimeout(300); await shot('longueur-50');
  // supprimer la ligne puis annuler
  await at(80, 25); await p.keyboard.press('Delete'); await p.waitForTimeout(200); await shot('suppression');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300); await shot('annuler');
  await p.click('#confirm .ok'); await p.waitForTimeout(1200);
  // profil ouvert -> bossage extrudé : message clair
  await tab('Fonctions'); await tool('Bossage extrudé'); await p.waitForTimeout(1500); await shot('extrusion-profil-ouvert');
  await p.click('#pmNo'); await p.waitForTimeout(500);
  // tôle pliée sur ce profil
  await tab('Tôlerie'); await tool('Tôle pliée (profil ouvert)'); await p.waitForTimeout(1500);
  await p.fill('input[data-k="thickness"]', '3'); await p.fill('input[data-k="width"]', '200'); await p.press('input[data-k="width"]','Tab'); await p.waitForTimeout(1500); await shot('tole-pm');
  await p.click('#pmOk'); await p.waitForTimeout(1500); await p.click('[data-k="iso"]'); await p.waitForTimeout(600); await p.click('[data-k="fit"]'); await p.waitForTimeout(600); await shot('tole');
  // fermer l'esquisse avec ✗ : les modifs doivent être annulées
  await p.dblclick('.ti:has-text("Esquisse1")'); await p.waitForTimeout(1200); await tool('Ligne'); await at(0, 0); await at(0, 50); await p.keyboard.press('Escape');
  await p.click('#confirm .no'); await p.waitForTimeout(1500); await shot('annuler-esquisse');
  console.log('ents', await p.evaluate(() => window.__gl.doc.features[0].entities.length));
  await b.close();
})();
