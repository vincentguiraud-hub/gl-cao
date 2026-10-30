// Tests du moteur : node tests/engine.mjs
import opencascade from "replicad-opencascadejs";
import { R } from "../src/occ.js";
import { rebuild, massProps } from "../src/cad.js";
R.setOC(await opencascade());
let id = 0; const nid = () => "e" + (id++);
const L = (a, b, cons) => ({ id: nid(), t: "line", a, b, cons });
const rect = (x0, y0, x1, y1) => { const g = nid(); return [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]].map(([a, b]) => ({ id: nid(), t: "line", a, b, g, gk: "rect" })); };
const C = (c, r) => ({ id: nid(), t: "circle", c, r });
const sk = (id, plane, entities) => ({ id, type: "sketch", name: id, plane, entities });
const top = { kind: "std", std: "top" }, front = { kind: "std", std: "front" }, right = { kind: "std", std: "right" };
const base = () => [sk("s1", top, rect(-50, -30, 50, 30)), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 20 }];
const cases = {
  "extrusion simple": [...base()],
  "extrusion plan milieu": [sk("s1", top, rect(-50, -30, 50, 30)), { id: "e1", type: "extrude", sketch: "s1", end: "mid", depth: 20 }],
  "extrusion 2 directions": [sk("s1", top, rect(-50, -30, 50, 30)), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 20, dir2: true, end2: "blind", depth2: 5 }],
  "extrusion dépouille": [sk("s1", top, rect(-50, -30, 50, 30)), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 20, draft: 5 }],
  "extrusion avec trou": [sk("s1", top, [...rect(-50, -30, 50, 30), C([0, 0], 10)]), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 20 }],
  "îlot dans trou": [sk("s1", top, [...rect(-50, -30, 50, 30), C([0, 0], 20), C([0, 0], 8)]), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 20 }],
  "profils séparés": [sk("s1", top, [...rect(-50, -30, -10, 30), ...rect(10, -30, 50, 30)]), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 20 }],
  "contours qui se chevauchent": [sk("s1", top, [...rect(-50, -30, 10, 30), C([10, 0], 20)]), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 20 }],
  "arc dans contour": [sk("s1", front, [L([0, 0], [100, 0]), L([100, 0], [100, 50]), { id: nid(), t: "arc", a: [100, 50], b: [0, 50], m: [50, 80] }, L([0, 50], [0, 0])]), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 10 }],
  "rainure": [sk("s1", top, [{ id: nid(), t: "slot", a: [-20, 0], b: [20, 0], r: 6 }]), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 5 }],
  "esquisse sur face + enlèvement": [...base(), sk("s2", { kind: "face", p: [0, 20, 0], n: [0, 1, 0] }, [C([20, 0], 5)]), { id: "c1", type: "cut", sketch: "s2", end: "blind", depth: 5 }],
  "enlèvement à travers": [...base(), sk("s2", { kind: "face", p: [0, 20, 0], n: [0, 1, 0] }, [C([20, 0], 5)]), { id: "c1", type: "cut", sketch: "s2", end: "through" }],
  "enlèvement 2 dir plan std": [...base(), sk("s2", front, [C([0, 10], 5)]), { id: "c1", type: "cut", sketch: "s2", end: "throughAll2" }],
  "esquisse sur face latérale": [...base(), sk("s2", { kind: "face", p: [50, 10, 0], n: [1, 0, 0] }, [C([0, 10], 4)]), { id: "e2", type: "extrude", sketch: "s2", end: "blind", depth: 15 }],
  "révolution axe auto": [sk("s1", front, [L([0, 0], [0, 10], true), ...rect(10, 0, 30, 40)]), { id: "r1", type: "revolve", sketch: "s1", angle: 360 }],
  "révolution 180": [sk("s1", front, [L([0, 0], [0, 10], true), ...rect(10, 0, 30, 40)]), { id: "r1", type: "revolve", sketch: "s1", angle: 180 }],
  "révolution sans axe": [sk("s1", front, rect(10, 0, 30, 40)), { id: "r1", type: "revolve", sketch: "s1", angle: 360 }],
  "enlèvement révolution": [...base(), sk("s2", front, [L([0, 0], [0, 10], true), ...rect(20, 15, 30, 25)]), { id: "r2", type: "revcut", sketch: "s2", angle: 360 }],
  "congé": [...base(), { id: "f1", type: "fillet", edges: [{ p: [50, 10, 30] }, { p: [-50, 10, 30] }], radius: 5 }],
  "congé trop grand": [...base(), { id: "f1", type: "fillet", edges: [{ p: [50, 10, 30] }], radius: 50 }],
  "chanfrein": [...base(), { id: "f1", type: "chamfer", edges: [{ p: [0, 20, 30] }], dist: 3 }],
  "coque": [...base(), { id: "sh", type: "shell", faces: [{ p: [0, 20, 0], n: [0, 1, 0] }], thickness: 2 }],
  "coque ext": [...base(), { id: "sh", type: "shell", faces: [{ p: [0, 20, 0], n: [0, 1, 0] }], thickness: 2, outward: true }],
  "dépouille": [...base(), { id: "d", type: "draft", faces: [{ p: [50, 10, 0], n: [1, 0, 0] }], angle: 5, neutral: top }],
  "perçage simple": [...base(), { id: "h", type: "hole", face: { p: [0, 20, 0], n: [0, 1, 0] }, points: [[20, 20, 10]], kind: "simple", d: 9, end: "through" }],
  "perçage borgne pointe": [...base(), { id: "h", type: "hole", face: { p: [0, 20, 0], n: [0, 1, 0] }, points: [[20, 20, 10]], kind: "simple", d: 6.8, end: "blind", depth: 12, tip: true }],
  "lamage": [...base(), { id: "h", type: "hole", face: { p: [0, 20, 0], n: [0, 1, 0] }, points: [[20, 20, 10]], kind: "cbore", d: 9, cbD: 15, cbH: 8.6, end: "through" }],
  "fraisure": [...base(), { id: "h", type: "hole", face: { p: [0, 20, 0], n: [0, 1, 0] }, points: [[20, 20, 10]], kind: "csink", d: 9, csD: 16.4, csA: 90, end: "through" }],
  "perçage face latérale": [...base(), { id: "h", type: "hole", face: { p: [50, 10, 0], n: [1, 0, 0] }, points: [[50, 10, 0]], kind: "simple", d: 6, end: "blind", depth: 20 }],
  "répétition linéaire": [...base(), { id: "h", type: "hole", face: { p: [0, 20, 0], n: [0, 1, 0] }, points: [[-40, 20, -20]], kind: "simple", d: 6, end: "through" }, { id: "p", type: "lpattern", features: ["h"], axis1: "X", spacing1: 20, count1: 5, dir2: true, axis2: "Z", spacing2: 40, count2: 2 }],
  "répétition circulaire": [sk("s1", top, [C([0, 0], 50)]), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 10 }, { id: "h", type: "hole", face: { p: [0, 10, 0], n: [0, 1, 0] }, points: [[35, 10, 0]], kind: "simple", d: 8, end: "through" }, { id: "p", type: "cpattern", features: ["h"], axis: "Y", count: 6, angle: 360 }],
  "symétrie fonction": [...base(), sk("s2", { kind: "face", p: [0, 20, 0], n: [0, 1, 0] }, [C([30, 0], 5)]), { id: "e2", type: "extrude", sketch: "s2", end: "blind", depth: 10 }, { id: "m", type: "mirror", features: ["e2"], plane: right }],
  "symétrie corps": [...base(), { id: "m", type: "mirror", body: true, plane: { kind: "std", std: "front" } }],
  "plan décalé + esquisse": [...base(), { id: "pl", type: "plane", base: top, offset: 50, angle: 0 }, sk("s3", { kind: "ref", id: "pl" }, [C([0, 0], 10)]), { id: "e3", type: "extrude", sketch: "s3", end: "blind", depth: 10 }],
  "plan incliné": [{ id: "pl", type: "plane", base: front, offset: 0, angle: 30 }, sk("s3", { kind: "ref", id: "pl" }, rect(-10, -10, 10, 10)), { id: "e3", type: "extrude", sketch: "s3", end: "blind", depth: 10 }],
  "lissage": [sk("s1", top, rect(-30, -30, 30, 30)), { id: "pl", type: "plane", base: top, offset: 60 }, sk("s2", { kind: "ref", id: "pl" }, [C([0, 0], 15)]), { id: "l", type: "loft", sketches: ["s1", "s2"], op: "add" }],
  "balayage": [sk("p", front, [L([0, 0], [0, 100]), L([0, 100], [100, 100])]), sk("pr", top, [C([0, 0], 8), C([0, 0], 6)]), { id: "sw", type: "sweep", profile: "pr", path: "p", op: "add" }],
  "balayage arc": [sk("p", front, [L([0, 0], [0, 100]), { id: nid(), t: "arc", a: [0, 100], b: [50, 150], m: [14.64, 135.36] }]), sk("pr", top, [C([0, 0], 8)]), { id: "sw", type: "sweep", profile: "pr", path: "p", op: "add" }],
  "mécano carré onglet": [sk("w", front, [L([0, 0], [1000, 0]), L([1000, 0], [1000, 800]), L([1000, 800], [0, 800]), L([0, 800], [0, 0])]), { id: "m", type: "weld", sketch: "w", family: "tube_carre", size: "40x40x2", corner: "miter", rot: 0 }],
  "mécano angle 120°": [sk("w", front, [L([0, 0], [500, 0]), L([500, 0], [750, 433])]), { id: "m", type: "weld", sketch: "w", family: "tube_rect", size: "60x40x3", corner: "miter", rot: 0 }],
  "mécano IPE HEA UPN cornière": [sk("w", top, [L([0, 0], [1000, 0])]), { id: "a", type: "weld", sketch: "w", family: "ipe", size: "160", corner: "none" }, { id: "b", type: "weld", sketch: "w", family: "hea", size: "200", corner: "none" }, { id: "c", type: "weld", sketch: "w", family: "upn", size: "120", corner: "none" }, { id: "d", type: "weld", sketch: "w", family: "corniere", size: "50x5", corner: "none" }, { id: "e", type: "weld", sketch: "w", family: "te", size: "40x5", corner: "none" }, { id: "f", type: "weld", sketch: "w", family: "tube_rond", size: "42.4x2.6", corner: "none" }, { id: "g", type: "weld", sketch: "w", family: "plat", size: "40x5", corner: "none" }],
  "mécano en T": [sk("w", front, [L([0, 0], [1000, 0]), L([500, 0], [500, 600])]), { id: "m", type: "weld", sketch: "w", family: "tube_carre", size: "40x40x2", corner: "miter" }],
  "tôle pliée U": [sk("t", front, [L([0, 80], [0, 0]), L([0, 0], [120, 0]), L([120, 0], [120, 25])]), { id: "t1", type: "sheet", sketch: "t", thickness: 3, radius: 3, k: 0.4, width: 100, side: "left", mid: true }],
  "tôle pliée Z angle 45": [sk("t", front, [L([0, 0], [100, 0]), L([100, 0], [150, 50]), L([150, 50], [250, 50])]), { id: "t1", type: "sheet", sketch: "t", thickness: 2, radius: 2, k: 0.4, width: 50, side: "mid" }],
  "tôle droite (sans pli)": [sk("t", front, [L([0, 0], [100, 0])]), { id: "t1", type: "sheet", sketch: "t", thickness: 2, radius: 2, k: 0.4, width: 50, side: "mid" }],
  "variables": [sk("s1", top, rect(-50, -30, 50, 30)), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: "EP*2" }],
};
let fails = 0;
for (const [name, features] of Object.entries(cases)) {
  const t0 = Date.now();
  const st = rebuild({ vars: { EP: 6 }, material: { density: 7.85 }, features });
  const errs = Object.entries(st.errors);
  const mp = (st.main || st.bodies.length) ? massProps(st, 7.85) : null;
  const ok = !errs.length && mp && mp.volume > 0;
  if (!ok) fails++;
  console.log((ok ? "OK  " : "ERR ") + name.padEnd(32) + (mp ? `V=${mp.volume.toFixed(0)} ` : "") + `${Date.now() - t0}ms ` + errs.map(([k, v]) => k + ": " + v).join(" | "));
}
console.log("échecs :", fails);
// ---- fonctions v1.3
const more = {
  "paroi mince ouverte": [sk("s1", top, [L([0, 0], [100, 0]), L([100, 0], [100, 60]), L([100, 60], [160, 60])]), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 50, thin: true, thinT: 3, thinSide: "mid" }],
  "paroi mince fermée": [sk("s1", top, rect(-50, -30, 50, 30)), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 50, thin: true, thinT: 2, thinSide: "left" }],
  "couper par plan": [...base(), { id: "sp", type: "split", plane: right, offset: 10 }],
  "déplacer corps": [...base(), { id: "mv", type: "movebody", dx: 100, ry: 45 }],
  "copier corps x3": [...base(), { id: "mv", type: "movebody", dx: 150, copy: true, count: 3 }],
  "insérer pièce": [{ id: "pp", type: "part", data: { features: base(), material: { density: 7.85 } }, x: 200, rz: 90, count: 2, px: 0, py: 0, pz: 100 }],
  "perçages depuis esquisse": [...base(), sk("hp", { kind: "face", p: [0, 20, 0], n: [0, 1, 0] }, [{ id: "pt1", t: "point", p: [20, 10] }, { id: "pt2", t: "point", p: [-20, 10] }, C([0, -10], 3)]), { id: "h", type: "hole", ptsSketch: "hp", useCircles: true, kind: "simple", d: 6, end: "through" }],
};
let fails2 = 0;
for (const [name, features] of Object.entries(more)) {
  const st = rebuild({ vars: { EP: 6 }, material: { density: 7.85 }, features });
  const errs = Object.entries(st.errors); const mp = (st.main || st.bodies.length) ? massProps(st, 7.85) : null;
  const ok = !errs.length && mp && mp.volume > 0; if (!ok) fails2++;
  console.log((ok ? "OK  " : "ERR ") + name.padEnd(32) + (mp ? `V=${mp.volume.toFixed(0)} corps=${st.bodies.length}` : "") + " " + errs.map(([k, v]) => k + ": " + v).join(" | "));
}
console.log("échecs v1.3 :", fails2);
{
  const { flatHoles } = await import("../src/cad.js");
  const feats = [sk("t", front, [L([0, 80], [0, 0]), L([0, 0], [120, 0]), L([120, 0], [120, 25])]), { id: "t1", type: "sheet", sketch: "t", thickness: 3, radius: 3, k: 0.4, width: 100, side: "left", mid: true },
    { id: "h", type: "hole", face: { p: [60, 0, 0], n: [0, -1, 0] }, points: [[40, 0, 25], [80, 0, -25]], kind: "simple", d: 11, end: "through" }];
  const doc = { vars: {}, material: { density: 7.85 }, features: feats };
  const st = rebuild(doc); const fh = flatHoles(doc, st, "t1");
  console.log((fh.length === 2 ? "OK  " : "ERR ") + "perçages sur développé " + JSON.stringify(fh.map(h => [h.x.toFixed(2), h.y.toFixed(2), h.d])) + " développé=" + st.info.t1.flat.toFixed(2));
  const w = rebuild({ vars: {}, material: { density: 7.85 }, features: [sk("w", front, [L([0, 0], [500, 0]), L([500, 0], [500, 300])]), { id: "m", type: "weld", sketch: "w", family: "tube_carre", size: "40x40x2", corner: "miter", caps: true, capT: 3 }] });
  console.log((w.bodies.length === 4 && !Object.keys(w.errors).length ? "OK  " : "ERR ") + "embouts mécano corps=" + w.bodies.length + " " + JSON.stringify(w.errors));
}
{
  // congé qui doit survivre à un changement de dimensions
  const { edgeSignature } = await import("../src/cad.js");
  const mk = w => [sk("s1", top, rect(-w / 2, -30, w / 2, 30)), { id: "e1", type: "extrude", sketch: "s1", end: "blind", depth: 20 }];
  const st0 = rebuild({ vars: {}, material: { density: 7.85 }, features: mk(100) });
  const eds = st0.main.edges.filter(e => { const m = e.pointAt(0.5).toTuple(); return Math.abs(m[0] - 50) < 1e-6 && Math.abs(m[2] - 30) < 1e-6; });
  const sig = edgeSignature(st0.main, eds[0], eds[0].pointAt(0.5).toTuple());
  for (const w of [100, 160, 60]) {
    const st = rebuild({ vars: {}, material: { density: 7.85 }, features: [...mk(w), { id: "f", type: "fillet", edges: [sig], radius: 5 }] });
    console.log((!Object.keys(st.errors).length ? "OK  " : "ERR ") + "congé robuste largeur " + w + " " + JSON.stringify(st.errors));
  }
}
{
  // perçage, esquisse et enlèvement sur un tube mécano-soudé
  const w = [sk("w", front, [L([0, 0], [1000, 0])]), { id: "m", type: "weld", sketch: "w", family: "tube_carre", size: "40x40x2", corner: "none" }];
  const t1 = rebuild({ vars: {}, material: { density: 7.85 }, features: [...w, { id: "h", type: "hole", face: { p: [500, 20, 0], n: [0, 1, 0] }, points: [[200, 20, 0], [800, 20, 0]], kind: "simple", d: 9, end: "through" }] });
  const v0 = rebuild({ vars: {}, material: { density: 7.85 }, features: w });
  const m0 = massProps(v0, 7.85).volume, m1 = massProps(t1, 7.85).volume;
  console.log((!Object.keys(t1.errors).length && m1 < m0 ? "OK  " : "ERR ") + "perçage dans un tube " + (m0 - m1).toFixed(0) + " " + JSON.stringify(t1.errors));
  const t2 = rebuild({ vars: {}, material: { density: 7.85 }, features: [...w, sk("s2", { kind: "face", p: [500, 20, 0], n: [0, 1, 0] }, [{ id: "sl", t: "slot", a: [100, 0], b: [200, 0], r: 5 }]), { id: "c", type: "cut", sketch: "s2", end: "blind", depth: 5 }] });
  console.log((!Object.keys(t2.errors).length && massProps(t2, 7.85).volume < m0 ? "OK  " : "ERR ") + "esquisse + enlèvement sur un tube " + JSON.stringify(t2.errors));
  const t3 = rebuild({ vars: {}, material: { density: 7.85 }, features: [...w, sk("s3", top, rect(-50, -50, 50, 50)), { id: "e", type: "extrude", sketch: "s3", end: "blind", depth: 10 }, sk("s4", top, rect(-10, -10, 10, 10)), { id: "c2", type: "cut", sketch: "s4", end: "throughAll2" }] });
  console.log((Object.keys(t3.errors).length === 0 ? "OK  " : "ERR ") + "enlèvement à travers corps + tube " + JSON.stringify(t3.errors));
}
