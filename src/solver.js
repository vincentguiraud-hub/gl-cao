// Solveur de contraintes d'esquisse (moindres carrés, Levenberg-Marquardt)
// Les points confondus (mêmes coordonnées) sont fusionnés en un seul point.
// Un point posé sur l'origine est fixe.
import { circleFrom3 } from "./geom.js";

const TOL = 1e-6;
export const POINT_KEYS = { line: ["a", "b"], arc: ["a", "b", "m"], circle: ["c"], slot: ["a", "b"], point: ["p"] };
const keysOf = e => POINT_KEYS[e.t] || [];
const hasRadius = e => e.t === "circle" || e.t === "slot";

export const REL_LABELS = {
  h: "Horizontale", v: "Verticale", par: "Parallèle", perp: "Perpendiculaire", equal: "Égale", tan: "Tangente",
  conc: "Concentrique", colin: "Colinéaire", mid: "Point milieu", onLine: "Sur la ligne", onCircle: "Sur le cercle",
  fix: "Fixe", hpts: "Horizontaux", vpts: "Verticaux", len: "Longueur", rad: "Rayon", dia: "Diamètre", dist: "Distance", angle: "Angle",
  coinc: "Coïncidente",
};
export const REL_GLYPH = { h: "─", v: "│", par: "∥", perp: "⊥", equal: "=", tan: "T", conc: "◎", colin: "⋯", mid: "◆", onLine: "↘", onCircle: "○", fix: "⚓", hpts: "─", vpts: "│" };
export const isDim = c => ["len", "rad", "dia", "dist", "angle"].includes(c.t);

