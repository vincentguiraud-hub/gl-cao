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
    const layers = [...this.layers].map((l, i) => `0\nLAYER\n2\n${l}\n70\n0\n62\n${l === "PLIAGE" ? 1 : l === "TEXTE" ? 3 : 7}\n6\n${l === "PLIAGE" ? "DASHED" : "CONTINUOUS"}`).join("\n");
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
      if (cross < 0) d.arc(c.c, c.r, ang(e.a), ang(e.b), layer); else d.arc(c.c, c.r, ang(e.b), ang(e.a), layer);
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
export function flatPatternDXF(info, name) {
  const d = new DXF(); const L = info.flat, W = info.width;
  d.line([0, 0], [L, 0]); d.line([L, 0], [L, W]); d.line([L, W], [0, W]); d.line([0, W], [0, 0]);
  for (const b of info.bends) { d.line([b.pos, 0], [b.pos, W], "PLIAGE"); d.text([b.pos + 2, W + 4], 4, `PLI ${b.dir.toUpperCase()} ${b.angle.toFixed(1)}° R${info.r}`, "TEXTE"); }
  d.text([0, -10], 5, `${name} - Ep ${info.t} - Developpe ${L.toFixed(2)} x ${W}`, "TEXTE");
  return d.toString();
}
