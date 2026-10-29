// Mode esquisse : outils de dessin 2D sur un plan, accrochages, cotes pilotantes
import * as THREE from "three";
import { v2, to3D, to2D, planeY, circleFrom3, arcSample, slotOutline } from "./geom.js";
import { solveSketch, cleanConstraints, REL_GLYPH, isDim, POINT_KEYS } from "./solver.js";

let uid = 0;
export const newId = (p = "e") => p + Date.now().toString(36) + (uid++).toString(36);

const C = { line: 0x1a1a1a, sel: 0x0a6cff, cons: 0x7a7f87, hover: 0xff8a00, preview: 0x0a84ff, point: 0x111111 };

export class Sketcher {
  constructor(viewer, plane, entities, ui, constraints) {
    this.v = viewer; this.plane = plane; this.ui = ui;
    this.ents = JSON.parse(JSON.stringify(entities || []));
    this.cons = JSON.parse(JSON.stringify(constraints || []));
    this.selPts = new Set(); this.showRels = true; this.autoRel = true; this.dofCache = null;
    this.tool = "line"; this.temp = []; this.sel = new Set(); this.hoverId = null;
    if (!constraints) for (const e of this.ents) if (e.t === "line" && e.g && e.gk === "rect") { if (Math.abs(e.a[1] - e.b[1]) < 1e-9) this.cons.push({ t: "h", e: e.id }); else if (Math.abs(e.a[0] - e.b[0]) < 1e-9) this.cons.push({ t: "v", e: e.id }); }
    this.undoStack = []; this.redoStack = [];
    this.gridSnap = true; this.showDims = true; this.polySides = 6; this.filletR = 5;
    this.labels = document.createElement("div"); this.labels.className = "sk-labels";
    viewer.container.appendChild(this.labels);
    this.snapGlyph = document.createElement("div"); this.snapGlyph.className = "snap-glyph"; viewer.container.appendChild(this.snapGlyph);
    this.onRender = () => this.updateLabels();
    viewer.onRender.push(this.onRender);
    this.bind();
    this.draw();
  }
  destroy() {
    this.unbind(); this.labels.remove(); this.snapGlyph.remove();
    this.v.onRender = this.v.onRender.filter(f => f !== this.onRender);
    this.v.sketchGroup.clear(); this.v.render();
  }
  // ----- historique
  state() { return JSON.stringify({ e: this.ents, c: this.cons }); }
  restore(s) { const o = JSON.parse(s); this.ents = o.e; this.cons = o.c; }
  snapshot() { this.undoStack.push(this.state()); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack = []; }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(this.state()); this.restore(this.undoStack.pop()); this.sel.clear(); this.selPts.clear(); this.changed(); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this.state()); this.restore(this.redoStack.pop()); this.sel.clear(); this.selPts.clear(); this.changed(); }
  changed() { this.cons = cleanConstraints(this.ents, this.cons); this.dofCache = null; this.draw(); this.ui.onSketchChange?.(this); }
  // résolution des contraintes ; renvoie false (et annule) en cas de conflit
  solve(opts = {}) {
    if (!this.cons.length) return true;
    const backup = JSON.stringify(this.ents);
    const r = solveSketch(this.ents, this.cons, opts);
    if (!r.ok && !opts.drag) { this.ents = JSON.parse(backup); return false; }
    return true;
  }
  dof() { if (this.dofCache == null) { try { this.dofCache = solveSketch(JSON.parse(JSON.stringify(this.ents)), this.cons, { dof: true }).dof; } catch { this.dofCache = -1; } } return this.dofCache; }
  addConstraint(c) {
    const key = JSON.stringify(c);
    if (this.cons.some(x => JSON.stringify(x) === key)) { this.ui.toast?.("Cette relation existe déjà"); return true; }
    this.snapshot(); this.cons.push(c);
    if (!this.solve()) { this.cons.pop(); this.undoStack.pop(); return false; }
    this.changed(); return true;
  }
  removeConstraint(i) { this.snapshot(); this.cons.splice(i, 1); this.changed(); }
  // cote pilotante : crée ou met à jour, puis résout
  setDim(match, c) {
    this.snapshot();
    const i = this.cons.findIndex(match);
    const old = i >= 0 ? { ...this.cons[i] } : null;
    if (i >= 0) this.cons[i] = { ...this.cons[i], ...c }; else this.cons.push(c);
    if (!this.solve()) { if (i >= 0) this.cons[i] = old; else this.cons.pop(); this.undoStack.pop(); this.ui.toast?.("Cette cote est en conflit avec les relations existantes (ou sur-contraint)", true); return false; }
    this.changed(); return true;
  }
  setTool(t) { this.tool = t; this.temp = []; this.preview = null; this.chainStart = null; this.draw(); this.ui.onSketchTool?.(t); }

  // ----- événements
  bind() {
    const el = this.v.renderer.domElement;
    this.h = {
      down: e => this.onDown(e), move: e => this.onMove(e), up: e => this.onUp(e), dbl: e => this.onDbl(e),
    };
    el.addEventListener("pointerdown", this.h.down); el.addEventListener("pointermove", this.h.move);
    el.addEventListener("pointerup", this.h.up); el.addEventListener("dblclick", this.h.dbl);
  }
  unbind() {
    const el = this.v.renderer.domElement;
    el.removeEventListener("pointerdown", this.h.down); el.removeEventListener("pointermove", this.h.move);
    el.removeEventListener("pointerup", this.h.up); el.removeEventListener("dblclick", this.h.dbl);
  }
  px() { return this.v.worldPerPixel(); }
  raw2D(e) { const P = this.v.rayPlane(e, this.plane); return P ? to2D(this.plane, P) : null; }
  gridStep() { const w = this.px() * 12; const p = Math.pow(10, Math.floor(Math.log10(w))); const m = w / p; return (m < 2 ? 2 : m < 5 ? 5 : 10) * p / 2; }
  snapPoints() {
    const pts = [{ p: [0, 0], k: "origine" }];
    for (const e of this.ents) {
      if (e.t === "line") { pts.push({ p: e.a, k: "extrémité" }, { p: e.b, k: "extrémité" }, { p: v2.mul(v2.add(e.a, e.b), 0.5), k: "milieu" }); }
      if (e.t === "arc") { pts.push({ p: e.a, k: "extrémité" }, { p: e.b, k: "extrémité" }); const c = circleFrom3(e.a, e.m, e.b); if (c) pts.push({ p: c.c, k: "centre" }); }
      if (e.t === "circle") { pts.push({ p: e.c, k: "centre" }); for (let i = 0; i < 4; i++) pts.push({ p: [e.c[0] + e.r * Math.cos(i * Math.PI / 2), e.c[1] + e.r * Math.sin(i * Math.PI / 2)], k: "quadrant" }); }
      if (e.t === "slot") pts.push({ p: e.a, k: "centre" }, { p: e.b, k: "centre" });
      if (e.t === "point") pts.push({ p: e.p, k: "point" });
    }
    return pts;
  }
  snap(e, ref = null) {
    const r = this.raw2D(e); if (!r) return null;
    const tol = this.px() * 9;
    let best = null, bd = tol;
    for (const s of this.snapPoints()) { const d = v2.dist(s.p, r); if (d < bd) { bd = d; best = s; } }
    if (best) { this.showSnap(best.k, e); this.lastInfer = ""; return [...best.p]; }
    let p = [...r];
    let label = "";
    if (ref) {
      // inférence horizontale / verticale
      const d = v2.sub(p, ref);
      if (Math.abs(d[1]) < tol * 0.8 && Math.abs(d[0]) > tol) { p[1] = ref[1]; label = "horizontal"; }
      else if (Math.abs(d[0]) < tol * 0.8 && Math.abs(d[1]) > tol) { p[0] = ref[0]; label = "vertical"; }
    }
    if (this.gridSnap) {
      const g = this.gridStep();
      if (label !== "vertical") p[0] = Math.round(p[0] / g) * g;
      if (label !== "horizontal") p[1] = Math.round(p[1] / g) * g;
    }
    // alignement avec des points existants
    if (!label) for (const s of this.snapPoints()) {
      if (Math.abs(s.p[0] - r[0]) < tol * 0.6) { p[0] = s.p[0]; label = "aligné"; }
      if (Math.abs(s.p[1] - r[1]) < tol * 0.6) { p[1] = s.p[1]; label = "aligné"; }
    }
    this.showSnap(label, e); this.lastInfer = label;
    p = p.map(x => Math.round(x * 1e6) / 1e6);
    return p;
  }
  showSnap(k, e) {
    if (!k) { this.snapGlyph.style.display = "none"; return; }
    const r = this.v.container.getBoundingClientRect();
    this.snapGlyph.style.display = "block"; this.snapGlyph.textContent = k;
    this.snapGlyph.style.left = (e.clientX - r.left + 14) + "px"; this.snapGlyph.style.top = (e.clientY - r.top + 12) + "px";
  }
  hit(p2) {
    const tol = this.px() * 7; let best = null, bd = tol;
    for (const e of this.ents) { const d = entDist(e, p2); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  pointHandle(p2) {
    const tol = this.px() * 8;
    for (const e of this.ents) for (const k of handleKeys(e)) if (v2.dist(e[k], p2) < tol) return { e, k };
    return null;
  }
  onDown(e) {
    if (e.button !== 0) return;
    this.downAt = [e.clientX, e.clientY];
    const p = this.raw2D(e); if (!p) return;
    if (this.tool === "select") {
      const h = this.pointHandle(p);
      if (h) { this.drag = { ...h, from: [...h.e[h.k]], start: [...h.e[h.k]] }; this.snapshot(); this.v.controls.enabled = false; return; }
    }
  }
  onUp(e) {
    if (e.button !== 0) return;
    this.v.controls.enabled = true;
    if (this.drag) {
      const moved = !v2.eq(this.drag.start, this.drag.e[this.drag.k], 1e-4); const dr = this.drag; this.drag = null;
      if (moved) { if (this.cons.length) solveSketch(this.ents, this.cons, { force: true }); this.changed(); return; }
      this.undoStack.pop();
      // simple clic sur un point : sélection du point
      if (this.tool === "select") { const key = dr.e.id + ":" + dr.k; if (!e.shiftKey && !e.ctrlKey) { this.sel.clear(); this.selPts.clear(); } if (this.selPts.has(key)) this.selPts.delete(key); else this.selPts.add(key); this.draw(); this.ui.onSketchSelect?.(this); return; }
    }
    if (this.downAt && Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 6 && e.pointerType !== "touch") return;
    this.click(e);
  }
  onMove(e) {
    const p = this.raw2D(e); if (!p) return;
    if (this.drag) {
      const np = this.snap(e);
      if (this.cons.length) { solveSketch(this.ents, this.cons, { drag: { e: this.drag.e, k: this.drag.k, to: np }, force: true }); }
      else if (this.drag.e.g && this.drag.e.gk === "rect") moveRectCorner(this.ents, this.drag.e.g, this.drag.from, np);
      else movePoint(this.ents, this.drag.from, np, this.drag.e, this.drag.k);
      this.drag.from = [...this.drag.e[this.drag.k]];
      this.draw(); return;
    }
    if (this.tool === "select" || this.tool === "trim" || this.tool === "dim" || this.tool === "fillet") {
      const h = this.hit(p); const id = h ? h.id : null;
      if (id !== this.hoverId) { this.hoverId = id; this.draw(); }
      this.snapGlyph.style.display = "none";
      return;
    }
    const last = this.temp[this.temp.length - 1];
    this.cursor = this.snap(e, last);
    this.updatePreview(); this.draw();
  }
  onDbl() { if (this.tool === "line") { this.temp = []; this.preview = null; this.draw(); } }
  key(e) {
    if (e.key === "Escape") { if (this.temp.length) { this.temp = []; this.preview = null; this.draw(); } else this.setTool("select"); return true; }
    if ((e.key === "Delete" || e.key === "Backspace") && this.sel.size) { this.deleteSelected(); return true; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { this.undo(); return true; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { this.redo(); return true; }
    return false;
  }
  deleteSelected() { this.snapshot(); this.ents = this.ents.filter(x => !this.sel.has(x.id)); this.sel.clear(); this.selPts.clear(); this.changed(); }
  add(...es) { for (const e of es) { e.id ||= newId(); this.ents.push(e); } }

  click(e) {
    const t = this.tool;
    if (t === "select" || t === "dim") {
      const p = this.raw2D(e); const h = p && this.hit(p);
      if (t === "dim") {
        const ph = p && this.pointHandle(p);
        const origin = p && v2.dist(p, [0, 0]) < this.px() * 8 ? { e: null, k: null, p: [0, 0] } : null;
        const pt = ph ? { p: [...ph.e[ph.k]], ref: { e: ph.e.id, k: ph.k } } : origin ? { p: [0, 0], ref: null } : null;
        if (pt) {
          if (this.dimFirst && !v2.eq(this.dimFirst.p, pt.p)) { const a = this.dimFirst; this.dimFirst = null; this.draw(); this.ui.editDistance?.(this, a, pt, e); return; }
          this.dimFirst = pt; this.draw(); return;
        }
        this.dimFirst = null;
        if (h) this.ui.editDim?.(this, h, e); return;
      }
      if (!e.shiftKey && !e.ctrlKey) { this.sel.clear(); this.selPts.clear(); }
      if (h) { if (this.sel.has(h.id)) this.sel.delete(h.id); else this.sel.add(h.id); }
      this.draw(); this.ui.onSketchSelect?.(this); return;
    }
    if (t === "trim") {
      const p = this.raw2D(e); const h = p && this.hit(p);
      if (h) {
        this.snapshot(); const before = new Set(this.ents.map(x => x.id)); const keep = this.cons.filter(c => (c.t === "h" || c.t === "v") && c.e === h.id);
        trimEntity(this.ents, h, p);
        for (const n of this.ents.filter(x => !before.has(x.id) && x.t === "line")) for (const c of keep) this.cons.push({ t: c.t, e: n.id });
        this.changed();
      }
      return;
    }
    if (t === "fillet") {
      const p = this.raw2D(e);
      if (p) {
        this.snapshot(); const before = new Set(this.ents.map(x => x.id));
        if (!sketchFillet(this.ents, p, this.filletR, this.px() * 10)) this.undoStack.pop();
        else {
          const arc = this.ents.find(x => !before.has(x.id) && x.t === "arc");
          if (arc) for (const l of this.ents.filter(x => x.t === "line" && (v2.eq(x.a, arc.a) || v2.eq(x.b, arc.a) || v2.eq(x.a, arc.b) || v2.eq(x.b, arc.b)))) this.cons.push({ t: "tan", e1: l.id, e2: arc.id });
          this.changed();
        }
      }
      return;
    }
    const p = this.snap(e, this.temp[this.temp.length - 1]); if (!p) return;
    const tp = this.temp;
    switch (t) {
      case "line": case "centerline": {
        if (!tp.length) { tp.push(p); this.chainStart = p; break; }
        const a = tp[tp.length - 1]; if (v2.eq(a, p)) { this.temp = []; break; }
        this.snapshot(); const nl = { t: "line", a, b: p, cons: t === "centerline" }; this.add(nl);
        if (this.autoRel) { if (Math.abs(a[1] - p[1]) < 1e-9 && this.lastInfer === "horizontal") this.cons.push({ t: "h", e: nl.id }); else if (Math.abs(a[0] - p[0]) < 1e-9 && this.lastInfer === "vertical") this.cons.push({ t: "v", e: nl.id }); }
        this.changed();
        if (t === "centerline" || (this.chainStart && v2.eq(p, this.chainStart) && tp.length > 1)) { this.temp = []; this.chainStart = null; }
        else tp.push(p);
        break;
      }
      case "rect": case "crect": {
        if (!tp.length) { tp.push(p); break; }
        const [a] = tp; const c = t === "crect" ? [2 * a[0] - p[0], 2 * a[1] - p[1]] : a;
        if (Math.abs(p[0] - c[0]) < 1e-9 || Math.abs(p[1] - c[1]) < 1e-9) break;
        this.snapshot(); const rl = rectLines(c, p); this.add(...rl);
        if (this.autoRel) rl.forEach((l, i) => this.cons.push({ t: i % 2 ? "v" : "h", e: l.id }));
        this.temp = []; this.changed(); break;
      }
      case "circle": {
        if (!tp.length) { tp.push(p); break; }
        const r = v2.dist(tp[0], p); if (r < 1e-6) break;
        this.snapshot(); this.add({ t: "circle", c: tp[0], r: round(r) }); this.temp = []; this.changed(); break;
      }
      case "arc": {
        if (tp.length < 2) { if (tp.length === 1 && v2.eq(tp[0], p)) break; tp.push(p); break; }
        if (!circleFrom3(tp[0], p, tp[1])) break;
        this.snapshot(); this.add({ t: "arc", a: tp[0], b: tp[1], m: p }); this.temp = []; this.changed(); break;
      }
      case "carc": {
        if (tp.length < 2) { if (tp.length === 1 && v2.eq(tp[0], p)) break; tp.push(p); break; }
        const a = arcCenter(tp[0], tp[1], p); if (!a) break;
        this.snapshot(); this.add(a); this.temp = []; this.changed(); break;
      }
      case "tarc": {
        if (!tp.length) {
          const l = this.ents.find(x => x.t === "line" && (v2.eq(x.a, p) || v2.eq(x.b, p)));
          const ar = this.ents.find(x => x.t === "arc" && (v2.eq(x.a, p) || v2.eq(x.b, p)));
          if (!l && !ar) { this.ui.toast?.("Commencez l'arc tangent sur l'extrémité d'une ligne ou d'un arc"); break; }
          this.tanDir = l ? (v2.eq(l.b, p) ? v2.norm(v2.sub(l.b, l.a)) : v2.norm(v2.sub(l.a, l.b))) : arcEndTangent(ar, p);
          tp.push(p); break;
        }
        const a = arcTangent(tp[0], this.tanDir, p); if (!a) break;
        this.snapshot(); this.add(a); this.temp = []; this.changed(); break;
      }
      case "poly": {
        if (!tp.length) { tp.push(p); break; }
        const r = v2.dist(tp[0], p); if (r < 1e-6) break;
        const a0 = Math.atan2(p[1] - tp[0][1], p[0] - tp[0][0]);
        this.snapshot(); this.add(...polyLines(tp[0], r, this.polySides, a0)); this.temp = []; this.changed(); break;
      }
      case "slot": {
        if (tp.length < 2) { if (tp.length === 1 && v2.eq(tp[0], p)) break; tp.push(p); break; }
        const r = distPointLine(p, tp[0], tp[1]); if (r < 1e-6) break;
        this.snapshot(); this.add({ t: "slot", a: tp[0], b: tp[1], r: round(r) }); this.temp = []; this.changed(); break;
      }
      case "point": this.snapshot(); this.add({ t: "point", p }); this.changed(); break;
    }
    this.updatePreview(); this.draw();
  }
  updatePreview() {
    const tp = this.temp, c = this.cursor; this.preview = null;
    if (!tp.length || !c) return;
    switch (this.tool) {
      case "line": case "centerline": this.preview = [{ t: "line", a: tp[tp.length - 1], b: c, cons: this.tool === "centerline" }]; break;
      case "rect": this.preview = rectLines(tp[0], c); break;
      case "crect": this.preview = rectLines([2 * tp[0][0] - c[0], 2 * tp[0][1] - c[1]], c); break;
      case "circle": this.preview = [{ t: "circle", c: tp[0], r: v2.dist(tp[0], c) }]; break;
      case "arc": this.preview = tp.length === 1 ? [{ t: "line", a: tp[0], b: c, cons: true }] : (circleFrom3(tp[0], c, tp[1]) ? [{ t: "arc", a: tp[0], b: tp[1], m: c }] : null); break;
      case "carc": this.preview = tp.length === 1 ? [{ t: "circle", c: tp[0], r: v2.dist(tp[0], c), cons: true }] : [arcCenter(tp[0], tp[1], c)].filter(Boolean); break;
      case "tarc": this.preview = [arcTangent(tp[0], this.tanDir, c)].filter(Boolean); break;
      case "poly": this.preview = polyLines(tp[0], v2.dist(tp[0], c), this.polySides, Math.atan2(c[1] - tp[0][1], c[0] - tp[0][0])); break;
      case "slot": this.preview = tp.length === 1 ? [{ t: "line", a: tp[0], b: c, cons: true }] : [{ t: "slot", a: tp[0], b: tp[1], r: distPointLine(c, tp[0], tp[1]) }]; break;
    }
  }
  // ----- rendu
  draw() {
    const g = this.v.sketchGroup; g.clear();
    const P = p => new THREE.Vector3(...to3D(this.plane, p));
    const addEnt = (e, color, dashed) => {
      const pts = entPoints(e).map(P);
      if (e.t === "point") {
        const m = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ color, size: 7, sizeAttenuation: false, depthTest: false }));
        m.renderOrder = 30; g.add(m); return;
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: this.px() * 8, gapSize: this.px() * 4, depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false });
      const l = new THREE.Line(geo, mat); if (dashed) l.computeLineDistances(); l.renderOrder = 30; g.add(l);
    };
    const full = this.cons.length && this.ents.length && this.dof() === 0;
    for (const e of this.ents) {
      const col = this.sel.has(e.id) ? C.sel : e.id === this.hoverId ? C.hover : e.cons ? C.cons : (full ? 0x111111 : 0x1f5fbf);
      addEnt(e, col, !!e.cons);
    }
    if (this.preview) for (const e of this.preview) addEnt(e, C.preview, !!e.cons);
    // points d'extrémité
    const ends = [];
    for (const e of this.ents) for (const k of handleKeys(e)) ends.push(P(e[k]));
    for (const t of this.temp) ends.push(P(t));
    if (ends.length) { const m = new THREE.Points(new THREE.BufferGeometry().setFromPoints(ends), new THREE.PointsMaterial({ color: 0x1f2937, size: 5, sizeAttenuation: false, depthTest: false })); m.renderOrder = 31; g.add(m); }
    if (this.selPts.size) { const pts = [...this.selPts].map(k => { const [id, kk] = k.split(":"); const en = this.ents.find(x => x.id === id); return en ? P(en[kk]) : null; }).filter(Boolean); const m = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ color: C.sel, size: 10, sizeAttenuation: false, depthTest: false })); m.renderOrder = 33; g.add(m); }
    if (this.dimFirst) { const m = new THREE.Points(new THREE.BufferGeometry().setFromPoints([P(this.dimFirst.p)]), new THREE.PointsMaterial({ color: 0xff8a00, size: 11, sizeAttenuation: false, depthTest: false })); m.renderOrder = 32; g.add(m); }
    if (this.showGrid) this.drawGrid(g, P);
    // origine de l'esquisse
    const o = P([0, 0]); const s = this.px() * 18;
    const ax = new THREE.BufferGeometry().setFromPoints([P([-s, 0]), P([s, 0])]), ay = new THREE.BufferGeometry().setFromPoints([P([0, -s]), P([0, s])]);
    g.add(new THREE.Line(ax, new THREE.LineBasicMaterial({ color: 0xd03030, depthTest: false })), new THREE.Line(ay, new THREE.LineBasicMaterial({ color: 0x30a030, depthTest: false })));
    void o;
    // grille
    this.v.render();
  }
  drawGrid(g, P) {
    const step = this.gridStep() * 2; const c = this.v.controls.target.toArray(); const c2 = to2D(this.plane, c);
    const half = (this.v.camera.top - this.v.camera.bottom) / this.v.camera.zoom * 1.2;
    const n = Math.min(120, Math.ceil(half / step));
    const x0 = Math.round(c2[0] / step) * step, y0 = Math.round(c2[1] / step) * step;
    const pts = [];
    for (let i = -n; i <= n; i++) {
      pts.push(P([x0 + i * step, y0 - n * step]), P([x0 + i * step, y0 + n * step]));
      pts.push(P([x0 - n * step, y0 + i * step]), P([x0 + n * step, y0 + i * step]));
    }
    const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9fb0c2, transparent: true, opacity: 0.35, depthTest: false }));
    ls.renderOrder = 29; g.add(ls);
  }
  // déplacer / copier / pivoter les entités sélectionnées
  transformSelected(fn, copy, keepOrient = true) {
    const sel = this.ents.filter(e => this.sel.has(e.id)); if (!sel.length) return "Sélectionnez des entités";
    this.snapshot();
    const gmap = {}, idmap = {};
    for (const e of sel) {
      const c = copy ? JSON.parse(JSON.stringify(e)) : e;
      if (copy) { c.id = newId(); idmap[e.id] = c.id; if (c.g) c.g = gmap[c.g] ||= newId("g"); }
      for (const k of ["a", "b", "m", "c", "p", "pc"]) if (c[k]) c[k] = fn(c[k]).map(round);
      if (copy) this.ents.push(c);
    }
    const orientRel = c => ["h", "v", "hpts", "vpts", "fix", "angle"].includes(c.t);
    if (copy) this.copyConstraints(idmap, c => keepOrient || !orientRel(c));
    else if (!keepOrient) { const ids = new Set(sel.map(e => e.id)); this.cons = this.cons.filter(c => !(orientRel(c) && [c.e, c.e1, c.e2, c.p?.e, c.p1?.e, c.p2?.e].some(x => ids.has(x)))); }
    if (!copy) { const ids = new Set(sel.map(e => e.id)); this.cons = this.cons.filter(c => !(c.t === "fix" && ids.has(c.p?.e))); if (this.cons.length) solveSketch(this.ents, this.cons, { force: true }); }
    this.changed(); return null;
  }
  // duplique les relations internes à un groupe d'entités copiées
  copyConstraints(idmap, filter = () => true) {
    const add = [];
    for (const c of this.cons) {
      const refs = [c.e, c.e1, c.e2, c.p?.e, c.p1?.e, c.p2?.e].filter(Boolean);
      if (!refs.length || !refs.every(id => idmap[id]) || !filter(c)) continue;
      const n = JSON.parse(JSON.stringify(c));
      for (const k of ["e", "e1", "e2"]) if (n[k]) n[k] = idmap[n[k]];
      for (const k of ["p", "p1", "p2"]) if (n[k]) n[k].e = idmap[n[k].e];
      add.push(n);
    }
    this.cons.push(...add);
  }
  moveSelected(dx, dy, copy) { return this.transformSelected(p => [p[0] + dx, p[1] + dy], copy); }
  rotateSelected(cx, cy, deg, copy) { const a = deg * Math.PI / 180; return this.transformSelected(p => v2.add([cx, cy], v2.rot(v2.sub(p, [cx, cy]), a)), copy, Math.abs(deg % 90) < 1e-9 && false); }
  // cote entre deux points : déplace le second point (et tout ce qui y est relié)
  setDistance(p1, p2, val, mode) {
    let target;
    if (mode === "h") target = [p1[0] + Math.sign(p2[0] - p1[0] || 1) * val, p2[1]];
    else if (mode === "v") target = [p2[0], p1[1] + Math.sign(p2[1] - p1[1] || 1) * val];
    else { const d = v2.norm(v2.sub(p2, p1)); target = v2.add(p1, v2.mul(d, val)); }
    if (v2.eq(p2, [0, 0])) { // l'origine est fixe : on déplace l'autre point
      const back = mode === "h" ? [p2[0] - Math.sign(p2[0] - p1[0] || 1) * val, p1[1]] : mode === "v" ? [p1[0], p2[1] - Math.sign(p2[1] - p1[1] || 1) * val] : v2.sub(p2, v2.mul(v2.norm(v2.sub(p2, p1)), val));
      movePointAll(this.ents, p1, back.map(round)); return;
    }
    const g = this.ents.find(e => e.g && e.gk === "rect" && (v2.eq(e.a, p2) || v2.eq(e.b, p2)));
    if (g) { // déplacer tout le rectangle pour garder sa forme
      const d = v2.sub(target, p2); const corners = new Map();
      for (const e of this.ents.filter(x => x.g === g.g)) for (const k of ["a", "b"]) corners.set(e[k].map(v => v.toFixed(6)).join(), [...e[k]]);
      const tmp = [...corners.values()].map((old, i) => { const t = [2e9 + i, 2e9 + i]; movePointAll(this.ents, old, t); return [t, v2.add(old, d).map(round)]; });
      for (const [t, nw] of tmp) movePointAll(this.ents, t, nw);
      return;
    }
    movePointAll(this.ents, p2, target.map(round));
  }
  updateLabels() {
    const out = [];
    const S = p => this.v.toScreen(to3D(this.plane, p));
    const fmt = x => (Math.round(x * 100) / 100).toString().replace(".", ",");
    const E = id => this.ents.find(x => x.id === id);
    const PT = r => { if (!r) return [0, 0]; const en = E(r.e); return en ? en[r.k] : [0, 0]; };
    const driven = new Set();
    // cotes pilotantes
    this.cons.forEach((c, i) => {
      let pos, txt;
      if (c.t === "len") { const e = E(c.e); if (!e) return; driven.add(e.id); const m = v2.mul(v2.add(e.a, e.b), 0.5); const d = v2.norm(v2.sub(e.b, e.a)); pos = S(v2.add(m, v2.mul([-d[1], d[0]], this.px() * 16))); txt = fmt(c.val); }
      else if (c.t === "rad" || c.t === "dia") { const e = E(c.e); if (!e) return; driven.add(e.id); const cc = e.t === "circle" ? { c: e.c, r: e.r } : circleFrom3(e.a, e.m, e.b); if (!cc) return; pos = S([cc.c[0] + cc.r * 0.7071, cc.c[1] + cc.r * 0.7071]); txt = (c.t === "dia" ? "Ø" : "R") + fmt(c.val); }
      else if (c.t === "dist") { const p1 = PT(c.p1), p2 = c.p2 ? PT(c.p2) : [0, 0]; const m = v2.mul(v2.add(p1, p2), 0.5); pos = S(v2.add(m, [0, this.px() * 12])); txt = (c.mode === "h" ? "↔ " : c.mode === "v" ? "↕ " : "") + fmt(c.val); }
      else if (c.t === "angle") { const e1 = E(c.e1); if (!e1) return; pos = S(v2.mul(v2.add(e1.a, e1.b), 0.5)); pos = [pos[0] + 14, pos[1] + 14]; txt = fmt(c.val) + "°"; }
      else return;
      out.push(`<div class="sk-dim drv" data-ci="${i}" style="left:${pos[0]}px;top:${pos[1]}px">${txt}</div>`);
    });
    // cotes d'information (non pilotantes)
    if (this.showDims) {
      const seenGroup = new Set();
      for (const e of this.ents) {
        if (e.cons || e.t === "point" || driven.has(e.id)) continue;
        let pos, txt;
        if (e.t === "line") {
          if (e.g && e.gk === "poly") { if (seenGroup.has(e.g)) continue; seenGroup.add(e.g); }
          const m = v2.mul(v2.add(e.a, e.b), 0.5); const d = v2.norm(v2.sub(e.b, e.a)); const n = [-d[1], d[0]];
          pos = S(v2.add(m, v2.mul(n, this.px() * 14))); txt = fmt(v2.dist(e.a, e.b));
        } else if (e.t === "circle") { pos = S([e.c[0] + e.r * 0.7071, e.c[1] + e.r * 0.7071]); txt = "Ø" + fmt(2 * e.r); }
        else if (e.t === "arc") { const c = circleFrom3(e.a, e.m, e.b); if (!c) continue; pos = S(e.m); txt = "R" + fmt(c.r); }
        else if (e.t === "slot") { pos = S(v2.mul(v2.add(e.a, e.b), 0.5)); txt = fmt(v2.dist(e.a, e.b)) + " × " + fmt(2 * e.r); }
        out.push(`<div class="sk-dim info" data-id="${e.id}" style="left:${pos[0]}px;top:${pos[1]}px">${txt}</div>`);
      }
    }
    // symboles de relations
    if (this.showRels) {
      const cnt = new Map();
      for (const c of this.cons) {
        const g = REL_GLYPH[c.t]; if (!g) continue;
        const ids = [c.e, c.e1, c.e2, c.p?.e, c.p1?.e].filter(Boolean);
        for (const id of [...new Set(ids)]) {
          const e = E(id); if (!e) continue;
          let base = e.t === "line" ? v2.mul(v2.add(e.a, e.b), 0.5) : e.t === "circle" ? [e.c[0], e.c[1] - e.r] : e.t === "arc" ? e.m : e.t === "point" ? e.p : e.a;
          const n = cnt.get(id) || 0; cnt.set(id, n + 1);
          const sp = S(base);
          out.push(`<div class="sk-rel" title="${c.t}" style="left:${sp[0] + 10 + n * 15}px;top:${sp[1] + 10}px">${g}</div>`);
        }
      }
    }
    this.labels.innerHTML = out.join("");
    this.labels.querySelectorAll(".sk-dim.info").forEach(el => el.onpointerdown = ev => { ev.stopPropagation(); const ent = E(el.dataset.id); if (ent) this.ui.editDim?.(this, ent, ev); });
    this.labels.querySelectorAll(".sk-dim.drv").forEach(el => el.onpointerdown = ev => { ev.stopPropagation(); this.ui.editConstraintDim?.(this, +el.dataset.ci, ev); });
  }
  // ----- modifications de cotes
  setLineLength(e, L) {
    const d = v2.norm(v2.sub(e.b, e.a)); const nb = v2.add(e.a, v2.mul(d, L)); const delta = v2.sub(nb, e.b);
    if (e.g && e.gk === "rect") {
      // déplacer tout le côté opposé du rectangle
      const proj = q => v2.dot(v2.sub(q, e.a), d); const lim = proj(e.b) - 1e-6;
      const uniq = new Map();
      for (const x of this.ents.filter(x => x.g === e.g)) for (const k of ["a", "b"]) if (proj(x[k]) >= lim) uniq.set(x[k].map(v => v.toFixed(6)).join(), [...x[k]]);
      // déplacer chaque sommet une seule fois (ordre sûr : vers une position temporaire puis finale)
      const tmp = [...uniq.values()].map((old, i) => { const t = [1e9 + i, 1e9 + i]; movePointAll(this.ents, old, t); return [t, v2.add(old, delta)]; });
      for (const [t, nw] of tmp) movePointAll(this.ents, t, nw);
    } else movePointAll(this.ents, [...e.b], nb);
  }
  setLineAngle(e, deg) {
    const L = v2.dist(e.a, e.b); const a = deg * Math.PI / 180;
    movePointAll(this.ents, [...e.b], v2.add(e.a, [L * Math.cos(a), L * Math.sin(a)]));
  }
  setArcRadius(e, r) {
    const ch = v2.dist(e.a, e.b); if (r < ch / 2) r = ch / 2;
    const c0 = circleFrom3(e.a, e.m, e.b); const mid = v2.mul(v2.add(e.a, e.b), 0.5);
    const dir = v2.norm(v2.sub(e.m, mid)); const sag = r - Math.sqrt(Math.max(0, r * r - ch * ch / 4));
    const big = c0 && v2.dist(e.m, mid) > c0.r; // arc > demi-cercle
    e.m = v2.add(mid, v2.mul(dir, big ? 2 * r - sag : sag));
  }
  // symétrie des entités sélectionnées par rapport à un axe de construction sélectionné
  mirrorSelected() {
    const sel = this.ents.filter(e => this.sel.has(e.id));
    const axis = sel.find(e => e.t === "line" && e.cons);
    if (!axis) return "Sélectionnez des entités ET un axe de construction";
    const d = v2.norm(v2.sub(axis.b, axis.a));
    const M = p => { const q = v2.sub(p, axis.a); const t = v2.dot(q, d); const proj = v2.add(axis.a, v2.mul(d, t)); return v2.sub(v2.mul(proj, 2), p).map(round); };
    this.snapshot();
    const gmap = {}, idmap = {};
    for (const e of sel) {
      if (e === axis) continue;
      const c = JSON.parse(JSON.stringify(e)); c.id = newId(); idmap[e.id] = c.id;
      if (c.g) c.g = gmap[c.g] ||= newId("g");
      for (const k of ["a", "b", "m", "c", "p"]) if (c[k]) c[k] = M(c[k]);
      this.ents.push(c);
    }
    const hv = Math.abs(d[0]) < 1e-9 || Math.abs(d[1]) < 1e-9;
    this.copyConstraints(idmap, c => hv || !["h", "v", "hpts", "vpts", "fix", "angle"].includes(c.t));
    this.changed(); return null;
  }
  offsetSelected(dist) {
    const sel = this.ents.filter(e => this.sel.has(e.id));
    if (!sel.length) return "Sélectionnez des entités";
    this.snapshot();
    for (const e of sel) {
      const c = JSON.parse(JSON.stringify(e)); c.id = newId(); delete c.g;
      if (c.t === "circle") c.r = Math.max(0.01, c.r + dist);
      else if (c.t === "line") { const d = v2.norm(v2.sub(c.b, c.a)); const n = [-d[1] * dist, d[0] * dist]; c.a = v2.add(c.a, n); c.b = v2.add(c.b, n); }
      else if (c.t === "slot") c.r = Math.max(0.01, c.r + dist);
      else if (c.t === "arc") { const cc = circleFrom3(c.a, c.m, c.b); const k = (cc.r + dist) / cc.r; for (const key of ["a", "b", "m"]) c[key] = v2.add(cc.c, v2.mul(v2.sub(c[key], cc.c), k)); }
      this.ents.push(c);
    }
    this.changed(); return null;
  }
  linearPatternSelected(dx, dy, n) {
    const sel = this.ents.filter(e => this.sel.has(e.id)); if (!sel.length) return "Sélectionnez des entités";
    this.snapshot();
    for (let i = 1; i < n; i++) {
      const gmap = {}, idmap = {};
      for (const e of sel) {
        const c = JSON.parse(JSON.stringify(e)); c.id = newId(); idmap[e.id] = c.id; if (c.g) c.g = gmap[c.g] ||= newId("g");
        for (const k of ["a", "b", "m", "c", "p", "pc"]) if (c[k]) c[k] = [c[k][0] + dx * i, c[k][1] + dy * i];
        this.ents.push(c);
      }
      this.copyConstraints(idmap, c => c.t !== "fix");
    }
    this.changed(); return null;
  }
  // convertir les arêtes d'une face du modèle
  convertFace(face) {
    const P = p => to2D(this.plane, p).map(round);
    this.snapshot();
    for (const ed of face.edges) {
      const t = ed.geomType;
      const s = ed.startPoint.toTuple(), en = ed.endPoint.toTuple();
      if (t === "LINE") this.add({ t: "line", a: P(s), b: P(en) });
      else if (t === "CIRCLE") {
        const p1 = ed.pointAt(1 / 3).toTuple(), p2 = ed.pointAt(2 / 3).toTuple();
        if (v2.eq(P(s), P(en), 1e-4)) { const c = circleFrom3(P(s), P(p1), P(p2)); if (c) this.add({ t: "circle", c: c.c.map(round), r: round(c.r) }); }
        else this.add({ t: "arc", a: P(s), b: P(en), m: P(ed.pointAt(0.5).toTuple()) });
      } else {
        let prev = P(s);
        for (let i = 1; i <= 16; i++) { const q = P(ed.pointAt(i / 16).toTuple()); this.add({ t: "line", a: prev, b: q }); prev = q; }
      }
    }
    this.changed();
  }
}