class System {
  constructor(ents, cons) {
    this.ents = ents; this.byId = new Map(ents.map(e => [e.id, e]));
    this.groups = []; // {x, y, fixed, members:[[e,k]]}
    this.ptGroup = new Map(); // "id:k" -> group index
    for (const e of ents) for (const k of keysOf(e)) {
      const p = e[k];
      let gi = this.groups.findIndex(g => Math.abs(g.x - p[0]) < TOL && Math.abs(g.y - p[1]) < TOL);
      if (gi < 0) { gi = this.groups.length; this.groups.push({ x: p[0], y: p[1], fixed: Math.abs(p[0]) < TOL && Math.abs(p[1]) < TOL, members: [] }); }
      this.groups[gi].members.push([e, k]); this.ptGroup.set(e.id + ":" + k, gi);
    }
    // contraintes « fixe » : le groupe devient fixe
    for (const c of cons) if (c.t === "fix") { const gi = this.ptGroup.get(c.p?.e + ":" + c.p?.k); if (gi != null) this.groups[gi].fixed = true; }
    // vecteur de variables
    this.vars = []; this.gVar = new Map(); this.rVar = new Map();
    this.groups.forEach((g, i) => { if (!g.fixed) { this.gVar.set(i, this.vars.length); this.vars.push(g.x, g.y); } });
    for (const e of ents) if (hasRadius(e)) { this.rVar.set(e.id, this.vars.length); this.vars.push(e.r); }
    this.cons = cons.filter(c => this.valid(c));
    this.arcCount = ents.filter(e => e.t === "arc").length;
  }
  valid(c) {
    const ok = r => r && (r.k ? this.ptGroup.has(r.e + ":" + r.k) : this.byId.has(r.e));
    for (const key of ["e", "e1", "e2"]) if (c[key] && !this.byId.has(c[key])) return false;
    for (const key of ["p", "p1", "p2"]) if (c[key] && !ok(c[key])) return false;
    return true;
  }
  P(x, e, k) { const gi = this.ptGroup.get(e.id + ":" + k); const g = this.groups[gi]; const vi = this.gVar.get(gi); return vi == null ? [g.x, g.y] : [x[vi], x[vi + 1]]; }
  Pr(x, r) { return this.P(x, this.byId.get(r.e), r.k); }
  R(x, e) {
    if (hasRadius(e)) return x[this.rVar.get(e.id)];
    if (e.t === "arc") { const c = circleFrom3(this.P(x, e, "a"), this.P(x, e, "m"), this.P(x, e, "b")); return c ? c.r : 0; }
    return 0;
  }
  C(x, e) {
    if (e.t === "circle") return this.P(x, e, "c");
    if (e.t === "arc") { const c = circleFrom3(this.P(x, e, "a"), this.P(x, e, "m"), this.P(x, e, "b")); return c ? c.c : this.P(x, e, "m"); }
    return null;
  }
  residuals(x, extra = []) {
    const out = [];
    const L = e => [this.P(x, e, "a"), this.P(x, e, "b")];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
    const len = a => Math.hypot(a[0], a[1]);
    const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
    const distPL = (p, e) => { const [a, b] = L(e); const d = sub(b, a); const l = len(d) || 1e-12; return cross(d, sub(p, a)) / l; };
    for (const c of this.cons) {
      const e = c.e && this.byId.get(c.e), e1 = c.e1 && this.byId.get(c.e1), e2 = c.e2 && this.byId.get(c.e2);
      switch (c.t) {
        case "h": { const [a, b] = L(e); out.push(a[1] - b[1]); break; }
        case "v": { const [a, b] = L(e); out.push(a[0] - b[0]); break; }
        case "par": case "perp": {
          const [a1, b1] = L(e1), [a2, b2] = L(e2); const d1 = sub(b1, a1), d2 = sub(b2, a2); const n = (len(d1) * len(d2)) || 1e-12;
          out.push((c.t === "par" ? cross(d1, d2) : dot(d1, d2)) / n * 50); break;
        }
        case "colin": { const [a2, b2] = L(e2); out.push(distPL(a2, e1), distPL(b2, e1)); break; }
        case "equal": {
          if (e1.t === "line" && e2.t === "line") { const [a1, b1] = L(e1), [a2, b2] = L(e2); out.push(len(sub(b1, a1)) - len(sub(b2, a2))); }
          else out.push(this.R(x, e1) - this.R(x, e2));
          break;
        }
        case "tan": {
          const ln = e1.t === "line" ? e1 : e2.t === "line" ? e2 : null;
          if (ln) { const ci = ln === e1 ? e2 : e1; out.push(Math.abs(distPL(this.C(x, ci), ln)) - this.R(x, ci)); }
          else { const d = len(sub(this.C(x, e1), this.C(x, e2))); const r1 = this.R(x, e1), r2 = this.R(x, e2); out.push(c.inner ? d - Math.abs(r1 - r2) : d - (r1 + r2)); }
          break;
        }
        case "conc": { const d = sub(this.C(x, e1), this.C(x, e2)); out.push(d[0], d[1]); break; }
        case "mid": { const p = this.Pr(x, c.p); const [a, b] = L(e); out.push(p[0] - (a[0] + b[0]) / 2, p[1] - (a[1] + b[1]) / 2); break; }
        case "onLine": out.push(distPL(this.Pr(x, c.p), e)); break;
        case "onCircle": out.push(len(sub(this.Pr(x, c.p), this.C(x, e))) - this.R(x, e)); break;
        case "hpts": out.push(this.Pr(x, c.p1)[1] - this.Pr(x, c.p2)[1]); break;
        case "vpts": out.push(this.Pr(x, c.p1)[0] - this.Pr(x, c.p2)[0]); break;
        case "coinc": { const d = sub(this.Pr(x, c.p1), this.Pr(x, c.p2)); out.push(d[0], d[1]); break; }
        case "len": { const [a, b] = L(e); out.push(len(sub(b, a)) - c.val); break; }
        case "rad": out.push(this.R(x, e) - c.val); break;
        case "dia": out.push(2 * this.R(x, e) - c.val); break;
        case "dist": {
          const p1 = c.p1 ? this.Pr(x, c.p1) : [0, 0], p2 = c.p2 ? this.Pr(x, c.p2) : [0, 0];
          if (c.mode === "h") out.push(Math.abs(p2[0] - p1[0]) - c.val);
          else if (c.mode === "v") out.push(Math.abs(p2[1] - p1[1]) - c.val);
          else if (c.mode === "pl") out.push(Math.abs(distPL(p1, e)) - c.val);
          else out.push(len(sub(p2, p1)) - c.val);
          break;
        }
        case "angle": {
          const [a1, b1] = L(e1), [a2, b2] = L(e2); const d1 = sub(b1, a1), d2 = sub(b2, a2);
          const ang = Math.atan2(Math.abs(cross(d1, d2)), dot(d1, d2)) * 180 / Math.PI;
          out.push((ang - c.val) * Math.PI / 180 * 50); break;
        }
      }
    }
    for (const s of extra) out.push((x[s.i] - s.target) * s.w);
    return out;
  }
  jacobian(x, extra, r0) {
    const n = x.length, m = r0.length; const J = Array.from({ length: m }, () => new Float64Array(n));
    for (let j = 0; j < n; j++) {
      const h = 1e-7 * Math.max(1, Math.abs(x[j])); const old = x[j]; x[j] = old + h;
      const r = this.residuals(x, extra); x[j] = old;
      for (let i = 0; i < m; i++) J[i][j] = (r[i] - r0[i]) / h;
    }
    return J;
  }
  solve(x, extra = [], maxIt = 60) {
    let lambda = 1e-3;
    let r = this.residuals(x, extra); let err = r.reduce((s, v) => s + v * v, 0);
    for (let it = 0; it < maxIt && err > 1e-20; it++) {
      const J = this.jacobian(x, extra, r);
      const n = x.length, m = r.length;
      const A = Array.from({ length: n }, () => new Float64Array(n)); const g = new Float64Array(n);
      for (let i = 0; i < m; i++) { const Ji = J[i]; const ri = r[i]; for (let a = 0; a < n; a++) { const v = Ji[a]; if (!v) continue; g[a] += v * ri; for (let b = a; b < n; b++) if (Ji[b]) A[a][b] += v * Ji[b]; } }
      for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) A[a][b] = A[b][a];
      let improved = false;
      for (let tries = 0; tries < 8; tries++) {
        const M = A.map((row, i) => { const c = Float64Array.from(row); c[i] += lambda * (1 + row[i]); return c; });
        const dx = gauss(M, Array.from(g, v => -v));
        if (!dx) { lambda *= 10; continue; }
        const xn = x.map((v, i) => v + dx[i]);
        const rn = this.residuals(xn, extra); const en = rn.reduce((s, v) => s + v * v, 0);
        if (en < err) { x.splice(0, x.length, ...xn); r = rn; err = en; lambda = Math.max(lambda / 5, 1e-12); improved = true; break; }
        lambda *= 10;
      }
      if (!improved) break;
    }
    return err;
  }
  write(x) {
    this.groups.forEach((g, i) => { const vi = this.gVar.get(i); const p = vi == null ? [g.x, g.y] : [round(x[vi]), round(x[vi + 1])]; for (const [e, k] of g.members) e[k] = [...p]; });
    for (const e of this.ents) if (hasRadius(e)) e.r = Math.max(1e-6, round(x[this.rVar.get(e.id)]));
  }
  dof(x) {
    const r = this.residuals(x); if (!x.length) return 0;
    if (!r.length) return x.length - this.arcCount;
    const J = this.jacobian(x, [], r);
    return Math.max(0, x.length - rank(J) - this.arcCount);
  }
}
const round = v => Math.round(v * 1e7) / 1e7;
function gauss(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    if (Math.abs(A[p][i]) < 1e-14) return null;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; if (!f) continue; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  return x;
}
function rank(J) {
  const M = J.map(r => Float64Array.from(r)); const m = M.length, n = M[0]?.length || 0; let rk = 0;
  for (let c = 0; c < n && rk < m; c++) {
    let p = rk; for (let i = rk + 1; i < m; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-7) continue;
    [M[rk], M[p]] = [M[p], M[rk]];
    for (let i = rk + 1; i < m; i++) { const f = M[i][c] / M[rk][c]; if (f) for (let j = c; j < n; j++) M[i][j] -= f * M[rk][j]; }
    rk++;
  }
  return rk;
}

