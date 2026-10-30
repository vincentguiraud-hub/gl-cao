// Session réaliste 2 : profil en lignes enchaînées + arc tangent, révolution, enlèvement sur face latérale, suppression, annulation
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const log = []; p.on('pageerror', e => log.push('PAGEERR ' + e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' ')));
  p.on('console', m => { if (m.type()==='error') log.push(m.type()+' '+m.text().slice(0,250)); });
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  let n = 0; const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: `/tmp/real/b${String(++n).padStart(2,'0')}-${name}.png` }); const st = await p.evaluate(() => ({ f: window.__gl.doc.features.map(f=>f.name), e: window.__gl.st?.errors, sk: window.__gl.sk ? window.__gl.sk.ents.map(e=>e.t).join(',') : '', toast: document.querySelector('#toast').style.display==='block'?document.querySelector('#toast').textContent:'' })); console.log(n, name, JSON.stringify(st), log.splice(0).join(' || ')); };
  const tool = async name => { await p.locator('.cbtn').filter({ hasText: new RegExp('^' + name.replace(/[()/]/g,'.') + '$') }).first().click(); await p.waitForTimeout(150); };
  const tab = async t => { await p.click(`#tabs >> text=${t}`); await p.waitForTimeout(100); };
  const S = async (x, y) => p.evaluate(([x, y]) => window.__gl.scr([x, y]), [x, y]);
  const at = async (x, y) => { const [a, c] = await S(x, y); await p.mouse.move(a, c, { steps: 3 }); await p.waitForTimeout(30); await p.mouse.click(a, c); await p.waitForTimeout(60); };
  const P3 = async (x,y,z) => p.evaluate(([x,y,z]) => { const v = window.__gl.viewer(); const r = v.container.getBoundingClientRect(); const s = v.toScreen([x,y,z]); return [s[0]+r.left, s[1]+r.top]; }, [x,y,z]);
  // Esquisse plan de face : profil en L avec arc
  await p.click('text=Plan de face'); await tab('Esquisse'); await tool('Esquisse'); await p.waitForTimeout(1000);
  await tool('Ligne');
  await at(0, 0); await at(120, 0); await at(120, 15); await at(40, 15);
  await shot('profil-partiel');
  await tool('Arc tangent'); await at(40, 15); await at(15, 40); await shot('arc-tangent');
  await tool('Ligne'); await at(15, 40); await at(15, 100); await at(0, 100); await at(0, 0); await shot('profil-ferme');
  await p.keyboard.press('Escape');
  await p.click('#confirm .ok'); await p.waitForTimeout(1200);
  await tab('Fonctions'); await tool('Bossage extrudé'); await p.waitForTimeout(1200); await p.selectOption('select[data-k="end"]','mid'); await p.fill('input[data-k="depth"]','80'); await p.press('input[data-k="depth"]','Tab'); await p.waitForTimeout(1500); await shot('extrusion-pm');
  await p.click('#pmOk'); await p.waitForTimeout(1500); await p.click('[data-k="iso"]'); await p.waitForTimeout(600); await p.click('[data-k="fit"]'); await p.waitForTimeout(600); await shot('equerre');
  // esquisse sur la face verticale (x = 15, normale +X) : cercle, enlèvement à travers
  const f = await P3(15, 70, 0); await p.mouse.dblclick(f[0], f[1]); await p.waitForTimeout(1500); await shot('esquisse-face-verticale');
  await tool('Cercle'); const B = await p.locator('#view canvas').boundingBox(); await p.mouse.click(B.x + B.width/2, B.y + B.height/2 - 40); await p.mouse.click(B.x + B.width/2 + 15, B.y + B.height/2 - 40); await shot('cercle-face');
  await p.click('#confirm .ok'); await p.waitForTimeout(1200);
  await tool('Enlèvement extrudé'); await p.waitForTimeout(1200); await p.selectOption('select[data-k="end"]','through'); await p.waitForTimeout(1500); await shot('enlevement-pm');
  await p.click('#pmOk'); await p.waitForTimeout(1500); await p.click('[data-k="iso"]'); await p.waitForTimeout(600); await shot('enlevement');
  // révolution d'une rondelle sur le plan de droite
  await p.click('text=Plan de droite'); await tab('Esquisse'); await tool('Esquisse'); await p.waitForTimeout(1000);
  await tool('Axe de construction'); await at(-60, -30); await at(-60, 30);
  await tool('Rectangle'); await at(-50, -5); await at(-35, 5); await shot('profil-revolution');
  await p.click('#confirm .ok'); await p.waitForTimeout(1200);
  await tab('Fonctions'); await tool('Bossage avec révolution'); await p.waitForTimeout(1500); await shot('revolution-pm'); await p.click('#pmOk'); await p.waitForTimeout(1500);
  await p.click('[data-k="fit"]'); await p.waitForTimeout(600); await shot('revolution');
  // supprimer l'enlèvement puis annuler
  await p.click('.ti:has-text("Enlèv.-Extru1")', { button: 'right' }); await p.click('.menu button:text-is("Supprimer")'); await p.waitForTimeout(1500); await shot('suppression');
  await p.click('#bUndo'); await p.waitForTimeout(1500); await shot('annulation');
  await b.close();
})();
