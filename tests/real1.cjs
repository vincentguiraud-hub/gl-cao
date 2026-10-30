// Session réaliste : platine + bossage sur face + congés + perçages + modification amont
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const log = []; p.on('pageerror', e => log.push('PAGEERR ' + e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' ')));
  p.on('console', m => { if (m.type()==='error' || m.type()==='warning') log.push(m.type()+' '+m.text().slice(0,250)); });
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  let n = 0; const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: `/tmp/real/${String(++n).padStart(2,'0')}-${name}.png` }); const st = await p.evaluate(() => ({ f: window.__gl.doc.features.map(f=>f.name), e: window.__gl.st?.errors, msg: document.querySelector('#smsg').textContent, toast: document.querySelector('#toast').style.display==='block'?document.querySelector('#toast').textContent:'' })); console.log(n, name, JSON.stringify(st), log.splice(0).join(' || ')); };
  const box = async () => p.locator('#view canvas').boundingBox();
  const tool = async name => { await p.locator('.cbtn').filter({ hasText: new RegExp('^' + name.replace(/[()/]/g,'.') + '$') }).first().click(); await p.waitForTimeout(150); };
  const tab = async t => { await p.click(`#tabs >> text=${t}`); await p.waitForTimeout(100); };
  const P3 = async (x,y,z) => p.evaluate(([x,y,z]) => { const v = window.__gl.viewer(); const r = v.container.getBoundingClientRect(); const s = v.toScreen([x,y,z]); return [s[0]+r.left, s[1]+r.top]; }, [x,y,z]);
  // 1. Esquisse sur le plan de dessus : rectangle à main levée
  await shot('depart');
  await p.click('text=Plan de dessus'); await tab('Esquisse'); await tool('Esquisse'); await p.waitForTimeout(1000); await shot('esquisse-ouverte');
  await tool('Rectangle'); const B = await box(); const cx = B.x + B.width/2, cy = B.y + B.height/2;
  await p.mouse.move(cx - 150, cy - 90); await p.mouse.click(cx - 150, cy - 90); await p.mouse.move(cx + 140, cy + 80, {steps: 5}); await p.mouse.click(cx + 140, cy + 80); await shot('rectangle');
  // coter : clic sur l'étiquette de largeur
  const labels = await p.$$eval('.sk-dim', els => els.map(e => ({ t: e.textContent, x: e.getBoundingClientRect().x + 5, y: e.getBoundingClientRect().y + 5 })));
  console.log('labels', JSON.stringify(labels.map(l=>l.t)));
  await p.mouse.click(labels[0].x, labels[0].y); await p.waitForTimeout(200); await p.fill('.dimpop input', '200'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const labels2 = await p.$$eval('.sk-dim', els => els.map(e => ({ t: e.textContent, x: e.getBoundingClientRect().x + 5, y: e.getBoundingClientRect().y + 5, c: e.className })));
  console.log('labels2', JSON.stringify(labels2.map(l=>l.t+'/'+l.c)));
  const hl = labels2.find(l => l.c.includes('info') && l.t !== '200');
  if (hl) { await p.mouse.click(hl.x, hl.y); await p.waitForTimeout(200); await p.fill('.dimpop input', '120'); await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
  await shot('cotes');
  // cercle au centre
  await tool('Cercle'); await p.mouse.click(cx, cy); await p.mouse.click(cx + 30, cy); await shot('cercle');
  await p.click('#confirm .ok'); await p.waitForTimeout(1200); await shot('esquisse-validee');
  await tab('Fonctions'); await tool('Bossage extrudé'); await p.waitForTimeout(1200); await shot('extrusion-pm');
  await p.fill('input[data-k="depth"]', '15'); await p.press('input[data-k="depth"]', 'Tab'); await p.waitForTimeout(1200);
  await p.click('#pmOk'); await p.waitForTimeout(1500); await p.click('[data-k="iso"]'); await p.waitForTimeout(700); await p.click('[data-k="fit"]'); await p.waitForTimeout(700); await shot('extrusion');
  // 2. Esquisse sur la face du dessus (double-clic)
  const bb = await p.evaluate(() => { const v = window.__gl.viewer().modelBounds(); return [v.min.toArray(), v.max.toArray()]; }); console.log('bbox', JSON.stringify(bb));
  const top = await P3(60, bb[1][1], 30); await p.mouse.dblclick(top[0], top[1]); await p.waitForTimeout(1500); await shot('esquisse-sur-face');
  await tool('Rectangle centré'); const B2 = await box(); const c2x = B2.x + B2.width/2, c2y = B2.y + B2.height/2;
  await p.mouse.click(c2x + 40, c2y); await p.mouse.move(c2x + 70, c2y + 25, {steps:3}); await p.mouse.click(c2x + 70, c2y + 25); await shot('rect-sur-face');
  await p.click('#confirm .ok'); await p.waitForTimeout(1200);
  await tool('Bossage extrudé'); await p.waitForTimeout(1200); await shot('bossage2-pm'); await p.click('#pmOk'); await p.waitForTimeout(1500);
  await p.click('[data-k="iso"]'); await p.waitForTimeout(700); await shot('bossage2');
  // 3. Congé : clic sur arêtes
  await tool('Congé'); await p.waitForTimeout(600);
  const e1 = await P3(bb[1][0], bb[1][1] / 2, bb[1][2]); await p.mouse.click(e1[0], e1[1]); await p.waitForTimeout(400);
  const e2 = await P3(bb[0][0], bb[1][1] / 2, bb[1][2]); await p.mouse.click(e2[0], e2[1]); await p.waitForTimeout(400);
  await shot('conge-pm'); await p.click('#pmOk'); await p.waitForTimeout(1500); await shot('conge');
  // 4. Perçage sur la face du dessus
  await tool('Assistance perçage'); await p.waitForTimeout(600);
  const h1 = await P3(-80, bb[1][1], -40); await p.mouse.click(h1[0], h1[1]); await p.waitForTimeout(500);
  const h2 = await P3(-80, bb[1][1], 40); await p.mouse.click(h2[0], h2[1]); await p.waitForTimeout(500);
  await shot('percage-pm'); await p.click('#pmOk'); await p.waitForTimeout(1500); await shot('percage');
  // 5. Modifier l'esquisse de base (largeur 200 -> 260)
  await p.dblclick('.ti:has-text("Esquisse1")'); await p.waitForTimeout(1500); await shot('edition-esquisse1');
  const drv = await p.$$eval('.sk-dim.drv', els => els.map(e => ({ t: e.textContent, x: e.getBoundingClientRect().x + 5, y: e.getBoundingClientRect().y + 5 })));
  console.log('drv', JSON.stringify(drv.map(d=>d.t)));
  const w = drv.find(d => d.t === '200'); if (w) { await p.mouse.click(w.x, w.y); await p.waitForTimeout(200); await p.fill('.dimpop input', '260'); await p.keyboard.press('Enter'); await p.waitForTimeout(400); }
  await shot('largeur-260'); await p.click('#confirm .ok'); await p.waitForTimeout(2000); await p.click('[data-k="iso"]'); await p.waitForTimeout(500); await p.click('[data-k="fit"]'); await p.waitForTimeout(700); await shot('apres-modif');
  // 6. Modifier profondeur bossage 1
  await p.dblclick('.ti:has-text("Bossage-Extru1")'); await p.waitForTimeout(1000); await p.fill('input[data-k="depth"]', '25'); await p.press('input[data-k="depth"]', 'Tab'); await p.waitForTimeout(1500); await p.click('#pmOk'); await p.waitForTimeout(2000); await shot('epaisseur-25');
  await b.close();
})();
