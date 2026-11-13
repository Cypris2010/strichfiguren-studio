// 3D-Ansicht mit three.js: Boden, Licht, Kamera und das Strichmännchen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRUND_LAECHELN } from './face.js';

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
  kopf:    null,   // folgt dem Kopf, siehe kopfAnsicht()
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

// Gesicht: wird auf eine Leinwand gezeichnet und als Kappe vorn auf den Kopf gelegt.
// Die Kappe deckt GESICHT_WINKEL (Bogenmaß) in der Breite und Höhe ab; Mitte = Blick nach vorn (+z).
const GESICHT_PX = 512, GESICHT_WINKEL = 2.0;
const NEUTRAL = { augeL: 1, augeR: 1, braueInnen: 0, braueL: 0, braueR: 0, mundAuf: 0, laechelnL: GRUND_LAECHELN, laechelnR: GRUND_LAECHELN, spitz: 0 };

const OBEN = new THREE.Vector3(0, 1, 0);
const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
const kx = new THREE.Vector3(), ky = new THREE.Vector3(), kz = new THREE.Vector3(), km = new THREE.Matrix4();
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
    c.minDistance = 0.3;
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
    this.figur.remove(this.kopf);
    this.kopfGruppe = new THREE.Group();
    this.kopfGruppe.add(this.kopf);
    this.figur.add(this.kopfGruppe);
    this.gesichtLeinwand = document.createElement('canvas');
    this.gesichtLeinwand.width = this.gesichtLeinwand.height = GESICHT_PX;
    this.gesichtTextur = new THREE.CanvasTexture(this.gesichtLeinwand);
    this.gesichtTextur.colorSpace = THREE.SRGBColorSpace;
    this.gesichtTextur.anisotropy = 4;
    const kappe = new THREE.SphereGeometry(KOPF_RADIUS * 1.004, 32, 24,
      Math.PI / 2 - GESICHT_WINKEL / 2, GESICHT_WINKEL, Math.PI / 2 - GESICHT_WINKEL / 2, GESICHT_WINKEL);
    this.gesicht = new THREE.Mesh(kappe, new THREE.MeshBasicMaterial({ map: this.gesichtTextur, transparent: true, depthWrite: false }));
    this.kopfGruppe.add(this.gesicht);
    this.gesichtFarbe = '#fff';
    this.gesichtSchluessel = '';

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
    this.gesichtFarbe = s.hintergrund;
    this.gesichtSchluessel = '';
    this.zeichneGesicht(this.mimik ?? NEUTRAL);
    this.boden.material.opacity = s.schatten;
    this.boden.visible = s.schatten > 0;
    if (this.raster) { this.scene.remove(this.raster); this.raster.geometry.dispose(); this.raster.material.dispose(); }
    this.raster = new THREE.GridHelper(12, 24, s.raster[0], s.raster[1]);
    this.raster.position.y = 0.001;
    this.scene.add(this.raster);
  }

  // j: Gelenkpositionen aus rig.js; m: Mimik aus face.js (oder null)
  setPose(j, m = null) {
    this.setMimik(m);
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
    this.kopfGruppe.position.fromArray(j.headC);
    this.letzteKopfRichtung = j.kopf ?? null;
    this.kopfAusrichten();
  }

  // Mimik und Kopfdrehung aus dem Gesicht; ohne Gesicht neutral und Kopfrichtung aus der Pose
  setMimik(m) {
    this.mimik = m;
    this.zeichneGesicht(m ?? NEUTRAL);
    this.kopfAusrichten();
  }

  kopfAusrichten() {
    const q = this.kopfGruppe.quaternion, m = this.mimik, k = this.letzteKopfRichtung;
    if (m?.r) q.fromArray(m.r);
    else if (k) {
      kx.fromArray(k.x);
      kz.fromArray(k.f).addScaledVector(kx, -kz.dot(kx));
      if (kz.lengthSq() < 1e-8) { q.identity(); return; }
      kz.normalize();
      ky.crossVectors(kz, kx);
      q.setFromRotationMatrix(km.makeBasis(kx, ky, kz));
    } else q.identity();
  }

  // Strichgesicht auf die Leinwand zeichnen. Linke Seite der Person = rechts auf der Leinwand
  // (so sieht man sie von vorn); 1 Bogenmaß auf dem Kopf = GESICHT_PX / GESICHT_WINKEL Pixel.
  zeichneGesicht(m) {
    const schluessel = Object.values(m).map(v => (typeof v === 'number' ? v.toFixed(2) : '')).join() + this.gesichtFarbe;
    if (schluessel === this.gesichtSchluessel) return;
    this.gesichtSchluessel = schluessel;
    const g = this.gesichtLeinwand.getContext('2d'), E = GESICHT_PX / GESICHT_WINKEL;
    const cx = GESICHT_PX / 2, cy = GESICHT_PX / 2;
    g.clearRect(0, 0, GESICHT_PX, GESICHT_PX);
    g.strokeStyle = g.fillStyle = this.gesichtFarbe;
    g.lineCap = g.lineJoin = 'round';
    const augeY = cy - 0.12 * E, augeX = 0.36 * E, braueY = augeY - 0.27 * E;
    for (const [seite, offen, braue] of [[1, m.augeL, m.braueL], [-1, m.augeR, m.braueR]]) {
      const x = cx + seite * augeX;
      // Auge: Punkt, beim Blinzeln ein Strich
      const ry = Math.max(0.016 * E, 0.13 * E * offen);
      g.beginPath();
      g.ellipse(x, augeY, 0.1 * E, ry, 0, 0, Math.PI * 2);
      g.fill();
      // Braue: innen hebt browInnerUp, außen browOuterUp / browDown
      // hoch: ganze Braue hebt sich (außen mehr); runter: innen senkt sich (grimmig)
      const hoch = Math.max(0, braue), runter = Math.max(0, -braue);
      const innen = braueY - (m.braueInnen * 0.16 + hoch * 0.06 - runter * 0.1) * E;
      const aussen = braueY - (hoch * 0.14 - runter * 0.02) * E;
      g.lineWidth = 0.065 * E;
      g.beginPath();
      g.moveTo(x - seite * 0.13 * E, innen);
      g.lineTo(x + seite * 0.13 * E, aussen);
      g.stroke();
    }
    // Mund: Breite durch Lächeln und Spitzmund, Öffnung durch jawOpen, Mundwinkel durch Lächeln
    const mundY = cy + 0.38 * E;
    const halb = 0.27 * E * (1 + 0.25 * Math.max(m.laechelnL, m.laechelnR, 0) - 0.45 * m.spitz);
    const xl = cx + halb, xr = cx - halb;
    const yl = mundY - m.laechelnL * 0.12 * E, yr = mundY - m.laechelnR * 0.12 * E;
    const bogen = (m.laechelnL + m.laechelnR) / 2 * 0.16 * E;
    const auf = m.mundAuf * 0.42 * E;
    g.lineWidth = 0.065 * E;
    g.beginPath();
    g.moveTo(xr, yr);
    if (auf < 0.03 * E) {
      g.quadraticCurveTo(cx, mundY + bogen, xl, yl);
      g.stroke();
    } else {
      g.quadraticCurveTo(cx, mundY + bogen * 0.5 - auf * 0.25, xl, yl);
      g.quadraticCurveTo(cx, mundY + bogen + auf, xr, yr);
      g.fill();
      g.stroke();
    }
    this.gesichtTextur.needsUpdate = true;
  }

  setSpiegeln(an) { this.figur.scale.x = an ? -1 : 1; }
  setDrehen(an) { this.controls.autoRotate = an; }

  // Kamera-Voreinstellung; „kopf“ geht nah ans Gesicht und folgt dem Kopf danach
  setAnsicht(name) {
    if (!(name in ANSICHTEN)) return;
    this.folgeKopf = name === 'kopf';
    const nachZiel = this.folgeKopf ? this.kopfGruppe.getWorldPosition(new THREE.Vector3()) : ZIEL.clone();
    const nach = this.folgeKopf ? nachZiel.clone().add(new THREE.Vector3(0.12, 0.04, 0.75)) : new THREE.Vector3().fromArray(ANSICHTEN[name]);
    this.flug = {
      von: this.camera.position.clone(), nach,
      vonZiel: this.controls.target.clone(), nachZiel, start: performance.now(), dauer: 700,
    };
  }

  bild(t) {
    this.beiBild?.(t);
    if (this.flug) {
      const f = this.flug, k = Math.min(1, (performance.now() - f.start) / f.dauer), e = weich(k);
      this.camera.position.lerpVectors(f.von, f.nach, e);
      this.controls.target.lerpVectors(f.vonZiel, f.nachZiel, e);
      if (k >= 1) this.flug = null;
    } else if (this.folgeKopf) {
      // Kamera samt Blickpunkt mit dem Kopf verschieben; Drehen und Zoomen mit der Maus bleiben möglich
      this.kopfGruppe.getWorldPosition(d).sub(this.controls.target);
      this.camera.position.add(d);
      this.controls.target.add(d);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
