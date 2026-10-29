// Moteur de reconstruction paramétrique : arbre de création -> corps solides
import { R } from "./occ.js";
import { v2, v3, STD_PLANES, planeY, to3D, planeFromNormal, offsetPlane, rPlane, sketchRegions, buildChains, startOf, endOf, makeEval, chainPolygon, polyArea, pointInPoly, entityPolygon } from "./geom.js";
import { profileSection, profileName } from "./profiles.js";

export const importCache = new Map();
export async function prepareImports(doc) {
  for (const f of doc.features) {
    if (f.type === "import" && f.data && !importCache.has(f.id)) {
      const bin = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
      const blob = new Blob([bin]);
      const sh = f.format === "stl" ? await R.importSTL(blob) : await R.importSTEP(blob);
      importCache.set(f.id, sh);
    }
  }
}

const FEATURE_LABELS = {
  sketch: "Esquisse", extrude: "Bossage extrudé", cut: "Enlèvement extrudé", revolve: "Bossage avec révolution", revcut: "Enlèvement avec révolution",
  fillet: "Congé", chamfer: "Chanfrein", shell: "Coque", hole: "Perçage", lpattern: "Répétition linéaire", cpattern: "Répétition circulaire",
  mirror: "Symétrie", plane: "Plan", loft: "Lissage", sweep: "Balayage", weld: "Élément mécano-soudé", sheet: "Tôle pliée", import: "Corps importé", draft: "Dépouille",
};
export const featureLabel = t => FEATURE_LABELS[t] || t;

export function resolvePlane(ref, st) {
  if (!ref) return STD_PLANES.front;
  if (ref.kind === "std") return STD_PLANES[ref.std];
  if (ref.kind === "ref") { const p = st.planes[ref.id]; if (!p) throw new Error("Plan de référence introuvable"); return p; }
  if (ref.kind === "face") {
    if (!st.main) throw new Error("Face d'appui introuvable (pas de corps)");
    const face = findFace(st.main, ref, true);
    if (!face) throw new Error("Face d'appui introuvable");
    const c = face.center.toTuple(), n = face.normalAt().toTuple();
    return planeFromNormal(c, n);
  }
  if (ref.kind === "fixed") return ref.plane;
  throw new Error("Plan invalide");
}

