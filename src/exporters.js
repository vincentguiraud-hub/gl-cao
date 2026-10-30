// Exports : DXF, ZIP, téléchargements (compatibles page publiée)
import { zipSync, strToU8 } from "fflate";
import { arcSample, circleFrom3 } from "./geom.js";

let dl = null, dlTried = false;
async function downloadsApi() {
  if (dlTried) return dl;
  dlTried = true;
  try { if (window.claude?.use) dl = await Promise.race([window.claude.use("downloads"), new Promise(r => setTimeout(() => r(null), 4000))]); } catch { dl = null; }
  return dl;
}
export function warmDownloads() { downloadsApi(); }

export async function saveFile(filename, data, toast) {
  const api = await downloadsApi();
  if (api) {
    try { await api.save({ filename, data }); toast?.("Fichier proposé : " + filename); return true; }
    catch (e) {
      if (e?.code === "declined") { toast?.("Téléchargement annulé"); return false; }
      if (e?.code === "rejected_extension" || e?.code === "extension_not_enabled") { toast?.("Format non autorisé ici : " + filename, true); return false; }
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data]);
  // noms de fichiers sans accents (certains navigateurs ignorent sinon le nom proposé)
  const safe = filename.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w .()&+-]/g, "_");
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = safe;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}
export async function saveZipped(zipName, files, toast) {
  const api = await downloadsApi();
  const entries = Object.entries(files);
  if (!api && entries.length === 1) { const [n, c] = entries[0]; return saveFile(n, c, toast); }
  const obj = {};
  for (const [name, content] of Object.entries(files)) obj[name] = typeof content === "string" ? strToU8(content) : content;
  return saveFile(zipName, new Blob([zipSync(obj, { level: 6 })]), toast);
}

