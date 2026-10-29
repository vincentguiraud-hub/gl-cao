const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' ')));
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  await p.evaluate(() => { localStorage.clear(); });
  const S = async (x, y) => p.evaluate(([x, y]) => window.__gl.scr([x, y]), [x, y]);
  const clickAt = async (x, y, mod) => { const [sx, sy] = await S(x, y); await p.mouse.move(sx, sy); await p.waitForTimeout(40); if (mod) await p.keyboard.down(mod); await p.mouse.click(sx, sy); if (mod) await p.keyboard.up(mod); await p.waitForTimeout(80); };
  const tool = async name => { await p.locator('.cbtn').filter({ hasText: new RegExp('^' + name.replace(/[()/]/g,'.') + '$') }).first().click(); await p.waitForTimeout(100); };
  const info = async l => { const r = await p.evaluate(() => ({ n: window.__gl.sk.ents.length, c: window.__gl.sk.cons.map(c => c.t + (c.val!=null?'='+c.val:'')).join(','), dof: window.__gl.sk.dof() })); console.log(l.padEnd(28), JSON.stringify(r), errs.length ? 'ERRS ' + errs.splice(0).join(' | ') : ''); };
  await p.click('text=Plan de face'); await p.click('#tabs >> text=Esquisse'); await p.click('.cbtn >> text=Esquisse'); await p.waitForTimeout(1200);
  await p.evaluate(() => { const v = window.__gl.viewer(); v.camera.zoom = 2.5; v.camera.updateProjectionMatrix(); v.controls.target.set(0,0,0); v.camera.position.set(0,0,5000); v.camera.lookAt(0,0,0); v.controls.update(); v.render(); });
  await p.waitForTimeout(300);
  await tool('Rectangle'); await clickAt(0,0); await clickAt(100,60); await info('rectangle auto h/v');
  // cote largeur via étiquette
  await tool('Cotation'); await clickAt(50, 0); await p.fill('.dimpop input', '120'); await p.keyboard.press('Enter'); await p.waitForTimeout(200); await info('cote largeur 120');
  await clickAt(100 + 20, 30); await p.waitForTimeout(100); const has = await p.$('.dimpop'); if (has) { await p.fill('.dimpop input', '70'); await p.keyboard.press('Enter'); } await p.waitForTimeout(200); await info('cote hauteur 70');
  console.log('coins', JSON.stringify(await p.evaluate(() => window.__gl.sk.ents.map(e => [e.a, e.b]))));
  // cercle + tangence + diamètre
  await tool('Cercle'); await clickAt(60, 35); await clickAt(70, 35); await info('cercle');
  await tool('Sélection'); await clickAt(70, 35 - 0.0001); 
  await clickAt(60, 70, 'Shift');
  console.log('sel', await p.evaluate(() => [...window.__gl.sk.sel]));
  const relBtns = await p.$$eval('[data-rel]', bs => bs.map(b => b.textContent)); console.log('boutons', relBtns);
  if (relBtns.includes('Tangente')) { await p.click('[data-rel="tan"]'); await p.waitForTimeout(300); }
  await info('tangente');
  // modifier cote pilotante existante
  const drv = await p.$$('.sk-dim.drv'); console.log('cotes pilotantes', drv.length);
  await drv[0].click(); await p.waitForTimeout(150); await p.fill('.dimpop input', '150'); await p.keyboard.press('Enter'); await p.waitForTimeout(300); await info('modifier cote 150');
  // glisser coin (doit rester rectangle, largeur figée)
  await tool('Sélection'); const pts = await p.evaluate(() => window.__gl.sk.ents[1].b); const [ax, ay] = await S(pts[0], pts[1]);
  await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(ax + 40, ay - 40, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  console.log('après glisser', JSON.stringify(await p.evaluate(() => window.__gl.sk.ents.slice(0,4).map(e => [e.a, e.b]))));
  // conflit
  await tool('Sélection'); await clickAt(75, 0); await p.waitForTimeout(100);
  if (await p.$('[data-rel="v"]')) await p.click('[data-rel="v"]'); await p.waitForTimeout(300);
  console.log('toast', await p.textContent('#toast'));
  await p.screenshot({ path: '/tmp/w1.png' });
  await p.click('#confirm .ok'); await p.waitForTimeout(1200);
  await p.dblclick('.ti:has-text("Esquisse1")'); await p.waitForTimeout(1200); await info('réouverture');
  console.log(errs.join('\n'));
  await b.close();
})();