export function findFace(shape, ref, planarOnly = false) {
  let best = null, bd = Infinity;
  const vtx = R.makeVertex(ref.p);
  for (const f of shape.faces) {
    if (planarOnly && f.geomType !== "PLANE") continue;
    if (ref.n && f.geomType === "PLANE") { const n = f.normalAt().toTuple(); if (v3.dot(n, ref.n) < 0.99) continue; }
    const d = R.measureDistanceBetween(f, vtx);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}
export function findEdge(shape, p) {
  let best = null, bd = Infinity; const vtx = R.makeVertex(p);
  for (const e of shape.edges) { const d = R.measureDistanceBetween(e, vtx); if (d < bd) { bd = d; best = e; } }
  return bd < 5 ? best : null;
}

function bigLength(st) {
  let L = 2000;
  const all = [st.main, ...st.bodies.map(b => b.shape)].filter(Boolean);
  for (const s of all) { const b = s.boundingBox.bounds; L = Math.max(L, v3.dist(b[0], b[1]) * 3); }
  return L;
}

function applyOp(st, f, tool, op) {
  (st.tools[f.id] ||= []).push({ shape: tool, op });
  if (op === "add") st.main = st.main ? st.main.fuse(tool) : tool;
  else {
    if (!st.main) throw new Error("Aucun corps à enlever");
    st.main = st.main.cut(tool);
  }
}

function sketchOf(st, id) {
  const sk = st.sketches[id];
  if (!sk) throw new Error("Esquisse manquante ou supprimée");
  return sk;
}
function regionOf(sk) {
  const r = sketchRegions(sk.entities);
  if (!r.drawing) throw new Error("L'esquisse ne contient aucun contour fermé");
  return r.drawing;
}

function extrudeTool(sk, off, len) {
  const d = regionOf(sk);
  return d.sketchOnPlane(rPlane(offsetPlane(sk.plane, off))).extrude(len);
}

export const HOLE_STD = {
  M3: { tap: 2.5, clear: 3.4, cb: [6.5, 3.4], cs: 6.5 }, M4: { tap: 3.3, clear: 4.5, cb: [8, 4.4], cs: 8.6 }, M5: { tap: 4.2, clear: 5.5, cb: [10, 5.4], cs: 10.4 },
  M6: { tap: 5, clear: 6.6, cb: [11, 6.4], cs: 12.4 }, M8: { tap: 6.8, clear: 9, cb: [15, 8.6], cs: 16.4 }, M10: { tap: 8.5, clear: 11, cb: [18, 10.6], cs: 20.4 },
  M12: { tap: 10.2, clear: 13.5, cb: [20, 12.6], cs: 24.4 }, M14: { tap: 12, clear: 15.5, cb: [24, 14.6], cs: 27 }, M16: { tap: 14, clear: 17.5, cb: [26, 16.6], cs: 32.4 },
  M20: { tap: 17.5, clear: 22, cb: [33, 20.6], cs: 40.4 },
};

function holeTool(p, n, h, depth) {
  // profil en (r, z) avec z positif = dans la matière
  const r = h.d / 2, e = 0.5;
  const pts = [[0, -e]];
  if (h.kind === "cbore") { pts.push([h.cbD / 2, -e], [h.cbD / 2, h.cbH], [r, h.cbH]); }
  else if (h.kind === "csink") { const R0 = h.csD / 2; const hc = (R0 - r) / Math.tan((h.csA || 90) / 2 * Math.PI / 180); pts.push([R0 + e, -e], [R0, 0], [r, Math.max(hc, 0.01)]); }
  else pts.push([r, -e]);
  pts.push([r, depth]);
  if (h.tip && !h.through) pts.push([0, depth + r / Math.tan(59 * Math.PI / 180)]);
  else pts.push([0, depth]);
  n = v3.norm(n);
  let u = Math.abs(n[1]) < 0.9 ? v3.norm(v3.cross([0, 1, 0], n)) : v3.norm(v3.cross([1, 0, 0], n));
  const vN = v3.cross(n, u);
  const plane = new R.Plane(p, u, vN); // y du plan = cross(vN,u) = -n
  let pen = R.draw(pts[0]);
  for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
  const d = pen.close();
  return d.sketchOnPlane(plane).revolve(n, { origin: p });
}

function axisVec(a) { return { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[a] || [1, 0, 0]; }

// ---------- Tôlerie : profil ouvert -> tôle pliée
export function offsetPolyline(pts, d) {
  if (Math.abs(d) < 1e-9) return pts.map(p => [...p]);
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dir = v2.norm(v2.sub(pts[i + 1], pts[i])); const nL = [-dir[1], dir[0]];
    segs.push([v2.add(pts[i], v2.mul(nL, d)), v2.add(pts[i + 1], v2.mul(nL, d)), dir]);
  }
  const out = [segs[0][0]];
  for (let i = 1; i < segs.length; i++) {
    const [a1, , d1] = segs[i - 1], [a2, , d2] = segs[i];
    const den = v2.cross(d1, d2);
    if (Math.abs(den) < 1e-9) { out.push(segs[i][0]); continue; }
    const t = v2.cross(v2.sub(a2, a1), d2) / den;
    out.push(v2.add(a1, v2.mul(d1, t)));
  }
  out.push(segs[segs.length - 1][1]);
  return out;
}
export function sheetGeometry(pts0, t, r, K, side) {
  const shift = side === "left" ? t / 2 : side === "right" ? -t / 2 : 0;
  const pts = offsetPolyline(pts0, shift);
  const Rm = r + t / 2;
  const n = pts.length;
  const dirs = []; for (let i = 0; i < n - 1; i++) dirs.push(v2.norm(v2.sub(pts[i + 1], pts[i])));
  const bends = [];
  const sbAt = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const a = dirs[i - 1], b = dirs[i];
    const th = Math.acos(Math.max(-1, Math.min(1, v2.dot(a, b))));
    if (th < 1e-6) { bends.push(null); continue; }
    const s = Math.sign(v2.cross(a, b));
    const sb = Rm * Math.tan(th / 2); sbAt[i] = sb;
    const Tin = v2.sub(pts[i], v2.mul(a, sb)), Tout = v2.add(pts[i], v2.mul(b, sb));
    const nLa = [-a[1], a[0]];
    const C = v2.add(Tin, v2.mul(nLa, s * Rm));
    bends.push({ i, th, s, sb, Tin, Tout, C });
  }
  // segments droits rognés
  const straights = [];
  for (let i = 0; i < n - 1; i++) {
    const S = v2.add(pts[i], v2.mul(dirs[i], sbAt[i])), E = v2.sub(pts[i + 1], v2.mul(dirs[i], sbAt[i + 1]));
    const L = v2.dot(v2.sub(E, S), dirs[i]);
    if (L < -1e-6) throw new Error("Segment trop court pour le rayon de pliage (segment " + (i + 1) + ")");
    straights.push({ S, E, L: Math.max(L, 0), dir: dirs[i] });
  }
  const side_ = (k) => { // k=+1 gauche, -1 droite
    const path = [];
    for (let i = 0; i < n - 1; i++) {
      const st = straights[i]; const nL = [-st.dir[1], st.dir[0]];
      const S = v2.add(st.S, v2.mul(nL, k * t / 2)), E = v2.add(st.E, v2.mul(nL, k * t / 2));
      if (i === 0) path.push({ t: "M", p: S });
      path.push({ t: "L", p: E });
      const b = bends[i]; // pli au sommet i+1
      if (i < n - 2 && b) {
        const nextNL = [-dirs[i + 1][1], dirs[i + 1][0]];
        const nS = v2.add(straights[i + 1].S, v2.mul(nextNL, k * t / 2));
        const rho = Rm - b.s * k * t / 2;
        const bis = v2.norm(v2.add(v2.sub(E, b.C), v2.sub(nS, b.C)));
        path.push({ t: "A", p: nS, m: v2.add(b.C, v2.mul(bis, rho)) });
      }
    }
    return path;
  };
  const left = side_(1), right = side_(-1);
  // contour fermé : gauche aller, bout, droite retour
  const flat = straights.reduce((s, x) => s + x.L, 0) + bends.filter(Boolean).reduce((s, b) => s + b.th * (r + K * t), 0);
  // positions des lignes de pli sur le développé
  const flatBends = []; let acc = 0;
  for (let i = 0; i < straights.length; i++) {
    acc += straights[i].L;
    const b = bends[i];
    if (i < straights.length - 1 && b) { const ba = b.th * (r + K * t); flatBends.push({ pos: acc + ba / 2, start: acc, end: acc + ba, angle: b.th * 180 / Math.PI, dir: b.s > 0 ? "haut" : "bas" }); acc += ba; }
  }
  return { left, right, flat, flatBends, straights, bends: bends.filter(Boolean) };
}
function sheetDrawing(g) {
  const L = g.left, Rt = g.right;
  let pen = R.draw(L[0].p);
  for (let i = 1; i < L.length; i++) pen = L[i].t === "A" ? pen.threePointsArcTo(L[i].p, L[i].m) : pen.lineTo(L[i].p);
  // bout -> côté droit en sens inverse
  const rev = [];
  for (let i = Rt.length - 1; i >= 0; i--) rev.push(Rt[i]);
  pen = pen.lineTo(rev[0].p);
  for (let i = 0; i < rev.length - 1; i++) {
    const cur = rev[i], nxt = rev[i + 1];
    if (cur.t === "A") pen = pen.threePointsArcTo(nxt.p, cur.m); else pen = pen.lineTo(nxt.p);
  }
  return pen.close();
}

