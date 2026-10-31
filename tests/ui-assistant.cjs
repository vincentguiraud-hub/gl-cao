// Test du panneau Claude avec une API GitHub simulée
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const calls = []; const issues = [];
  await p.route('https://api.github.com/**', async route => {
    const req = route.request(); const u = new URL(req.url()); const path = u.pathname.replace('/repos/vincentguiraud-hub/gl-cao', ''); const m = req.method();
    calls.push(m + ' ' + path + (u.search || ''));
    const J = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === '' ) return J({ full_name: 'vincentguiraud-hub/gl-cao' });
    if (path === '/git/ref/heads/demandes') return J({ message: 'Not Found' }, 404);
    if (path === '/git/ref/heads/main') return J({ object: { sha: 'abc' } });
    if (path === '/git/refs' && m === 'POST') return J({ ref: 'refs/heads/demandes' }, 201);
    if (path.startsWith('/contents/') && m === 'PUT') { const bd = JSON.parse(req.postData()); calls.push('  taille ' + bd.content.length); return J({}, 201); }
    if (path === '/issues' && m === 'POST') { const bd = JSON.parse(req.postData()); const it = { number: 10 + issues.length, title: bd.title, body: bd.body, state: 'open', comments: 0, created_at: new Date().toISOString(), html_url: 'https://github.com/x' }; issues.unshift(it); return J(it, 201); }
    if (path === '/issues' && m === 'GET') return J(issues);
    if (/\/issues\/\d+\/comments/.test(path)) return J([{ body: '✅ Modifié : **congé** conservé.\n1. Relancez.' }]);
    if (path === '/commits') return J([{ sha: '1', commit: { message: 'v1.6.0 : panneau Claude', author: { date: '2026-10-31T10:00:00Z' } } }, { sha: '2', commit: { message: 'wip', author: { date: '2026-10-31T09:00:00Z' } } }, { sha: '3', commit: { message: 'v1.5.2 : arcs DXF', author: { date: '2026-10-30T10:00:00Z' } } }]);
    return J({ message: 'non simulé ' + path }, 404);
  });
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.querySelector('#loading').style.display === 'none', null, { timeout: 120000 });
  await p.evaluate(() => { localStorage.clear(); window.__gl.loadExample('platine'); }); await p.waitForTimeout(2500);
  await p.click('#bClaude'); await p.waitForTimeout(300);
  await p.screenshot({ path: '/tmp/cl1.png' });
  await p.fill('#clTok', 'github_pat_TEST'); await p.click('#clSave'); await p.waitForTimeout(500); console.log('réglages :', await p.textContent('#clMsg'));
  await p.click('[data-tab="new"]'); await p.fill('#clText', 'Quand je change la longueur du tube, le congé disparaît.'); await p.click('#clSend'); await p.waitForTimeout(1500);
  console.log('appels :', calls.join(' | ')); console.log('titre issue :', issues[0]?.title); console.log(issues[0]?.body);
  await p.waitForTimeout(500); await p.screenshot({ path: '/tmp/cl2.png' });
  await p.click('[data-c]').catch(() => {}); 
  issues[0].comments = 1; issues[0].state = 'closed'; await p.click('[data-tab="list"]'); await p.waitForTimeout(800); await p.click('[data-c]'); await p.waitForTimeout(500); await p.screenshot({ path: '/tmp/cl3.png' });
  p.on('dialog', d => d.accept());
  await p.click('[data-tab="versions"]'); await p.waitForTimeout(800); await p.screenshot({ path: '/tmp/cl4.png' });
  await p.click('#clBack'); await p.waitForTimeout(800); console.log('retour :', issues[0].title);
  console.log(errs.join('\n'));
  await b.close();
})();
