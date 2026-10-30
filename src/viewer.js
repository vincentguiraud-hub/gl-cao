// Vue 3D : rendu des corps, plans, sélection, orientation
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STD_PLANES, planeY, v3 } from "./geom.js";

const COL = { face: 0xb9c3cc, hover: 0xffb347, sel: 0x2f8cff, edge: 0x1d232a, edgeHover: 0xff8a00, edgeSel: 0x0a6cff, plane: 0x6fa8dc };

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.camera.position.set(400, 300, 500); this.camera.up.set(0, 1, 0);
    this.camera.zoom = 1;
    this.viewSize = 400;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = true;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 2.2;
    this.setIdleControls();
    const amb = new THREE.HemisphereLight(0xffffff, 0x8892a0, 1.6); this.scene.add(amb);
    this.key = new THREE.DirectionalLight(0xffffff, 1.6); this.scene.add(this.key);
    this.camera.add(this.key); this.key.position.set(0.5, 1, 1); this.scene.add(this.camera);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.bodiesGroup = new THREE.Group(); this.root.add(this.bodiesGroup);
    this.planesGroup = new THREE.Group(); this.root.add(this.planesGroup);
    this.sketchGroup = new THREE.Group(); this.root.add(this.sketchGroup);
    this.overlayGroup = new THREE.Group(); this.root.add(this.overlayGroup);
    this.triad = this.makeTriad(); this.root.add(this.triad);
    this.bodies = []; this.hover = null; this.selection = [];
    this.displayMode = "shadedEdges";
    this.clip = null;
    this.raycaster = new THREE.Raycaster();
    this.onRender = [];
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.controls.addEventListener("change", () => this.render());
    this.planeVisible = { front: true, top: true, right: true };
    this.refPlanes = [];
    this.buildPlanes();
    this.render();
  }
  setIdleControls() {
    this.controls.enableRotate = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }
  setSketchControls() {
    this.controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: -1, TWO: THREE.TOUCH.DOLLY_PAN };
  }
  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    const a = w / h, s = this.viewSize;
    this.camera.left = -s * a; this.camera.right = s * a; this.camera.top = s; this.camera.bottom = -s;
    this.camera.updateProjectionMatrix();
    this.render();
  }
  worldPerPixel() { return (this.camera.top - this.camera.bottom) / this.camera.zoom / (this.container.clientHeight || 1); }
  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const s = this.worldPerPixel() * 60; this.triad.scale.setScalar(s / 60 * 1);
      this.renderer.render(this.scene, this.camera);
      for (const f of this.onRender) f();
    });
  }
  makeTriad() {
    const g = new THREE.Group();
    const mk = (dir, c) => { const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...dir).multiplyScalar(40)]); return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: c, depthTest: false })); };
    g.add(mk([1, 0, 0], 0xd03030), mk([0, 1, 0], 0x30a030), mk([0, 0, 1], 0x3050d0));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0x334, depthTest: false }));
    g.add(dot); g.renderOrder = 10;
    return g;
  }
  // ---------- Plans
  buildPlanes() {
    this.planesGroup.clear();
    const add = (p, key, size, ref) => {
      if (!p) return;
      const y = planeY(p);
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...p.x), new THREE.Vector3(...y), new THREE.Vector3(...p.n));
      m.setPosition(...p.o);
      const geo = new THREE.PlaneGeometry(size, size);
      const mat = new THREE.MeshBasicMaterial({ color: COL.plane, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat); mesh.applyMatrix4(m);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x5b8fc7, transparent: true, opacity: 0.6 }));
      edges.applyMatrix4(m);
      mesh.userData = { pick: { kind: "plane", ref }, edges };
      this.planesGroup.add(mesh, edges);
    };
    for (const k of ["front", "top", "right"]) if (this.planeVisible[k]) add(STD_PLANES[k], k, this.planeSize || 200, { kind: "std", std: k });
    for (const r of this.refPlanes) add(r.plane, r.id, (this.planeSize || 200) * 0.8, { kind: "ref", id: r.id });
    this.render();
  }
  // ---------- Corps
  setBodies(list) {
    for (const b of this.bodies) { b.mesh.geometry.dispose(); b.lines?.geometry.dispose(); }
    this.bodiesGroup.clear(); this.bodies = [];
    list.forEach((b, bi) => {
      let m, e;
      try { m = b.shape.mesh({ tolerance: 0.05, angularTolerance: 0.25 }); e = b.shape.meshEdges({ tolerance: 0.05, angularTolerance: 0.25 }); }
      catch (err) { console.warn(err); return; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(m.vertices, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.normals, 3));
      geo.setIndex(m.triangles);
      const triFace = new Int32Array(m.triangles.length / 3);
      m.faceGroups.forEach((g, fi) => { geo.addGroup(g.start, g.count, 0); for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) triFace[t] = fi; });
      const color = new THREE.Color(b.color || "#b9c3cc");
      const mats = [
        new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: this.clip ? [this.clip] : [] }),
        new THREE.MeshStandardMaterial({ color: COL.hover, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: this.clip ? [this.clip] : [] }),
        new THREE.MeshStandardMaterial({ color: COL.sel, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: this.clip ? [this.clip] : [] }),
      ];
      const mesh = new THREE.Mesh(geo, mats);
      mesh.userData = { body: bi };
      const lgeo = new THREE.BufferGeometry();
      lgeo.setAttribute("position", new THREE.Float32BufferAttribute(e.lines, 3));
      const segEdge = new Int32Array(e.lines.length / 6);
      e.edgeGroups.forEach((g, ei) => { lgeo.addGroup(g.start, g.count, 0); for (let s = g.start / 2; s < (g.start + g.count) / 2; s++) segEdge[s] = ei; });
      const lmats = [new THREE.LineBasicMaterial({ color: COL.edge, clippingPlanes: this.clip ? [this.clip] : [] }), new THREE.LineBasicMaterial({ color: COL.edgeHover, clippingPlanes: this.clip ? [this.clip] : [] }), new THREE.LineBasicMaterial({ color: COL.edgeSel, clippingPlanes: this.clip ? [this.clip] : [] })];
      const lines = new THREE.LineSegments(lgeo, lmats);
      lines.userData = { body: bi };
      this.bodiesGroup.add(mesh, lines);
      this.bodies.push({ ...b, mesh, lines, triFace, segEdge, faceGroups: m.faceGroups, edgeGroups: e.edgeGroups });
    });
    this.applyDisplayMode();
    this.refreshHighlights();
  }
  applyDisplayMode() {
    for (const b of this.bodies) {
      const mode = this.displayMode;
      b.mesh.visible = mode !== "wire";
      b.lines.visible = mode !== "shaded";
      b.mesh.material.forEach(m => { m.transparent = mode === "xray"; m.opacity = mode === "xray" ? 0.35 : 1; m.depthWrite = mode !== "xray"; });
    }
    this.render();
  }
  setClip(plane) {
    this.clip = plane;
    for (const b of this.bodies) { [...b.mesh.material, ...b.lines.material].forEach(m => { m.clippingPlanes = plane ? [plane] : []; m.needsUpdate = true; }); }
    this.render();
  }
  modelBounds() {
    const box = new THREE.Box3();
    for (const b of this.bodies) box.expandByObject(b.mesh);
    if (this.extraBounds) { const e = this.extraBounds(); if (e && !e.isEmpty()) box.union(e); }
    if (box.isEmpty()) box.set(new THREE.Vector3(-100, -100, -100), new THREE.Vector3(100, 100, 100));
    return box;
  }
  // ---------- Orientation
  setView(dir, up = [0, 1, 0], animate = true, center = null) {
    const box = this.modelBounds();
    const c = center ? new THREE.Vector3(...center) : box.getCenter(new THREE.Vector3());
    const d = new THREE.Vector3(...dir).normalize();
    const dist = 5000;
    const targetPos = c.clone().add(d.clone().multiplyScalar(dist));
    const startPos = this.camera.position.clone(), startT = this.controls.target.clone(), startUp = this.camera.up.clone();
    const endUp = new THREE.Vector3(...up);
    const t0 = performance.now(), dur = animate ? 350 : 0;
    const step = () => {
      const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1; const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      // interpolation sphérique de la direction
      const sd = startPos.clone().sub(startT).normalize(); const nd = sd.lerp(d, e).normalize();
      if (nd.lengthSq() < 1e-6) nd.copy(d);
      const t = startT.clone().lerp(c, e);
      this.controls.target.copy(t);
      this.camera.up.copy(startUp.clone().lerp(endUp, e).normalize());
      this.camera.position.copy(t.clone().add(nd.multiplyScalar(dist)));
      this.camera.lookAt(t);
      this.controls.update(); this.render();
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }
  zoomFit(animate = true) {
    const box = this.modelBounds();
    const size = box.getSize(new THREE.Vector3()).length() || 200;
    const c = box.getCenter(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const z0 = this.camera.zoom, z1 = (this.viewSize * 2) / (size * 1.25);
    const t0 = this.controls.target.clone(); const tStart = performance.now(); const dur = animate ? 300 : 0;
    const step = () => {
      const k = dur ? Math.min(1, (performance.now() - tStart) / dur) : 1;
      this.camera.zoom = z0 + (z1 - z0) * k;
      const t = t0.clone().lerp(c, k); this.controls.target.copy(t);
      this.camera.position.copy(t.clone().add(dir.clone().multiplyScalar(5000)));
      this.camera.updateProjectionMatrix(); this.controls.update(); this.render();
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }
  // ---------- Picking
  ndc(ev) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
  pick(ev, filter = { face: true, edge: true, plane: true }) {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    this.raycaster.params.Line.threshold = this.worldPerPixel() * 7;
    const hits = [];
    if (filter.edge) {
      const ls = this.bodies.filter(b => b.lines.visible).map(b => b.lines);
      for (const h of this.raycaster.intersectObjects(ls, false)) {
        if (this.clip && this.clip.distanceToPoint(h.point) < 0) continue;
        const b = this.bodies[h.object.userData.body]; const seg = Math.floor(h.index / 2);
        hits.push({ kind: "edge", body: h.object.userData.body, edge: b.segEdge[seg], p: h.point.toArray(), dist: h.distance - this.worldPerPixel() * 3 });
        break;
      }
    }
    if (filter.face) {
      const ms = this.bodies.map(b => b.mesh);
      for (const h of this.raycaster.intersectObjects(ms, false)) {
        if (this.clip && this.clip.distanceToPoint(h.point) < 0) continue;
        const bi = h.object.userData.body; const b = this.bodies[bi];
        const fi = b.triFace[h.faceIndex];
        hits.push({ kind: "face", body: bi, face: fi, p: h.point.toArray(), n: h.face.normal.toArray(), dist: h.distance });
        break;
      }
    }
    if (filter.plane) {
      const ps = this.planesGroup.children.filter(o => o.userData.pick);
      const h = this.raycaster.intersectObjects(ps, false)[0];
      if (h) {
        // n'accepter le plan que près de son bord pour ne pas gêner la sélection du modèle
        hits.push({ kind: "plane", ref: h.object.userData.pick.ref, p: h.point.toArray(), dist: h.distance + (hits.length ? 1e9 : 0) });
      }
    }
    hits.sort((a, b) => a.dist - b.dist);
    // une arête l'emporte sur la face qu'elle borde
    const edgeHit = hits.find(h => h.kind === "edge"), faceHit = hits.find(h => h.kind === "face");
    if (edgeHit && faceHit && edgeHit.dist <= faceHit.dist + this.worldPerPixel() * 8) return edgeHit;
    return hits[0] || null;
  }
  rayPlane(ev, plane) {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...plane.n), new THREE.Vector3(...plane.o));
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(pl, out) ? out.toArray() : null;
  }
  toScreen(p) {
    const v = new THREE.Vector3(...p).project(this.camera);
    const r = this.renderer.domElement;
    return [(v.x + 1) / 2 * r.clientWidth, (1 - v.y) / 2 * r.clientHeight];
  }
  // ---------- Surbrillance
  setHover(h) { this.hover = h; this.refreshHighlights(); }
  setSelection(sel) { this.selection = sel; this.refreshHighlights(); }
  refreshHighlights() {
    for (const b of this.bodies) {
      b.mesh.geometry.groups.forEach(g => g.materialIndex = 0);
      b.lines.geometry.groups.forEach(g => g.materialIndex = 0);
    }
    const mark = (h, idx) => {
      if (!h) return; const b = this.bodies[h.body]; if (!b) return;
      if (h.kind === "face" && b.mesh.geometry.groups[h.face]) b.mesh.geometry.groups[h.face].materialIndex = idx;
      if (h.kind === "edge" && b.lines.geometry.groups[h.edge]) b.lines.geometry.groups[h.edge].materialIndex = idx;
    };
    for (const s of this.selection) mark(s, 2);
    mark(this.hover, 1);
    for (const o of this.planesGroup.children) {
      if (!o.userData.pick) continue;
      const ref = o.userData.pick.ref;
      const same = r => r && r.kind === "plane" && JSON.stringify(r.ref) === JSON.stringify(ref);
      const on = this.selection.some(same) ? 2 : same(this.hover) ? 1 : 0;
      o.material.opacity = on ? 0.22 : 0.07;
      o.material.color.set(on === 2 ? COL.sel : on === 1 ? COL.hover : COL.plane);
    }
    this.render();
  }
  // ---------- Surcouches (prévisualisation outils, points, axes)
  clearOverlay() { this.overlayGroup.clear(); this.render(); }
  addOverlayPoints(pts, color = 0xff3b30, size = 7) {
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
    const m = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }));
    m.renderOrder = 20; this.overlayGroup.add(m); this.render();
  }
  addOverlayLine(pts, color = 0xff8a00, dashed = false) {
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
    const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 6 * this.worldPerPixel(), gapSize: 4 * this.worldPerPixel(), depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false });
    const l = new THREE.Line(geo, mat); if (dashed) l.computeLineDistances(); l.renderOrder = 20; this.overlayGroup.add(l); this.render();
  }
  addGhost(shape, color = 0xffa040) {
    try {
      const m = shape.mesh({ tolerance: 0.2, angularTolerance: 0.4 });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(m.vertices, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.normals, 3)); geo.setIndex(m.triangles);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
      this.overlayGroup.add(mesh); this.render();
    } catch (e) { }
  }
  screenshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL("image/png"); }
}