// ---------- DXF (R12, mm)
export class DXF {
  constructor() { this.ents = []; this.layers = new Set(["0"]); }
  line(a, b, layer = "0") { this.layers.add(layer); this.ents.push(`0\nLINE\n8\n${layer}\n10\n${a[0]}\n20\n${a[1]}\n30\n0\n11\n${b[0]}\n21\n${b[1]}\n31\n0`); }
  circle(c, r, layer = "0") { this.layers.add(layer); this.ents.push(`0\nCIRCLE\n8\n${layer}\n10\n${c[0]}\n20\n${c[1]}\n30\n0\n40\n${r}`); }
  arc(c, r, a0, a1, layer = "0") { this.layers.add(layer); this.ents.push(`0\nARC\n8\n${layer}\n10\n${c[0]}\n20\n${c[1]}\n30\n0\n40\n${r}\n50\n${a0}\n51\n${a1}`); }
  text(p, h, s, layer = "0") { this.layers.add(layer); this.ents.push(`0\nTEXT\n8\n${layer}\n10\n${p[0]}\n20\n${p[1]}\n30\n0\n40\n${h}\n1\n${s}`); }
  toString() {
    const layers = [...this.layers].map((l, i) => `0\nLAYER\n2\n${l}\n70\n0\n62\n${l === "PLIAGE" ? 1 : l === "TEXTE" ? 3 : l === "CACHE" ? 8 : l === "COTES" ? 4 : l === "CADRE" ? 7 : 7}\n6\n${l === "PLIAGE" || l === "CACHE" ? "DASHED" : "CONTINUOUS"}`).join("\n");
    return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n2\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nLTYPE\n2\nDASHED\n70\n0\n3\n__ __ __\n72\n65\n73\n2\n40\n15.0\n49\n10.0\n49\n-5.0\n0\nENDTAB\n0\nTABLE\n2\nLAYER\n70\n${this.layers.size}\n${layers}\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${this.ents.join("\n")}\n0\nENDSEC\n0\nEOF\n`;
  }
}
export function sketchToDXF(entities) {
  const d = new DXF();
  for (const e of entities) {
    const layer = e.cons ? "CONSTRUCTION" : "0";
    if (e.t === "line") d.line(e.a, e.b, layer);
    else if (e.t === "circle") d.circle(e.c, e.r, layer);
    else if (e.t === "arc") {
      const c = circleFrom3(e.a, e.m, e.b); if (!c) continue;
      const ang = p => Math.atan2(p[1] - c.c[1], p[0] - c.c[0]) * 180 / Math.PI;
      const cross = (e.m[0] - e.a[0]) * (e.b[1] - e.a[1]) - (e.m[1] - e.a[1]) * (e.b[0] - e.a[0]);
      if (cross > 0) d.arc(c.c, c.r, ang(e.a), ang(e.b), layer); else d.arc(c.c, c.r, ang(e.b), ang(e.a), layer);
    } else if (e.t === "slot") {
      const s = arcSample({ a: e.a, b: e.b, m: e.a }, 2); void s;
      const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1]; const L = Math.hypot(dx, dy) || 1; const n = [-dy / L * e.r, dx / L * e.r];
      d.line([e.a[0] + n[0], e.a[1] + n[1]], [e.b[0] + n[0], e.b[1] + n[1]], layer);
      d.line([e.a[0] - n[0], e.a[1] - n[1]], [e.b[0] - n[0], e.b[1] - n[1]], layer);
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      d.arc(e.b, e.r, ang - 90, ang + 90, layer); d.arc(e.a, e.r, ang + 90, ang + 270, layer);
    } else if (e.t === "point") d.circle(e.p, 0.1, "POINTS");
  }
  return d.toString();
}
export function flatPatternDXF(info, name, holes = []) {
  const d = new DXF(); const L = info.flat, W = info.width;
  d.line([0, 0], [L, 0]); d.line([L, 0], [L, W]); d.line([L, W], [0, W]); d.line([0, W], [0, 0]);
  for (const h of holes) d.circle([Math.round(h.x * 1e4) / 1e4, Math.round(h.y * 1e4) / 1e4], h.d / 2);
  for (const b of info.bends) { d.line([b.pos, 0], [b.pos, W], "PLIAGE"); d.text([b.pos + 2, W + 4], 4, `PLI ${b.dir.toUpperCase()} ${b.angle.toFixed(1)}° R${info.r}`, "TEXTE"); }
  d.text([0, -10], 5, `${name} - Ep ${info.t} - Developpe ${L.toFixed(2)} x ${W}`, "TEXTE");
  return d.toString();
}

// ---------- Formats maillés (impression 3D, rendu, échange)
// meshes : [{ name, vertices:Float32Array|number[], triangles:number[], color:"#rrggbb" }]
export function toOBJ(meshes) {
  let out = "# G&L CAO 3D - export OBJ (mm)\n", base = 1;
  for (const m of meshes) {
    out += `o ${m.name.replace(/\s+/g, "_")}\n`;
    for (let i = 0; i < m.vertices.length; i += 3) out += `v ${m.vertices[i]} ${m.vertices[i + 1]} ${m.vertices[i + 2]}\n`;
    for (let i = 0; i < m.triangles.length; i += 3) out += `f ${m.triangles[i] + base} ${m.triangles[i + 1] + base} ${m.triangles[i + 2] + base}\n`;
    base += m.vertices.length / 3;
  }
  return out;
}
export function toSTLAscii(meshes, name = "piece") {
  let out = `solid ${name}\n`;
  for (const m of meshes) {
    const V = m.vertices, T = m.triangles;
    for (let i = 0; i < T.length; i += 3) {
      const a = [V[T[i] * 3], V[T[i] * 3 + 1], V[T[i] * 3 + 2]], b = [V[T[i + 1] * 3], V[T[i + 1] * 3 + 1], V[T[i + 1] * 3 + 2]], c = [V[T[i + 2] * 3], V[T[i + 2] * 3 + 1], V[T[i + 2] * 3 + 2]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
      out += `facet normal ${n.join(" ")}\n outer loop\n  vertex ${a.join(" ")}\n  vertex ${b.join(" ")}\n  vertex ${c.join(" ")}\n endloop\nendfacet\n`;
    }
  }
  return out + `endsolid ${name}\n`;
}
export function toPLY(meshes) {
  let nv = 0, nf = 0; for (const m of meshes) { nv += m.vertices.length / 3; nf += m.triangles.length / 3; }
  let out = `ply\nformat ascii 1.0\ncomment G&L CAO 3D (mm)\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`;
  const faces = []; let base = 0;
  for (const m of meshes) {
    const c = hexRGB(m.color || "#a9b4bf");
    for (let i = 0; i < m.vertices.length; i += 3) out += `${m.vertices[i]} ${m.vertices[i + 1]} ${m.vertices[i + 2]} ${c.join(" ")}\n`;
    for (let i = 0; i < m.triangles.length; i += 3) faces.push(`3 ${m.triangles[i] + base} ${m.triangles[i + 1] + base} ${m.triangles[i + 2] + base}`);
    base += m.vertices.length / 3;
  }
  return out + faces.join("\n") + "\n";
}
// 3MF (Bambu Studio, PrusaSlicer, Cura…) — une pièce par corps
export function to3MF(meshes, title = "piece") {
  let objs = "", items = "";
  meshes.forEach((m, k) => {
    let v = "", t = "";
    for (let i = 0; i < m.vertices.length; i += 3) v += `<vertex x="${m.vertices[i]}" y="${-m.vertices[i + 2]}" z="${m.vertices[i + 1]}"/>`; // Z vers le haut pour les trancheurs
    for (let i = 0; i < m.triangles.length; i += 3) t += `<triangle v1="${m.triangles[i]}" v2="${m.triangles[i + 1]}" v3="${m.triangles[i + 2]}"/>`;
    objs += `<object id="${k + 1}" name="${escXml(m.name)}" type="model"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
    items += `<item objectid="${k + 1}"/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="fr-FR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${escXml(title)}</metadata><metadata name="Application">G&amp;L CAO 3D</metadata><resources>${objs}</resources><build>${items}</build></model>`;
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    "3D/3dmodel.model": strToU8(model),
  };
  return new Blob([zipSync(files, { level: 6 })]);
}
const hexRGB = h => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const escXml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// ---------- Plan SVG -> DXF (vues, cotes, textes, cartouche)
export function svgDrawingToDXF(svgText, H) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const d = new DXF();
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  const parseTf = s => {
    let M = [1, 0, 0, 1, 0, 0];
    for (const m of (s || "").matchAll(/(translate|scale|rotate)\(([^)]*)\)/g)) {
      const a = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
      if (m[1] === "translate") M = mul(M, [1, 0, 0, 1, a[0] || 0, a[1] || 0]);
      if (m[1] === "scale") M = mul(M, [a[0], 0, 0, a[1] ?? a[0], 0, 0]);
      if (m[1] === "rotate") { const r = a[0] * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r); M = mul(M, [c, sn, -sn, c, 0, 0]); }
    }
    return M;
  };
  const ap = (M, x, y) => { const X = M[0] * x + M[2] * y + M[4], Y = M[1] * x + M[3] * y + M[5]; return [round(X), round(H - Y)]; };
  const layerOf = el => { const st = el.getAttribute("stroke-dasharray") || el.parentElement?.getAttribute("stroke-dasharray"); if (st) return "CACHE"; const sw = parseFloat(el.getAttribute("stroke-width") || el.parentElement?.getAttribute("stroke-width") || "0"); return sw > 0 && sw < 0.3 ? "COTES" : "0"; };
  const walk = (el, M) => {
    for (const c of el.children) {
      const M2 = c.getAttribute("transform") ? mul(M, parseTf(c.getAttribute("transform"))) : M;
      const tag = c.tagName.toLowerCase();
      if (tag === "g") walk(c, M2);
      else if (tag === "line") d.line(ap(M2, +c.getAttribute("x1"), +c.getAttribute("y1")), ap(M2, +c.getAttribute("x2"), +c.getAttribute("y2")), layerOf(c));
      else if (tag === "rect") { const x = +c.getAttribute("x") || 0, y = +c.getAttribute("y") || 0, w = +c.getAttribute("width"), h = +c.getAttribute("height"); if (c.getAttribute("fill") === "#fff" && x === 0 && y === 0) continue; const p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]].map(q => ap(M2, q[0], q[1])); for (let i = 0; i < 4; i++) d.line(p[i], p[i + 1], "CADRE"); }
      else if (tag === "circle") { const c0 = ap(M2, +c.getAttribute("cx"), +c.getAttribute("cy")); d.circle(c0, +c.getAttribute("r") * Math.hypot(M2[0], M2[1]), "CADRE"); }
      else if (tag === "text") { const p = ap(M2, +c.getAttribute("x") || 0, +c.getAttribute("y") || 0); const hgt = (+c.getAttribute("font-size") || 3) * Math.hypot(M2[0], M2[1]); d.text(p, hgt * 0.8, c.textContent, "TEXTE"); }
      else if (tag === "path") {
        const layer = layerOf(c); const polys = pathToPolylines(c.getAttribute("d") || "");
        for (const pl of polys) for (let i = 0; i < pl.length - 1; i++) d.line(ap(M2, ...pl[i]), ap(M2, ...pl[i + 1]), c.getAttribute("fill") === "#000" ? "COTES" : layer);
      }
    }
  };
  walk(doc.documentElement, [1, 0, 0, 1, 0, 0]);
  return d.toString();
}
const round = v => Math.round(v * 1e4) / 1e4;
// Chemin SVG (M L H V C Q A Z, absolus et relatifs) -> polylignes
export function pathToPolylines(dstr) {
  const toks = dstr.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const out = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = null, i = 0;
  const num = () => parseFloat(toks[i++]);
  const push = (px, py) => { cur.push([px, py]); x = px; y = py; };
  while (i < toks.length) {
    if (/[a-z]/i.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(); const C = cmd.toUpperCase();
    if (C === "Z") { if (cur) { cur.push([sx, sy]); x = sx; y = sy; } continue; }
    if (C === "M") { const px = num() + (rel ? x : 0), py = num() + (rel ? y : 0); cur = [[px, py]]; out.push(cur); x = sx = px; y = sy = py; cmd = rel ? "l" : "L"; continue; }
    if (!cur) { cur = [[x, y]]; out.push(cur); }
    if (C === "L") { push(num() + (rel ? x : 0), num() + (rel ? y : 0)); }
    else if (C === "H") { push(num() + (rel ? x : 0), y); }
    else if (C === "V") { push(x, num() + (rel ? y : 0)); }
    else if (C === "C" || C === "S" || C === "Q" || C === "T") {
      const n = C === "C" ? 6 : C === "S" || C === "Q" ? 4 : 2; const a = []; for (let k = 0; k < n; k++) a.push(num());
      const pts = []; for (let k = 0; k < n; k += 2) pts.push([a[k] + (rel ? x : 0), a[k + 1] + (rel ? y : 0)]);
      const p0 = [x, y]; const ctrl = C === "C" ? pts : C === "Q" ? [pts[0], pts[0], pts[1]] : [p0, pts[0], pts[pts.length - 1]];
      const [c1, c2, p3] = C === "C" ? pts : ctrl;
      for (let k = 1; k <= 12; k++) { const t = k / 12, u = 1 - t; push(u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]); }
    } else if (C === "A") {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(); const ex = num() + (rel ? x : 0), ey = num() + (rel ? y : 0);
      for (const q of arcPoints(x, y, rx, ry, rot, large, sweep, ex, ey)) push(q[0], q[1]);
    } else i++;
  }
  return out.filter(p => p.length > 1);
}
function arcPoints(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (!rx || !ry) return [[x2, y2]];
  const r = phi * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2; const x1p = c * dx + s * dy, y1p = -s * dx + c * dy;
  let lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = fa === fs ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den)); const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry); let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 24))); const out = [];
  for (let k = 1; k <= n; k++) { const t = t1 + dt * k / n; const px = rx * Math.cos(t), py = ry * Math.sin(t); out.push([c * px - s * py + cx, s * px + c * py + cy]); }
  return out;
}
// ---------- Face plane -> DXF (contour + trous), pour la découpe
export function faceToDXF(face, plane, to2D) {
  const d = new DXF();
  for (const ed of face.edges) {
    const P = q => to2D(plane, q).map(round);
    const s = ed.startPoint.toTuple(), e = ed.endPoint.toTuple();
    if (ed.geomType === "LINE") d.line(P(s), P(e));
    else if (ed.geomType === "CIRCLE") {
      const a = P(s), m = P(ed.pointAt(0.5).toTuple()), b = P(e);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4) { const q = P(ed.pointAt(1 / 3).toTuple()), r = P(ed.pointAt(2 / 3).toTuple()); const c = circleFrom3(a, q, r); if (c) d.circle(c.c.map(round), round(c.r)); }
      else { const c = circleFrom3(a, m, b); if (!c) { d.line(a, b); continue; } const ang = p => Math.atan2(p[1] - c.c[1], p[0] - c.c[0]) * 180 / Math.PI; const cross = (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]); if (cross > 0) d.arc(c.c, c.r, ang(a), ang(b)); else d.arc(c.c, c.r, ang(b), ang(a)); }
    } else { let prev = P(s); for (let i = 1; i <= 24; i++) { const q = P(ed.pointAt(i / 24).toTuple()); d.line(prev, q); prev = q; } }
  }
  return d.toString();
}
