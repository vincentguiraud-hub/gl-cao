const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  await p.evaluate(() => window.__gl.loadExample('platine')); await p.waitForTimeout(2500);
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('#bSave')]); await d.saveAs('/tmp/proj.json');
  await p.evaluate(() => window.__gl.loadExample('cadre')); await p.waitForTimeout(2500);
  await p.setInputFiles('#fileIn', '/tmp/proj.json'); await p.waitForTimeout(500);
  // fileIn handler set only after click: simulate via Ouvrir
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#bOpen')]); await fc.setFiles('/tmp/proj.json'); await p.waitForTimeout(500); if (await p.$('.modal >> text=Remplacer')) await p.click('.modal button:text-is("Remplacer")'); await p.waitForTimeout(2500);
  console.log('rouvert', await p.evaluate(() => window.__gl.doc.name + ' ' + window.__gl.doc.features.length + ' ' + JSON.stringify(window.__gl.st.errors)));
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#bOpen')]); await fc2.setFiles('/tmp/piece.step'); await p.waitForTimeout(3000);
  console.log('import', await p.evaluate(() => window.__gl.doc.features.map(f=>f.type).join(',') + ' ' + JSON.stringify(window.__gl.st.errors)));
  await p.reload(); await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 }); await p.waitForTimeout(1500);
  console.log('autosave', await p.evaluate(() => window.__gl.doc.features.length + ' ' + JSON.stringify(window.__gl.st.errors)));
  console.log(errs.join('\n'));
  await b.close();
})();
