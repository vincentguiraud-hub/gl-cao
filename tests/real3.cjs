// Session réaliste 3 : ossature mécano-soudée (portique) + plan décalé + traverses + mise en plan
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const log = []; p.on('pageerror', e => log.push('PAGEERR ' + e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' ')));
  p.on('console', m => { if (m.type()==='error') log.push(m.type()+' '+m.text().slice(0,250)); });
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  let n = 0; const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: `/tmp/real/c${String(++n).padStart(2,'0')}-${name}.png` }); const st = await p.evaluate(() => ({ f: window.__gl.doc.features.map(f=>f.name), e: window.__gl.st?.errors, b: window.__gl.st?.bodies.length, toast: document.querySelector('#toast').style.display==='block'?document.querySelector('#toast').textContent:'' })); console.log(n, name, JSON.stringify(st), log.splice(0).join(' || ')); };
  const tool = async name => { await p.locator('.cbtn').filter({ hasText: new RegExp('^' + name.replace(/[()/]/g,'.') + '$') }).first().click(); await p.waitForTimeout(150); };
  const tab = async t => { await p.click(`#tabs >> text=${t}`); await p.waitForTimeout(100); };
  const S = async (x, y) => p.evaluate(([x, y]) => window.__gl.scr([x, y]), [x, y]);
  const at = async (x, y) => { const [a, c] = await S(x, y); await p.mouse.move(a, c, { steps: 3 }); await p.waitForTimeout(30); await p.mouse.click(a, c); await p.waitForTimeout(60); };
  const zoomOut = async k => { const B = await p.locator('#view canvas').boundingBox(); await p.mouse.move(B.x + B.width/2, B.y + B.height/2); for (let i = 0; i < k; i++) { await p.mouse.wheel(0, 300); await p.waitForTimeout(60); } };
  await p.click('text=Plan de face'); await tab('Esquisse'); await tool('Esquisse'); await p.waitForTimeout(1000);
  // dessin au clavier : saisie numérique des longueurs
  await tool('Ligne'); await at(0, 0);
  const mv = async (x, y) => { const [a, c] = await S(x, y); await p.mouse.move(a, c, { steps: 3 }); await p.waitForTimeout(60); };
  await mv(0, 20); await p.keyboard.type('2500'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  await p.click('[data-k="fit"]'); await p.waitForTimeout(500);
  await mv(1000, 2500); await p.keyboard.type('3500'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  await p.click('[data-k="fit"]'); await p.waitForTimeout(500);
  await mv(3500, 1000); await p.keyboard.type('2500'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.click('[data-k="fit"]'); await p.waitForTimeout(600);
  console.log('lignes', JSON.stringify(await p.evaluate(() => window.__gl.sk.ents.map(e => [e.a, e.b]))));
  await shot('portique');
  await p.click('#confirm .ok'); await p.waitForTimeout(1200);
  await tab('Mécano-soudé'); await tool('Élément mécano-soudé'); await p.waitForTimeout(1500);
  await p.selectOption('select[data-k="size"]', '80x80x3'); await p.waitForTimeout(1500); await shot('mecano-pm');
  await p.click('#pmOk'); await p.waitForTimeout(2000); await p.click('[data-k="iso"]'); await p.waitForTimeout(600); await p.click('[data-k="fit"]'); await p.waitForTimeout(600); await shot('portique-3d');
  // plan décalé de 1500 pour le 2e portique
  await tab('Fonctions'); await p.click('text=Plan de face'); await tool('Plan de référence'); await p.waitForTimeout(800);
  await p.fill('input[data-k="offset"]', '-1500'); await p.press('input[data-k="offset"]', 'Tab'); await p.waitForTimeout(1200); await p.click('#pmOk'); await p.waitForTimeout(1200); await shot('plan');
  // copier le portique : déplacer/copier les mécano-soudés
  await tool('Déplacer / copier le corps'); await p.waitForTimeout(800); await p.selectOption('select[data-k="target"]','weld'); await p.check('#c_copy'); await p.waitForTimeout(300);
  await p.fill('input[data-k="dx"]','0'); await p.fill('input[data-k="dz"]','-1500'); await p.press('input[data-k="dz"]','Tab'); await p.waitForTimeout(2000); await p.click('#pmOk'); await p.waitForTimeout(2500); await p.click('[data-k="fit"]'); await p.waitForTimeout(600); await shot('deux-portiques');
  // traverses sur le plan de dessus à y = 2500
  await p.click('text=Plan de dessus'); await tool('Plan de référence'); await p.waitForTimeout(800); await p.fill('input[data-k="offset"]','2460'); await p.press('input[data-k="offset"]','Tab'); await p.waitForTimeout(1000); await p.click('#pmOk'); await p.waitForTimeout(1200);
  await p.click('.ti:has-text("Plan2")'); await tab('Esquisse'); await tool('Esquisse'); await p.waitForTimeout(1200); await shot('esquisse-traverses');
  await tool('Ligne'); await at(0, 0); await at(0, 1500); await p.keyboard.press('Escape'); await at(3500, 0); await at(3500, 1500); await p.keyboard.press('Escape'); await shot('traverses');
  await p.click('#confirm .ok'); await p.waitForTimeout(1200);
  await tab('Mécano-soudé'); await tool('Élément mécano-soudé'); await p.waitForTimeout(1500); await p.selectOption('select[data-k="family"]','tube_rect'); await p.waitForTimeout(800); await p.selectOption('select[data-k="size"]','80x40x3'); await p.waitForTimeout(1200);
  await p.click('#pmOk'); await p.waitForTimeout(2500); await p.click('[data-k="iso"]'); await p.waitForTimeout(600); await p.click('[data-k="fit"]'); await p.waitForTimeout(600); await shot('pergola');
  await tool('Liste de débit'); await p.waitForTimeout(500); await shot('debit'); await p.evaluate(()=>document.querySelectorAll('.modal-bg').forEach(x=>x.remove()));
  await tab('Mise en plan'); await tool('Créer la mise en plan'); await p.waitForTimeout(8000); await shot('plan-pergola');
  await b.close();
})();
