// G&L CAO 3D — interface principale
import * as THREE from "three";
import { jsPDF } from "jspdf";
import { initOCC, R } from "./occ.js";
import { Viewer } from "./viewer.js";
import { Sketcher, newId, entPoints } from "./sketcher.js";
import { rebuild, featureLabel, prepareImports, importCache, massProps, exportCompound, HOLE_STD, resolvePlane, findFace, findEdge } from "./cad.js";
import { STD_PLANES, makeEval, v3, v2, planeFromNormal, planeY, to3D, to2D, circleFrom3 } from "./geom.js";
import { PROFILE_FAMILIES, profileName } from "./profiles.js";
import { icon } from "./icons.js";
import { saveFile, saveZipped, sketchToDXF, flatPatternDXF, warmDownloads } from "./exporters.js";
import { buildDrawing, SCALES, scaleLabel } from "./drawing.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (x, d = 2) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString("fr-FR", { maximumFractionDigits: d });

const MATERIALS = {
  acier: { name: "Acier S235", density: 7.85, color: "#a9b4bf" },
  corten: { name: "Acier Corten", density: 7.85, color: "#9a5a35" },
  galva: { name: "Acier galvanisé", density: 7.85, color: "#c7cdd2" },
  inox: { name: "Inox 304", density: 7.93, color: "#d3d8dd" },
  alu: { name: "Aluminium 6060", density: 2.70, color: "#d7dde3" },
  laiton: { name: "Laiton", density: 8.50, color: "#c9a94f" },
  fonte: { name: "Fonte", density: 7.20, color: "#6d7378" },
  chene: { name: "Bois – chêne", density: 0.75, color: "#b88a57" },
  pin: { name: "Bois – pin", density: 0.50, color: "#d9b57c" },
  pla: { name: "PLA (impression 3D)", density: 1.24, color: "#e07a2b" },
  petg: { name: "PETG (impression 3D)", density: 1.27, color: "#3d8bd9" },
  beton: { name: "Béton", density: 2.40, color: "#b5b2aa" },
};

// ---------------- État
const newDoc = () => ({ app: "glcad", version: 1, name: "Pièce1", vars: {}, material: { key: "acier", ...MATERIALS.acier }, features: [], rollback: null, author: "" });
let doc = newDoc();
let st = null;
let hist = [], fut = [];
let selection = [];
let treeSel = null;
let mode = "idle";
let pm = null;       // contexte du PropertyManager
let sk = null, skCtx = null;
let viewer;
let curTab = "fonctions";

// ---------------- Utilitaires UI
function toast(msg, bad = false) {
  const t = $("#toast"); t.textContent = msg; t.className = bad ? "bad" : ""; t.style.display = "block";
  clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = "none", 3200);
}
function status(msg) { $("#smsg").textContent = msg; }
function modal(title, body, buttons = [], opts = {}) {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" style="${opts.wide ? "width:min(1100px,96vw)" : ""}"><div class="mh">${title}<button class="x">${icon("close", 18)}</button></div><div class="mb"></div><div class="mf"></div></div>`;
  const mb = bg.querySelector(".mb"); if (typeof body === "string") mb.innerHTML = body; else mb.appendChild(body);
  const close = () => bg.remove();
  bg.querySelector(".x").onclick = close;
  bg.addEventListener("pointerdown", e => { if (e.target === bg) close(); });
  const mf = bg.querySelector(".mf");
  if (!buttons.length) mf.remove();
  for (const b of buttons) { const el = document.createElement("button"); el.className = "btn" + (b.pri ? " pri" : ""); el.textContent = b.label; el.onclick = () => { const r = b.click?.(bg); if (r !== false) close(); }; mf.appendChild(el); }
  document.body.appendChild(bg);
  return bg;
}
function popupMenu(x, y, items) {
  document.querySelectorAll(".menu").forEach(m => m.remove());
  const m = document.createElement("div"); m.className = "menu";
  for (const it of items) {
    if (it === "-") { m.appendChild(document.createElement("hr")); continue; }
    const b = document.createElement("button"); b.innerHTML = (it.icon ? icon(it.icon, 16) : "") + esc(it.label);
    b.onclick = () => { m.remove(); it.click(); }; m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 6) + "px"; m.style.top = Math.min(y, innerHeight - r.height - 6) + "px";
  setTimeout(() => document.addEventListener("pointerdown", function h(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("pointerdown", h); } }), 0);
}
const ev = () => makeEval(doc.vars);

// ---------------- Historique / reconstruction
function snapshot() { hist.push(JSON.stringify(doc)); if (hist.length > 100) hist.shift(); fut = []; updateUndo(); }
function updateUndo() { $("#bUndo").disabled = !hist.length; $("#bRedo").disabled = !fut.length; }
function undo() { if (!hist.length) return; fut.push(JSON.stringify(doc)); doc = JSON.parse(hist.pop()); afterLoad(); updateUndo(); }
function redo() { if (!fut.length) return; hist.push(JSON.stringify(doc)); doc = JSON.parse(fut.pop()); afterLoad(); updateUndo(); }
async function afterLoad() { $("#docname").value = doc.name; await prepareImports(doc); recompute(); }
function autosave() { try { localStorage.setItem("glcad-autosave", JSON.stringify(doc)); } catch { } }

function commit(fn) { snapshot(); fn(); recompute(); autosave(); }

function bodiesOf(state) {
  const out = [];
  if (state.main) out.push({ shape: state.main, color: doc.material?.color || "#a9b4bf", name: "Corps principal", kind: "main" });
  out.push(...state.bodies);
  return out;
}
function recompute(state) {
  st = state || rebuild(doc);
  viewer.refPlanes = Object.entries(st.planes).map(([id, plane]) => ({ id, plane }));
  viewer.setBodies(bodiesOf(st));
  { const b = viewer.modelBounds(); const sz = b.getSize(new THREE.Vector3()); const m = Math.max(sz.x, sz.y, sz.z); viewer.planeSize = viewer.bodies.length ? Math.max(60, m * 1.15) : 200; }
  viewer.buildPlanes();
  renderTree();
  const errs = Object.keys(st.errors).length;
  status(errs ? `⚠ ${errs} fonction(s) en erreur – survolez l'arbre pour le détail` : "Prêt");
  showSelectedSketch();
}

// ---------------- Arbre de création
const TYPE_ICON = { sketch: "sketch", extrude: "extrude", cut: "cut", revolve: "revolve", revcut: "revcut", fillet: "fillet", chamfer: "chamfer", shell: "shell", draft: "draft", hole: "hole", lpattern: "lpattern", cpattern: "cpattern", mirror: "mirror", plane: "plane", loft: "loft", sweep: "sweep", weld: "weld", sheet: "sheet", import: "import" };
function renderTree() {
  const t = $("#tree");
  const rb = doc.rollback ?? doc.features.length;
  let h = `<div class="tree-h">${icon("part", 18)}<span>${esc(doc.name)}</span></div>`;
  h += `<div class="ti" data-act="material">${icon("material", 16)}<span class="nm">${esc(doc.material?.name || "Matériau")}</span></div>`;
  for (const k of ["front", "top", "right"]) h += `<div class="ti ${isSelPlane(k) ? "sel" : ""}" data-plane="${k}">${icon("plane", 16)}<span class="nm">${STD_PLANES[k].name}</span></div>`;
  h += `<div class="ti">${icon("origin", 16)}<span class="nm">Origine</span></div>`;
  doc.features.forEach((f, i) => {
    if (i === rb) h += `<div class="rollbar" title="Barre de reprise"></div>`;
    const cls = ["ti", treeSel === f.id ? "sel" : "", f.suppressed ? "supp" : "", st?.errors[f.id] ? "err" : "", i >= rb ? "after" : ""].join(" ");
    const tip = st?.errors[f.id] ? "Erreur : " + st.errors[f.id] : featureLabel(f.type);
    h += `<div class="${cls}" data-id="${f.id}" title="${esc(tip)}">${icon(st?.errors[f.id] ? "error" : TYPE_ICON[f.type] || "part", 16)}<span class="nm">${esc(f.name)}</span></div>`;
    if (f.type === "weld" && st?.info[f.id]) st.info[f.id].forEach((m, j) => h += `<div class="ti child" data-id="${f.id}">${icon("weldmember", 14)}<span class="nm sub">${esc(m.profile)} – ${fmt(m.length, 1)} mm</span></div>`);
    if (f.type === "sheet" && st?.info[f.id]) h += `<div class="ti child" data-flat="${f.id}">${icon("flat", 14)}<span class="nm sub">Mise à plat : ${fmt(st.info[f.id].flat, 2)} × ${fmt(st.info[f.id].width, 1)}</span></div>`;
  });
  if (rb >= doc.features.length) h += `<div class="rollbar" title="Barre de reprise"></div>`;
  if (!doc.features.length) h += `<div class="hint" style="padding:8px">1. Choisissez un plan ci-dessus (ou dans la vue).<br>2. Cliquez sur <b>Esquisse</b>.<br>3. Dessinez un contour fermé puis validez ✓.<br>4. Cliquez sur <b>Bossage extrudé</b>.</div>`;
  t.innerHTML = h;
  t.querySelectorAll(".ti[data-id]").forEach(el => {
    const id = el.dataset.id;
    el.onclick = () => { treeSel = id; selection = []; viewer.setSelection([]); renderTree(); showSelectedSketch(); };
    el.ondblclick = () => editFeature(id);
    el.oncontextmenu = e => { e.preventDefault(); treeSel = id; renderTree(); featureMenu(id, e.clientX, e.clientY); };
    let pressT; el.addEventListener("touchstart", e => { pressT = setTimeout(() => { const t0 = e.touches[0]; featureMenu(id, t0.clientX, t0.clientY); }, 550); }, { passive: true });
    el.addEventListener("touchend", () => clearTimeout(pressT));
  });
  t.querySelectorAll(".ti[data-plane]").forEach(el => {
    el.onclick = () => { treeSel = null; selection = [{ kind: "plane", ref: { kind: "std", std: el.dataset.plane } }]; viewer.setSelection(selection); renderTree(); };
    el.ondblclick = () => startSketch({ kind: "std", std: el.dataset.plane });
  });
  t.querySelectorAll(".ti[data-flat]").forEach(el => el.onclick = () => showFlat(el.dataset.flat));
  const mat = t.querySelector('[data-act="material"]'); if (mat) mat.onclick = showMaterial;
}
function isSelPlane(k) { return selection.some(s => s.kind === "plane" && s.ref.kind === "std" && s.ref.std === k); }
function featureMenu(id, x, y) {
  const f = doc.features.find(q => q.id === id); if (!f) return;
  const idx = doc.features.indexOf(f);
  const items = [
    { label: "Éditer la fonction", icon: "sketch", click: () => editFeature(id) },
    { label: "Renommer", click: () => renameFeature(f) },
    { label: f.suppressed ? "Réactiver" : "Supprimer temporairement (désactiver)", click: () => commit(() => f.suppressed = !f.suppressed) },
    { label: "Placer la barre de reprise avant", click: () => commit(() => doc.rollback = idx) },
    { label: "Ramener la barre à la fin", click: () => commit(() => doc.rollback = null) },
    "-",
  ];
  if (f.type === "sketch") { items.push({ label: "Esquisse → DXF", icon: "export", click: () => exportSketchDXF(f) }); items.push({ label: "Bossage extrudé de cette esquisse", icon: "extrude", click: () => { treeSel = id; startFeature("extrude"); } }); }
  if (f.type === "weld") items.push({ label: "Liste de débit", icon: "cutlist", click: showCutList });
  if (f.type === "sheet") items.push({ label: "Mise à plat / DXF", icon: "flat", click: () => showFlat(id) });
  if (idx > 0) items.push({ label: "Monter", click: () => commit(() => { doc.features.splice(idx, 1); doc.features.splice(idx - 1, 0, f); }) });
  if (idx < doc.features.length - 1) items.push({ label: "Descendre", click: () => commit(() => { doc.features.splice(idx, 1); doc.features.splice(idx + 1, 0, f); }) });
  items.push("-", { label: "Supprimer", icon: "close", click: () => deleteFeature(id) });
  popupMenu(x, y, items);
}
function renameFeature(f) {
  const box = document.createElement("div");
  box.innerHTML = `<div class="fld"><label>Nom</label><input type="text" value="${esc(f.name)}"></div>`;
  const inp = box.querySelector("input");
  modal("Renommer", box, [{ label: "Annuler" }, { label: "OK", pri: true, click: () => commit(() => f.name = inp.value || f.name) }]);
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
}
function deleteFeature(id) {
  const f = doc.features.find(q => q.id === id);
  const deps = doc.features.filter(q => q.sketch === id || q.profile === id || q.path === id || (q.sketches || []).includes(id) || (q.features || []).includes(id));
  const go = () => commit(() => {
    const kill = new Set([id, ...(f.type === "sketch" ? [] : [])]);
    doc.features = doc.features.filter(q => !kill.has(q.id));
    if (doc.rollback != null && doc.rollback > doc.features.length) doc.rollback = null;
    treeSel = null;
  });
  if (deps.length) modal("Supprimer " + esc(f.name), `<p>Les fonctions suivantes dépendent de « ${esc(f.name)} » et passeront en erreur :</p><ul>${deps.map(d => "<li>" + esc(d.name) + "</li>").join("")}</ul>`, [{ label: "Annuler" }, { label: "Supprimer quand même", pri: true, click: go }]);
  else go();
}
function nextName(type) {
  const base = { sketch: "Esquisse", extrude: "Bossage-Extru", cut: "Enlèv.-Extru", revolve: "Bossage-Révol", revcut: "Enlèv.-Révol", fillet: "Congé", chamfer: "Chanfrein", shell: "Coque", draft: "Dépouille", hole: "Perçage", lpattern: "RépétLinéaire", cpattern: "RépétCirculaire", mirror: "Symétrie", plane: "Plan", loft: "Lissage", sweep: "Balayage", weld: "Mécano-soudé", sheet: "Tôle-pliée", import: "Importé" }[type] || type;
  let n = 1; while (doc.features.some(f => f.name === base + n)) n++;
  return base + n;
}