// ---------- Mécano-soudé
function weldMembers(f, sk, ev, st) {
  const lines = sk.entities.filter(e => e.t === "line" && !e.cons);
  if (!lines.length) throw new Error("L'esquisse ne contient aucune ligne");
  const sec0 = profileSection(f.family, f.size);
  const ns = sk.plane.n;
  const P3 = p => to3D(sk.plane, p);
  const key = p => p.map(x => x.toFixed(3)).join(",");
  const nodes = new Map();
  lines.forEach((l, i) => { for (const p of [l.a, l.b]) { const k = key(p); if (!nodes.has(k)) nodes.set(k, []); nodes.get(k).push(i); } });
  const rot = (ev(f.rot) || 0) * Math.PI / 180;
  const members = [];
  const info = [];
  const dens = st.density;
  lines.forEach((l, i) => {
    const A = P3(l.a), B = P3(l.b);
    const d = v3.norm(v3.sub(B, A)); const L = v3.dist(A, B);
    let x = v3.norm(v3.cross(ns, d)); let y = v3.cross(d, x);
    // rotation du profil autour de son axe
    const xr = v3.add(v3.mul(x, Math.cos(rot)), v3.mul(y, Math.sin(rot)));
    const yr = v3.cross(d, xr);
    const ends = [];
    let ext = Math.max(sec0.w, sec0.h) * 2;
    const extOf = { A: 0, B: 0 };
    for (const [endName, P, other] of [["A", l.a, l.b], ["B", l.b, l.a]]) {
      const lst = nodes.get(key(P));
      if (f.corner === "miter" && lst.length === 2) {
        const j = lst.find(k => k !== i); const o = lines[j];
        const oFar = v2.eq(o.a, P) ? o.b : o.a;
        const u = v3.norm(v3.sub(P3(other), P3(P))), v = v3.norm(v3.sub(P3(oFar), P3(P)));
        const ang = Math.acos(Math.max(-1, Math.min(1, v3.dot(u, v))));
        if (ang > 1e-3 && ang < Math.PI - 1e-3) {
          const m = v3.norm(v3.sub(u, v));
          extOf[endName] = ext;
          // largeur du profil dans le plan du coin
          const e = v3.norm(v3.cross(v3.cross(u, v), u));
          const half = (Math.abs(v3.dot(e, xr)) * sec0.w + Math.abs(v3.dot(e, yr)) * sec0.h) / 2;
          ends.push({ P: P3(P), m, extra: half / Math.tan(ang / 2), cut: 90 - ang / 2 * 180 / Math.PI });
        }
      }
    }
    const origin = v3.sub(A, v3.mul(d, extOf.A));
    const sec = profileSection(f.family, f.size);
    let solid = sec.drawing.sketchOnPlane(new R.Plane(origin, xr, d)).extrude(L + extOf.A + extOf.B);
    for (const e of ends) {
      let px = Math.abs(e.m[1]) < 0.9 ? v3.norm(v3.cross([0, 1, 0], e.m)) : [1, 0, 0];
      const res = solid.cutPlane(new R.Plane(e.P, px, e.m), 0, "positive");
      if (res) solid = res;
    }
    const lengthMax = L + ends.reduce((s, e) => s + e.extra, 0);
    const name = profileName(f.family, f.size);
    members.push({ shape: solid, name: name + " — " + lengthMax.toFixed(1) + " mm", kind: "weld", feature: f.id, color: f.color || "#9aa7b4" });
    info.push({ profile: name, length: lengthMax, cuts: ends.map(e => e.cut), mass: sec0.area * lengthMax * dens / 1e6 });
  });
  return { members, info };
}

