// Outils géométriques 2D/3D et conversion esquisse -> profils
import { R } from "./occ.js";

export const EPS = 1e-6;
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};
export const v2 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, s) => [a[0] * s, a[1] * s],
  len: a => Math.hypot(a[0], a[1]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  norm: a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
  eq: (a, b, t = 1e-5) => Math.abs(a[0] - b[0]) < t && Math.abs(a[1] - b[1]) < t,
  cross: (a, b) => a[0] * b[1] - a[1] * b[0],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  rot: (a, ang) => [a[0] * Math.cos(ang) - a[1] * Math.sin(ang), a[0] * Math.sin(ang) + a[1] * Math.cos(ang)],
};

// Plans standards (Y vers le haut)
export const STD_PLANES = {
  front: { name: "Plan de face", o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] },
  top: { name: "Plan de dessus", o: [0, 0, 0], x: [1, 0, 0], n: [0, 1, 0] },
  right: { name: "Plan de droite", o: [0, 0, 0], x: [0, 0, -1], n: [1, 0, 0] },
};
export function planeY(p) { return v3.cross(p.n, p.x); }
export function to3D(p, pt) { const y = planeY(p); return v3.add(p.o, v3.add(v3.mul(p.x, pt[0]), v3.mul(y, pt[1]))); }
export function to2D(p, P) { const d = v3.sub(P, p.o); return [v3.dot(d, p.x), v3.dot(d, planeY(p))]; }
export function planeFromNormal(o, n) {
  n = v3.norm(n);
  let x;
  if (Math.abs(n[1]) > 0.999) x = [1, 0, 0];
  else x = v3.norm(v3.cross([0, 1, 0], n));
  // origine = projection de l'origine globale sur le plan
  const d = v3.dot(o, n);
  return { o: v3.mul(n, d), x, n };
}
export function offsetPlane(p, d) { return { o: v3.add(p.o, v3.mul(p.n, d)), x: p.x, n: p.n }; }
export function rPlane(p) { return new R.Plane(p.o, p.x, p.n); }

// ---- Arcs à 3 points
export function circleFrom3(a, m, b) {
  const ax = a[0], ay = a[1], bx = m[0], by = m[1], cx = b[0], cy = b[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
}
export function arcSample(e, n = 32) {
  const C = circleFrom3(e.a, e.m, e.b);
  if (!C) return [e.a, e.b];
  const ang = p => Math.atan2(p[1] - C.c[1], p[0] - C.c[0]);
  let a0 = ang(e.a), am = ang(e.m), a1 = ang(e.b);
  const norm = x => { while (x < 0) x += 2 * Math.PI; while (x >= 2 * Math.PI) x -= 2 * Math.PI; return x; };
  let s1 = norm(a1 - a0), sm = norm(am - a0);
  let sweep = sm < s1 ? s1 : s1 - 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = a0 + sweep * i / n; pts.push([C.c[0] + C.r * Math.cos(t), C.c[1] + C.r * Math.sin(t)]); }
  return pts;
}
export function arcFromCenter(c, r, a0, sweep) {
  const p = t => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
  return { a: p(a0), m: p(a0 + sweep / 2), b: p(a0 + sweep) };
}

