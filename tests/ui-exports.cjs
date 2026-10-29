const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' ')));
  p.on('console', m => { if (m.type()==='error') errs.push('CONSOLE '+m.text().slice(0,200)); });
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  const P3 = async (x,y,z) => p.evaluate(([x,y,z]) => { const v = window.__gl.viewer(); const r = v.container.getBoundingClientRect(); const s = v.toScreen([x,y,z]); return [s[0]+r.left, s[1]+r.top]; }, [x,y,z]);
  const click3 = async (x,y,z) => { const [a,c] = await P3(x,y,z); await p.mouse.move(a,c); await p.waitForTimeout(50); await p.mouse.click(a,c); await p.waitForTimeout(400); };
  const tool = async (tab, name) => { await p.click(`#tabs >> text=${tab}`); await p.locator('.cbtn').filter({ hasText: new RegExp('^' + name.replace(/[()/]/g,'.') + '$') }).first().click(); await p.waitForTimeout(900); };
  const state = async (label) => { const r = await p.evaluate(() => ({ n: window.__gl.doc.features.length, b: window.__gl.st.bodies.length, err: window.__gl.st.errors })); console.log(label.padEnd(28), 'feats=', r.n, 'corps=', r.b, JSON.stringify(r.err), errs.length ? 'ERRS ' + errs.splice(0).join(' | ') : ''); };
  const ok = async () => { await p.click('#pmOk'); await p.waitForTimeout(1500); };
  const dl = async (fn) => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }).catch(()=>null), fn()]); if (!d) return null; const path = '/tmp/dl_' + d.suggestedFilename(); await d.saveAs(path); return d.suggestedFilename() + ' ' + require('fs').statSync(path).size + 'o'; };
  await p.evaluate(() => window.__gl.loadExample('platine')); await p.waitForTimeout(2500);
  await p.evaluate(() => { const v = window.__gl.viewer(); v.setView([1,1,1],[0,1,0],false); v.zoomFit(false); }); await p.waitForTimeout(600);
  await tool('Fonctions', 'Couper par un plan'); await p.fill('input[data-k="offset"]','30'); await p.press('input[data-k="offset"]','Tab'); await p.waitForTimeout(1200); await ok(); await state('couper');
  await p.click('.ti:has-text("Coupe1")', { button: 'right' }); await p.click('.menu >> text=Supprimer temporairement'); await p.waitForTimeout(1000);
  await tool('Fonctions', 'Déplacer / copier le corps'); await p.check('#c_copy'); await p.waitForTimeout(300); await p.fill('input[data-k="dx"]','250'); await p.press('input[data-k="dx"]','Tab'); await p.waitForTimeout(1200); await ok(); await state('copier corps');
  // insérer une pièce
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), tool('Fonctions', 'Insérer une pièce')]); await fc.setFiles('/tmp/proj.json'); await p.waitForTimeout(1500);
  await p.fill('input[data-k="y"]','100'); await p.press('input[data-k="y"]','Tab'); await p.waitForTimeout(1500); await ok(); await state('insérer pièce');
  // exports
  await p.click('#bExport'); await p.waitForTimeout(400);
  for (const k of ['step','stp','stl','stla','3mf','obj','glb','ply','png','json']) console.log(k.padEnd(6), await dl(async () => p.click(`[data-x="${k}"]`)));
  // face DXF
  await p.evaluate(()=>document.querySelectorAll('.modal-bg').forEach(x=>x.remove()));
  await click3(0, 10, 0); console.log('sel', await p.textContent('#smsg'));
  await p.click('#bExport'); await p.waitForTimeout(300); console.log('dxfface', await dl(async () => p.click('[data-x="dxfface"]')));
  await p.evaluate(()=>document.querySelectorAll('.modal-bg').forEach(x=>x.remove()));
  // plan DXF
  await tool('Mise en plan', 'Créer la mise en plan'); await p.waitForTimeout(5000);
  console.log('plan dxf', await dl(async () => p.click('.modal >> text=Exporter DXF')));
  console.log('plan png', await dl(async () => p.click('.modal >> text=Exporter PNG')));
  console.log('plan pdf', await dl(async () => p.click('.modal >> text=Exporter PDF')));
  await p.evaluate(()=>document.querySelectorAll('.modal-bg').forEach(x=>x.remove()));
  // perçages depuis esquisse + paroi mince
  await p.evaluate(() => window.__gl.loadExample('equerre')); await p.waitForTimeout(2500); await state('equerre');
  console.log(errs.join('\n'));
  await b.close();
})();
