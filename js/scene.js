// 3D-Ansicht mit three.js: Boden, Licht, Kamera und das Strichmännchen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const STILE = {
  flach:     { hintergrund: '#f3efe6', figur: '#1c3762', licht: false, raster: ['#c9c2b3', '#e2dccf'], schatten: 0.16 },
  plastisch: { hintergrund: '#e7ebf0', figur: '#1c3762', licht: true,  raster: ['#b8c1cc', '#d5dbe2'], schatten: 0.24 },
  neon:      { hintergrund: '#070a14', figur: '#46f0ff', licht: false, raster: ['#1f4466', '#0f1d30'], schatten: 0 },
};

const ANSICHTEN = {
  vorne:   [0, 1.25, 3.6],
  seite:   [3.6, 1.25, 0],
  schraeg: [2.6, 1.6, 2.6],
  oben:    [0.01, 4.2, 0.6],
};
const ZIEL = new THREE.Vector3(0, 0.9, 0);

// Glieder als Kapseln: [von, nach, Radius in m]; Namen wie in rig.js
const SEGMENTE = [
  ['pelvis', 'chest', 0.055], ['chest', 'headC', 0.03],
  ['chest', 'lSh', 0.035], ['chest', 'rSh', 0.035],
  ['lSh', 'lEl', 0.033], ['lEl', 'lWr', 0.03], ['lWr', 'lIdx', 0.025],
  ['rSh', 'rEl', 0.033], ['rEl', 'rWr', 0.03], ['rWr', 'rIdx', 0.025],
  ['pelvis', 'lHip', 0.042], ['pelvis', 'rHip', 0.042],
  ['lHip', 'lKn', 0.042], ['lKn', 'lAn', 0.035], ['lAn', 'lHe', 0.028], ['lHe', 'lTo', 0.028],
  ['rHip', 'rKn', 0.042], ['rKn', 'rAn', 0.035], ['rAn', 'rHe', 0.028], ['rHe', 'rTo', 0.028],
];
const KOPF_RADIUS = 0.115;

const OBEN = new THREE.Vector3(0, 1, 0);
const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
const weich = k => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

export class Studio3D {
  constructor(el) {
    this.el = el;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    this.camera.position.fromArray(ANSICHTEN.schraeg);
    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.target.copy(ZIEL);
    c.enableDamping = true;
    c.autoRotateSpeed = 1.2;
    c.minDistance = 0.8;
    c.maxDistance = 15;
    c.maxPolarAngle = Math.PI * 0.495;

    const sonne = new THREE.DirectionalLight(0xffffff, 2.2);
    sonne.position.set(2.5, 5, 3);
    sonne.castShadow = true;
    sonne.shadow.mapSize.set(2048, 2048);
    sonne.shadow.normalBias = 0.02;
    Object.assign(sonne.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 15 });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a8, 1.4), sonne);

    this.boden = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.2 }));
    this.boden.rotation.x = -Math.PI / 2;
    this.boden.receiveShadow = true;
    this.scene.add(this.boden);
    this.raster = null;

    // Figur
    this.figur = new THREE.Group();
    this.scene.add(this.figur);
    this.material = new THREE.MeshBasicMaterial();
    this.meshes = [];
    const zylinder = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    const kugel = new THREE.SphereGeometry(1, 24, 16);
    const mesh = geo => {
      const m = new THREE.Mesh(geo, this.material);
      m.castShadow = true;
      this.figur.add(m);
      this.meshes.push(m);
      return m;
    };
    this.segmente = SEGMENTE.map(([von, nach, radius]) => {
      const s = { von, nach, radius, anfang: mesh(kugel), ende: mesh(kugel), glied: mesh(zylinder) };
      s.anfang.scale.setScalar(radius);
      s.ende.scale.setScalar(radius);
      return s;
    });
    this.kopf = mesh(kugel);
    this.kopf.scale.setScalar(KOPF_RADIUS);

    this.beiBild = null;   // wird vor jedem Bild aufgerufen
    this.flug = null;
    this.setStil('flach');
    new ResizeObserver(() => this.groesse()).observe(el);
    this.groesse();
    r.setAnimationLoop(t => this.bild(t));
  }

  groesse() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setStil(name) {
    const s = STILE[name] ?? STILE.flach;
    this.scene.background = new THREE.Color(s.hintergrund);
    this.scene.fog = new THREE.Fog(s.hintergrund, 7, 20);
    this.material.dispose();
    this.material = s.licht
      ? new THREE.MeshStandardMaterial({ color: s.figur, roughness: 0.5, metalness: 0 })
      : new THREE.MeshBasicMaterial({ color: s.figur });
    for (const m of this.meshes) m.material = this.material;
    this.boden.material.opacity = s.schatten;
    this.boden.visible = s.schatten > 0;
    if (this.raster) { this.scene.remove(this.raster); this.raster.geometry.dispose(); this.raster.material.dispose(); }
    this.raster = new THREE.GridHelper(12, 24, s.raster[0], s.raster[1]);
    this.raster.position.y = 0.001;
    this.scene.add(this.raster);
  }

  // j: Gelenkpositionen aus rig.js
  setPose(j) {
    if (!j) return;
    for (const s of this.segmente) {
      a.fromArray(j[s.von]);
      b.fromArray(j[s.nach]);
      s.anfang.position.copy(a);
      s.ende.position.copy(b);
      d.subVectors(b, a);
      const laenge = d.length();
      s.glied.visible = laenge > 1e-4;
      if (!s.glied.visible) continue;
      s.glied.position.addVectors(a, b).multiplyScalar(0.5);
      s.glied.scale.set(s.radius, laenge, s.radius);
      s.glied.quaternion.setFromUnitVectors(OBEN, d.divideScalar(laenge));
    }
    this.kopf.position.fromArray(j.headC);
  }

  setSpiegeln(an) { this.figur.scale.x = an ? -1 : 1; }
  setDrehen(an) { this.controls.autoRotate = an; }

  setAnsicht(name) {
    const ziel = ANSICHTEN[name];
    if (!ziel) return;
    this.flug = {
      von: this.camera.position.clone(), nach: new THREE.Vector3().fromArray(ziel),
      vonZiel: this.controls.target.clone(), start: performance.now(), dauer: 700,
    };
  }

  bild(t) {
    this.beiBild?.(t);
    if (this.flug) {
      const f = this.flug, k = Math.min(1, (performance.now() - f.start) / f.dauer), e = weich(k);
      this.camera.position.lerpVectors(f.von, f.nach, e);
      this.controls.target.lerpVectors(f.vonZiel, ZIEL, e);
      if (k >= 1) this.flug = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