// ---------------- Barre de commandes
const SKETCH_TOOLS = [["select", "Sélection"], ["line", "Ligne"], ["rect", "Rectangle"], ["crect", "Rectangle centré"], ["circle", "Cercle"], ["arc", "Arc 3 points"], ["poly", "Polygone"], ["slot", "Rainure"], ["centerline", "Axe de construction"], ["point", "Point"], "|", ["dim", "Cotation"], ["sfillet", "Congé d'esquisse"], ["trim", "Ajuster"], ["offset", "Décaler entités"], ["smirror", "Symétrie d'entités"], ["spattern", "Répétition d'entités"], ["convert", "Convertir entités"], "|", ["exit", "Quitter l'esquisse"]];
const TABS = {
  fonctions: { label: "Fonctions", tools: [["extrude", "Bossage extrudé"], ["revolve", "Bossage avec révolution"], ["sweep", "Balayage"], ["loft", "Lissage"], "|", ["cut", "Enlèvement extrudé"], ["revcut", "Enlèvement avec révolution"], ["hole", "Assistance perçage"], "|", ["fillet", "Congé"], ["chamfer", "Chanfrein"], ["shell", "Coque"], ["draft", "Dépouille"], "|", ["lpattern", "Répétition linéaire"], ["cpattern", "Répétition circulaire"], ["mirror", "Symétrie"], "|", ["plane", "Plan de référence"], ["import", "Importer STEP / STL"]] },
  esquisse: { label: "Esquisse", tools: [["sketch", "Esquisse"]] },
  tolerie: { label: "Tôlerie", tools: [["sheet", "Tôle pliée (profil ouvert)"], ["plate", "Tôle de base (plaque)"], ["flat", "Mise à plat / DXF"]] },
  mecano: { label: "Mécano-soudé", tools: [["weld", "Élément mécano-soudé"], ["cutlist", "Liste de débit"]] },
  evaluer: { label: "Évaluer", tools: [["measure", "Mesurer"], ["mass", "Propriétés de masse"], ["section", "Vue en coupe"], ["vars", "Équations / variables"], ["material", "Matériau"]] },
  plan: { label: "Mise en plan", tools: [["drawing", "Créer la mise en plan"], ["png", "Capture d'écran PNG"]] },
};
function renderTabs() {
  const tabs = $("#tabs"); tabs.innerHTML = "";
  for (const [k, t] of Object.entries(TABS)) {
    const b = document.createElement("button"); b.textContent = t.label; b.className = curTab === k ? "on" : "";
    b.onclick = () => { curTab = k; renderTabs(); }; tabs.appendChild(b);
  }
  renderTools();
}
function renderTools() {
  const el = $("#tools"); el.innerHTML = "";
  let list = TABS[curTab].tools;
  if (curTab === "esquisse" && mode === "sketch") list = SKETCH_TOOLS;
  for (const t of list) {
    if (t === "|") { const s = document.createElement("div"); s.className = "sep"; el.appendChild(s); continue; }
    const [k, label] = t;
    const iconName = { sfillet: "sfillet", exit: "exit", spattern: "spattern", smirror: "smirror" }[k] || k;
    const b = document.createElement("button"); b.className = "cbtn"; b.innerHTML = icon(iconName, 24) + `<span>${label}</span>`;
    if (mode === "sketch" && curTab === "esquisse" && sk && (sk.tool === k || (k === "sfillet" && sk.tool === "fillet"))) b.classList.add("on");
    if (mode === "sketch" && curTab !== "esquisse") b.disabled = true;
    b.onclick = () => command(k);
    el.appendChild(b);
  }
}
function command(k) {
  document.querySelectorAll(".menu").forEach(m => m.remove());
  if (mode === "sketch") return sketchCommand(k);
  if (mode === "pm") { toast("Validez ou annulez d'abord la fonction en cours", true); return; }
  if (mode === "measure" && k !== "measure") stopMeasure();
  switch (k) {
    case "sketch": return startSketch();
    case "extrude": case "cut": case "revolve": case "revcut": case "fillet": case "chamfer": case "shell": case "draft": case "hole":
    case "lpattern": case "cpattern": case "mirror": case "plane": case "loft": case "sweep": case "weld": case "sheet": return startFeature(k);
    case "plate": return startFeature("extrude", { depth: 3, end: "blind", namePrefix: "Tôle-base" });
    case "import": return pickFile(".step,.stp,.stl", importFile);
    case "flat": { const s = doc.features.filter(f => f.type === "sheet"); if (!s.length) return toast("Aucune tôle pliée dans la pièce", true); return showFlat((s.find(f => f.id === treeSel) || s[s.length - 1]).id); }
    case "cutlist": return showCutList();
    case "measure": return mode === "measure" ? stopMeasure() : startMeasure();
    case "mass": return showMass();
    case "section": return startSection();
    case "vars": return showVars();
    case "material": return showMaterial();
    case "drawing": return showDrawing();
    case "png": return saveFile(doc.name + ".png", dataURLtoBlob(viewer.screenshot()), toast);
  }
}

// ---------------- HUD
function renderHUD() {
  const h = $("#hud");
  const B = (k, ic, tip, on = false) => `<button data-k="${k}" title="${tip}" class="${on ? "on" : ""}">${icon(ic, 20)}</button>`;
  h.innerHTML = B("fit", "fit", "Zoom au mieux (F)") + B("front", "front", "Vue de face") + B("top", "top", "Vue de dessus") + B("right", "right", "Vue de droite") + B("iso", "iso", "Isométrique") + B("normal", "normal", "Normal à la sélection") +
    `<span class="sep"></span>` + B("shadedEdges", "edges", "Ombré avec arêtes", viewer.displayMode === "shadedEdges") + B("shaded", "shaded", "Ombré", viewer.displayMode === "shaded") + B("wire", "wire", "Filaire", viewer.displayMode === "wire") + B("xray", "xray", "Transparent", viewer.displayMode === "xray") +
    `<span class="sep"></span>` + B("section", "section", "Vue en coupe", !!viewer.clip) + B("planes", "eye", "Afficher / masquer les plans", viewer.planeVisible.front);
  h.querySelectorAll("button").forEach(b => b.onclick = () => hudAction(b.dataset.k));
}
function hudAction(k) {
  const V = { front: [[0, 0, 1], [0, 1, 0]], top: [[0, 1, 0], [0, 0, -1]], right: [[1, 0, 0], [0, 1, 0]], iso: [[1, 1, 1], [0, 1, 0]] };
  if (V[k]) return viewer.setView(...V[k]);
  if (k === "fit") return viewer.zoomFit();
  if (k === "normal") return normalToSelection();
  if (["shadedEdges", "shaded", "wire", "xray"].includes(k)) { viewer.displayMode = k; viewer.applyDisplayMode(); return renderHUD(); }
  if (k === "section") return viewer.clip ? (viewer.setClip(null), renderHUD()) : startSection();
  if (k === "planes") { const v = !viewer.planeVisible.front; viewer.planeVisible = { front: v, top: v, right: v }; viewer.buildPlanes(); return renderHUD(); }
}
function normalToSelection() {
  let p = null;
  if (mode === "sketch") p = skCtx.plane;
  else { const s = selection[0]; if (s?.kind === "plane") p = s.ref.kind === "std" ? STD_PLANES[s.ref.std] : st.planes[s.ref.id]; if (s?.kind === "face") p = planeFromNormal(s.p, s.n); }
  if (!p) return toast("Sélectionnez une face plane ou un plan", true);
  viewer.setView(p.n, planeY(p));
}

// ---------------- Sélection dans la vue
let downPt = null;
function bindViewport() {
  const el = viewer.renderer.domElement;
  el.addEventListener("pointerdown", e => { downPt = [e.clientX, e.clientY, e.button]; });
  el.addEventListener("pointermove", e => {
    if (mode === "sketch" && sk) { const P = viewer.rayPlane(e, skCtx.plane); if (P) { const q = to2D(skCtx.plane, P); $("#sinfo").textContent = `X ${fmt(q[0], 2)}  Y ${fmt(q[1], 2)}`; } }
    if (mode === "sketch" && !(sk?.tool === "convert")) return;
    if (e.buttons) return;
    const h = viewer.pick(e, pickFilter());
    const hv = h && (h.kind !== "plane" || pickFilter().plane) ? h : null;
    if (JSON.stringify(hv && [hv.kind, hv.body, hv.face, hv.edge, hv.ref]) !== JSON.stringify(viewer.hover && [viewer.hover.kind, viewer.hover.body, viewer.hover.face, viewer.hover.edge, viewer.hover.ref])) viewer.setHover(hv);
  });
  el.addEventListener("pointerup", e => {
    if (!downPt) return;
    const moved = Math.hypot(e.clientX - downPt[0], e.clientY - downPt[1]) > 5;
    const btn = downPt[2]; downPt = null;
    if (moved) return;
    if (btn === 2) { contextMenuView(e); return; }
    if (btn !== 0) return;
    if (mode === "sketch") { if (sk?.tool === "convert") { const h = viewer.pick(e, { face: true }); if (h?.kind === "face") { const face = bodiesOf(st)[h.body]?.shape.faces[h.face]; if (face) { sk.convertFace(face); toast("Arêtes de la face converties"); } } } return; }
    const h = viewer.pick(e, pickFilter());
    if (mode === "pickplane") { if (h && (h.kind === "plane" || (h.kind === "face" && isPlanarHit(h)))) startSketch(refFromHit(h)); else toast("Cliquez sur un plan ou une face plane", true); return; }
    if (mode === "pm") return pmPick(h, e);
    if (mode === "measure") return measurePick(h, e);
    if (!h) { selection = []; treeSel = null; }
    else if (e.shiftKey || e.ctrlKey || e.metaKey) { const i = selection.findIndex(s => sameHit(s, h)); if (i >= 0) selection.splice(i, 1); else selection.push(h); }
    else selection = [h];
    viewer.setSelection(selection); renderTree(); describeSelection(); showSelectedSketch();
  });
  el.addEventListener("contextmenu", e => e.preventDefault());
  el.addEventListener("dblclick", e => {
    if (mode !== "idle") return;
    const h = viewer.pick(e, { face: true, plane: true });
    if (h && (h.kind === "plane" || (h.kind === "face" && isPlanarHit(h)))) startSketch(refFromHit(h));
  });
}
function pickFilter() {
  if (mode === "pm" && pm?.active) { const t = pm.fieldType(pm.active); return { face: t === "faces" || t === "face" || t === "points", edge: t === "edges", plane: t === "planeSel" }; }
  if (mode === "pickplane") return { face: true, plane: true };
  if (mode === "sketch") return { face: true };
  return { face: true, edge: true, plane: true };
}
const sameHit = (a, b) => a.kind === b.kind && a.body === b.body && a.face === b.face && a.edge === b.edge && JSON.stringify(a.ref) === JSON.stringify(b.ref);
function isPlanarHit(h) { const f = bodiesOf(st)[h.body]?.shape.faces[h.face]; return f && f.geomType === "PLANE"; }
function refFromHit(h) {
  if (h.kind === "plane") return h.ref;
  const f = bodiesOf(st)[h.body].shape.faces[h.face];
  const n = f.normalAt().toTuple().map(x => Math.round(x * 1e9) / 1e9);
  return { kind: "face", p: h.p, n };
}
function describeSelection() {
  if (!selection.length) return status("Prêt");
  const s = selection[0];
  if (s.kind === "plane") return status("Plan sélectionné – cliquez sur Esquisse pour dessiner dessus");
  const sh = bodiesOf(st)[s.body]?.shape; if (!sh) return;
  if (s.kind === "face") { const f = sh.faces[s.face]; status(`Face (${f.geomType === "PLANE" ? "plane" : f.geomType.toLowerCase()}) – aire ${fmt(R.measureArea(f), 2)} mm²` + (f.geomType === "PLANE" ? " – double-clic pour esquisser" : "")); }
  if (s.kind === "edge") { const e = sh.edges[s.edge]; status(`Arête (${e.geomType.toLowerCase()}) – longueur ${fmt(e.length, 3)} mm`); }
  if (selection.length > 1) status(selection.length + " éléments sélectionnés");
}
function contextMenuView(e) {
  if (mode !== "idle") return;
  const h = viewer.pick(e, { face: true, edge: true, plane: true });
  const items = [];
  if (h && (h.kind === "plane" || (h.kind === "face" && isPlanarHit(h)))) items.push({ label: "Esquisse sur cette face / ce plan", icon: "sketch", click: () => startSketch(refFromHit(h)) });
  if (h?.kind === "face") items.push({ label: "Normal à", icon: "normal", click: () => { selection = [h]; normalToSelection(); } });
  if (h?.kind === "edge") items.push({ label: "Congé sur cette arête", icon: "fillet", click: () => { selection = [h]; startFeature("fillet"); } });
  items.push({ label: "Zoom au mieux", icon: "fit", click: () => viewer.zoomFit() }, { label: "Vue isométrique", icon: "iso", click: () => hudAction("iso") });
  popupMenu(e.clientX, e.clientY, items);
}

