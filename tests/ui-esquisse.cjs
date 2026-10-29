const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' ')));
  p.on('console', m => { if (m.type()==='error') errs.push('CONSOLE '+m.text().slice(0,200)); });
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  await p.evaluate(() => localStorage.clear());
  const S = async (x, y) => p.evaluate(([x, y]) => window.__gl.scr([x, y]), [x, y]);
  const clickAt = async (x, y) => { const [sx, sy] = await S(x, y); await p.mouse.move(sx, sy); await p.waitForTimeout(40); await p.mouse.click(sx, sy); await p.waitForTimeout(60); };
  const tool = async name => { await p.locator('.cbtn').filter({ hasText: new RegExp('^' + name.replace(/[()/]/g,'.') + '$') }).first().click(); await p.waitForTimeout(100); };
  const n = () => p.evaluate(() => window.__gl.sk.ents.length);
  const log = async (label) => console.log(label.padEnd(26), 'ents=', await n(), errs.length ? 'ERRS ' + errs.splice(0).join(' | ') : '');
  await p.click('text=Plan de face'); await p.click('#tabs >> text=Esquisse'); await p.click('.cbtn >> text=Esquisse'); await p.waitForTimeout(1200);
  await p.evaluate(() => window.__gl.viewer().zoomFit(false)); 
  // zoom pour avoir ~ 300 mm visibles
  await p.evaluate(() => { const v = window.__gl.viewer(); v.camera.zoom = 2.5; v.camera.updateProjectionMatrix(); v.controls.target.set(0,0,0); v.camera.position.set(0,0,5000); v.camera.lookAt(0,0,0); v.controls.update(); v.render(); });
  await p.waitForTimeout(300);
  await tool('Ligne'); await clickAt(0,0); await clickAt(100,0); await clickAt(100,60); await p.keyboard.press('Escape'); await log('ligne x2');
  await tool('Rectangle'); await clickAt(-120,0); await clickAt(-60,50); await log('rectangle');
  await tool('Rectangle centré'); await clickAt(-90,-60); await clickAt(-70,-45); await log('rect centré');
  await tool('Cercle'); await clickAt(50,-50); await clickAt(65,-50); await log('cercle');
  await tool('Arc 3 points'); await clickAt(100,60); await clickAt(0,60); await clickAt(50,85); await log('arc 3 pts');
  await tool('Arc par centre'); await clickAt(150,0); await clickAt(170,0); await clickAt(150,20); await log('arc centre');
  await tool('Arc tangent'); await clickAt(100,60); await clickAt(130,90); await log('arc tangent');
  await tool('Polygone'); await clickAt(-150,-60); await clickAt(-135,-60); await log('polygone');
  await tool('Rainure'); await clickAt(20,-90); await clickAt(80,-90); await clickAt(80,-80); await log('rainure');
  await tool('Axe de construction'); await clickAt(0,-120); await clickAt(0,120); await log('axe');
  await tool('Point'); await clickAt(30,30); await log('point');
  // cote entre 2 points
  await tool('Cotation'); await clickAt(0,0); await clickAt(-120,0); await p.waitForTimeout(200);
  const pop = await p.$('.dimpop'); console.log('popup distance', !!pop, pop && await p.inputValue('.dimpop input'));
  if (pop) { await p.fill('.dimpop input', '130'); await p.keyboard.press('Enter'); }
  await log('cote 2 points');
  console.log('rect gauche x', await p.evaluate(() => Math.min(...window.__gl.sk.ents.filter(e=>e.t==='line').flatMap(e=>[e.a[0],e.b[0]]))));
  // cote de cercle
  await tool('Cotation'); await clickAt(65,-50); await p.waitForTimeout(150); const pop2 = await p.$('.dimpop'); if (pop2) { await p.fill('.dimpop input','40'); await p.keyboard.press('Enter'); }
  console.log('cercle r', await p.evaluate(() => window.__gl.sk.ents.find(e=>e.t==='circle').r));
  // congé d'esquisse sur coin (100,0)
  await tool("Congé d'esquisse"); await clickAt(100,0); await log('congé esquisse');
  // ajuster
  await tool('Ajuster'); await clickAt(0,100); await log('ajuster axe');
  // sélection + déplacer copier
  await tool('Sélection'); await clickAt(70,-50); await p.waitForTimeout(100);
  console.log('sel', await p.evaluate(() => window.__gl.sk.sel.size));
  await tool('Déplacer / copier'); await p.fill('#mvX','0'); await p.fill('#mvY','-30'); await p.check('#mvC'); await p.click('#opGo'); await log('copie');
  await tool('Pivoter'); await p.fill('#rtA','45'); await p.click('#opGo'); await log('pivoter');
  await tool('Décaler entités'); await p.fill('#opD','3'); await p.click('#opGo'); await log('décaler');
  await tool("Répétition d'entités"); await p.fill('#opX1','0'); await p.fill('#opY1','10'); await p.fill('#opN','2'); await p.click('#opGo'); await log('répétition');
  // glisser un point
  await tool('Sélection'); const [ax, ay] = await S(-60, 50); await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(ax+30, ay-30, {steps:5}); await p.mouse.up(); await log('glisser point');
  // undo/redo
  await p.click('#oUndo'); await p.click('#oRedo'); await log('undo/redo');
  await p.screenshot({ path: '/tmp/u1.png' });
  await p.click('#confirm .ok'); await p.waitForTimeout(1500);
  console.log('features', JSON.stringify(await p.evaluate(() => window.__gl.doc.features.map(f=>f.type+':'+f.entities?.length))));
  console.log(errs.join('\n'));
  await b.close();
})();
