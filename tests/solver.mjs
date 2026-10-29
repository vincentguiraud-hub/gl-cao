import { solveSketch, sketchDOF } from "../src/solver.js";
let fails = 0; const ok = (n, c, info = "") => { console.log((c ? "OK  " : "ERR ") + n + " " + info); if (!c) fails++; };
const near = (a, b, t = 1e-4) => Math.abs(a - b) < t;
// rectangle avec h/v + longueur
let E = [{ id: "1", t: "line", a: [0, 0], b: [100, 2] }, { id: "2", t: "line", a: [100, 2], b: [98, 50] }, { id: "3", t: "line", a: [98, 50], b: [3, 51] }, { id: "4", t: "line", a: [3, 51], b: [0, 0] }];
let C = [{ t: "h", e: "1" }, { t: "v", e: "2" }, { t: "h", e: "3" }, { t: "v", e: "4" }, { t: "len", e: "1", val: 120 }, { t: "len", e: "2", val: 60 }];
let r = solveSketch(E, C, { dof: true });
ok("rectangle", r.ok && near(E[0].b[0], 120) && near(E[1].b[1], 60) && near(E[2].b[0], 0), JSON.stringify(E.map(e => [e.a, e.b])) + " dof=" + r.dof);
ok("rectangle totalement contraint", r.dof === 0, "dof=" + r.dof);
// parallèle / perpendiculaire / angle
E = [{ id: "a", t: "line", a: [0, 0], b: [100, 0] }, { id: "b", t: "line", a: [0, 10], b: [80, 40] }];
r = solveSketch(E, [{ t: "h", e: "a" }, { t: "par", e1: "a", e2: "b" }]); ok("parallèle", r.ok && near(E[1].a[1], E[1].b[1]));
E[1].b = [80, 40]; r = solveSketch(E, [{ t: "h", e: "a" }, { t: "perp", e1: "a", e2: "b" }]); ok("perpendiculaire", r.ok && near(E[1].a[0], E[1].b[0]));
E[1].b = [80, 40]; r = solveSketch(E, [{ t: "h", e: "a" }, { t: "angle", e1: "a", e2: "b", val: 30 }]); const ang = Math.atan2(E[1].b[1] - E[1].a[1], E[1].b[0] - E[1].a[0]) * 180 / Math.PI; ok("angle 30", r.ok && near(ang, 30, 1e-3), ang);
// tangence ligne-cercle, égalité, concentrique
E = [{ id: "l", t: "line", a: [0, 0], b: [100, 0] }, { id: "c", t: "circle", c: [50, 30], r: 10 }, { id: "c2", t: "circle", c: [80, 60], r: 5 }];
r = solveSketch(E, [{ t: "h", e: "l" }, { t: "tan", e1: "l", e2: "c" }, { t: "equal", e1: "c", e2: "c2" }, { t: "rad", e: "c", val: 20 }]);
ok("tangente + égale + rayon", r.ok && near(E[1].r, 20) && near(E[2].r, 20) && near(Math.abs(E[1].c[1]), 20), JSON.stringify(E[1]));
r = solveSketch(E, [{ t: "conc", e1: "c", e2: "c2" }]); ok("concentrique", r.ok && near(E[1].c[0], E[2].c[0]) && near(E[1].c[1], E[2].c[1]));
// point milieu, sur ligne, distance
E = [{ id: "l", t: "line", a: [0, 0], b: [100, 0] }, { id: "p", t: "point", p: [30, 20] }];
r = solveSketch(E, [{ t: "mid", p: { e: "p", k: "p" }, e: "l" }]); ok("point milieu", r.ok && near(E[1].p[0], (E[0].a[0] + E[0].b[0]) / 2) && near(E[1].p[1], (E[0].a[1] + E[0].b[1]) / 2));
E[1].p = [30, 20]; r = solveSketch(E, [{ t: "dist", p1: { e: "l", k: "a" }, p2: { e: "p", k: "p" }, val: 50, mode: "h" }]); ok("distance horizontale", r.ok && near(Math.abs(E[1].p[0]), 50));
// origine fixe
E = [{ id: "l", t: "line", a: [0, 0], b: [100, 5] }]; r = solveSketch(E, [{ t: "h", e: "l" }, { t: "len", e: "l", val: 40 }], { dof: true }); ok("origine fixe", r.ok && near(E[0].a[0], 0) && near(E[0].b[0], 40), "dof=" + r.dof);
// glisser avec contraintes
E = [{ id: "1", t: "line", a: [0, 0], b: [100, 0] }, { id: "2", t: "line", a: [100, 0], b: [100, 50] }, { id: "3", t: "line", a: [100, 50], b: [0, 50] }, { id: "4", t: "line", a: [0, 50], b: [0, 0] }];
C = [{ t: "h", e: "1" }, { t: "v", e: "2" }, { t: "h", e: "3" }, { t: "v", e: "4" }];
r = solveSketch(E, C, { drag: { e: E[1], k: "b", to: [130, 70] } }); ok("glisser coin rectangle", r.ok && near(E[1].b[0], 130, 0.5) && near(E[1].b[1], 70, 0.5) && near(E[0].b[0], E[1].b[0]), JSON.stringify(E[1].b));
// arc tangent à une ligne
E = [{ id: "l", t: "line", a: [0, 0], b: [100, 0] }, { id: "ar", t: "arc", a: [100, 0], b: [150, 40], m: [135, 10] }];
r = solveSketch(E, [{ t: "tan", e1: "l", e2: "ar" }, { t: "rad", e: "ar", val: 50 }]); ok("arc tangent + rayon", r.ok, JSON.stringify(E[1]));
// conflit
E = [{ id: "l", t: "line", a: [0, 0], b: [100, 0] }]; r = solveSketch(E, [{ t: "h", e: "l" }, { t: "v", e: "l" }, { t: "len", e: "l", val: 50 }]); ok("conflit détecté", !r.ok);
// performances
E = []; C = []; for (let i = 0; i < 30; i++) { const y = i * 10; const g = [{ id: "a" + i, t: "line", a: [10, y + 1], b: [60, y + 1.5] }, { id: "b" + i, t: "line", a: [60, y + 1.5], b: [60, y + 6] }, { id: "c" + i, t: "line", a: [60, y + 6], b: [10, y + 6] }, { id: "d" + i, t: "line", a: [10, y + 6], b: [10, y + 1] }]; E.push(...g); C.push({ t: "h", e: "a" + i }, { t: "v", e: "b" + i }, { t: "h", e: "c" + i }, { t: "v", e: "d" + i }, { t: "len", e: "a" + i, val: 40 }); }
let t0 = Date.now(); r = solveSketch(E, C); ok("30 rectangles (" + (Date.now() - t0) + " ms)", r.ok && Date.now() - t0 < 3000);
console.log("échecs :", fails);