// ---------------- Esquisses
function showSelectedSketch() {
  if (mode === "sketch") return;
  viewer.sketchGroup.clear();
  const ids = new Set();
  const f = doc.features.find(q => q.id === treeSel);
  if (f?.type === "sketch") ids.add(f.id);
  if (mode === "pm" && pm?.feature) { for (const k of ["sketch", "profile", "path"]) if (pm.feature[k]) ids.add(pm.feature[k]); (pm.feature.sketches || []).forEach(x => ids.add(x)); }
  for (const id of ids) {
    const s = st?.sketches[id]; if (!s) continue;
    for (const e of s.entities) {
      const pts = entPoints(e).map(p => new THREE.Vector3(...to3D(s.plane, p)));
      if (pts.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: e.cons ? 0x7a7f87 : 0x0a6cff, depthTest: false })); l.renderOrder = 25;
      viewer.sketchGroup.add(l);
    }
  }
  viewer.render();
}
function startSketch(planeRef) {
  if (!planeRef) {
    const s = selection[0];
    if (s && (s.kind === "plane" || (s.kind === "face" && isPlanarHit(s)))) planeRef = refFromHit(s);
  }
  if (!planeRef) {
    mode = "pickplane"; status("Sélectionnez un plan ou une face plane pour l'esquisse (Échap pour annuler)");
    showPM(`<div class="pmh">${icon("sketch", 20)}<span class="t">Esquisse</span><button class="nobtn" id="pmNo">${icon("close", 18)}</button></div><div class="grp"><div class="hint">Cliquez sur un des trois plans (dans l'arbre ou dans la vue) ou sur une face plane du modèle.</div><div class="btnrow"><button class="btn" data-p="front">Plan de face</button><button class="btn" data-p="top">Plan de dessus</button><button class="btn" data-p="right">Plan de droite</button></div></div>`);
    $("#pm").querySelectorAll("[data-p]").forEach(b => b.onclick = () => startSketch({ kind: "std", std: b.dataset.p }));
    $("#pmNo").onclick = () => { mode = "idle"; hidePM(); status("Prêt"); };
    if (!viewer.planeVisible.front) { viewer.planeVisible = { front: true, top: true, right: true }; viewer.buildPlanes(); }
    return;
  }
  const f = { id: newId("sk"), type: "sketch", name: nextName("sketch"), plane: planeRef, entities: [] };
  const idx = doc.rollback ?? doc.features.length;
  enterSketch(f, true, idx);
}
function editFeature(id) {
  if (mode !== "idle") return toast("Terminez d'abord l'opération en cours", true);
  const f = doc.features.find(q => q.id === id); if (!f) return;
  if (f.type === "sketch") return enterSketch(f, false, doc.features.indexOf(f));
  if (f.type === "import") return toast("Un corps importé n'a pas de paramètres");
  openPM(JSON.parse(JSON.stringify(f)), false);
}
function enterSketch(f, isNew, idx) {
  // état du modèle avant l'esquisse
  const prevRollback = doc.rollback;
  const tmp = { ...doc, rollback: Math.min(idx, doc.features.length) };
  const base = rebuild(tmp);
  let plane;
  try { plane = resolvePlane(f.plane, base); } catch (e) { return toast("Plan d'esquisse introuvable : " + e.message, true); }
  recompute(base);
  mode = "sketch"; skCtx = { f, isNew, idx, prevRollback, plane };
  selection = []; viewer.setSelection([]); viewer.setHover(null);
  viewer.setSketchControls();
  viewer.setView(plane.n, planeY(plane), true, plane.o);
  sk = new Sketcher(viewer, plane, f.entities, {
    onSketchChange: () => renderSketchPM(), onSketchSelect: () => renderSketchPM(), onSketchTool: () => { renderTools(); renderSketchPM(); }, editDim,
  });
  sk.setTool("line");
  curTab = "esquisse"; renderTabs();
  $("#confirm").style.display = "flex";
  $("#confirm .ok").onclick = () => exitSketch(true);
  $("#confirm .no").onclick = () => exitSketch(false);
  renderSketchPM();
  status("Esquisse : clic = point, double-clic ou Échap = fin de ligne. Clic droit = déplacer la vue, molette = zoom.");
}
function exitSketch(save) {
  if (!sk) return;
  const ents = sk.ents; sk.destroy(); sk = null;
  const { f, isNew, idx, prevRollback } = skCtx; skCtx = null;
  mode = "idle"; viewer.setIdleControls(); $("#confirm").style.display = "none"; hidePM();
  doc.rollback = prevRollback;
  if (save && (ents.length || !isNew)) {
    commit(() => {
      f.entities = ents;
      if (isNew) { doc.features.splice(idx, 0, f); if (doc.rollback != null) doc.rollback++; }
      else { const i = doc.features.findIndex(q => q.id === f.id); doc.features[i] = f; }
    });
    treeSel = f.id;
  } else recompute();
  curTab = "fonctions"; renderTabs(); renderTree(); showSelectedSketch();
  $("#sinfo").textContent = "";
}
function sketchCommand(k) {
  if (k === "exit") return exitSketch(true);
  if (k === "sfillet") return sk.setTool("fillet");
  if (k === "smirror") { const err = sk.mirrorSelected(); if (err) toast(err, true); return; }
  if (k === "offset") { sk.pendingOp = "offset"; renderSketchPM(); return; }
  if (k === "spattern") { sk.pendingOp = "pattern"; renderSketchPM(); return; }
  if (k === "convert") { sk.setTool("convert"); toast("Cliquez sur une face du modèle pour projeter ses arêtes"); return; }
  if (SKETCH_TOOLS.some(t => t[0] === k)) sk.setTool(k);
}
function renderSketchPM() {
  if (!sk) return;
  const selEnts = sk.ents.filter(e => sk.sel.has(e.id));
  let h = `<div class="pmh">${icon("sketch", 20)}<span class="t">${esc(skCtx.f.name)}</span><button class="okbtn" id="skOk" title="Quitter l'esquisse">${icon("exit", 18)}</button><button class="nobtn" id="skNo" title="Annuler les modifications">${icon("close", 18)}</button></div>`;
  h += `<div class="grp"><h4>Options</h4>
    <div class="fld chk"><input type="checkbox" id="oGrid" ${sk.gridSnap ? "checked" : ""}><label for="oGrid">Accrochage à la grille (pas ${fmt(sk.gridStep(), 3)} mm)</label></div>
    <div class="fld chk"><input type="checkbox" id="oDims" ${sk.showDims ? "checked" : ""}><label for="oDims">Afficher les cotes (cliquer pour modifier)</label></div>
    ${sk.tool === "poly" ? `<div class="fld"><label>Nombre de côtés</label><input type="number" id="oSides" min="3" max="64" value="${sk.polySides}"></div>` : ""}
    ${sk.tool === "fillet" ? `<div class="fld"><label>Rayon du congé</label><input type="text" id="oFil" value="${sk.filletR}"></div><div class="hint">Cliquez sur un coin entre deux lignes.</div>` : ""}
    ${sk.tool === "trim" ? `<div class="hint">Cliquez sur la portion d'entité à supprimer.</div>` : ""}
    ${sk.tool === "dim" ? `<div class="hint">Cliquez sur une entité pour saisir sa cote.</div>` : ""}
    <div class="btnrow"><button class="btn" id="oUndo">↶ Annuler</button><button class="btn" id="oRedo">↷ Rétablir</button><button class="btn" id="oDel" ${selEnts.length ? "" : "disabled"}>Supprimer</button></div>
  </div>`;
  if (sk.pendingOp === "offset") h += `<div class="grp"><h4>Décaler les entités sélectionnées</h4><div class="fld"><label>Distance</label><input type="text" id="opD" value="5"></div><div class="btnrow"><button class="btn pri" id="opGo">Appliquer</button><button class="btn" id="opX">Fermer</button></div></div>`;
  if (sk.pendingOp === "pattern") h += `<div class="grp"><h4>Répétition linéaire d'entités</h4><div class="fld"><label>Pas X</label><input type="text" id="opX1" value="50"></div><div class="fld"><label>Pas Y</label><input type="text" id="opY1" value="0"></div><div class="fld"><label>Nombre</label><input type="text" id="opN" value="3"></div><div class="btnrow"><button class="btn pri" id="opGo">Appliquer</button><button class="btn" id="opX">Fermer</button></div></div>`;
  if (selEnts.length === 1) h += entityEditor(selEnts[0]);
  else if (selEnts.length > 1) h += `<div class="grp"><div class="hint">${selEnts.length} entités sélectionnées. Avec un axe de construction dans la sélection, utilisez « Symétrie d'entités ».</div><div class="btnrow"><button class="btn" id="oCons">Basculer construction</button></div></div>`;
  const cnt = sk.ents.length;
  h += `<div class="grp"><h4>Esquisse</h4><div class="hint">${cnt} entité(s). Contours fermés → volumes ; lignes ouvertes → tôle pliée / mécano-soudé / trajectoire.</div><div class="btnrow"><button class="btn" id="oDxf">Exporter en DXF</button></div></div>`;
  showPM(h);
  $("#skOk").onclick = () => exitSketch(true); $("#skNo").onclick = () => exitSketch(false);
  $("#oGrid").onchange = e => { sk.gridSnap = e.target.checked; };
  $("#oDims").onchange = e => { sk.showDims = e.target.checked; viewer.render(); };
  $("#oUndo").onclick = () => sk.undo(); $("#oRedo").onclick = () => sk.redo(); $("#oDel").onclick = () => sk.deleteSelected();
  $("#oDxf").onclick = () => exportSketchDXF({ name: skCtx.f.name, entities: sk.ents });
  const s = $("#oSides"); if (s) s.onchange = () => sk.polySides = Math.max(3, Math.min(64, parseInt(s.value) || 6));
  const fl = $("#oFil"); if (fl) fl.onchange = () => sk.filletR = ev()(fl.value) || 5;
  const oc = $("#oCons"); if (oc) oc.onclick = () => { sk.snapshot(); selEnts.forEach(e => e.cons = !e.cons); sk.changed(); };
  const go = $("#opGo"); if (go) go.onclick = () => {
    let err;
    if (sk.pendingOp === "offset") err = sk.offsetSelected(ev()($("#opD").value));
    else err = sk.linearPatternSelected(ev()($("#opX1").value), ev()($("#opY1").value), Math.max(2, Math.round(ev()($("#opN").value))));
    if (err) toast(err, true);
  };
  const ox = $("#opX"); if (ox) ox.onclick = () => { sk.pendingOp = null; renderSketchPM(); };
  bindEntityEditor(selEnts[0]);
}
function entityEditor(e) {
  const F = (k, l, v) => `<div class="fld"><label>${l}</label><input type="text" data-k="${k}" value="${fmt(v, 4)}"></div>`;
  let h = `<div class="grp"><h4>Propriétés de l'entité</h4>`;
  if (e.t === "line") {
    const L = v2.dist(e.a, e.b), ang = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) * 180 / Math.PI;
    h += F("ax", "X début", e.a[0]) + F("ay", "Y début", e.a[1]) + F("bx", "X fin", e.b[0]) + F("by", "Y fin", e.b[1]) + F("len", "Longueur", L) + F("ang", "Angle (°)", ang);
    if (e.g && e.gk === "rect") { const g = sk.ents.filter(x => x.g === e.g); const xs = g.flatMap(x => [x.a[0], x.b[0]]), ys = g.flatMap(x => [x.a[1], x.b[1]]); h += F("rw", "Largeur rect.", Math.max(...xs) - Math.min(...xs)) + F("rh", "Hauteur rect.", Math.max(...ys) - Math.min(...ys)); }
    if (e.g && e.gk === "poly") h += F("pr", "Rayon polygone", e.pr) + F("pn", "Côtés", e.pn);
    h += `<div class="btnrow"><button class="btn" data-a="h">Horizontale</button><button class="btn" data-a="v">Verticale</button><button class="btn" data-a="cons">${e.cons ? "Géométrie normale" : "Construction"}</button></div>`;
  } else if (e.t === "circle") h += F("cx", "Centre X", e.c[0]) + F("cy", "Centre Y", e.c[1]) + F("d", "Diamètre", 2 * e.r) + `<div class="btnrow"><button class="btn" data-a="cons">${e.cons ? "Géométrie normale" : "Construction"}</button></div>`;
  else if (e.t === "arc") { const c = circleFrom3(e.a, e.m, e.b); h += F("r", "Rayon", c ? c.r : 0) + `<div class="hint">Centre : ${fmt(c?.c[0] ?? 0)} ; ${fmt(c?.c[1] ?? 0)}</div>`; }
  else if (e.t === "slot") h += F("sl", "Entraxe", v2.dist(e.a, e.b)) + F("sw", "Largeur", 2 * e.r);
  else if (e.t === "point") h += F("px", "X", e.p[0]) + F("py", "Y", e.p[1]);
  return h + "</div>";
}
function bindEntityEditor(e) {
  if (!e) return;
  const E = ev();
  $("#pm").querySelectorAll("input[data-k]").forEach(inp => {
    inp.onkeydown = x => { if (x.key === "Enter") inp.blur(); x.stopPropagation(); };
    inp.onchange = () => {
      const v = E(inp.value); sk.snapshot();
      const k = inp.dataset.k;
      const mv = (key, np) => { const old = [...e[key]]; import_movePointAll(sk.ents, old, np); };
      switch (k) {
        case "ax": mv("a", [v, e.a[1]]); break; case "ay": mv("a", [e.a[0], v]); break;
        case "bx": mv("b", [v, e.b[1]]); break; case "by": mv("b", [e.b[0], v]); break;
        case "len": if (v > 0) sk.setLineLength(e, v); break;
        case "ang": sk.setLineAngle(e, v); break;
        case "rw": case "rh": { const g = sk.ents.filter(x => x.g === e.g); const horiz = k === "rw"; const side = g.find(x => horiz ? Math.abs(x.a[1] - x.b[1]) < 1e-9 : Math.abs(x.a[0] - x.b[0]) < 1e-9); if (side && v > 0) sk.setLineLength(side, v); break; }
        case "pr": case "pn": { const g = sk.ents.filter(x => x.g === e.g); const r = k === "pr" ? v : e.pr, n = k === "pn" ? Math.max(3, Math.round(v)) : e.pn; const a0 = Math.atan2(e.a[1] - e.pc[1], e.a[0] - e.pc[0]); const c = e.pc; sk.ents = sk.ents.filter(x => x.g !== e.g); const pts = []; for (let i = 0; i < n; i++) { const t = a0 + i * 2 * Math.PI / n; pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); } const gid = newId("g"); pts.forEach((p, i) => sk.ents.push({ id: newId(), t: "line", a: p, b: [...pts[(i + 1) % n]], g: gid, gk: "poly", pc: c, pr: r, pn: n })); sk.sel.clear(); void g; break; }
        case "cx": e.c = [v, e.c[1]]; break; case "cy": e.c = [e.c[0], v]; break; case "d": if (v > 0) e.r = v / 2; break;
        case "r": if (v > 0) sk.setArcRadius(e, v); break;
        case "sl": { const d = v2.norm(v2.sub(e.b, e.a)); e.b = v2.add(e.a, v2.mul(d, v)); break; }
        case "sw": if (v > 0) e.r = v / 2; break;
        case "px": e.p = [v, e.p[1]]; break; case "py": e.p = [e.p[0], v]; break;
      }
      sk.changed();
    };
  });
  $("#pm").querySelectorAll("button[data-a]").forEach(b => b.onclick = () => {
    sk.snapshot();
    if (b.dataset.a === "h") import_movePointAll(sk.ents, [...e.b], [e.b[0], e.a[1]]);
    if (b.dataset.a === "v") import_movePointAll(sk.ents, [...e.b], [e.a[0], e.b[1]]);
    if (b.dataset.a === "cons") e.cons = !e.cons;
    sk.changed();
  });
}
import { movePointAll as import_movePointAll } from "./sketcher.js";
function editDim(s, e, evt) {
  document.querySelectorAll(".dimpop").forEach(x => x.remove());
  let val, apply;
  if (e.t === "line") { val = v2.dist(e.a, e.b); apply = v => s.setLineLength(e, v); }
  else if (e.t === "circle") { val = 2 * e.r; apply = v => e.r = v / 2; }
  else if (e.t === "arc") { const c = circleFrom3(e.a, e.m, e.b); val = c?.r || 0; apply = v => s.setArcRadius(e, v); }
  else if (e.t === "slot") { val = v2.dist(e.a, e.b); apply = v => { const d = v2.norm(v2.sub(e.b, e.a)); e.b = v2.add(e.a, v2.mul(d, v)); }; }
  else return;
  const pop = document.createElement("div"); pop.className = "dimpop";
  const r = viewer.container.getBoundingClientRect();
  pop.style.left = Math.min(evt.clientX - r.left + 8, r.width - 200) + "px"; pop.style.top = (evt.clientY - r.top + 8) + "px";
  pop.innerHTML = `<span>${e.t === "circle" ? "Ø" : e.t === "arc" ? "R" : "L"}</span><input type="text" value="${fmt(val, 4)}"><button class="ok">✓</button><button class="no">✕</button>`;
  viewer.container.appendChild(pop);
  const inp = pop.querySelector("input"); setTimeout(() => { inp.focus(); inp.select(); }, 30);
  const ok = () => { const v = ev()(inp.value); if (v > 0) { s.snapshot(); apply(v); s.changed(); } pop.remove(); };
  pop.querySelector(".ok").onclick = ok; pop.querySelector(".no").onclick = () => pop.remove();
  inp.onkeydown = x => { x.stopPropagation(); if (x.key === "Enter") ok(); if (x.key === "Escape") pop.remove(); };
}