// Polygone approximatif d'une entité fermée
export function entityPolygon(e) {
  if (e.t === "circle") { const p = []; for (let i = 0; i < 48; i++) { const t = i / 48 * Math.PI * 2; p.push([e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)]); } return p; }
  if (e.t === "slot") return slotOutline(e, 16);
  return [];
}
export function slotOutline(e, n = 16) {
  const d = v2.norm(v2.sub(e.b, e.a)); const ang = Math.atan2(d[1], d[0]);
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = ang - Math.PI / 2 - Math.PI * i / n; pts.push([e.a[0] + e.r * Math.cos(t), e.a[1] + e.r * Math.sin(t)]); }
  for (let i = 0; i <= n; i++) { const t = ang + Math.PI / 2 - Math.PI * i / n; pts.push([e.b[0] + e.r * Math.cos(t), e.b[1] + e.r * Math.sin(t)]); }
  return pts;
}
export function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// ---- Chaînes de segments (lignes + arcs)
export function buildChains(entities) {
  const segs = entities.filter(e => !e.cons && (e.t === "line" || e.t === "arc")).map(e => ({ e, used: false }));
  const loops = [], open = [];
  const tol = 1e-4;
  for (const s of segs) {
    if (s.used) continue;
    s.used = true;
    let chain = [{ e: s.e, rev: false }];
    // étendre vers l'avant
    const extend = (forward) => {
      let grow = true;
      while (grow) {
        grow = false;
        const end = forward ? endOf(chain[chain.length - 1]) : startOf(chain[0]);
        for (const o of segs) {
          if (o.used) continue;
          if (v2.eq(o.e.a, end, tol)) { o.used = true; forward ? chain.push({ e: o.e, rev: !forward ? true : false }) : chain.unshift({ e: o.e, rev: true }); grow = true; break; }
          if (v2.eq(o.e.b, end, tol)) { o.used = true; forward ? chain.push({ e: o.e, rev: true }) : chain.unshift({ e: o.e, rev: false }); grow = true; break; }
        }
        if (v2.eq(startOf(chain[0]), endOf(chain[chain.length - 1]), tol) && chain.length > 1) return true;
      }
      return false;
    };
    let closed = extend(true);
    if (!closed) closed = extend(false);
    if (!closed && chain.length > 1 && v2.eq(startOf(chain[0]), endOf(chain[chain.length - 1]), tol)) closed = true;
    (closed ? loops : open).push(chain);
  }
  return { loops, open };
}
export function startOf(c) { return c.rev ? c.e.b : c.e.a; }
export function endOf(c) { return c.rev ? c.e.a : c.e.b; }
export function chainPolygon(chain) {
  const pts = [];
  for (const c of chain) {
    if (c.e.t === "line") pts.push(startOf(c));
    else { let s = arcSample(c.e, 16); if (c.rev) s = s.reverse(); s.pop(); pts.push(...s); }
  }
  return pts;
}
export function chainDrawing(chain) {
  let pen = R.draw(startOf(chain[0]));
  chain.forEach((c, i) => {
    const last = i === chain.length - 1;
    if (c.e.t === "line") { if (!last) pen = pen.lineTo(endOf(c)); }
    else pen = pen.threePointsArcTo(endOf(c), c.e.m);
  });
  return pen.close();
}
function entityDrawing(e) {
  if (e.t === "circle") return R.drawCircle(e.r).translate(e.c[0], e.c[1]);
  if (e.t === "slot") {
    const L = v2.dist(e.a, e.b); const mid = v2.mul(v2.add(e.a, e.b), 0.5);
    const ang = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) * 180 / Math.PI;
    return R.drawRoundedRectangle(L + 2 * e.r, 2 * e.r, e.r * 0.9999).rotate(ang).translate(mid[0], mid[1]);
  }
  return null;
}

// Région fermée de l'esquisse -> Drawing replicad (avec trous imbriqués)
export function sketchRegions(entities) {
  const { loops, open } = buildChains(entities);
  const items = [];
  for (const l of loops) items.push({ poly: chainPolygon(l), make: () => chainDrawing(l) });
  for (const e of entities) if (!e.cons && (e.t === "circle" || e.t === "slot")) items.push({ poly: entityPolygon(e), make: () => entityDrawing(e) });
  if (!items.length) return { drawing: null, open, loops: 0 };
  items.forEach(it => it.area = Math.abs(polyArea(it.poly)));
  items.sort((a, b) => b.area - a.area);
  let res = null;
  for (const it of items) {
    const sample = it.poly[0];
    let depth = 0;
    for (const o of items) if (o !== it && o.area > it.area && pointInPoly(sample, o.poly)) depth++;
    const d = it.make();
    if (!res) res = d; else res = depth % 2 === 0 ? res.fuse(d) : res.cut(d);
  }
  return { drawing: res, open, loops: items.length };
}

// Sommets d'une chaîne ouverte (lignes seulement) pour la tôlerie / mécano-soudé
export function chainPoints(chain) {
  const pts = [startOf(chain[0])];
  for (const c of chain) pts.push(endOf(c));
  return pts;
}

// ---- Expressions / variables
export function makeEval(vars) {
  return (x) => {
    if (typeof x === "number") return x;
    if (x == null || x === "") return 0;
    const s = String(x).replace(",", ".").trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    try {
      const names = Object.keys(vars || {});
      const vals = names.map(n => Number(vars[n]) || 0);
      // eslint-disable-next-line no-new-func
      const f = new Function(...names, "Math", "const {sin,cos,tan,sqrt,PI,abs,min,max,round}=Math; return (" + s.replace(/^=/, "") + ");");
      const v = f(...vals, Math);
      return Number.isFinite(v) ? v : 0;
    } catch { return 0; }
  };
}