// Résout l'esquisse. drag = { e, k, to:[x,y] } pour suivre la souris. Renvoie { ok, err, dof }
export function solveSketch(ents, cons, opts = {}) {
  const sys = new System(ents, cons);
  if (!sys.vars.length) return { ok: true, err: 0, dof: 0 };
  const x = [...sys.vars];
  const extra = [];
  if (opts.drag) {
    const gi = sys.ptGroup.get(opts.drag.e.id + ":" + opts.drag.k); const vi = sys.gVar.get(gi);
    if (vi != null) extra.push({ i: vi, target: opts.drag.to[0], w: 0.05 }, { i: vi + 1, target: opts.drag.to[1], w: 0.05 });
  }
  if (opts.keep) for (const [e, k] of opts.keep) { // garder des points en place (édition numérique)
    const gi = sys.ptGroup.get(e.id + ":" + k); const vi = sys.gVar.get(gi);
    if (vi != null) extra.push({ i: vi, target: x[vi], w: 0.05 }, { i: vi + 1, target: x[vi + 1], w: 0.05 });
  }
  if (!sys.cons.length && !extra.length) return { ok: true, err: 0, dof: opts.dof ? sys.dof(x) : null };
  if (extra.length) sys.solve(x, extra, opts.drag ? 25 : 60);
  const err = sys.solve(x, [], opts.drag ? 25 : 80);
  const ok = err < 1e-10;
  if (ok || opts.force) sys.write(x);
  return { ok, err, dof: opts.dof ? sys.dof(x) : null };
}
export function sketchDOF(ents, cons) { const sys = new System(ents, cons); return sys.dof([...sys.vars]); }
export function cleanConstraints(ents, cons) {
  const ids = new Set(ents.map(e => e.id));
  const okRef = r => !r || ids.has(r.e);
  return cons.filter(c => [c.e, c.e1, c.e2].every(v => !v || ids.has(v)) && okRef(c.p) && okRef(c.p1) && okRef(c.p2));
}