// ---------------- PropertyManager (fonctions)
function showPM(html) { $("#pm").innerHTML = html; $("#pm").style.display = "block"; $("#tree").style.display = "none"; setSideTab("pm"); }
function hidePM() { $("#pm").innerHTML = ""; $("#pm").style.display = "none"; $("#tree").style.display = "block"; setSideTab("tree"); }
function setSideTab(t) { document.querySelectorAll("#sidetabs button").forEach(b => b.classList.toggle("on", b.dataset.t === t)); }

const sketchesBefore = (idx) => doc.features.slice(0, idx).filter(f => f.type === "sketch");
const usedSketches = () => new Set(doc.features.flatMap(f => [f.sketch, f.profile, f.path, ...(f.sketches || [])]).filter(Boolean));
function defaultSketch(idx) {
  const sks = sketchesBefore(idx);
  const sel = sks.find(f => f.id === treeSel); if (sel) return sel.id;
  const used = usedSketches();
  const free = sks.filter(f => !used.has(f.id));
  return (free[free.length - 1] || sks[sks.length - 1])?.id || "";
}
function startFeature(type, extra = {}) {
  const idx = doc.rollback ?? doc.features.length;
  const f = { id: newId("f"), type, name: extra.namePrefix ? (() => { let n = 1; while (doc.features.some(q => q.name === extra.namePrefix + n)) n++; return extra.namePrefix + n; })() : nextName(type) };
  const D = {
    extrude: { sketch: defaultSketch(idx), end: "blind", depth: 20, reverse: false, dir2: false, depth2: 10, end2: "blind", draft: 0 },
    cut: { sketch: defaultSketch(idx), end: "blind", depth: 10, reverse: false, dir2: false, depth2: 10, end2: "blind" },
    revolve: { sketch: defaultSketch(idx), axis: "", angle: 360, reverse: false },
    revcut: { sketch: defaultSketch(idx), axis: "", angle: 360, reverse: false },
    fillet: { edges: [], radius: 5 }, chamfer: { edges: [], dist: 2 },
    shell: { faces: [], thickness: 2, outward: false }, draft: { faces: [], angle: 3, neutral: { kind: "std", std: "top" } },
    hole: { face: null, points: [], std: "M8", usage: "clear", kind: "simple", d: 9, cbD: 15, cbH: 8.6, csD: 16.4, csA: 90, end: "through", depth: 20, tip: true },
    lpattern: { features: [], axis1: "X", rev1: false, spacing1: 50, count1: 3, dir2: false, axis2: "Z", rev2: false, spacing2: 50, count2: 2 },
    cpattern: { features: [], axis: "Y", count: 6, angle: 360, rev: false },
    mirror: { body: false, features: [], plane: { kind: "std", std: "right" } },
    plane: { base: { kind: "std", std: "front" }, offset: 50, angle: 0 },
    loft: { sketches: [], op: "add", ruled: false },
    sweep: { profile: "", path: "", op: "add" },
    weld: { sketch: defaultSketch(idx), family: "tube_carre", size: "40x40x2", corner: "miter", rot: 0, color: "#8f9ba8" },
    sheet: { sketch: defaultSketch(idx), thickness: 2, radius: 2, k: 0.4, width: 100, side: "mid", mid: false, reverse: false },
  }[type] || {};
  Object.assign(f, JSON.parse(JSON.stringify(D)));
  if (extra.depth) f.depth = extra.depth;
  // reprendre la sélection courante
  const sh = st && bodiesOf(st);
  if ((type === "fillet" || type === "chamfer") && selection.length) f.edges = selection.filter(s => s.kind === "edge").map(s => ({ p: s.p }));
  if ((type === "shell" || type === "draft") && selection.length) f.faces = selection.filter(s => s.kind === "face").map(s => ({ p: s.p, n: s.n }));
  if (type === "hole" && selection[0]?.kind === "face" && isPlanarHit(selection[0])) { const r = refFromHit(selection[0]); f.face = r; f.points = [r.p]; }
  if (type === "plane" && selection[0]) { if (selection[0].kind === "plane") f.base = selection[0].ref; else if (selection[0].kind === "face" && isPlanarHit(selection[0])) f.base = refFromHit(selection[0]); }
  if (["lpattern", "cpattern", "mirror"].includes(type) && treeSel) { const t = doc.features.find(q => q.id === treeSel); if (t && ["extrude", "cut", "revolve", "revcut", "hole", "sweep", "loft"].includes(t.type)) f.features = [t.id]; }
  void sh;
  if (["extrude", "cut", "revolve", "revcut", "weld", "sheet"].includes(type) && !f.sketch) {
    toast("Créez d'abord une esquisse (onglet Esquisse)", true); return;
  }
  openPM(f, true);
}
const FEATURE_TYPES_FOR_PATTERN = ["extrude", "cut", "revolve", "revcut", "hole", "sweep", "loft"];
function pmSpec(f) {
  const idx = pm.idx;
  const sks = sketchesBefore(idx).map(s => [s.id, s.name]);
  const planesOpt = [["std:front", "Plan de face"], ["std:top", "Plan de dessus"], ["std:right", "Plan de droite"], ...doc.features.slice(0, idx).filter(q => q.type === "plane").map(q => ["ref:" + q.id, q.name])];
  const endOpts = [["blind", "Borgne"], ["through", "À travers tout"], ["mid", "Plan milieu"]];
  if (f.type === "cut") endOpts.push(["throughAll2", "À travers tout – 2 directions"]);
  const G = [];
  switch (f.type) {
    case "extrude": case "cut":
      G.push({ t: "Esquisse", f: [{ k: "sketch", l: "Esquisse", type: "select", o: sks }] });
      G.push({ t: "Direction 1", f: [{ k: "end", l: "Condition de fin", type: "select", o: endOpts }, ...(f.end === "blind" || f.end === "mid" ? [{ k: "depth", l: "Profondeur (mm)", type: "num" }] : []), { k: "reverse", l: "Inverser la direction", type: "check" }, ...(f.type === "extrude" && f.end === "blind" ? [{ k: "draft", l: "Dépouille (°)", type: "num" }] : [])] });
      if (f.end === "blind" || f.end === "through") G.push({ t: "Direction 2", f: [{ k: "dir2", l: "Activer la direction 2", type: "check" }, ...(f.dir2 ? [{ k: "end2", l: "Condition de fin", type: "select", o: [["blind", "Borgne"], ["through", "À travers tout"]] }, ...(f.end2 === "blind" ? [{ k: "depth2", l: "Profondeur (mm)", type: "num" }] : [])] : [])] });
      break;
    case "revolve": case "revcut": {
      const s = doc.features.find(q => q.id === f.sketch);
      const axes = [["", "Auto (1er axe de construction, sinon axe vertical)"], ...(s?.entities || []).filter(e => e.t === "line").map((e, i) => [e.id, (e.cons ? "Axe " : "Ligne ") + (i + 1) + ` (${fmt(e.a[0])};${fmt(e.a[1])} → ${fmt(e.b[0])};${fmt(e.b[1])})`])];
      G.push({ t: "Esquisse et axe", f: [{ k: "sketch", l: "Esquisse", type: "select", o: sks }, { k: "axis", l: "Axe de révolution", type: "select", o: axes }] });
      G.push({ t: "Paramètres", f: [{ k: "angle", l: "Angle (°)", type: "num" }, { k: "reverse", l: "Inverser le sens", type: "check" }] });
      break;
    }
    case "fillet": G.push({ t: "Éléments à arrondir", f: [{ k: "edges", l: "Arêtes", type: "edges" }, { k: "radius", l: "Rayon (mm)", type: "num" }] }); break;
    case "chamfer": G.push({ t: "Éléments à chanfreiner", f: [{ k: "edges", l: "Arêtes", type: "edges" }, { k: "dist", l: "Distance (mm)", type: "num" }] }); break;
    case "shell": G.push({ t: "Paramètres", f: [{ k: "faces", l: "Faces à supprimer", type: "faces" }, { k: "thickness", l: "Épaisseur (mm)", type: "num" }, { k: "outward", l: "Coque vers l'extérieur", type: "check" }] }); break;
    case "draft": G.push({ t: "Paramètres", f: [{ k: "faces", l: "Faces à dépouiller", type: "faces" }, { k: "angle", l: "Angle (°)", type: "num" }, { k: "neutral", l: "Plan neutre", type: "plane", o: planesOpt }] }); break;
    case "hole": {
      const stdO = Object.keys(HOLE_STD).map(k => [k, k]);
      G.push({ t: "Type de trou", f: [{ k: "kind", l: "Type", type: "select", o: [["simple", "Perçage simple"], ["cbore", "Lamage (vis CHC)"], ["csink", "Fraisure (vis FHC)"]] }, { k: "std", l: "Taille", type: "select", o: [["", "Personnalisée"], ...stdO] }, { k: "usage", l: "Usage", type: "select", o: [["clear", "Passage de vis (normal)"], ["tap", "Avant-trou de taraudage"]] }, { k: "d", l: "Diamètre (mm)", type: "num" }, ...(f.kind === "cbore" ? [{ k: "cbD", l: "Ø lamage", type: "num" }, { k: "cbH", l: "Prof. lamage", type: "num" }] : []), ...(f.kind === "csink" ? [{ k: "csD", l: "Ø fraisure", type: "num" }, { k: "csA", l: "Angle fraisure (°)", type: "num" }] : [])] });
      G.push({ t: "Condition de fin", f: [{ k: "end", l: "Fin", type: "select", o: [["through", "À travers tout"], ["blind", "Borgne"]] }, ...(f.end === "blind" ? [{ k: "depth", l: "Profondeur (mm)", type: "num" }, { k: "tip", l: "Pointe de foret 118°", type: "check" }] : [])] });
      G.push({ t: "Positions", f: [{ k: "points", l: "Positions", type: "points" }] });
      break;
    }
    case "lpattern":
      G.push({ t: "Fonctions à répéter", f: [{ k: "features", l: "Fonctions", type: "features" }] });
      G.push({ t: "Direction 1", f: [{ k: "axis1", l: "Axe", type: "select", o: [["X", "X"], ["Y", "Y"], ["Z", "Z"]] }, { k: "rev1", l: "Inverser", type: "check" }, { k: "spacing1", l: "Espacement (mm)", type: "num" }, { k: "count1", l: "Nombre d'occurrences", type: "num" }] });
      G.push({ t: "Direction 2", f: [{ k: "dir2", l: "Activer", type: "check" }, ...(f.dir2 ? [{ k: "axis2", l: "Axe", type: "select", o: [["X", "X"], ["Y", "Y"], ["Z", "Z"]] }, { k: "rev2", l: "Inverser", type: "check" }, { k: "spacing2", l: "Espacement (mm)", type: "num" }, { k: "count2", l: "Nombre d'occurrences", type: "num" }] : [])] });
      break;
    case "cpattern":
      G.push({ t: "Fonctions à répéter", f: [{ k: "features", l: "Fonctions", type: "features" }] });
      G.push({ t: "Paramètres", f: [{ k: "axis", l: "Axe (par l'origine)", type: "select", o: [["X", "X"], ["Y", "Y"], ["Z", "Z"]] }, { k: "count", l: "Nombre d'occurrences", type: "num" }, { k: "angle", l: "Angle total (°)", type: "num" }, { k: "rev", l: "Inverser", type: "check" }] });
      break;
    case "mirror":
      G.push({ t: "Plan de symétrie", f: [{ k: "plane", l: "Plan", type: "plane", o: planesOpt }] });
      G.push({ t: "Éléments", f: [{ k: "body", l: "Symétriser tout le corps", type: "check" }, ...(f.body ? [] : [{ k: "features", l: "Fonctions", type: "features" }])] });
      break;
    case "plane":
      G.push({ t: "Référence", f: [{ k: "base", l: "Plan / face de base", type: "plane", o: [...planesOpt, ...(f.base?.kind === "face" ? [["face", "Face sélectionnée"]] : [])] }, { k: "offset", l: "Décalage (mm)", type: "num" }, { k: "angle", l: "Angle (°) autour de X du plan", type: "num" }] });
      break;
    case "loft": G.push({ t: "Profils (dans l'ordre)", f: [{ k: "sketches", l: "Esquisses", type: "multisketch" }, { k: "op", l: "Opération", type: "select", o: [["add", "Bossage"], ["cut", "Enlèvement"]] }, { k: "ruled", l: "Surfaces réglées (droites)", type: "check" }] }); break;
    case "sweep": G.push({ t: "Profil et trajectoire", f: [{ k: "profile", l: "Profil (fermé)", type: "select", o: [["", "—"], ...sks] }, { k: "path", l: "Trajectoire", type: "select", o: [["", "—"], ...sks] }, { k: "op", l: "Opération", type: "select", o: [["add", "Bossage"], ["cut", "Enlèvement"]] }] }); G.push({ t: "", f: [{ type: "info", html: "Le profil doit être dessiné sur un plan perpendiculaire au début de la trajectoire, et le traverser." }] }); break;
    case "weld": {
      const fam = PROFILE_FAMILIES[f.family];
      G.push({ t: "Profilé", f: [{ k: "sketch", l: "Esquisse (lignes)", type: "select", o: sks }, { k: "family", l: "Type", type: "select", o: Object.entries(PROFILE_FAMILIES).map(([k, v]) => [k, v.label]) }, { k: "size", l: "Taille", type: "select", o: fam.sizes.map(s => [s, s]) }, { k: "rot", l: "Rotation du profil (°)", type: "num" }] });
      G.push({ t: "Coins", f: [{ k: "corner", l: "Traitement des coins", type: "select", o: [["miter", "Coupe d'onglet"], ["none", "Bout à bout (sans coupe)"]] }, { k: "color", l: "Couleur", type: "color" }] });
      G.push({ t: "", f: [{ type: "info", html: "Chaque ligne de l'esquisse devient une barre. Pour une ossature 3D (pergola…), faites une esquisse par plan : poteaux sur le plan de face, traverses sur un plan décalé, etc." }] });
      break;
    }
    case "sheet":
      G.push({ t: "Profil", f: [{ k: "sketch", l: "Esquisse (lignes ouvertes)", type: "select", o: sks }, { k: "side", l: "Matière", type: "select", o: [["mid", "Centrée sur la ligne"], ["left", "Côté gauche"], ["right", "Côté droit"]] }] });
      G.push({ t: "Tôle", f: [{ k: "thickness", l: "Épaisseur (mm)", type: "num" }, { k: "radius", l: "Rayon intérieur (mm)", type: "num" }, { k: "k", l: "Facteur K", type: "num" }, { k: "width", l: "Longueur de pliage (mm)", type: "num" }, { k: "mid", l: "Symétrique / plan d'esquisse", type: "check" }, { k: "reverse", l: "Inverser", type: "check" }] });
      break;
  }
  if (["extrude", "revolve", "lpattern", "cpattern", "mirror", "weld", "sheet", "loft", "sweep", "cut", "revcut", "hole", "plane"].includes(f.type)) pm.preview ??= true; else pm.preview ??= false;
  return G;
}
function openPM(f, isNew) {
  if (mode === "measure") stopMeasure();
  const idx = isNew ? (doc.rollback ?? doc.features.length) : doc.features.findIndex(q => q.id === f.id);
  pm = { feature: f, isNew, idx, active: null, err: null };
  pm.fieldType = k => { for (const g of pmSpec(pm.feature)) for (const x of g.f) if (x.k === k) return x.type; return null; };
  mode = "pm";
  $("#confirm").style.display = "flex";
  $("#confirm .ok").onclick = pmOk; $("#confirm .no").onclick = pmCancel;
  // champ de sélection actif par défaut
  for (const g of pmSpec(f)) for (const x of g.f) if (!pm.active && ["edges", "faces", "points"].includes(x.type)) pm.active = x.k;
  renderPM(); previewPM();
}
function renderPM() {
  const f = pm.feature;
  const G = pmSpec(f);
  const E = ev();
  let h = `<div class="pmh">${icon(TYPE_ICON[f.type] || "part", 20)}<span class="t">${esc(featureLabel(f.type))}</span><button class="okbtn" id="pmOk" title="Valider">${icon("exit", 18)}</button><button class="nobtn" id="pmNo" title="Annuler">${icon("close", 18)}</button></div>`;
  h += `<div class="grp"><div class="fld"><label>Nom</label><input type="text" data-k="name" value="${esc(f.name)}"></div></div>`;
  for (const g of G) {
    h += `<div class="grp">${g.t ? `<h4>${g.t}</h4>` : ""}`;
    for (const x of g.f) {
      const v = f[x.k];
      switch (x.type) {
        case "num": h += `<div class="fld"><label>${x.l}</label><input type="text" data-k="${x.k}" value="${esc(v)}" title="Nombre ou expression (ex : L/2+10)"></div>`; if (typeof v === "string" && v && isNaN(+v)) h += `<div class="hint" style="margin-left:114px">= ${fmt(E(v), 3)}</div>`; break;
        case "select": h += `<div class="fld"><label>${x.l}</label><select data-k="${x.k}">${x.o.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(v) === String(ov) ? "selected" : ""}>${esc(ol)}</option>`).join("")}</select></div>`; break;
        case "check": h += `<div class="fld chk"><input type="checkbox" id="c_${x.k}" data-k="${x.k}" ${v ? "checked" : ""}><label for="c_${x.k}">${x.l}</label></div>`; break;
        case "color": h += `<div class="fld"><label>${x.l}</label><input type="color" data-k="${x.k}" value="${esc(v || "#8f9ba8")}"></div>`; break;
        case "plane": { const cur = v ? (v.kind === "std" ? "std:" + v.std : v.kind === "ref" ? "ref:" + v.id : "face") : ""; h += `<div class="fld"><label>${x.l}</label><select data-k="${x.k}" data-plane="1">${x.o.map(([ov, ol]) => `<option value="${ov}" ${cur === ov ? "selected" : ""}>${esc(ol)}</option>`).join("")}</select></div>`; if (f.type === "plane") h += `<div class="hint">Astuce : sélectionnez une face plane avant de lancer la commande pour partir de cette face.</div>`; break; }
        case "edges": case "faces": {
          const list = v || [];
          h += `<div class="hint">${x.l} : cliquez dans la vue pour ajouter / retirer.</div><div class="sellist ${pm.active === x.k ? "active" : ""}" data-sel="${x.k}">${list.map((r, i) => `<div class="it"><span>${x.type === "edges" ? "Arête" : "Face"} ${i + 1}</span><button data-rm="${x.k}:${i}">✕</button></div>`).join("") || '<span class="hint">aucune</span>'}</div>`;
          break;
        }
        case "points": {
          const list = f.points || [];
          const pl = f.face ? planeFromNormal(f.face.p, f.face.n) : null;
          h += `<div class="hint">${f.face ? "Cliquez sur la face pour ajouter un perçage. Coordonnées dans le plan de la face :" : "Cliquez sur une face plane du modèle."}</div><div class="sellist ${pm.active === "points" ? "active" : ""}" data-sel="points">`;
          list.forEach((p, i) => { const q = to2D(pl, p); h += `<div class="it" style="gap:4px;align-items:center"><span>${i + 1}</span><input type="text" style="width:70px" data-pu="${i}" value="${fmt(q[0], 3)}"><input type="text" style="width:70px" data-pv="${i}" value="${fmt(q[1], 3)}"><button data-rm="points:${i}">✕</button></div>`; });
          if (!list.length) h += '<span class="hint">aucune</span>';
          h += `</div>`;
          if (f.face) h += `<div class="btnrow"><button class="btn" id="addPt">+ Ajouter un point (0 ; 0)</button><button class="btn" id="resetFace">Changer de face</button></div>`;
          break;
        }
        case "features": {
          const cands = doc.features.slice(0, pm.idx).filter(q => FEATURE_TYPES_FOR_PATTERN.includes(q.type));
          h += `<div class="sellist">${cands.map(q => `<label class="it" style="justify-content:flex-start;gap:6px"><input type="checkbox" data-feat="${q.id}" ${(f.features || []).includes(q.id) ? "checked" : ""}>${esc(q.name)}</label>`).join("") || '<span class="hint">aucune fonction volumique</span>'}</div>`;
          break;
        }
        case "multisketch": {
          const sks = sketchesBefore(pm.idx);
          h += `<div class="sellist">${sks.map(q => `<label class="it" style="justify-content:flex-start;gap:6px"><input type="checkbox" data-msk="${q.id}" ${(f.sketches || []).includes(q.id) ? "checked" : ""}>${esc(q.name)}${(f.sketches || []).includes(q.id) ? ` <span class="hint">(#${f.sketches.indexOf(q.id) + 1})</span>` : ""}</label>`).join("")}</div>`;
          break;
        }
        case "info": h += `<div class="hint">${x.html}</div>`; break;
      }
    }
    h += `</div>`;
  }
  h += `<div class="grp"><div class="fld chk"><input type="checkbox" id="pmPrev" ${pm.preview ? "checked" : ""}><label for="pmPrev">Aperçu en direct</label></div></div>`;
  showPM(h);
  const P = $("#pm");
  $("#pmOk").onclick = pmOk; $("#pmNo").onclick = pmCancel;
  P.querySelectorAll("input[data-k],select[data-k]").forEach(el => {
    const k = el.dataset.k;
    el.onkeydown = x => { x.stopPropagation(); if (x.key === "Enter") { el.blur(); } };
    el.onchange = () => {
      if (el.type === "checkbox") f[k] = el.checked;
      else if (el.dataset.plane) { const [kind, id] = el.value.split(":"); if (kind === "std") f[k] = { kind: "std", std: id }; else if (kind === "ref") f[k] = { kind: "ref", id }; }
      else if (k === "name") f.name = el.value;
      else if (pm.fieldType(k) === "num") { const s = el.value.trim().replace(",", "."); f[k] = /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : s; }
      else f[k] = el.value;
      if (f.type === "hole" && ["std", "usage", "kind"].includes(k) && f.std) { const H = HOLE_STD[f.std]; f.d = f.usage === "tap" ? H.tap : H.clear; f.cbD = H.cb[0]; f.cbH = H.cb[1]; f.csD = H.cs; }
      if (f.type === "hole" && k === "d") f.std = "";
      if (f.type === "weld" && k === "family") f.size = PROFILE_FAMILIES[f.family].sizes[Math.min(4, PROFILE_FAMILIES[f.family].sizes.length - 1)];
      renderPM(); previewPM();
    };
  });
  P.querySelectorAll("[data-sel]").forEach(el => el.onclick = e => { if (e.target.closest("button,input")) return; pm.active = el.dataset.sel; renderPM(); });
  P.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { const [k, i] = b.dataset.rm.split(":"); f[k].splice(+i, 1); renderPM(); previewPM(); });
  P.querySelectorAll("[data-feat]").forEach(c => c.onchange = () => { f.features = f.features || []; if (c.checked) f.features.push(c.dataset.feat); else f.features = f.features.filter(x => x !== c.dataset.feat); previewPM(); });
  P.querySelectorAll("[data-msk]").forEach(c => c.onchange = () => { f.sketches = f.sketches || []; if (c.checked) f.sketches.push(c.dataset.msk); else f.sketches = f.sketches.filter(x => x !== c.dataset.msk); renderPM(); previewPM(); });
  P.querySelectorAll("[data-pu],[data-pv]").forEach(inp => { inp.onkeydown = x => x.stopPropagation(); inp.onchange = () => { const i = +(inp.dataset.pu ?? inp.dataset.pv); const pl = planeFromNormal(f.face.p, f.face.n); const q = to2D(pl, f.points[i]); const val = ev()(inp.value); if (inp.dataset.pu != null) q[0] = val; else q[1] = val; f.points[i] = to3D(pl, q); renderPM(); previewPM(); }; });
  const ap = $("#addPt"); if (ap) ap.onclick = () => { const pl = planeFromNormal(f.face.p, f.face.n); f.points.push(to3D(pl, [0, 0])); renderPM(); previewPM(); };
  const rf = $("#resetFace"); if (rf) rf.onclick = () => { f.face = null; f.points = []; pm.active = "points"; renderPM(); previewPM(); };
  $("#pmPrev").onchange = e => { pm.preview = e.target.checked; previewPM(); };
}
function pmPick(h) {
  const f = pm.feature; const k = pm.active; const t = k && pm.fieldType(k);
  if (!h || !t) return;
  if (t === "edges" && h.kind === "edge") {
    const list = f[k] ||= [];
    const i = list.findIndex(r => v3.dist(r.p, h.p) < 1e-3 || findEdgeIdxSame(r.p, h));
    if (i >= 0) list.splice(i, 1); else list.push({ p: h.p.map(x => Math.round(x * 1e6) / 1e6) });
  } else if (t === "faces" && h.kind === "face") {
    const list = f[k] ||= [];
    const i = list.findIndex(r => findFaceIdxSame(r, h));
    if (i >= 0) list.splice(i, 1); else list.push({ p: h.p, n: bodiesOf(st)[h.body].shape.faces[h.face].geomType === "PLANE" ? refFromHit(h).n : null });
  } else if (t === "points" && h.kind === "face") {
    if (!isPlanarHit(h)) return toast("Choisissez une face plane", true);
    const r = refFromHit(h);
    if (!f.face) { f.face = r; f.points = [r.p]; }
    else { if (v3.dot(r.n, f.face.n) < 0.999) return toast("Les perçages doivent être sur des faces parallèles", true); const pl = planeFromNormal(f.face.p, f.face.n); f.points.push(to3D(pl, to2D(pl, r.p).map(x => Math.round(x * 100) / 100))); }
  } else return;
  renderPM(); previewPM();
}
function findEdgeIdxSame(p, h) { try { const sh = bodiesOf(st)[h.body].shape; const e = sh.edges[h.edge]; return R.measureDistanceBetween(e, R.makeVertex(p)) < 1e-4; } catch { return false; } }
function findFaceIdxSame(r, h) { try { const sh = bodiesOf(st)[h.body].shape; const fc = sh.faces[h.face]; return R.measureDistanceBetween(fc, R.makeVertex(r.p)) < 1e-4; } catch { return false; } }
let prevTimer = 0;
function previewPM() {
  clearTimeout(prevTimer);
  prevTimer = setTimeout(() => {
    if (!pm) return;
    const f = pm.feature;
    const feats = [...doc.features];
    if (pm.isNew) feats.splice(pm.idx, 0, f); else feats[pm.idx] = f;
    const showWith = pm.preview;
    const tmp = { ...doc, features: feats, rollback: showWith ? pm.idx + 1 : pm.idx };
    const s = rebuild(tmp);
    pm.err = null; pm.info = null;
    if (showWith) {
      pm.err = s.errors[f.id] || null;
      if (f.type === "sheet" && s.info[f.id]) { const I = s.info[f.id]; pm.info = `<h4>Développé</h4><div>Longueur à plat : <b>${fmt(I.flat, 2)} mm</b> × ${fmt(I.width, 1)} mm</div><div class="hint">${I.bends.map((b, i) => `Pli ${i + 1} : ${fmt(b.angle, 1)}° ${b.dir} à ${fmt(b.pos, 2)} mm`).join("<br>")}</div>`; }
      if (f.type === "weld" && s.info[f.id]) { pm.info = `<h4>Barres</h4>` + s.info[f.id].map((m, i) => `<div>${i + 1}. ${esc(m.profile)} – <b>${fmt(m.length, 1)} mm</b>${m.cuts.length ? " – onglets " + m.cuts.map(c => fmt(c, 1) + "°").join(" / ") : ""}</div>`).join(""); }
    } else if (s.errors[f.id]) pm.err = null;
    recompute(s);
    // marqueurs de sélection
    viewer.clearOverlay();
    const pts = [...(f.edges || []), ...(f.faces || [])].map(r => r.p);
    if (f.points) pts.push(...f.points);
    if (pts.length) viewer.addOverlayPoints(pts, 0x0a6cff, 9);
    // rafraîchir uniquement la zone d'erreur / info
    const P = $("#pm"); const old = P.querySelector(".err"); if (old) old.remove();
    P.querySelectorAll(".grp.pminfo").forEach(x => x.remove());
    if (pm.err) { const soft = /^(Aucun|Aucune|Il faut|Esquisse manquante|L'esquisse ne contient)/.test(pm.err); const d = document.createElement("div"); d.className = soft ? "hint err" : "err"; if (soft) d.style.color = "#6a7380"; d.textContent = (soft ? "ℹ " : "⚠ ") + pm.err; P.appendChild(d); }
    if (pm.info) { const d = document.createElement("div"); d.className = "grp pminfo"; d.innerHTML = pm.info; P.appendChild(d); }
    showSelectedSketch();
  }, 120);
}
function pmOk() {
  if (!pm) return;
  const f = pm.feature;
  const { isNew, idx } = pm;
  pm = null; mode = "idle"; $("#confirm").style.display = "none"; hidePM(); viewer.clearOverlay();
  commit(() => {
    if (isNew) { doc.features.splice(idx, 0, f); if (doc.rollback != null) doc.rollback++; }
    else doc.features[idx] = f;
  });
  treeSel = f.id; selection = []; viewer.setSelection([]); renderTree(); showSelectedSketch();
  if (st.errors[f.id]) toast("La fonction a été créée mais est en erreur : " + st.errors[f.id], true);
}
function pmCancel() { pm = null; mode = "idle"; $("#confirm").style.display = "none"; hidePM(); viewer.clearOverlay(); recompute(); }

// ---------------- Mesure
let measureSel = [];
function startMeasure() {
  mode = "measure"; measureSel = []; $("#measure").style.display = "block";
  $("#measure").innerHTML = "<b>Mesurer</b><div class='hint'>Cliquez sur une ou deux entités (faces, arêtes). Échap pour quitter.</div>";
  status("Mesure : cliquez sur des faces ou arêtes");
}
function stopMeasure() { mode = "idle"; measureSel = []; $("#measure").style.display = "none"; viewer.setSelection([]); viewer.clearOverlay(); status("Prêt"); }
function measurePick(h) {
  if (!h || h.kind === "plane") { measureSel = []; viewer.setSelection([]); }
  else { if (measureSel.length >= 2) measureSel = []; measureSel.push(h); viewer.setSelection(measureSel); }
  const B = bodiesOf(st);
  const sub = s => s.kind === "face" ? B[s.body].shape.faces[s.face] : B[s.body].shape.edges[s.edge];
  let html = "<b>Mesurer</b>";
  measureSel.forEach((s, i) => {
    const o = sub(s);
    if (s.kind === "face") { html += `<div>${i + 1}. Face ${o.geomType === "PLANE" ? "plane" : o.geomType.toLowerCase()} – aire <b>${fmt(R.measureArea(o), 2)} mm²</b></div>`; }
    else {
      let extra = "";
      if (o.geomType === "CIRCLE") { const a = o.pointAt(0).toTuple(), b = o.pointAt(1 / 3).toTuple(), c = o.pointAt(2 / 3).toTuple(); const A = v3.dist(a, b), Bd = v3.dist(b, c), Cd = v3.dist(c, a); const ar = v3.len(v3.cross(v3.sub(b, a), v3.sub(c, a))) / 2; const r = A * Bd * Cd / (4 * ar); extra = ` – Ø <b>${fmt(2 * r, 3)}</b>`; }
      html += `<div>${i + 1}. Arête ${o.geomType.toLowerCase()} – longueur <b>${fmt(o.length, 3)} mm</b>${extra}</div>`;
    }
  });
  if (measureSel.length === 2) {
    const [a, b] = measureSel.map(sub);
    const d = R.measureDistanceBetween(a, b);
    html += `<hr><div>Distance mini : <b>${fmt(d, 3)} mm</b></div>`;
    const [p, q] = measureSel.map(s => s.p);
    html += `<div class="hint">Entre points cliqués : ΔX ${fmt(q[0] - p[0], 2)} ΔY ${fmt(q[1] - p[1], 2)} ΔZ ${fmt(q[2] - p[2], 2)}</div>`;
    if (measureSel.every(s => s.kind === "face") && a.geomType === "PLANE" && b.geomType === "PLANE") { const ang = Math.acos(Math.min(1, Math.abs(v3.dot(a.normalAt().toTuple(), b.normalAt().toTuple())))) * 180 / Math.PI; html += `<div>Angle : <b>${fmt(ang, 2)}°</b></div>`; }
  }
  $("#measure").innerHTML = html + "<div class='btnrow'><button class='btn' id='mClose'>Fermer</button></div>";
  $("#mClose").onclick = stopMeasure;
}

// ---------------- Coupe
function startSection() {
  const box = viewer.modelBounds();
  const state = { axis: "X", off: 0, flip: false };
  const apply = () => {
    const n = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[state.axis].map(x => state.flip ? x : -x);
    const c = box.getCenter(new THREE.Vector3()).toArray();
    const i = { X: 0, Y: 1, Z: 2 }[state.axis];
    const pos = c[i] + state.off;
    viewer.setClip(new THREE.Plane(new THREE.Vector3(...n), state.flip ? -pos : pos));
    renderHUD();
  };
  const size = box.getSize(new THREE.Vector3());
  const body = document.createElement("div");
  body.innerHTML = `<div class="fld"><label>Plan de coupe</label><select id="sxA"><option value="X">Plan de droite (X)</option><option value="Y">Plan de dessus (Y)</option><option value="Z">Plan de face (Z)</option></select></div>
  <div class="fld"><label>Position</label><input type="range" id="sxO" min="-1" max="1" step="0.001" value="0" style="flex:1"></div>
  <div class="fld chk"><input type="checkbox" id="sxF"><label for="sxF">Inverser le côté</label></div>`;
  const m = modal("Vue en coupe", body, [{ label: "Désactiver la coupe", click: () => { viewer.setClip(null); renderHUD(); } }, { label: "OK", pri: true }]);
  m.style.background = "transparent"; m.style.pointerEvents = "none"; m.querySelector(".modal").style.pointerEvents = "auto"; m.style.placeItems = "end center";
  const upd = () => { state.axis = body.querySelector("#sxA").value; const half = size.toArray()[{ X: 0, Y: 1, Z: 2 }[state.axis]] / 2; state.off = parseFloat(body.querySelector("#sxO").value) * half; state.flip = body.querySelector("#sxF").checked; apply(); };
  body.querySelectorAll("select,input").forEach(x => x.oninput = upd);
  upd();
}

// ---------------- Masse, matériau, variables
function showMass() {
  if (!st || (!st.main && !st.bodies.length)) return toast("Aucun corps", true);
  const mp = massProps(st, doc.material.density);
  const bb = viewer.modelBounds(); const s = bb.getSize(new THREE.Vector3());
  let h = `<table class="tb"><tr><th>Matériau</th><td>${esc(doc.material.name)} (${fmt(doc.material.density, 2)} g/cm³)</td></tr>
  <tr><th>Masse</th><td><b>${fmt(mp.mass, 3)} kg</b></td></tr><tr><th>Volume</th><td>${fmt(mp.volume / 1000, 2)} cm³ (${fmt(mp.volume, 0)} mm³)</td></tr>
  <tr><th>Surface</th><td>${fmt(mp.area / 100, 2)} cm² (${fmt(mp.area / 1e6, 4)} m² – utile pour la peinture / galva)</td></tr>
  <tr><th>Centre de gravité</th><td>X ${fmt(mp.cog[0], 2)} ; Y ${fmt(mp.cog[1], 2)} ; Z ${fmt(mp.cog[2], 2)} mm</td></tr>
  <tr><th>Encombrement</th><td>${fmt(s.x, 1)} × ${fmt(s.y, 1)} × ${fmt(s.z, 1)} mm (X × Y × Z)</td></tr></table>`;
  modal("Propriétés de masse", h, [{ label: "Fermer", pri: true }]);
}
function showMaterial() {
  const body = document.createElement("div");
  body.innerHTML = `<div class="fld"><label>Matériau</label><select id="matS">${Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}" ${doc.material.key === k ? "selected" : ""}>${m.name} – ${m.density} g/cm³</option>`).join("")}<option value="custom" ${doc.material.key === "custom" ? "selected" : ""}>Personnalisé…</option></select></div>
  <div class="fld"><label>Masse vol. (g/cm³)</label><input type="text" id="matD" value="${doc.material.density}"></div><div class="fld"><label>Couleur</label><input type="color" id="matC" value="${doc.material.color}"></div>`;
  const sel = body.querySelector("#matS");
  sel.onchange = () => { const m = MATERIALS[sel.value]; if (m) { body.querySelector("#matD").value = m.density; body.querySelector("#matC").value = m.color; } };
  modal("Matériau", body, [{ label: "Annuler" }, { label: "Appliquer", pri: true, click: () => commit(() => { const k = sel.value; doc.material = { key: k, name: MATERIALS[k]?.name || "Personnalisé", density: parseFloat(body.querySelector("#matD").value.replace(",", ".")) || 7.85, color: body.querySelector("#matC").value }; }) }]);
}
function showVars() {
  const body = document.createElement("div");
  const rows = Object.entries(doc.vars).map(([k, v]) => ({ k, v }));
  const draw = () => {
    body.innerHTML = `<p class="hint">Définissez des variables (ex. <b>L = 1200</b>, <b>H = L/2</b>) puis tapez leur nom ou une formule dans n'importe quel champ numérique d'une fonction (ex. <b>L-40</b>).</p><table class="tb"><tr><th>Nom</th><th>Valeur / formule</th><th></th></tr>${rows.map((r, i) => `<tr><td><input type="text" data-i="${i}" data-f="k" value="${esc(r.k)}" style="width:100%;border:none"></td><td><input type="text" data-i="${i}" data-f="v" value="${esc(r.v)}" style="width:100%;border:none"></td><td><button class="btn" data-del="${i}">✕</button></td></tr>`).join("")}</table><div class="btnrow"><button class="btn" id="vAdd">+ Ajouter une variable</button></div>`;
    body.querySelectorAll("input").forEach(inp => { inp.onkeydown = e => e.stopPropagation(); inp.oninput = () => rows[+inp.dataset.i][inp.dataset.f] = inp.value; });
    body.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { rows.splice(+b.dataset.del, 1); draw(); });
    body.querySelector("#vAdd").onclick = () => { rows.push({ k: "V" + (rows.length + 1), v: "100" }); draw(); };
  };
  draw();
  modal("Équations / variables globales", body, [{ label: "Annuler" }, { label: "Appliquer", pri: true, click: () => commit(() => {
    const out = {};
    // résolution dans l'ordre (une variable peut dépendre des précédentes)
    for (const r of rows) { const name = r.k.trim().replace(/[^A-Za-z0-9_]/g, ""); if (!name || /^\d/.test(name)) continue; out[name] = makeEval(out)(r.v); }
    doc.vars = out; doc.varsSrc = rows;
  }) }]);
}

// ---------------- Mécano-soudé : liste de débit
function showCutList() {
  const items = [];
  doc.features.forEach(f => { if (f.type === "weld" && st.info[f.id]) st.info[f.id].forEach(m => items.push({ ...m, feat: f.name })); });
  if (!items.length) return toast("Aucun élément mécano-soudé", true);
  const groups = new Map();
  for (const m of items) { const key = m.profile + "|" + m.length.toFixed(1) + "|" + m.cuts.map(c => c.toFixed(1)).join("/"); const g = groups.get(key) || { ...m, qty: 0 }; g.qty++; groups.set(key, g); }
  const rows = [...groups.values()].sort((a, b) => a.profile.localeCompare(b.profile) || b.length - a.length);
  const byProf = new Map(); for (const r of rows) { const p = byProf.get(r.profile) || { len: 0, mass: 0 }; p.len += r.length * r.qty; p.mass += r.mass * r.qty; byProf.set(r.profile, p); }
  let h = `<table class="tb"><tr><th>N°</th><th>Profilé</th><th>Longueur (mm)</th><th>Coupes</th><th>Qté</th><th>Masse unit. (kg)</th><th>Masse tot. (kg)</th></tr>`;
  rows.forEach((r, i) => h += `<tr><td>${i + 1}</td><td>${esc(r.profile)}</td><td class="n">${fmt(r.length, 1)}</td><td>${r.cuts.length ? r.cuts.map(c => fmt(c, 1) + "°").join(" / ") : "droit"}</td><td class="n">${r.qty}</td><td class="n">${fmt(r.mass, 2)}</td><td class="n">${fmt(r.mass * r.qty, 2)}</td></tr>`);
  h += `</table><h4>Récapitulatif par profilé</h4><table class="tb"><tr><th>Profilé</th><th>Longueur totale (m)</th><th>Barres de 6 m (+3 % chute)</th><th>Masse (kg)</th></tr>`;
  for (const [p, v] of byProf) h += `<tr><td>${esc(p)}</td><td class="n">${fmt(v.len / 1000, 3)}</td><td class="n">${Math.ceil(v.len * 1.03 / 6000)}</td><td class="n">${fmt(v.mass, 2)}</td></tr>`;
  h += `</table><p class="hint">Longueurs = longueur hors-tout (pointe d'onglet comprise). Masses calculées avec ${esc(doc.material.name)}.</p>`;
  const csv = "N°;Profilé;Longueur (mm);Coupes;Quantité;Masse unitaire (kg);Masse totale (kg)\n" + rows.map((r, i) => [i + 1, r.profile, fmt(r.length, 1), r.cuts.length ? r.cuts.map(c => fmt(c, 1) + "°").join(" / ") : "droit", r.qty, fmt(r.mass, 2), fmt(r.mass * r.qty, 2)].join(";")).join("\n");
  modal("Liste de débit – " + esc(doc.name), h, [{ label: "Exporter CSV (Excel)", click: () => { saveFile(doc.name + " - liste de débit.csv", "﻿" + csv, toast); return false; } }, { label: "Fermer", pri: true }], { wide: true });
}

// ---------------- Tôlerie : mise à plat
function showFlat(id) {
  const f = doc.features.find(q => q.id === id); const I = st.info[id];
  if (!I) return toast("La tôle pliée est en erreur", true);
  const L = I.flat, W = I.width, pad = 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad - 14} ${L + 2 * pad} ${W + 2 * pad + 14}" style="width:100%;max-height:50vh;background:#fff"><rect x="0" y="0" width="${L}" height="${W}" fill="#e9eef3" stroke="#000" stroke-width="${Math.max(L, W) / 500}"/>${I.bends.map((b, i) => `<line x1="${b.pos}" y1="0" x2="${b.pos}" y2="${W}" stroke="#d93025" stroke-dasharray="${W / 40} ${W / 60}" stroke-width="${Math.max(L, W) / 600}"/><text x="${b.pos}" y="${-4}" font-size="${Math.max(L, W) / 45}" text-anchor="middle" fill="#d93025">P${i + 1}</text>`).join("")}</svg>`;
  let h = svg + `<table class="tb" style="margin-top:10px"><tr><th>Développé</th><td><b>${fmt(L, 2)} × ${fmt(W, 1)} mm</b></td><th>Épaisseur</th><td>${fmt(I.t, 2)} mm</td></tr><tr><th>Rayon intérieur</th><td>${fmt(I.r, 2)} mm</td><th>Facteur K</th><td>${fmt(I.K, 3)}</td></tr></table>
  <table class="tb" style="margin-top:8px"><tr><th>Pli</th><th>Angle</th><th>Sens</th><th>Position axe de pli (mm)</th><th>Zone de pli</th></tr>${I.bends.map((b, i) => `<tr><td>P${i + 1}</td><td>${fmt(b.angle, 1)}°</td><td>${b.dir}</td><td class="n">${fmt(b.pos, 2)}</td><td class="n">${fmt(b.start, 2)} → ${fmt(b.end, 2)}</td></tr>`).join("")}</table>`;
  modal("Mise à plat – " + esc(f.name), h, [{ label: "Exporter DXF (découpe)", pri: true, click: () => { saveZipped(`${doc.name} - ${f.name} - developpe.zip`, { [`${f.name}-developpe.dxf`]: flatPatternDXF(I, f.name) }, toast); return false; } }, { label: "Fermer" }], { wide: true });
}
function exportSketchDXF(f) { saveZipped(`${doc.name} - ${f.name}.zip`, { [`${f.name}.dxf`]: sketchToDXF(f.entities || []) }, toast); }

