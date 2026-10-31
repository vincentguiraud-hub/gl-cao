// Panneau « Claude » : décrire un problème ou une demande, Claude modifie l'application et la publie.
// Fonctionnement : la demande devient une issue « [Claude] … » du dépôt GitHub ; l'automatisation
// (.github/workflows/claude-demande.yml) fait la modification, vérifie, publie et répond.
// Les retours en arrière passent par une issue « [Retour] … » (claude-retour.yml).

const OWNER = "vincentguiraud-hub", REPO = "gl-cao";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const LS_TOKEN = "glcad-gh-token", LS_PENDING = "glcad-claude-pending";

const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};
const token = () => ls.get(LS_TOKEN, "");
const pending = () => { try { return JSON.parse(ls.get(LS_PENDING, "[]")); } catch { return []; } };
const setPending = a => ls.set(LS_PENDING, JSON.stringify(a));

async function gh(path, opts = {}) {
  const t = token(); if (!t) throw new Error("Jeton GitHub manquant (onglet Réglages)");
  const r = await fetch(API + path, { ...opts, headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + t, "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) } });
  if (r.status === 404 && opts.allow404) return null;
  if (!r.ok) {
    let msg = r.status + " " + r.statusText; try { const j = await r.json(); if (j.message) msg = j.message; } catch { }
    if (r.status === 401) msg = "Jeton GitHub refusé (expiré ou incorrect) : refaites-en un dans Réglages";
    if (r.status === 403 || r.status === 404) msg = "Le jeton GitHub n'a pas les droits nécessaires sur le dépôt gl-cao (Contents et Issues en lecture/écriture) : " + msg;
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}
const b64utf8 = s => btoa(unescape(encodeURIComponent(s)));

async function ensureBranch() {
  const ref = await gh("/git/ref/heads/demandes", { allow404: true });
  if (ref) return;
  const main = await gh("/git/ref/heads/main");
  await gh("/git/refs", { method: "POST", body: JSON.stringify({ ref: "refs/heads/demandes", sha: main.object.sha }) });
}
async function putFile(path, b64, message) {
  await gh("/contents/" + encodeURI(path), { method: "PUT", body: JSON.stringify({ message, content: b64, branch: "demandes" }) });
}

export async function sendRequest({ text, screenshot, project, version }) {
  const id = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dir = `demandes/${id}`;
  const files = [];
  if (screenshot || project) {
    await ensureBranch();
    if (screenshot) { await putFile(`${dir}/capture.png`, screenshot.split(",")[1], `Demande ${id} : capture`); files.push("capture.png (vue 3D au moment de la demande)"); }
    if (project) { await putFile(`${dir}/piece.glcad.json`, b64utf8(project), `Demande ${id} : pièce`); files.push("piece.glcad.json (pièce ouverte)"); }
  }
  const first = text.trim().split("\n")[0].slice(0, 70);
  const body = `${text.trim()}\n\n---\n- Version de l'application : ${version}\n- Envoyé depuis G&L CAO 3D le ${new Date().toLocaleString("fr-FR")}\n` + (files.length ? `- Pièces jointes (branche demandes) : ${dir}\n${files.map(f => "  - " + f).join("\n")}\n` : "");
  const issue = await gh("/issues", { method: "POST", body: JSON.stringify({ title: "[Claude] " + first, body }) });
  setPending([...new Set([...pending(), issue.number])]);
  return issue;
}
export async function requestRollback(target, version) {
  const title = target ? `[Retour] ${target}` : "[Retour] précédente";
  const issue = await gh("/issues", { method: "POST", body: JSON.stringify({ title, body: `Demande de retour en arrière envoyée depuis l'application (version actuelle ${version}).` }) });
  setPending([...new Set([...pending(), issue.number])]);
  return issue;
}
export async function listRequests() {
  const all = await gh(`/issues?state=all&per_page=40&creator=${OWNER}&sort=created&direction=desc`);
  return all.filter(i => !i.pull_request && /^\[(Claude|Retour)\]/.test(i.title));
}
export async function lastComment(n) {
  const c = await gh(`/issues/${n}/comments?per_page=50`);
  return c.length ? c[c.length - 1].body : "";
}
export async function listVersions() {
  const commits = await gh("/commits?sha=main&per_page=60");
  return commits.map(c => { const m = /^v(\d+\.\d+\.\d+)\s*:?\s*(.*)/.exec(c.commit.message.split("\n")[0]); return m ? { v: m[1], msg: m[2], date: c.commit.author.date, sha: c.sha } : null; }).filter(Boolean);
}
export async function checkToken() { const r = await gh(""); return r.full_name; }

// ---------------- Interface
export function openAssistant(ctx) {
  const { modal, toast, esc, version, getProject, getScreenshot } = ctx;
  const body = document.createElement("div");
  body.style.minWidth = "min(760px,90vw)";
  let tab = token() ? "new" : "settings";
  let timer = 0;
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>");
  const draw = async () => {
    clearTimeout(timer);
    const T = (k, l) => `<button class="btn ${tab === k ? "pri" : ""}" data-tab="${k}">${l}</button>`;
    let h = `<div class="btnrow" style="margin:0 0 10px">${T("new", "Nouvelle demande")}${T("list", "Mes demandes")}${T("versions", "Versions")}${T("settings", "Réglages")}</div>`;
    if (tab === "new") {
      h += `<p class="hint">Décrivez le problème ou ce que vous voulez ajouter, comme vous le feriez dans la conversation. Claude modifie l'application, vérifie qu'elle fonctionne et la publie (5 à 15 minutes). Vous serez prévenu ici ; il suffira ensuite de relancer le logiciel.</p>
      <textarea id="clText" rows="7" style="width:100%;border:1px solid var(--line);border-radius:7px;padding:8px;font:inherit" placeholder="Ex : quand je fais un congé sur un tube puis que je change la longueur du tube, le congé disparaît.&#10;Ex : ajouter les profilés IPN dans le mécano-soudé."></textarea>
      <div class="fld chk"><input type="checkbox" id="clShot" checked><label for="clShot">Joindre une capture de la vue 3D</label></div>
      <div class="fld chk"><input type="checkbox" id="clProj" checked><label for="clProj">Joindre la pièce ouverte (pour reproduire le problème)</label></div>
      <div class="btnrow"><button class="btn pri" id="clSend">Envoyer à Claude</button></div><div id="clMsg" class="hint"></div>`;
    } else if (tab === "list") {
      h += `<div id="clList" class="hint">Chargement…</div>`;
    } else if (tab === "versions") {
      h += `<p class="hint">Version actuelle : <b>${esc(version)}</b>. Chaque modification crée une nouvelle version ; les anciennes sont conservées. Revenir à une version crée une nouvelle version avec l'ancien contenu (on peut toujours revenir en avant).</p>
      <div class="btnrow"><button class="btn pri" id="clBack">↶ Revenir à la version précédente</button></div><div id="clVers" class="hint" style="margin-top:8px">Chargement…</div>`;
    } else {
      h += `<p>Pour que l'application puisse transmettre vos demandes, elle a besoin d'un <b>jeton GitHub</b> limité au dépôt <code>gl-cao</code> (à faire une seule fois) :</p>
      <ol><li>Ouvrez <a href="https://github.com/settings/personal-access-tokens/new" target="_blank">github.com → Settings → Fine-grained tokens → Generate new token</a>.</li>
      <li>Nom : <b>G&L CAO</b> ; Expiration : <b>1 an</b> ; Repository access : <b>Only select repositories</b> → <b>gl-cao</b>.</li>
      <li>Permissions → Repository permissions : <b>Contents : Read and write</b> et <b>Issues : Read and write</b>.</li>
      <li>Cliquez <b>Generate token</b>, copiez le jeton (commence par <code>github_pat_</code>) et collez-le ci-dessous.</li></ol>
      <div class="fld"><label>Jeton GitHub</label><input type="password" id="clTok" value="${esc(token())}" placeholder="github_pat_…"></div>
      <div class="btnrow"><button class="btn pri" id="clSave">Enregistrer et tester</button><button class="btn" id="clDel">Effacer le jeton</button></div><div id="clMsg" class="hint"></div>
      <p class="hint">Le jeton reste uniquement sur cet ordinateur. Il ne permet d'agir que sur le dépôt gl-cao.</p>`;
    }
    body.innerHTML = h;
    body.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
    body.querySelectorAll("input,textarea").forEach(x => x.onkeydown = e => e.stopPropagation());
    const msg = (t, bad) => { const m = body.querySelector("#clMsg"); if (m) { m.textContent = t; m.style.color = bad ? "var(--err)" : ""; } };
    if (tab === "new") {
      body.querySelector("#clSend").onclick = async () => {
        const text = body.querySelector("#clText").value.trim();
        if (text.length < 8) return msg("Décrivez la demande en quelques mots.", true);
        if (!token()) { tab = "settings"; return draw(); }
        const btn = body.querySelector("#clSend"); btn.disabled = true; msg("Envoi en cours…");
        try {
          const issue = await sendRequest({ text, version, screenshot: body.querySelector("#clShot").checked ? getScreenshot() : null, project: body.querySelector("#clProj").checked ? getProject() : null });
          toast("Demande n°" + issue.number + " envoyée à Claude");
          tab = "list"; draw();
        } catch (e) { btn.disabled = false; msg("Envoi impossible : " + e.message, true); }
      };
    }
    if (tab === "settings") {
      body.querySelector("#clSave").onclick = async () => {
        const v = body.querySelector("#clTok").value.trim(); if (!v) return msg("Collez le jeton.", true);
        ls.set(LS_TOKEN, v); msg("Test…");
        try { const n = await checkToken(); msg("✔ Jeton valide pour " + n + ". Vous pouvez envoyer des demandes."); }
        catch (e) { msg("✖ " + e.message, true); }
      };
      body.querySelector("#clDel").onclick = () => { ls.del(LS_TOKEN); draw(); };
    }
    if (tab === "list") {
      const el = body.querySelector("#clList");
      try {
        const items = await listRequests();
        if (!items.length) { el.textContent = "Aucune demande pour l'instant."; return; }
        el.innerHTML = items.map(i => `<div class="grp" style="margin:0 0 8px"><div style="display:flex;gap:8px;align-items:center"><b>n°${i.number}</b><span style="flex:1">${esc(i.title.replace(/^\[(Claude|Retour)\]\s*/, i.title.startsWith("[Retour]") ? "↶ Retour : " : ""))}</span><span style="color:${i.state === "closed" ? "#0f8a3c" : "#b26a00"};font-weight:600">${i.state === "closed" ? "✔ Terminée" : "⏳ En cours"}</span></div><div class="hint">${new Date(i.created_at).toLocaleString("fr-FR")}${i.comments ? ` – <a href="#" data-c="${i.number}">voir la réponse de Claude</a>` : ""} – <a href="${i.html_url}" target="_blank">ouvrir sur GitHub</a></div><div id="cmt${i.number}"></div></div>`).join("");
        el.querySelectorAll("[data-c]").forEach(a => a.onclick = async e => { e.preventDefault(); const box = body.querySelector("#cmt" + a.dataset.c); box.innerHTML = "<span class='hint'>…</span>"; try { box.innerHTML = `<div style="background:#f6f8fb;border:1px solid var(--line);border-radius:7px;padding:8px;margin-top:6px">${md(await lastComment(a.dataset.c))}</div>`; } catch (er) { box.textContent = er.message; } });
        if (items.some(i => i.state === "open")) timer = setTimeout(() => { if (document.body.contains(body) && tab === "list") draw(); }, 20000);
      } catch (e) { el.textContent = e.message; el.style.color = "var(--err)"; }
    }
    if (tab === "versions") {
      body.querySelector("#clBack").onclick = async () => {
        if (!confirmBox("Revenir à la version précédente ?")) return;
        try { const i = await requestRollback(null, version); toast("Retour en arrière demandé (n°" + i.number + ")"); tab = "list"; draw(); } catch (e) { toast(e.message, true); }
      };
      const el = body.querySelector("#clVers");
      try {
        const vs = await listVersions();
        el.innerHTML = `<table class="tb"><tr><th>Version</th><th>Date</th><th>Modification</th><th></th></tr>${vs.map(x => `<tr><td><b>v${esc(x.v)}</b>${x.v === version ? " (actuelle)" : ""}</td><td>${new Date(x.date).toLocaleDateString("fr-FR")}</td><td>${esc(x.msg)}</td><td>${x.v === version ? "" : `<button class="btn" data-v="${esc(x.v)}">Revenir à cette version</button>`}</td></tr>`).join("")}</table>`;
        el.querySelectorAll("[data-v]").forEach(b => b.onclick = async () => {
          if (!confirmBox("Revenir à la version v" + b.dataset.v + " ?")) return;
          try { const i = await requestRollback("v" + b.dataset.v, version); toast("Retour à v" + b.dataset.v + " demandé (n°" + i.number + ")"); tab = "list"; draw(); } catch (e) { toast(e.message, true); }
        });
      } catch (e) { el.textContent = e.message; el.style.color = "var(--err)"; }
    }
  };
  // confirmation simple intégrée (les boîtes natives sont bloquées dans certaines vues)
  const confirmBox = q => { const r = window.__glConfirm ? window.__glConfirm(q) : true; return r; };
  modal("Claude – assistant de l'application", body, [{ label: "Fermer" }], { wide: true });
  draw();
}

// Surveillance en arrière-plan : prévient quand une demande est terminée
export function watchRequests({ toast, onDone }) {
  const tick = async () => {
    const p = pending(); if (!p.length || !token()) return;
    try {
      const items = await listRequests();
      for (const n of p) {
        const it = items.find(i => i.number === n);
        if (it && it.state === "closed") { setPending(pending().filter(x => x !== n)); onDone?.(it); }
      }
    } catch { }
  };
  setTimeout(tick, 8000); setInterval(tick, 60000);
  void toast;
}
export const assistantConfig = { OWNER, REPO };