const GEOM_HINT = {
  revolve: "Révolution impossible : le profil doit être fermé et ne pas croiser l'axe de révolution.",
  revcut: "Révolution impossible : le profil doit être fermé et ne pas croiser l'axe de révolution.",
  fillet: "Congé impossible : rayon trop grand pour les arêtes choisies, ou arêtes non compatibles.",
  chamfer: "Chanfrein impossible : distance trop grande pour les arêtes choisies.",
  shell: "Coque impossible : épaisseur trop grande, ou géométrie trop complexe (essayez une épaisseur plus faible).",
  draft: "Dépouille impossible sur ces faces avec ce plan neutre.",
  extrude: "Extrusion impossible : vérifiez que l'esquisse est un contour fermé sans chevauchement.",
  cut: "Enlèvement impossible : vérifiez que l'esquisse est un contour fermé et la direction.",
  loft: "Lissage impossible : les profils doivent être fermés, sur des plans différents, avec un nombre de côtés compatible.",
  sweep: "Balayage impossible : le profil doit couper le début de la trajectoire, perpendiculairement.",
  hole: "Perçage impossible à cet endroit.",
  weld: "Profilé impossible à créer sur cette esquisse.",
  sheet: "Tôle impossible : segments trop courts pour le rayon de pliage, ou profil qui se recoupe.",
  lpattern: "Répétition impossible : les occurrences sortent du corps ou se chevauchent mal.",
  cpattern: "Répétition impossible avec ces paramètres.",
  mirror: "Symétrie impossible avec ce plan.",
};
function friendlyError(f, e) {
  const m = e && typeof e.message === "string" ? e.message : "";
  if (m && !/^\[object|WebAssembly|RuntimeError|unreachable|memory access|null function|Cannot read|undefined/i.test(m)) return m;
  return GEOM_HINT[f.type] || "Opération géométrique impossible avec ces paramètres.";
}

// ---------- Reconstruction complète
export function rebuild(doc) {
  const ev = makeEval(doc.vars);
  const st = { main: null, bodies: [], errors: {}, tools: {}, planes: {}, sketches: {}, info: {}, density: (doc.material?.density ?? 7.85) * 1000 /* kg/m3 → g/mm3 conv later */ };
  st.density = (doc.material?.density ?? 7.85); // g/cm3 ; masse(kg) = mm3 * dens / 1e6
  const stop = doc.rollback ?? doc.features.length;
  for (let i = 0; i < Math.min(stop, doc.features.length); i++) {
    const f = doc.features[i];
    if (f.suppressed) continue;
    try { applyFeature(f, st, ev, doc); }
    catch (e) { st.errors[f.id] = friendlyError(f, e); console.warn(f, e); }
  }
  return st;
}

function applyFeature(f, st, ev, doc) {
  switch (f.type) {
    case "plane": {
      let base = resolvePlane(f.base, st);
      const ang = (ev(f.angle) || 0) * Math.PI / 180;
      if (ang) { const y = planeY(base); base = { o: base.o, x: base.x, n: v3.norm(v3.add(v3.mul(base.n, Math.cos(ang)), v3.mul(y, -Math.sin(ang)))) }; }
      st.planes[f.id] = offsetPlane(base, ev(f.offset) || 0);
      break;
    }
    case "sketch": {
      st.sketches[f.id] = { plane: resolvePlane(f.plane, st), entities: f.entities || [] };
      break;
    }
    case "extrude": case "cut": {
      const sk = sketchOf(st, f.sketch);
      const op = f.type === "extrude" ? "add" : "cut";
      const sign = (f.reverse ? -1 : 1) * (op === "cut" ? -1 : 1); // enlèvement : vers la matière par défaut
      const big = bigLength(st);
      let d1 = f.end === "through" ? big : ev(f.depth);
      if (!(Math.abs(d1) > 1e-6)) throw new Error("Profondeur nulle");
      let tool;
      if (f.end === "mid") tool = extrudeTool(sk, -d1 / 2, d1);
      else if (f.end === "throughAll2") tool = extrudeTool(sk, -big, 2 * big);
      else {
        tool = extrudeTool(sk, 0, sign * d1);
        if (f.dir2) {
          const d2 = f.end2 === "through" ? big : ev(f.depth2);
          if (d2 > 0) tool = tool.fuse(extrudeTool(sk, 0, -sign * d2));
        }
      }
      if (f.draft && ev(f.draft) && f.end !== "mid") {
        // dépouille approximée : rétrécissement linéaire
        const d = regionOf(sk);
        const a = ev(f.draft) * Math.PI / 180;
        const bb = d.boundingBox; const size = Math.max(bb.width, bb.height) / 2;
        const endFactor = Math.max(0.01, (size - Math.abs(d1) * Math.tan(a)) / size);
        tool = d.sketchOnPlane(rPlane(sk.plane)).extrude(sign * d1, { extrusionProfile: { profile: "linear", endFactor } });
      }
      applyOp(st, f, tool, op);
      if (op === "add" && f.thin) { /* réservé */ }
      break;
    }
    case "revolve": case "revcut": {
      const sk = sketchOf(st, f.sketch);
      let axis = sk.entities.find(e => e.id === f.axis) || sk.entities.find(e => e.t === "line" && e.cons);
      const a2 = axis ? axis.a : [0, 0], b2 = axis ? axis.b : [0, 1];
      const a3 = to3D(sk.plane, a2), dir = v3.norm(v3.sub(to3D(sk.plane, b2), a3));
      const ang = ev(f.angle) || 360;
      const d = regionOf(sk);
      const sh = d.sketchOnPlane(rPlane(sk.plane)).revolve(f.reverse ? v3.mul(dir, -1) : dir, { origin: a3, angle: Math.min(ang, 360) });
      applyOp(st, f, sh, f.type === "revolve" ? "add" : "cut");
      break;
    }
    case "fillet": case "chamfer": {
      if (!st.main) throw new Error("Aucun corps");
      const edges = (f.edges || []).map(r => findEdge(st.main, r.p)).filter(Boolean);
      if (!edges.length) throw new Error("Aucune arête sélectionnée");
      const v = ev(f.type === "fillet" ? f.radius : f.dist);
      const res = f.type === "fillet" ? st.main.fillet(v, e => e.inList(edges)) : st.main.chamfer(v, e => e.inList(edges));
      if (!res) throw new Error("Opération impossible");
      st.main = res;
      break;
    }
    case "shell": {
      if (!st.main) throw new Error("Aucun corps");
      const faces = (f.faces || []).map(r => findFace(st.main, r)).filter(Boolean);
      const t = ev(f.thickness);
      st.main = st.main.shell(f.outward ? -t : t, fc => fc.inList(faces));
      break;
    }
    case "draft": {
      if (!st.main) throw new Error("Aucun corps");
      const faces = (f.faces || []).map(r => findFace(st.main, r)).filter(Boolean);
      const np = resolvePlane(f.neutral || { kind: "std", std: "top" }, st);
      st.main = st.main.draft(ev(f.angle), fc => fc.inList(faces), rPlane(np));
      break;
    }
    case "hole": {
      if (!st.main) throw new Error("Aucun corps");
      if (!f.points?.length) throw new Error("Aucune position de perçage");
      const big = bigLength(st);
      const h = { kind: f.kind, d: ev(f.d), cbD: ev(f.cbD), cbH: ev(f.cbH), csD: ev(f.csD), csA: ev(f.csA) || 90, tip: f.tip, through: f.end === "through" };
      const depth = f.end === "through" ? big : ev(f.depth);
      let tool = null;
      for (const p of f.points) { const t = holeTool(p, f.face.n, h, depth); tool = tool ? tool.fuse(t) : t; }
      applyOp(st, f, tool, "cut");
      break;
    }
    case "lpattern": case "cpattern": case "mirror": {
      if (!st.main) throw new Error("Aucun corps");
      const srcTools = [];
      if (f.type === "mirror" && f.body) srcTools.push({ shape: st.main, op: "add" });
      else for (const id of f.features || []) { const t = st.tools[id]; if (!t) throw new Error("Fonction à répéter non valide (seules les fonctions de volume / perçage)"); srcTools.push(...t); }
      if (!srcTools.length) throw new Error("Aucune fonction sélectionnée");
      const instances = [];
      if (f.type === "lpattern") {
        const d1 = v3.mul(axisVec(f.axis1), f.rev1 ? -1 : 1), s1 = ev(f.spacing1), n1 = Math.max(1, Math.round(ev(f.count1)));
        const useD2 = f.dir2;
        const d2 = v3.mul(axisVec(f.axis2), f.rev2 ? -1 : 1), s2 = ev(f.spacing2), n2 = useD2 ? Math.max(1, Math.round(ev(f.count2))) : 1;
        for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) if (i || j) instances.push(s => s.clone().translate(v3.add(v3.mul(d1, s1 * i), v3.mul(d2, s2 * j))));
      } else if (f.type === "cpattern") {
        const n = Math.max(1, Math.round(ev(f.count))); const tot = ev(f.angle) || 360;
        const step = (Math.abs(tot - 360) < 1e-6) ? 360 / n : tot / Math.max(1, n - 1);
        const ax = axisVec(f.axis); const org = f.origin || [0, 0, 0];
        for (let i = 1; i < n; i++) instances.push(s => s.clone().rotate(step * i * (f.rev ? -1 : 1), org, ax));
      } else {
        const p = resolvePlane(f.plane || { kind: "std", std: "right" }, st);
        instances.push(s => s.clone().mirror(p.n, p.o));
      }
      for (const src of srcTools) for (const mk of instances) applyOp(st, f, mk(src.shape), src.op);
      break;
    }
    case "loft": {
      const sks = (f.sketches || []).map(id => sketchOf(st, id));
      if (sks.length < 2) throw new Error("Il faut au moins 2 esquisses");
      const sk3 = sks.map(sk => regionOf(sk).sketchOnPlane(rPlane(sk.plane)));
      const sh = sk3[0].loftWith(sk3.slice(1), { ruled: !!f.ruled });
      applyOp(st, f, sh, f.op === "cut" ? "cut" : "add");
      break;
    }
    case "sweep": {
      const prof = sketchOf(st, f.profile), path = sketchOf(st, f.path);
      const { loops, open } = buildChains(path.entities);
      const chain = open[0] || loops[0];
      if (!chain) throw new Error("Trajectoire introuvable dans l'esquisse");
      let pen = R.draw(startOf(chain[0]));
      for (const c of chain) pen = c.e.t === "line" ? pen.lineTo(endOf(c)) : pen.threePointsArcTo(endOf(c), c.e.m);
      const spine = (open[0] ? pen.done() : pen.close()).sketchOnPlane(rPlane(path.plane)).wire;
      // profils : chaque contour fermé balayé, puis combinaison
      const items = profileItems(prof.entities);
      if (!items.length) throw new Error("Le profil doit être fermé");
      let res = null;
      for (const it of items) {
        const w = it.make().sketchOnPlane(rPlane(prof.plane)).wire;
        const s = R.genericSweep(w, spine, { transitionMode: "right" });
        res = !res ? s : (it.depth % 2 === 0 ? res.fuse(s) : res.cut(s));
      }
      applyOp(st, f, res, f.op === "cut" ? "cut" : "add");
      break;
    }
    case "weld": {
      const sk = sketchOf(st, f.sketch);
      const { members, info } = weldMembers(f, sk, ev, st);
      st.bodies.push(...members);
      st.info[f.id] = info;
      break;
    }
    case "sheet": {
      const sk = sketchOf(st, f.sketch);
      const { open } = buildChains(sk.entities.filter(e => e.t === "line"));
      if (!open.length) throw new Error("La tôle pliée nécessite un profil ouvert (lignes)");
      const pts = [startOf(open[0][0]), ...open[0].map(endOf)];
      const t = ev(f.thickness), r = ev(f.radius), K = ev(f.k), W = ev(f.width);
      const g = sheetGeometry(pts, t, r, K, f.side);
      const d = sheetDrawing(g);
      const off = f.mid ? -W / 2 : 0;
      const sh = d.sketchOnPlane(rPlane(offsetPlane(sk.plane, off))).extrude((f.reverse && !f.mid) ? -W : W);
      applyOp(st, f, sh, "add");
      st.info[f.id] = { flat: g.flat, width: W, bends: g.flatBends, t, r, K };
      break;
    }
    case "import": {
      const sh = importCache.get(f.id);
      if (!sh) throw new Error("Fichier importé non chargé");
      applyOp(st, f, sh.clone(), "add");
      break;
    }
    default: throw new Error("Type de fonction inconnu : " + f.type);
  }
}

