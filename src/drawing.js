// Mise en plan : projections 2D (vues de face, dessus, gauche, isométrique) sur un format avec cartouche
import { R } from "./occ.js";

const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420] };
const SCALES = [10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 25, 1 / 50, 1 / 100];
const scaleLabel = s => s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`;

function project(shape, dir, xAxis) {
  const cam = new R.ProjectionCamera([-dir[0] * 1e4, -dir[1] * 1e4, -dir[2] * 1e4], dir, xAxis);
  const { visible, hidden } = R.drawProjection(shape, cam);
  // ProjectionCamera : y = dir × x ; on veut y "vers le haut" à l'écran
  const vis = visible.toSVGPaths(), hid = hidden.toSVGPaths();
  const bb = visible.boundingBox; // en coordonnées caméra
  return { vis, hid, bb: { minX: bb.bounds[0][0], minY: bb.bounds[0][1], maxX: bb.bounds[1][0], maxY: bb.bounds[1][1] } };
}

// Vues (projection européenne) : dir = direction de regard
const VIEWS = {
  face: { label: "Vue de face", dir: [0, 0, -1], x: [1, 0, 0] },
  dessus: { label: "Vue de dessus", dir: [0, -1, 0], x: [1, 0, 0] },
  gauche: { label: "Vue de gauche", dir: [1, 0, 0], x: [0, 0, 1] },
  droite: { label: "Vue de droite", dir: [-1, 0, 0], x: [0, 0, -1] },
  iso: { label: "Isométrique", dir: [-1, -1, -1], x: [1, 0, -1] },
};

export function buildDrawing(shape, opts) {
  const [W, H] = SHEETS[opts.format] || SHEETS.A3;
  const margin = 10, tbH = 32, tbW = 180;
  const views = {};
  const vsel = opts.views || { face: true, dessus: true, gauche: true };
  for (const k of ["face", "dessus", "gauche", "iso"]) {
    if (k === "iso" && !opts.iso) continue;
    if (k !== "iso" && !vsel[k]) continue;
    const v = VIEWS[k]; const n = Math.hypot(...v.dir); const xn = Math.hypot(...v.x);
    views[k] = project(shape, v.dir.map(x => x / n), v.x.map(x => x / xn));
  }
  // Note : y caméra = dir × x. Pour la vue de face dir=-Z, x=X → y = -Y (inversé).
  // Les chemins SVG replicad inversent y : on obtient donc l'orientation correcte à l'écran.
  const sz = k => views[k] ? [views[k].bb.maxX - views[k].bb.minX, views[k].bb.maxY - views[k].bb.minY] : [0, 0];
  const [fw, fh] = sz("face"), [tw, th] = sz("dessus"), [lw, lh] = sz("gauche"), [iw, ih] = sz("iso");
  const gap = 25;
  const tableH = opts.table ? 8 + opts.table.length * 5 : 0;
  const availW = W - 2 * margin - 20, availH = H - 2 * margin - tbH - 20 - (opts.table ? Math.min(tableH, 60) : 0);
  let scale = opts.scale;
  if (!scale || scale === "auto") {
    scale = SCALES[SCALES.length - 1];
    for (const s of SCALES) {
      const totW = (fw + lw + (opts.iso ? iw : 0)) * s + gap * (opts.iso ? 3 : 2), totH = (fh + th) * s + gap * 2;
      if (totW <= availW && totH <= availH) { scale = s; break; }
    }
  }
  // positions (centres des vues, en mm papier)
  const x0 = margin + 15, y0 = margin + 15;
  const pos = {};
  pos.face = [x0 + fw * scale / 2 + gap / 2, y0 + fh * scale / 2 + gap / 2];
  pos.dessus = [pos.face[0], pos.face[1] + fh * scale / 2 + gap + th * scale / 2];
  pos.gauche = [pos.face[0] + fw * scale / 2 + gap + lw * scale / 2, pos.face[1]];
  let isoScale = scale * 0.8;
  if (opts.iso && iw > 0 && ih > 0) {
    // zone libre à droite des vues, au-dessus du cartouche / de la liste de débit
    const leftEdge = Math.max(pos.face[0] + fw * scale / 2, vsel.gauche ? pos.gauche[0] + lw * scale / 2 : 0) + gap;
    const bottomEdge = H - margin - tbH - 10 - (opts.table ? 5 * (opts.table.length + 1) + 6 : 0);
    let bx0 = leftEdge, by0 = margin + 12, bx1 = W - margin - 10, by1 = bottomEdge;
    if (bx1 - bx0 < 60) { // pas de place à droite : sous la vue de dessus
      bx0 = margin + 15; bx1 = W - margin - tbW - 20; by0 = pos.dessus[1] + th * scale / 2 + gap; by1 = H - margin - 10;
    }
    isoScale = Math.min(scale, (bx1 - bx0) / iw, (by1 - by0 - 8) / ih) * 0.95;
    pos.iso = [(bx0 + bx1) / 2, by0 + (by1 - by0 - 8) / 2];
  }
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  out.push(`<rect x="${margin}" y="${margin}" width="${W - 2 * margin}" height="${H - 2 * margin}" fill="none" stroke="#000" stroke-width="0.5"/>`);
  const dims = [];
  for (const [k, v] of Object.entries(views)) {
    const s = k === "iso" ? isoScale : scale;
    const cx = (v.bb.minX + v.bb.maxX) / 2, cy = (v.bb.minY + v.bb.maxY) / 2;
    const [px, py] = pos[k];
    // replicad toSVGPaths inverse y : y_svg = -y_cam
    const tf = `translate(${px} ${py}) scale(${s}) translate(${-cx} ${cy})`;
    out.push(`<g transform="${tf}" fill="none" stroke-linecap="round" stroke-linejoin="round">`);
    if (opts.hidden && k !== "iso") for (const p of v.hid) out.push(`<path d="${p}" stroke="#555" stroke-width="${0.25 / s}" stroke-dasharray="${2 / s} ${1.2 / s}"/>`);
    for (const p of v.vis) out.push(`<path d="${p}" stroke="#000" stroke-width="${0.45 / s}"/>`);
    out.push(`</g>`);
    out.push(`<text x="${px}" y="${py + (v.bb.maxY - v.bb.minY) * s / 2 + 8}" font-size="3.2" text-anchor="middle" fill="#333">${VIEWS[k].label}</text>`);
    if (k !== "iso" && opts.dims) {
      const w = v.bb.maxX - v.bb.minX, h = v.bb.maxY - v.bb.minY;
      const left = px - w * s / 2, right = px + w * s / 2, top = py - h * s / 2, bottom = py + h * s / 2;
      // cote horizontale au-dessus, verticale à gauche
      dims.push(dimH(left, right, top - 7, top, w));
      dims.push(dimV(top, bottom, left - 7, left, h));
    }
  }
  out.push(...dims);
  // cartouche
  const tx = W - margin - tbW, ty = H - margin - tbH;
  const today = new Date().toLocaleDateString("fr-FR");
  out.push(`<g stroke="#000" stroke-width="0.35" fill="none"><rect x="${tx}" y="${ty}" width="${tbW}" height="${tbH}"/>
  <line x1="${tx}" y1="${ty + 12}" x2="${tx + tbW}" y2="${ty + 12}"/><line x1="${tx}" y1="${ty + 22}" x2="${tx + tbW}" y2="${ty + 22}"/>
  <line x1="${tx + 60}" y1="${ty + 12}" x2="${tx + 60}" y2="${ty + tbH}"/><line x1="${tx + 120}" y1="${ty + 12}" x2="${tx + 120}" y2="${ty + tbH}"/></g>`);
  const t = (x, y, s, txt, w = "normal", anchor = "start") => `<text x="${x}" y="${y}" font-size="${s}" font-weight="${w}" text-anchor="${anchor}" fill="#000">${esc(txt)}</text>`;
  out.push(t(tx + 3, ty + 5.5, 4.2, opts.company || "G&L Créations", "bold"));
  out.push(t(tx + 3, ty + 10.3, 3.2, opts.title || "Pièce"));
  out.push(t(tx + tbW - 3, ty + 5.5, 2.6, opts.companyInfo || "Métallerie – Ferronnerie – Rénovation – 30140 Massillargues-Attuech", "normal", "end"));
  out.push(t(tx + tbW - 3, ty + 10.3, 2.6, "Unités : mm", "normal", "end"));
  out.push(t(tx + 2, ty + 15.5, 2.3, "Matériau"), t(tx + 2, ty + 20, 3, opts.material || "-", "bold"));
  out.push(t(tx + 62, ty + 15.5, 2.3, "Échelle"), t(tx + 62, ty + 20, 3, scaleLabel(scale), "bold"));
  out.push(t(tx + 122, ty + 15.5, 2.3, "Masse"), t(tx + 122, ty + 20, 3, opts.mass || "-", "bold"));
  out.push(t(tx + 2, ty + 25.5, 2.3, "Dessiné par"), t(tx + 2, ty + 30, 3, opts.author || "", "bold"));
  out.push(t(tx + 62, ty + 25.5, 2.3, "Date"), t(tx + 62, ty + 30, 3, today, "bold"));
  out.push(t(tx + 122, ty + 25.5, 2.3, "Format / Folio"), t(tx + 122, ty + 30, 3, (opts.format || "A3") + " – 1/1", "bold"));
  if (opts.notes) out.push(t(margin + 4, H - margin - 4, 3, opts.notes));
  // symbole de projection européenne
  out.push(`<g transform="translate(${tx - 22} ${ty + tbH - 12})" stroke="#000" stroke-width="0.3" fill="none"><path d="M0 2 L8 0 L8 10 L0 8 Z"/><circle cx="15" cy="5" r="4"/><circle cx="15" cy="5" r="2"/></g>`);
  if (opts.table && opts.table.length) {
    // liste de débit au-dessus du cartouche
    const cols = [["N°", 10], ["Profilé", 62], ["Long. (mm)", 26], ["Coupes", 34], ["Qté", 14], ["Masse (kg)", 34]];
    const rowH = 5, tw2 = cols.reduce((a, c) => a + c[1], 0);
    let yy = ty - 4 - rowH * (opts.table.length + 1); const xx = W - margin - tw2;
    out.push(`<g stroke="#000" stroke-width="0.25" fill="none"><rect x="${xx}" y="${yy}" width="${tw2}" height="${rowH * (opts.table.length + 1)}"/></g>`);
    let cx = xx;
    for (const [lab, w] of cols) { out.push(t(cx + 1.5, yy + 3.6, 2.6, lab, "bold")); cx += w; out.push(`<line x1="${cx}" y1="${yy}" x2="${cx}" y2="${yy + rowH * (opts.table.length + 1)}" stroke="#000" stroke-width="0.2"/>`); }
    opts.table.forEach((r, i) => {
      const y = yy + rowH * (i + 1); out.push(`<line x1="${xx}" y1="${y}" x2="${xx + tw2}" y2="${y}" stroke="#000" stroke-width="0.2"/>`);
      const vals = [String(i + 1), r.profile, fmt(r.length), r.cuts.length ? r.cuts.map(c => fmt(c) + "°").join(" / ") : "droit", String(r.qty), fmt(r.mass * r.qty)];
      let x2 = xx; vals.forEach((v, j) => { out.push(t(x2 + 1.5, y + 3.6, 2.5, v)); x2 += cols[j][1]; });
    });
  }
  out.push(`</svg>`);
  return { svg: out.join("\n"), scale, W, H };
}
const fmt = x => (Math.round(x * 10) / 10).toString().replace(".", ",");
function arrow(x, y, ang) { const a = 2.2, b = 0.7; const c = Math.cos(ang), s = Math.sin(ang); return `<path d="M${x} ${y} L${x - a * c + b * s} ${y - a * s - b * c} L${x - a * c - b * s} ${y - a * s + b * c} Z" fill="#000"/>`; }
function dimH(x1, x2, y, yRef, val) {
  return `<g stroke="#000" stroke-width="0.18"><line x1="${x1}" y1="${yRef - 1}" x2="${x1}" y2="${y - 2}"/><line x1="${x2}" y1="${yRef - 1}" x2="${x2}" y2="${y - 2}"/><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/></g>${arrow(x1, y, Math.PI)}${arrow(x2, y, 0)}<text x="${(x1 + x2) / 2}" y="${y - 1.2}" font-size="3" text-anchor="middle">${fmt(val)}</text>`;
}
function dimV(y1, y2, x, xRef, val) {
  return `<g stroke="#000" stroke-width="0.18"><line x1="${xRef - 1}" y1="${y1}" x2="${x - 2}" y2="${y1}"/><line x1="${xRef - 1}" y1="${y2}" x2="${x - 2}" y2="${y2}"/><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/></g>${arrow(x, y1, -Math.PI / 2)}${arrow(x, y2, Math.PI / 2)}<text transform="translate(${x - 1.2} ${(y1 + y2) / 2}) rotate(-90)" font-size="3" text-anchor="middle">${fmt(val)}</text>`;
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export { SHEETS, SCALES, scaleLabel };