// ---------------- Mise en plan
function showDrawing() {
  const shape = exportCompound(st);
  if (!shape) return toast("Aucun corps à mettre en plan", true);
  const mp = massProps(st, doc.material.density);
  const opts = { format: "A3", scale: "auto", hidden: true, iso: true, dims: true, title: doc.name, author: doc.author || "", notes: "", material: doc.material.name, mass: mp ? fmt(mp.mass, 2) + " kg" : "-" };
  const body = document.createElement("div");
  body.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
    <div class="fld"><label style="flex:none">Format</label><select id="dF"><option>A4</option><option selected>A3</option><option>A2</option></select></div>
    <div class="fld"><label style="flex:none">Échelle</label><select id="dS"><option value="auto">Auto</option>${SCALES.map(s => `<option value="${s}">${scaleLabel(s)}</option>`).join("")}</select></div>
    <div class="fld"><label style="flex:none">Titre</label><input type="text" id="dT" value="${esc(opts.title)}"></div>
    <div class="fld"><label style="flex:none">Dessiné par</label><input type="text" id="dA" value="${esc(opts.author)}" style="width:110px"></div>
    <div class="fld chk"><input type="checkbox" id="dH" checked><label for="dH" style="flex:none">Arêtes cachées</label></div>
    <div class="fld chk"><input type="checkbox" id="dI" checked><label for="dI" style="flex:none">Vue iso</label></div>
    <div class="fld chk"><input type="checkbox" id="dD" checked><label for="dD" style="flex:none">Cotes d'encombrement</label></div>
    <div class="fld" style="flex:1 1 100%"><label style="flex:none">Notes</label><input type="text" id="dN" placeholder="ex : Ébavurer tous les angles – Finition galvanisée"></div></div><div class="sheetview" id="dV"><div class="hint">Calcul des projections…</div></div>`;
  let last = null;
  const gen = () => {
    opts.format = body.querySelector("#dF").value; const sv = body.querySelector("#dS").value; opts.scale = sv === "auto" ? "auto" : parseFloat(sv);
    opts.title = body.querySelector("#dT").value; opts.author = body.querySelector("#dA").value; opts.hidden = body.querySelector("#dH").checked; opts.iso = body.querySelector("#dI").checked; opts.dims = body.querySelector("#dD").checked; opts.notes = body.querySelector("#dN").value;
    doc.author = opts.author;
    setTimeout(() => {
      try { last = buildDrawing(shape, opts); const v = body.querySelector("#dV"); v.innerHTML = last.svg; const s = v.querySelector("svg"); s.style.width = "100%"; s.style.height = "auto"; s.removeAttribute("height"); }
      catch (e) { body.querySelector("#dV").innerHTML = `<div class="err">Erreur de projection : ${esc(e.message)}</div>`; }
    }, 20);
  };
  body.querySelectorAll("select,input").forEach(x => { x.onchange = gen; x.onkeydown = e => e.stopPropagation(); });
  modal("Mise en plan", body, [
    { label: "Exporter SVG", click: () => { if (last) saveFile(`${doc.name} - plan.svg`, last.svg, toast); return false; } },
    { label: "Exporter PDF", pri: true, click: () => { if (last) svgToPdf(last).then(b => saveFile(`${doc.name} - plan.pdf`, b, toast)); return false; } },
    { label: "Fermer" }], { wide: true });
  gen();
}
async function svgToPdf(d) {
  const pxPerMm = 8;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([d.svg], { type: "image/svg+xml" }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement("canvas"); c.width = d.W * pxPerMm; c.height = d.H * pxPerMm;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [d.W, d.H] });
  pdf.addImage(c.toDataURL("image/png"), "PNG", 0, 0, d.W, d.H);
  return pdf.output("blob");
}

// ---------------- Fichiers
function pickFile(accept, cb) {
  const inp = $("#fileIn"); inp.value = ""; inp.accept = accept;
  inp.onchange = () => { const f = inp.files[0]; if (f) cb(f); };
  inp.click();
}
async function importFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const fmtx = /\.stl$/i.test(file.name) ? "stl" : "step";
  const f = { id: newId("im"), type: "import", name: file.name.replace(/\.[^.]+$/, ""), format: fmtx, data: btoa(bin) };
  try {
    const blob = new Blob([buf]);
    const sh = fmtx === "stl" ? await R.importSTL(blob) : await R.importSTEP(blob);
    importCache.set(f.id, sh);
  } catch (e) { return toast("Import impossible : " + e.message, true); }
  commit(() => { const idx = doc.rollback ?? doc.features.length; doc.features.splice(idx, 0, f); if (doc.rollback != null) doc.rollback++; });
  viewer.zoomFit(); toast("Fichier importé : " + file.name);
}
async function openFile(file) {
  if (/\.(step|stp|stl)$/i.test(file.name)) return importFile(file);
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== "glcad") throw new Error("Ce n'est pas un projet G&L CAO");
    snapshot(); doc = d; importCache.clear(); await afterLoad(); viewer.zoomFit(); toast("Projet ouvert : " + doc.name);
  } catch (e) { toast("Ouverture impossible : " + e.message, true); }
}
function saveProject() { doc.name = $("#docname").value || "Pièce"; saveFile(doc.name + ".glcad.json", JSON.stringify(doc), toast); autosave(); }
function exportMenu(x, y) {
  popupMenu(x, y, [
    { label: "STEP (.step) – pour autres logiciels CAO", icon: "export", click: () => exportCAD("step") },
    { label: "STL (.stl) – impression 3D", icon: "export", click: () => exportCAD("stl") },
    { label: "Esquisse sélectionnée → DXF", icon: "export", click: () => { const f = doc.features.find(q => q.id === treeSel && q.type === "sketch"); if (!f) return toast("Sélectionnez une esquisse dans l'arbre", true); exportSketchDXF(f); } },
    { label: "Mise en plan (PDF / SVG)…", icon: "drawing", click: showDrawing },
    { label: "Capture d'écran PNG", icon: "png", click: () => saveFile(doc.name + ".png", dataURLtoBlob(viewer.screenshot()), toast) },
    "-",
    { label: "Projet G&L CAO (.json)", icon: "save", click: saveProject },
  ]);
}
async function exportCAD(kind) {
  const sh = exportCompound(st); if (!sh) return toast("Rien à exporter", true);
  try {
    const blob = kind === "step" ? sh.blobSTEP() : sh.blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 0.1 });
    const data = new Uint8Array(await blob.arrayBuffer());
    saveZipped(`${doc.name} - ${kind.toUpperCase()}.zip`, { [`${doc.name}.${kind === "step" ? "step" : "stl"}`]: data }, toast);
  } catch (e) { toast("Export impossible : " + e.message, true); }
}
function dataURLtoBlob(u) { const b = atob(u.split(",")[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new Blob([a], { type: "image/png" }); }
function newMenu(x, y) {
  popupMenu(x, y, [
    { label: "Nouvelle pièce vide", icon: "new", click: () => { snapshot(); doc = newDoc(); importCache.clear(); treeSel = null; afterLoad(); viewer.setView([1, 1, 1]); } },
    { label: "Exemple : platine percée", icon: "plate", click: () => loadExample("platine") },
    { label: "Exemple : cadre mécano-soudé", icon: "weld", click: () => loadExample("cadre") },
    { label: "Exemple : équerre en tôle pliée", icon: "sheet", click: () => loadExample("equerre") },
  ]);
}
function loadExample(k) {
  const L = (a, b, cons) => ({ id: newId(), t: "line", a, b, cons });
  const rect = (x0, y0, x1, y1) => { const g = newId("g"); return [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]].map(([a, b]) => ({ id: newId(), t: "line", a, b, g, gk: "rect" })); };
  const d = newDoc();
  if (k === "platine") {
    d.name = "Platine 200x150"; d.vars = { L: 200, H: 150, EP: 10 };
    d.features = [
      { id: "sk1", type: "sketch", name: "Esquisse1", plane: { kind: "std", std: "top" }, entities: rect(-100, -75, 100, 75) },
      { id: "f1", type: "extrude", name: "Bossage-Extru1", sketch: "sk1", end: "blind", depth: "EP", reverse: false, dir2: false, depth2: 10, end2: "blind", draft: 0 },
      { id: "f2", type: "hole", name: "Perçage1", face: { p: [0, 10, 0], n: [0, 1, 0] }, points: [[-75, 10, -50], [75, 10, -50], [-75, 10, 50], [75, 10, 50]], std: "M12", usage: "clear", kind: "simple", d: 13.5, cbD: 20, cbH: 12.6, csD: 24.4, csA: 90, end: "through", depth: 20, tip: true },
      { id: "f3", type: "fillet", name: "Congé1", edges: [{ p: [100, 5, 75] }, { p: [-100, 5, 75] }, { p: [100, 5, -75] }, { p: [-100, 5, -75] }], radius: 15 },
    ];
  } else if (k === "cadre") {
    d.name = "Cadre portail"; d.vars = { L: 1500, H: 1000 };
    d.features = [
      { id: "sk1", type: "sketch", name: "Esquisse cadre", plane: { kind: "std", std: "front" }, entities: [L([0, 0], [1500, 0]), L([1500, 0], [1500, 1000]), L([1500, 1000], [0, 1000]), L([0, 1000], [0, 0])] },
      { id: "w1", type: "weld", name: "Cadre 40x40", sketch: "sk1", family: "tube_carre", size: "40x40x2", corner: "miter", rot: 0, color: "#7d8a97" },
      { id: "sk2", type: "sketch", name: "Esquisse barreaux", plane: { kind: "std", std: "front" }, entities: [125, 250, 375, 500, 625, 750, 875, 1000, 1125, 1250, 1375].map(x => L([x, 20], [x, 980])) },
      { id: "w2", type: "weld", name: "Barreaux 20x20", sketch: "sk2", family: "carre_plein", size: "20", corner: "none", rot: 0, color: "#5f6b78" },
    ];
  } else {
    d.name = "Équerre pliée"; d.material = { key: "inox", ...MATERIALS.inox };
    d.features = [
      { id: "sk1", type: "sketch", name: "Profil", plane: { kind: "std", std: "front" }, entities: [L([0, 80], [0, 0]), L([0, 0], [120, 0]), L([120, 0], [120, 25])] },
      { id: "t1", type: "sheet", name: "Tôle-pliée1", sketch: "sk1", thickness: 3, radius: 3, k: 0.4, width: 100, side: "left", mid: true, reverse: false },
      { id: "f2", type: "hole", name: "Perçage1", face: { p: [60, 0, 0], n: [0, -1, 0] }, points: [[40, 0, 25], [80, 0, -25]], std: "M10", usage: "clear", kind: "simple", d: 11, cbD: 18, cbH: 10.6, csD: 20.4, csA: 90, end: "through", depth: 20, tip: true },
    ];
  }
  snapshot(); doc = d; importCache.clear(); treeSel = null; afterLoad().then(() => { viewer.setView([1, 1, 1]); setTimeout(() => viewer.zoomFit(), 400); });
}
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const APP_BUILD = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "";
// Vérification des mises à jour (version publiée sur GitHub Pages)
async function checkUpdate(manual = false) {
  try {
    const r = await fetch("./version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw 0;
    const v = await r.json();
    if (v.build && v.build !== APP_BUILD) {
      const bar = document.createElement("div");
      bar.style.cssText = "position:fixed;top:44px;right:12px;z-index:95;background:#0a6cff;color:#fff;padding:9px 12px;border-radius:9px;box-shadow:0 6px 18px rgba(0,0,0,.25);display:flex;gap:10px;align-items:center";
      bar.innerHTML = `Nouvelle version ${esc(v.version)} disponible <button class="btn" style="color:#0a6cff">Mettre à jour</button>`;
      bar.querySelector("button").onclick = () => { autosave(); location.reload(); };
      document.querySelectorAll(".updbar").forEach(x => x.remove()); bar.className = "updbar"; document.body.appendChild(bar);
    } else if (manual) toast("Vous avez la dernière version (" + APP_VERSION + ")");
  } catch { if (manual) toast("Vérification impossible (hors ligne ?)", true); }
}
function showHelp() {
  modal("Aide – G&L CAO 3D", `<div style="max-width:720px"><p class="hint">Version ${APP_VERSION} – ${APP_BUILD} <button class="btn" id="chkUpd">Vérifier les mises à jour</button></p>
  <h4>Créer une pièce</h4><ol>
  <li>Cliquez sur un plan (Face, Dessus, Droite) dans l'arbre ou dans la vue, puis sur <b>Esquisse</b> (onglet Esquisse). Double-clic sur un plan ou une face plane = esquisse directe.</li>
  <li>Dessinez avec <b>Ligne</b>, <b>Rectangle</b>, <b>Cercle</b>… Les cotes s'affichent en bleu : <b>cliquez sur une cote pour taper la valeur exacte</b>. Sélectionnez une entité (outil Sélection) pour éditer ses coordonnées dans le panneau Propriétés.</li>
  <li>Validez l'esquisse avec ✓ (en haut à droite).</li>
  <li>Onglet <b>Fonctions</b> → <b>Bossage extrudé</b>, réglez la profondeur, validez ✓.</li>
  <li>Esquissez sur une face (double-clic dessus) puis <b>Enlèvement extrudé</b>, ou utilisez <b>Assistance perçage</b> pour des trous normalisés M3 à M20 (passage, taraudage, lamage, fraisure).</li>
  <li>Sélectionnez des arêtes puis <b>Congé</b> ou <b>Chanfrein</b>.</li></ol>
  <h4>Métallerie</h4><ul>
  <li><b>Mécano-soudé</b> : dessinez des lignes (squelette) puis « Élément mécano-soudé » : tubes carrés / rectangulaires / ronds, plats, cornières, IPE, HEA, HEB, UPN… Coupes d'onglet automatiques et <b>liste de débit</b> avec longueurs, angles, masses, export CSV.</li>
  <li><b>Tôlerie</b> : dessinez un profil ouvert (lignes) puis « Tôle pliée » (épaisseur, rayon, facteur K). « Mise à plat » donne le développé et exporte le <b>DXF</b> pour la découpe laser.</li></ul>
  <h4>Souris / tactile</h4><ul><li>Clic gauche glissé : rotation (hors esquisse) • Clic droit glissé : déplacement • Molette : zoom • Clic droit : menu contextuel.</li><li>Tactile : 1 doigt = rotation, 2 doigts = zoom / déplacement.</li></ul>
  <h4>Raccourcis</h4><ul><li>Ctrl+Z / Ctrl+Y : annuler / rétablir • Ctrl+S : enregistrer • F : zoom au mieux • Échap : annuler • Suppr : supprimer.</li></ul>
  <h4>Paramétrage</h4><p>Tous les champs numériques acceptent des formules et des variables (Évaluer → Équations). Double-cliquez une fonction de l'arbre pour la modifier ; tout est recalculé.</p>
  <h4>Fichiers</h4><p>Enregistrez le projet (.json) pour le rouvrir plus tard. Exports : STEP, STL (impression 3D), DXF, mise en plan PDF/SVG, PNG. Import STEP/STL possible. Le travail en cours est aussi gardé automatiquement dans ce navigateur.</p></div>`, [{ label: "Fermer", pri: true }], { wide: true });
  const cu = document.getElementById("chkUpd"); if (cu) cu.onclick = () => checkUpdate(true);
}

// ---------------- Clavier
document.addEventListener("keydown", e => {
  if (e.target.matches("input,textarea,select")) return;
  if (mode === "sketch" && sk && sk.key(e)) { e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); saveProject(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "z" && mode === "idle") { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "y" && mode === "idle") { e.preventDefault(); redo(); return; }
  if (k === "escape") {
    if (mode === "pm") pmCancel(); else if (mode === "pickplane") { mode = "idle"; hidePM(); } else if (mode === "measure") stopMeasure(); else if (mode === "sketch") exitSketch(true);
    else { selection = []; treeSel = null; viewer.setSelection([]); renderTree(); showSelectedSketch(); }
    return;
  }
  if (k === "f" && !e.ctrlKey) viewer.zoomFit();
  if ((k === "delete") && mode === "idle" && treeSel) deleteFeature(treeSel);
  if (k === "enter" && mode === "pm") pmOk();
});

// ---------------- Démarrage
async function main() {
  viewer = new Viewer($("#view"));
  $("#bNew").innerHTML = icon("new", 18) + '<span class="lbl">Nouveau</span>';
  $("#bOpen").innerHTML = icon("open", 18) + '<span class="lbl">Ouvrir</span>';
  $("#bSave").innerHTML = icon("save", 18) + '<span class="lbl">Enregistrer</span>';
  $("#bExport").innerHTML = icon("export", 18) + '<span class="lbl">Exporter</span>';
  $("#bUndo").innerHTML = icon("undo", 18); $("#bRedo").innerHTML = icon("redo", 18);
  $("#bHelp").innerHTML = icon("help", 18) + '<span class="lbl">Aide</span>';
  $("#confirm .ok").innerHTML = icon("exit", 26); $("#confirm .no").innerHTML = icon("close", 24);
  $("#bNew").onclick = e => newMenu(e.clientX, e.clientY + 10);
  $("#bOpen").onclick = () => pickFile(".json,.glcad,.step,.stp,.stl", openFile);
  $("#bSave").onclick = saveProject;
  $("#bExport").onclick = e => exportMenu(e.clientX, e.clientY + 10);
  $("#bUndo").onclick = undo; $("#bRedo").onclick = redo; $("#bHelp").onclick = showHelp;
  $("#docname").onchange = () => { doc.name = $("#docname").value || "Pièce"; renderTree(); autosave(); };
  $("#docname").onkeydown = e => e.stopPropagation();
  document.querySelectorAll("#sidetabs button").forEach(b => b.onclick = () => { if (b.dataset.t === "pm" && !$("#pm").innerHTML) return; $("#pm").style.display = b.dataset.t === "pm" ? "block" : "none"; $("#tree").style.display = b.dataset.t === "tree" ? "block" : "none"; setSideTab(b.dataset.t); });
  renderTabs(); renderHUD(); updateUndo(); bindViewport();
  viewer.setView([1, 1, 1], [0, 1, 0], false);
  warmDownloads();
  try {
    await initOCC(m => $("#loadmsg").textContent = m);
  } catch (e) { $("#loadmsg").textContent = "Erreur de chargement du moteur : " + e.message; return; }
  let restored = false;
  try { const s = localStorage.getItem("glcad-autosave"); if (s) { const d = JSON.parse(s); if (d.app === "glcad" && d.features?.length) { doc = d; restored = true; } } } catch { }
  await afterLoad();
  $("#loading").style.display = "none";
  if (/^https?:/.test(location.protocol) && !/claude/.test(location.host)) { setTimeout(checkUpdate, 5000); setInterval(checkUpdate, 15 * 60 * 1000); }
  if (restored) { viewer.zoomFit(false); toast("Dernière session restaurée"); }
  else { viewer.zoomFit(false); status("Prêt – choisissez un plan puis cliquez sur Esquisse (ou Nouveau → Exemple)"); }
}
main();
window.__gl = { get doc() { return doc; }, get st() { return st; }, loadExample, command, viewer: () => viewer };