function profileItems(entities) {
  const { loops } = buildChains(entities);
  const items = [];
  for (const l of loops) items.push({ poly: chainPolygon(l), chain: l });
  for (const e of entities) if (!e.cons && (e.t === "circle" || e.t === "slot")) items.push({ poly: entityPolygon(e), e });
  items.forEach(it => it.area = Math.abs(polyArea(it.poly)));
  items.sort((a, b) => b.area - a.area);
  for (const it of items) { it.depth = 0; for (const o of items) if (o !== it && o.area > it.area && pointInPoly(it.poly[0], o.poly)) it.depth++; }
  for (const it of items) it.make = () => it.chain ? sketchRegions(it.chain.map(c => c.e)).drawing : sketchRegions([it.e]).drawing;
  return items;
}

// Propriétés de masse
export function massProps(st, density) {
  const shapes = [st.main, ...st.bodies.map(b => b.shape)].filter(Boolean);
  let V = 0, A = 0, cx = 0, cy = 0, cz = 0;
  for (const s of shapes) {
    const vp = R.measureShapeVolumeProperties(s); const sp = R.measureShapeSurfaceProperties(s);
    V += vp.volume; A += sp.area; const c = vp.centerOfMass; cx += c[0] * vp.volume; cy += c[1] * vp.volume; cz += c[2] * vp.volume;
  }
  if (!V) return null;
  return { volume: V, area: A, mass: V * density / 1e6, cog: [cx / V, cy / V, cz / V] };
}
export function allShapes(st) { return [st.main, ...st.bodies.map(b => b.shape)].filter(Boolean); }
export function exportCompound(st) {
  const shapes = allShapes(st);
  if (!shapes.length) return null;
  return shapes.length === 1 ? shapes[0] : R.makeCompound(shapes);
}
