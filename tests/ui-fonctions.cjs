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
  const state = async (label) => { const r = await p.evaluate(() => ({ n: window.__gl.doc.features.length, err: window.__gl.st.errors })); console.log(label.padEnd(28), 'feats=', r.n, JSON.stringify(r.err), errs.length ? 'ERRS ' + errs.splice(0).join(' | ') : ''); };
  const ok = async () => { await p.click('#pmOk'); await p.waitForTimeout(1500); };
  await p.evaluate(() => window.__gl.loadExample('platine')); await p.waitForTimeout(2500);
  await p.evaluate(() => { const v = window.__gl.viewer(); v.setView([1,1,1],[0,1,0],false); v.zoomFit(false); }); await p.waitForTimeout(600);
  // congé par clic de face (face supérieure → toutes ses arêtes)
  await tool('Fonctions', 'Chanfrein'); await click3(0, 10, 30);
  console.log('arêtes chanfrein', await p.evaluate(() => window.__gl.pm.feature.edges.length));
  await p.fill('input[data-k="dist"]', '1'); await p.press('input[data-k="dist"]','Tab'); await p.check('#pmPrev'); await p.waitForTimeout(1500); await ok(); await state('chanfrein face');
  // perçage avec clic
  await tool('Fonctions', 'Assistance perçage'); await click3(30, 10, 0); await click3(-30, 10, 0);
  await p.selectOption('select[data-k="kind"]','cbore'); await p.waitForTimeout(800);
  await p.selectOption('select[data-k="std"]','M6'); await p.waitForTimeout(800);
  console.log('perçage pts', await p.evaluate(() => window.__gl.pm.feature.points.length), 'd', await p.evaluate(() => window.__gl.pm.feature.d));
  await ok(); await state('perçage lamage');
  // répétition circulaire du perçage
  await p.click('.ti:has-text("Perçage2")'); await tool('Fonctions', 'Répétition circulaire'); await p.fill('input[data-k="count"]','4'); await p.press('input[data-k="count"]','Tab'); await p.waitForTimeout(1200); await ok(); await state('répét circulaire');
  // symétrie
  await tool('Fonctions', 'Symétrie'); await p.check('#c_body'); await p.waitForTimeout(1200); await ok(); await state('symétrie corps');
  // plan de référence
  await tool('Fonctions', 'Plan de référence'); await p.fill('input[data-k="offset"]','40'); await p.press('input[data-k="offset"]','Tab'); await ok(); await state('plan réf');
  // arbre : renommer, désactiver, barre de reprise, monter, supprimer
  await p.click('.ti:has-text("Symétrie1")', { button: 'right' }); await p.click('.menu >> text=Supprimer temporairement'); await p.waitForTimeout(1200); await state('désactiver');
  await p.click('.ti:has-text("Symétrie1")', { button: 'right' }); await p.click('.menu >> text=Réactiver'); await p.waitForTimeout(1200);
  await p.click('.ti:has-text("Plan1")', { button: 'right' }); await p.click('.menu >> text=Masquer'); await p.waitForTimeout(800); await state('masquer plan');
  await p.click('.ti:has-text("Plan1")', { button: 'right' }); await p.click('.menu >> text=Renommer'); await p.fill('.modal input','Plan haut'); await p.click('.modal >> text=OK'); await p.waitForTimeout(800); await state('renommer');
  const bar = await p.$('.rollbar'); const bb = await bar.boundingBox(); const tgt = await (await p.$('.ti:has-text("Congé1")')).boundingBox();
  await p.mouse.move(bb.x+20, bb.y+2); await p.mouse.down(); await p.mouse.move(tgt.x+40, tgt.y+tgt.height/2, {steps:6}); await p.mouse.up(); await p.waitForTimeout(1200);
  console.log('rollback', await p.evaluate(() => window.__gl.doc.rollback));
  await p.click('.ti:has-text("Perçage1")', { button: 'right' }); await p.click('.menu >> text=Ramener la barre à la fin'); await p.waitForTimeout(1200); await state('rollback fin');
  // édition fonction (double-clic) avec variable
  await p.dblclick('.ti:has-text("Bossage-Extru1")'); await p.waitForTimeout(900); await p.fill('input[data-k="depth"]','EP+5'); await p.press('input[data-k="depth"]','Tab'); await p.waitForTimeout(1200); await ok(); await state('édition EP+5');
  // mesure
  await tool('Évaluer', 'Mesurer'); await click3(0, 15, 0); await click3(100, 7, 0); console.log('mesure:', (await p.textContent('#measure')).replace(/\s+/g,' ').slice(0,200)); await p.keyboard.press('Escape');
  // masse
  await tool('Évaluer', 'Propriétés de masse'); console.log('masse:', (await p.textContent('.modal .mb')).replace(/\s+/g,' ').slice(0,120)); await p.click('.modal .x');
  // variables
  await tool('Évaluer', 'Équations / variables'); await p.click('#vAdd'); await p.waitForTimeout(100); await p.click('.modal >> text=Appliquer'); await p.waitForTimeout(1200); await state('variables');
  // matériau
  await tool('Évaluer', 'Matériau'); await p.selectOption('#matS','corten'); await p.click('.modal >> text=Appliquer'); await p.waitForTimeout(1200); await state('matériau corten');
  // coupe
  await tool('Évaluer', 'Vue en coupe'); await p.waitForTimeout(500); await p.click('.modal >> text=OK'); await p.waitForTimeout(300); await p.click('[data-k="section"]'); await state('coupe on/off');
  // exports
  const dl = async (fn) => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }).catch(()=>null), fn()]); return d ? d.suggestedFilename() : null; };
  console.log('STEP', await dl(async () => { await p.click('#bExport'); await p.click('.menu >> text=STEP'); }));
  console.log('STL', await dl(async () => { await p.click('#bExport'); await p.click('.menu >> text=STL'); }));
  const proj = await dl(async () => { await p.click('#bSave'); }); console.log('projet', proj);
  console.log('PNG', await dl(async () => { await p.click('#bExport'); await p.click('.menu >> text=Capture'); }));
  // mise en plan PDF
  await tool('Mise en plan', 'Créer la mise en plan'); await p.waitForTimeout(3500);
  console.log('PDF', await dl(async () => { await p.click('.modal >> text=Exporter PDF'); }));
  console.log('SVG', await dl(async () => { await p.click('.modal >> text=Exporter SVG'); }));
  await p.click('.modal .x');
  // cadre : liste de débit + plan avec tableau
  await p.evaluate(() => window.__gl.loadExample('cadre')); await p.waitForTimeout(3000); await state('cadre');
  await tool('Mécano-soudé', 'Liste de débit'); console.log('CSV', await dl(async () => { await p.click('.modal >> text=Exporter CSV'); })); console.log('modals', await p.locator('.modal').count(), await p.locator('.modal .x').count()); await p.screenshot({path:'/tmp/csv.png'}); await p.evaluate(()=>document.querySelectorAll('.modal-bg').forEach(x=>x.remove()));
  await tool('Mise en plan', 'Créer la mise en plan'); await p.waitForTimeout(4000); await p.screenshot({ path: '/tmp/v1.png' }); await p.evaluate(()=>document.querySelectorAll('.modal-bg').forEach(x=>x.remove()));
  // mécano via PM : alignement
  await p.click('.ti:has-text("Esquisse cadre")'); await tool('Mécano-soudé', 'Élément mécano-soudé'); await p.selectOption('select[data-k="align"]','top'); await p.waitForTimeout(1500); await ok(); await state('mécano aligné');
  // équerre : DXF
  await p.evaluate(() => window.__gl.loadExample('equerre')); await p.waitForTimeout(2500);
  await tool('Tôlerie', 'Mise à plat / DXF'); console.log('DXF', await dl(async () => { await p.click('.modal >> text=Exporter DXF'); })); await p.evaluate(()=>document.querySelectorAll('.modal-bg').forEach(x=>x.remove()));
  // tôle pliée via PM après esquisse ouverte
  await p.click('.ti:has-text("Profil")'); await tool('Tôlerie', 'Tôle pliée (profil ouvert)'); await p.waitForTimeout(1500); await ok(); await state('tôle pliée PM');
  // révolution via UI : esquisse plan de droite
  await p.evaluate(() => window.__gl.loadExample('platine')); await p.waitForTimeout(2500);
  // import STEP
  const fs = require('fs');
  console.log(errs.join('\n'));
  await b.close();
})();