// ---------- utilitaires d'entités
const round = x => Math.round(x * 1e6) / 1e6;
export function handleKeys(e) { return e.t === "line" || e.t === "arc" ? ["a", "b"] : e.t === "circle" ? ["c"] : e.t === "slot" ? ["a", "b"] : e.t === "point" ? ["p"] : []; }
export function rectLines(a, b) {
  const g = newId("g");
  const p1 = [a[0], a[1]], p2 = [b[0], a[1]], p3 = [b[0], b[1]], p4 = [a[0], b[1]];
  return [[p1, p2], [p2, p3], [p3, p4], [p4, p1]].map(([x, y]) => ({ id: newId(), t: "line", a: [...x], b: [...y], g, gk: "rect" }));
}
export function polyLines(c, r, n, a0) {
  const g = newId("g"); const pts = [];
  for (let i = 0; i < n; i++) { const t = a0 + i * 2 * Math.PI / n; pts.push([round(c[0] + r * Math.cos(t)), round(c[1] + r * Math.sin(t))]); }
  return pts.map((p, i) => ({ id: newId(), t: "line", a: p, b: [...pts[(i + 1) % n]], g, gk: "poly", pc: c, pr: r, pn: n }));
}
function arcCenter(c, a, p) {
  const r = v2.dist(c, a); if (r < 1e-9) return null;
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]); let a1 = Math.atan2(p[1] - c[1], p[0] - c[0]);
  let sw = a1 - a0; while (sw <= 0) sw += 2 * Math.PI; // sens trigonométrique
  if (sw > 2 * Math.PI - 1e-6) return null;
  const pt = t => [round(c[0] + r * Math.cos(t)), round(c[1] + r * Math.sin(t))];
  return { t: "arc", a: [...a], b: pt(a0 + sw), m: pt(a0 + sw / 2) };
}
function arcTangent(s, dir, p) {
  if (!dir) return null;
  const ch = v2.sub(p, s); const L = v2.len(ch); if (L < 1e-9) return null;
  const n = [-dir[1], dir[0]]; const k = v2.dot(ch, n); if (Math.abs(k) < 1e-9) return null;
  const r = (L * L) / (2 * k); const c = v2.add(s, v2.mul(n, r)); // r signé
  const R0 = Math.abs(r);
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]), a1 = Math.atan2(p[1] - c[1], p[0] - c[0]);
  let sw = a1 - a0; if (r > 0) { while (sw <= 0) sw += 2 * Math.PI; } else { while (sw >= 0) sw -= 2 * Math.PI; }
  const t = a0 + sw / 2;
  return { t: "arc", a: [...s], b: [...p], m: [round(c[0] + R0 * Math.cos(t)), round(c[1] + R0 * Math.sin(t))] };
}
function arcEndTangent(e, p) {
  const C0 = circleFrom3(e.a, e.m, e.b); if (!C0) return null;
  const rad = v2.norm(v2.sub(p, C0.c)); let tg = [-rad[1], rad[0]];
  // orienter dans le sens de parcours (de l'intérieur de l'arc vers l'extrémité)
  const other = v2.eq(e.b, p) ? e.m : e.m; const toward = v2.sub(p, other);
  if (v2.dot(tg, toward) < 0) tg = [-tg[0], -tg[1]];
  return tg;
}
function distPointLine(p, a, b) { const d = v2.norm(v2.sub(b, a)); return Math.abs(v2.cross(d, v2.sub(p, a))); }
function distPointSeg(p, a, b) {
  const ab = v2.sub(b, a); const l2 = v2.dot(ab, ab); if (!l2) return v2.dist(p, a);
  const t = Math.max(0, Math.min(1, v2.dot(v2.sub(p, a), ab) / l2)); return v2.dist(p, v2.add(a, v2.mul(ab, t)));
}
export function entPoints(e) {
  if (e.t === "line") return [e.a, e.b];
  if (e.t === "circle") { const p = []; for (let i = 0; i <= 64; i++) { const t = i / 64 * 2 * Math.PI; p.push([e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)]); } return p; }
  if (e.t === "arc") return arcSample(e, 48);
  if (e.t === "slot") { const o = slotOutline(e, 16); o.push(o[0]); return o; }
  if (e.t === "point") return [e.p];
  return [];
}
export function entDist(e, p) {
  if (e.t === "point") return v2.dist(e.p, p);
  if (e.t === "circle") return Math.abs(v2.dist(e.c, p) - e.r);
  const pts = entPoints(e); let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distPointSeg(p, pts[i], pts[i + 1]));
  return d;
}
function movePoint(ents, from, to) { movePointAll(ents, from, to); }
// déplacer un coin de rectangle : le coin opposé reste fixe, les deux autres suivent
function moveRectCorner(ents, g, from, to) {
  const lines = ents.filter(e => e.g === g);
  const pts = []; for (const e of lines) for (const k of ["a", "b"]) if (!pts.some(q => v2.eq(q, e[k]))) pts.push([...e[k]]);
  if (pts.length !== 4) return movePointAll(ents, from, to);
  const opp = pts.reduce((best, q) => v2.dist(q, from) > v2.dist(best, from) ? q : best, pts[0]);
  const others = pts.filter(q => !v2.eq(q, from) && !v2.eq(q, opp));
  // coin partageant x avec "from" -> prend x de "to"
  const plan = others.map(q => [q, Math.abs(q[0] - from[0]) < 1e-6 ? [to[0], q[1]] : [q[0], to[1]]]);
  plan.push([from, to]);
  const tmp = plan.map(([old, nw], i) => { const t = [3e9 + i, 3e9 + i]; movePointAll(ents, old, t); return [t, nw]; });
  for (const [t, nw] of tmp) movePointAll(ents, t, nw);
}
export function movePointAll(ents, from, to) {
  for (const e of ents) for (const k of handleKeys(e)) if (v2.eq(e[k], from, 1e-6)) {
    if (e.t === "arc") { // conserver la forme de l'arc approximativement
      const other = k === "a" ? e.b : e.a; const oldMid = e.m; const oldChord = v2.sub(from, other), newChord = v2.sub(to, other);
      const s = v2.len(newChord) / (v2.len(oldChord) || 1); const ang = Math.atan2(newChord[1], newChord[0]) - Math.atan2(oldChord[1], oldChord[0]);
      e.m = v2.add(other, v2.rot(v2.mul(v2.sub(oldMid, other), s), ang));
    }
    e[k] = [...to];
  }
}
// ---------- ajuster (trim)
function segInter(a, b, c, d) {
  const r = v2.sub(b, a), s = v2.sub(d, c); const den = v2.cross(r, s); if (Math.abs(den) < 1e-12) return null;
  const t = v2.cross(v2.sub(c, a), s) / den, u = v2.cross(v2.sub(c, a), r) / den;
  if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) return t; return null;
}
function trimEntity(ents, e, p) {
  if (e.t === "line") {
    const ts = [0, 1];
    for (const o of ents) {
      if (o === e || o.t === "point") continue;
      const pts = entPoints(o);
      for (let i = 0; i < pts.length - 1; i++) { const t = segInter(e.a, e.b, pts[i], pts[i + 1]); if (t != null) ts.push(t); }
    }
    ts.sort((x, y) => x - y);
    const ab = v2.sub(e.b, e.a); const tp = v2.dot(v2.sub(p, e.a), ab) / v2.dot(ab, ab);
    let lo = 0, hi = 1; for (const t of ts) { if (t <= tp) lo = t; if (t > tp) { hi = t; break; } }
    const idx = ents.indexOf(e); ents.splice(idx, 1);
    const P = t => v2.add(e.a, v2.mul(ab, t)).map(round);
    if (lo > 1e-9) ents.push({ ...e, id: newId(), b: P(lo), g: undefined });
    if (hi < 1 - 1e-9) ents.push({ ...e, id: newId(), a: P(hi), g: undefined });
    // retirer le groupe des autres lignes du rectangle (le rectangle n'est plus rigide)
    if (e.g) for (const o of ents) if (o.g === e.g) o.g = undefined;
  } else if (e.t === "circle" || e.t === "arc") {
    // découpe d'un cercle : conserver l'arc opposé entre les deux intersections les plus proches
    const C0 = e.t === "circle" ? { c: e.c, r: e.r } : circleFrom3(e.a, e.m, e.b);
    const angs = [];
    for (const o of ents) {
      if (o === e || o.t === "point") continue;
      const pts = entPoints(o);
      for (let i = 0; i < pts.length - 1; i++) for (const q of segCircle(pts[i], pts[i + 1], C0)) angs.push(Math.atan2(q[1] - C0.c[1], q[0] - C0.c[0]));
    }
    if (e.t === "circle") {
      if (angs.length < 2) { ents.splice(ents.indexOf(e), 1); return; }
      const ap = Math.atan2(p[1] - C0.c[1], p[0] - C0.c[0]);
      const norm = x => ((x - ap) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const sorted = angs.map(norm).sort((x, y) => x - y);
      const a1 = ap + sorted[0], a0 = ap + sorted[sorted.length - 1] - 2 * Math.PI; // portion cliquée entre a0 et a1
      const sweep = 2 * Math.PI - (a1 - a0);
      const pt = t => [round(C0.c[0] + C0.r * Math.cos(t)), round(C0.c[1] + C0.r * Math.sin(t))];
      ents.splice(ents.indexOf(e), 1);
      ents.push({ id: newId(), t: "arc", a: pt(a1), b: pt(a1 + sweep), m: pt(a1 + sweep / 2) });
    } else ents.splice(ents.indexOf(e), 1);
  } else ents.splice(ents.indexOf(e), 1);
}
function segCircle(a, b, C0) {
  const d = v2.sub(b, a), f = v2.sub(a, C0.c);
  const A = v2.dot(d, d), B = 2 * v2.dot(f, d), Cc = v2.dot(f, f) - C0.r * C0.r;
  const disc = B * B - 4 * A * Cc; if (disc < 0 || !A) return [];
  const s = Math.sqrt(disc); const out = [];
  for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) if (t >= 0 && t <= 1) out.push(v2.add(a, v2.mul(d, t)));
  return out;
}
// ---------- congé d'esquisse entre deux lignes
function sketchFillet(ents, p, r, tol) {
  let corner = null;
  for (const e of ents) if (e.t === "line") for (const k of ["a", "b"]) if (v2.dist(e[k], p) < tol) { corner = e[k]; break; }
  if (!corner) return false;
  const ls = ents.filter(e => e.t === "line" && (v2.eq(e.a, corner) || v2.eq(e.b, corner)));
  if (ls.length !== 2) return false;
  const [l1, l2] = ls; const far = l => v2.eq(l.a, corner) ? l.b : l.a;
  const u = v2.norm(v2.sub(far(l1), corner)), w = v2.norm(v2.sub(far(l2), corner));
  const th = Math.acos(Math.max(-1, Math.min(1, v2.dot(u, w))));
  const t = r / Math.tan(th / 2);
  if (t >= v2.dist(corner, far(l1)) || t >= v2.dist(corner, far(l2))) return false;
  const T1 = v2.add(corner, v2.mul(u, t)).map(round), T2 = v2.add(corner, v2.mul(w, t)).map(round);
  const bis = v2.norm(v2.add(u, w)); const Cc = v2.add(corner, v2.mul(bis, r / Math.sin(th / 2)));
  const M = v2.add(Cc, v2.mul(v2.norm(v2.sub(corner, Cc)), r)).map(round);
  for (const l of [l1, l2]) { const k = v2.eq(l.a, corner) ? "a" : "b"; l[k] = l === l1 ? T1 : T2; if (l.g) for (const o of ents) if (o.g === l.g) o.g = undefined; }
  ents.push({ id: newId(), t: "arc", a: T1, b: T2, m: M });
  return true;
}
export { planeY };
