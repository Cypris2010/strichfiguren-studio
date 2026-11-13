// 3D-Ansicht mit three.js: Boden, Licht, Kamera und das Strichmännchen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Instrumente } from './instrumente.js';
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
  kopf:    null,   // nah ans Gesicht der ersten Figur, folgt dem Kopf
};
const ZIEL = new THREE.Vector3(0, 0.9, 0);
const ABSTAND = 1.8;   // zwei Figuren: so weit stehen sie auseinander (m)

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

// Knetfigur: dicke, runde Glieder in mehreren Farben. [von, nach, Radius am Anfang, Radius am Ende, Teil]
const KNET_SEGMENTE = [
  ['pelvis', 'chest', 0.15, 0.135, 'shirt'], ['chest', 'headC', 0.06, 0.06, 'haut'],
  ['chest', 'lSh', 0.12, 0.085, 'shirt'], ['chest', 'rSh', 0.12, 0.085, 'shirt'],
  ['lSh', 'lEl', 0.08, 0.066, 'shirt'], ['lEl', 'lWr', 0.058, 0.048, 'haut'], ['lWr', 'lIdx', 0.05, 0.06, 'haut'],
  ['rSh', 'rEl', 0.08, 0.066, 'shirt'], ['rEl', 'rWr', 0.058, 0.048, 'haut'], ['rWr', 'rIdx', 0.05, 0.06, 'haut'],
  ['pelvis', 'lHip', 0.12, 0.1, 'hose'], ['pelvis', 'rHip', 0.12, 0.1, 'hose'],
  ['lHip', 'lKn', 0.098, 0.082, 'hose'], ['lKn', 'lAn', 0.082, 0.066, 'hose'], ['lAn', 'lHe', 0.064, 0.07, 'schuh'], ['lHe', 'lTo', 0.07, 0.078, 'schuh'],
  ['rHip', 'rKn', 0.098, 0.082, 'hose'], ['rKn', 'rAn', 0.082, 0.066, 'hose'], ['rAn', 'rHe', 0.064, 0.07, 'schuh'], ['rHe', 'rTo', 0.07, 0.078, 'schuh'],
];

// sitz: so weit liegt die Sitzfläche des Hockers unter der Beckenmitte
// kopf: Radius; bauch: so weit ragt der Bauch über ein Strichmännchen hinaus (Gitarre rückt nach vorn);
// hebung: so viel höher steht die Figur, weil die Schuhe dicker sind als die Füße eines Strichmännchens
const FORMEN = {
  strich: { segmente: SEGMENTE.map(([von, nach, r]) => [von, nach, r, r, '']), kugeln: [], kopf: KOPF_RADIUS, bauch: 0, hebung: 0, haare: false, sitz: 0.045 },
  knet: { segmente: KNET_SEGMENTE, kugeln: [['pelvis', 0.155, 'hose']], kopf: 0.17, bauch: 0.1, hebung: 0.05, haare: true, sitz: 0.12 },
};

// Farben je Figur, damit man die Bandmitglieder auseinanderhält; haare: [Position, Streckung] relativ zum Kopf
const KNET_FARBEN = [
  { haut: '#f2c29b', shirt: '#e4572e', hose: '#2f5d8a', schuh: '#3a3a3a', haare: '#7a4521', haarForm: [[0, 0.26, -0.18], [1.06, 0.82, 1.04]] },
  { haut: '#c48a5e', shirt: '#3fa34d', hose: '#4a4a68', schuh: '#e8e0d0', haare: '#231c18', haarForm: [[0, 0.36, -0.12], [1.04, 0.7, 1.0]] },
];
const KNET_GESICHT = '#2a1c14';

// Leichte Unebenheiten wie von Fingern in der Knete (Rauschen als Relief)
let knetRelief = null;
function knetReliefTextur() {
  if (knetRelief) return knetRelief;
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, n, n);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * n, y = Math.random() * n, r = 2 + Math.random() * 9, hell = Math.random() < 0.5;
    const v = g.createRadialGradient(x, y, 0, x, y, r);
    v.addColorStop(0, hell ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)');
    v.addColorStop(1, 'rgba(128,128,128,0)');
    g.fillStyle = v;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  knetRelief = new THREE.CanvasTexture(c);
  knetRelief.wrapS = knetRelief.wrapT = THREE.RepeatWrapping;
  return knetRelief;
}

// Gesicht: wird auf eine Leinwand gezeichnet und als Kappe vorn auf den Kopf gelegt.
// Die Kappe deckt GESICHT_WINKEL (Bogenmaß) in der Breite und Höhe ab; Mitte = Blick nach vorn (+z).
const GESICHT_PX = 512, GESICHT_WINKEL = 2.0;
const NEUTRAL = { augeL: 1, augeR: 1, braueInnen: 0, braueL: 0, braueR: 0, mundAuf: 0, laechelnL: GRUND_LAECHELN, laechelnR: GRUND_LAECHELN, spitz: 0 };

const OBEN = new THREE.Vector3(0, 1, 0);
const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
const kx = new THREE.Vector3(), ky = new THREE.Vector3(), kz = new THREE.Vector3(), km = new THREE.Matrix4();
const weich = k => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

// Eine Figur (Strichmännchen oder Knetfigur) mit ihrem Instrument
class Figur {
  constructor(studio, nr) {
    this.gruppe = new THREE.Group();
    studio.scene.add(this.gruppe);
    this.material = studio.material;   // Strichmännchen: eine Farbe je Stil
    const farben = KNET_FARBEN[nr % KNET_FARBEN.length];
    this.haarForm = farben.haarForm;
    this.knetMaterial = Object.fromEntries(['haut', 'shirt', 'hose', 'schuh', 'haare'].map(teil => [teil,
      new THREE.MeshStandardMaterial({ color: farben[teil], roughness: 0.82, metalness: 0, bumpMap: knetReliefTextur(), bumpScale: 0.6 })]));
    this.kugel = new THREE.SphereGeometry(1, 32, 20);
    this.koerper = new THREE.Group();
    this.gruppe.add(this.koerper);
    this.meshes = [];
    this.gliedGeometrien = [];
    // Kopf mit Gesicht als eigene Gruppe, damit er sich drehen kann
    this.kopf = new THREE.Mesh(this.kugel, this.material);
    this.kopf.castShadow = true;
    this.haare = new THREE.Mesh(this.kugel, this.knetMaterial.haare);
    this.haare.castShadow = true;
    this.kopfGruppe = new THREE.Group();
    this.kopfGruppe.add(this.kopf, this.haare);
    this.gruppe.add(this.kopfGruppe);
    this.gesichtLeinwand = document.createElement('canvas');
    this.gesichtLeinwand.width = this.gesichtLeinwand.height = GESICHT_PX;
    this.gesichtTextur = new THREE.CanvasTexture(this.gesichtLeinwand);
    this.gesichtTextur.colorSpace = THREE.SRGBColorSpace;
    this.gesichtTextur.anisotropy = 4;
    const kappe = new THREE.SphereGeometry(KOPF_RADIUS * 1.004, 32, 24,
      Math.PI / 2 - GESICHT_WINKEL / 2, GESICHT_WINKEL, Math.PI / 2 - GESICHT_WINKEL / 2, GESICHT_WINKEL);
    this.gesicht = new THREE.Mesh(kappe, new THREE.MeshBasicMaterial({ map: this.gesichtTextur, transparent: true, depthWrite: false }));
    this.kopfGruppe.add(this.gesicht);
    this.stilFarbe = '#fff';
    this.gesichtFarbe = '#fff';
    this.gesichtSchluessel = '';
    this.mimik = null;
    this.kopfRichtung = null;
    this.instrumente = new Instrumente(this.gruppe);
    this.hocker = this.hockerBauen();
    this.letzte = null;
    this.setForm('strich');
  }

  // Hocker zum Sitzen (das Schlagzeug bringt seinen eigenen mit); Oberkante liegt bei y = 0
  hockerBauen() {
    const hocker = new THREE.Group();
    const holz = new THREE.MeshStandardMaterial({ color: '#a8743f', roughness: 0.7 });
    const metall = new THREE.MeshStandardMaterial({ color: '#555b63', roughness: 0.4, metalness: 0.6 });
    const sitz = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.17, 0.05, 32), holz);
    sitz.position.y = -0.025;
    const stange = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 12), metall);
    const fuss = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 28), metall);
    for (const m of [sitz, stange, fuss]) { m.castShadow = true; hocker.add(m); }
    hocker.userData = { stange, fuss };
    hocker.visible = false;
    this.gruppe.add(hocker);
    return hocker;
  }

  hockerStellen(j) {
    const h = this.hocker;
    h.visible = !!j.sitzt && this.instrumente.rolle !== 'schlagzeug';
    if (!h.visible) return;
    const oben = Math.max(0.1, j.pelvis[1] - FORMEN[this.form].sitz);
    h.position.set(j.pelvis[0], oben, j.pelvis[2] - 0.04);
    const { stange, fuss } = h.userData;
    stange.scale.y = oben - 0.05;
    stange.position.y = -0.05 - stange.scale.y / 2;
    fuss.position.y = 0.015 - oben;
  }

  materialFuer(teil) { return this.form === 'knet' ? this.knetMaterial[teil] : this.material; }

  // Körper neu aufbauen: 'strich' | 'knet'
  setForm(name) {
    const f = FORMEN[name] ?? FORMEN.strich;
    this.form = name in FORMEN ? name : 'strich';
    this.koerper.clear();
    for (const g of this.gliedGeometrien) g.dispose();
    this.gliedGeometrien = [];
    this.meshes = [];
    const mesh = (geo, teil) => {
      const m = new THREE.Mesh(geo, this.materialFuer(teil));
      m.castShadow = true;
      m.userData.teil = teil;
      this.koerper.add(m);
      this.meshes.push(m);
      return m;
    };
    this.segmente = f.segmente.map(([von, nach, r1, r2, teil]) => {
      // Zylinder entlang +y; oben = Ende des Glieds. Länge wird beim Stellen gesetzt.
      const geo = new THREE.CylinderGeometry(r2, r1, 1, 24, 1, true);
      this.gliedGeometrien.push(geo);
      const s = { von, nach, anfang: mesh(this.kugel, teil), ende: mesh(this.kugel, teil), glied: mesh(geo, teil) };
      s.anfang.scale.setScalar(r1);
      s.ende.scale.setScalar(r2);
      return s;
    });
    this.kugeln = f.kugeln.map(([wo, r, teil]) => {
      const m = mesh(this.kugel, teil);
      m.scale.setScalar(r);
      m.userData.wo = wo;
      return m;
    });
    this.kopf.material = this.materialFuer('haut');
    this.kopf.scale.setScalar(f.kopf);
    this.gesicht.scale.setScalar(f.kopf / KOPF_RADIUS);
    this.haare.visible = f.haare;
    this.haare.position.fromArray(this.haarForm[0]).multiplyScalar(f.kopf);
    this.haare.scale.fromArray(this.haarForm[1]).multiplyScalar(f.kopf);
    this.hebung = f.hebung;
    this.instrumente.bauch = f.bauch;
    this.gesichtFarbeSetzen();
    this.neuZeichnen();
  }

  setStil(name, material, gesichtFarbe) {
    this.material = material;
    for (const m of this.meshes) m.material = this.materialFuer(m.userData.teil);
    this.kopf.material = this.materialFuer('haut');
    this.instrumente.setStil(name);
    this.stilFarbe = gesichtFarbe;
    this.gesichtFarbeSetzen();
  }

  // Strichmännchen: Gesicht in der Hintergrundfarbe; Knetfigur: dunkel auf hellem Kopf
  gesichtFarbeSetzen() {
    this.gesichtFarbe = this.form === 'knet' ? KNET_GESICHT : this.stilFarbe;
    this.gesichtSchluessel = '';
    this.zeichneGesicht(this.mimik ?? NEUTRAL);
  }

  // Mimik und Kopfdrehung aus face.js; null = neutrales Gesicht, Kopfrichtung grob aus der Pose
  setMimik(m) {
    this.mimik = m;
    this.zeichneGesicht(m ?? NEUTRAL);
    this.kopfAusrichten();
  }

  kopfAusrichten() {
    const q = this.kopfGruppe.quaternion, m = this.mimik, k = this.kopfRichtung;
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
      g.beginPath();
      g.ellipse(x, augeY, 0.1 * E, Math.max(0.016 * E, 0.13 * E * offen), 0, 0, Math.PI * 2);
      g.fill();
      // Braue – hoch: ganze Braue hebt sich (außen mehr); runter: innen senkt sich (grimmig)
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

  // j: Gelenkpositionen aus rig.js; extra: Richtungen aus Farbmarkern (optional)
  setPose(j, extra) {
    if (!j) return;
    this.letzte = [j, extra];
    if (this.hebung) {
      const h = this.hebung, k = {};
      for (const [n, v] of Object.entries(j)) k[n] = Array.isArray(v) ? [v[0], v[1] + h, v[2]] : v;
      j = k;
    }
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
      s.glied.scale.set(1, laenge, 1);
      s.glied.quaternion.setFromUnitVectors(OBEN, d.divideScalar(laenge));
    }
    for (const m of this.kugeln) m.position.fromArray(j[m.userData.wo]);
    this.hockerStellen(j);
    this.kopfGruppe.position.fromArray(j.headC);
    this.kopfRichtung = j.kopf ?? null;
    this.kopfAusrichten();
    this.instrumente.update(j, extra);
  }

  // Letzte Pose noch einmal anwenden, z. B. nach dem Einmessen bei angehaltenem Video
  neuZeichnen() { if (this.letzte) this.setPose(...this.letzte); }

  // rolle: '' | 'gitarre' | 'bass' | 'schlagzeug'; hand: 'auto' | 'rechts' | 'links'
  setInstrument(rolle, hand) {
    this.instrumente.setRolle(rolle);
    this.instrumente.setHand(hand);
    this.neuZeichnen();
  }
  // Feste Werte aus einer ganzen Aufnahme, null = live nachführen
  setAnker(anker) {
    this.instrumente.setAnker(anker);
    if (!anker) this.instrumente.liveZuruecksetzen();
  }
}

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

    // Figuren: eine je Kamera; die zweite erscheint erst, wenn eine zweite Kamera läuft
    this.material = new THREE.MeshBasicMaterial();
    this.figuren = [new Figur(this, 0), new Figur(this, 1)];
    this.setFigurenZahl(1);

    this.beiBild = null;   // wird vor jedem Bild aufgerufen
    this.nachBild = null;  // danach, wenn alle Figuren stehen (Live-Stream an Blender)
    this.flug = null;
    this.messung = { ms: 0, abstand: 1000 / 60, zuletzt: 0 };   // Dauer eines Bildes (ms) und Abstand zwischen zwei Bildern
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
    for (const f of this.figuren) f.setStil(name, this.material, s.hintergrund);
    this.boden.material.opacity = s.schatten;
    this.boden.visible = s.schatten > 0;
    if (this.raster) { this.scene.remove(this.raster); this.raster.geometry.dispose(); this.raster.material.dispose(); }
    this.raster = new THREE.GridHelper(12, 24, s.raster[0], s.raster[1]);
    this.raster.position.y = 0.001;
    this.scene.add(this.raster);
  }

  // Aussehen aller Figuren: 'strich' | 'knet'
  setForm(name) { for (const f of this.figuren) f.setForm(name); }

  // Erste Figur – so bleibt die Konsole wie bisher bedienbar
  get instrumente() { return this.figuren[0].instrumente; }

  // Eine Figur steht in der Mitte, zwei stehen nebeneinander
  setFigurenZahl(n) {
    this.figuren.forEach((f, i) => {
      f.gruppe.visible = i < n;
      f.gruppe.position.x = n > 1 ? (i - (n - 1) / 2) * ABSTAND : 0;
    });
  }

  neuZeichnen() { for (const f of this.figuren) f.neuZeichnen(); }
  // Spiegeln je Figur (folgt der Kamera, die ihren Körper liefert)
  setSpiegeln(an, nr = null) {
    for (const [i, f] of this.figuren.entries()) if (nr === null || nr === i) f.gruppe.scale.x = an ? -1 : 1;
  }
  setDrehen(an) { this.controls.autoRotate = an; }

  // Kamera-Voreinstellung; „kopf“ geht nah ans Gesicht der ersten Figur und folgt ihm danach
  setAnsicht(name) {
    if (!(name in ANSICHTEN)) return;
    this.folgeKopf = name === 'kopf';
    const kopf = this.figuren[0].kopfGruppe;
    const nachZiel = this.folgeKopf ? kopf.getWorldPosition(new THREE.Vector3()) : ZIEL.clone();
    const nach = this.folgeKopf ? nachZiel.clone().add(new THREE.Vector3(0.12, 0.04, 0.75)) : new THREE.Vector3().fromArray(ANSICHTEN[name]);
    this.flug = {
      von: this.camera.position.clone(), nach,
      vonZiel: this.controls.target.clone(), nachZiel, start: performance.now(), dauer: 700,
    };
  }

  bild(t) {
    const anfang = performance.now();
    this.beiBild?.(t);
    this.nachBild?.(this);
    if (this.flug) {
      const f = this.flug, k = Math.min(1, (performance.now() - f.start) / f.dauer), e = weich(k);
      this.camera.position.lerpVectors(f.von, f.nach, e);
      this.controls.target.lerpVectors(f.vonZiel, f.nachZiel, e);
      if (k >= 1) this.flug = null;
    } else if (this.folgeKopf) {
      // Kamera samt Blickpunkt mit dem Kopf verschieben; Drehen und Zoomen mit der Maus bleiben möglich
      this.figuren[0].kopfGruppe.getWorldPosition(d).sub(this.controls.target);
      this.camera.position.add(d);
      this.controls.target.add(d);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const m = this.messung;
    m.ms += (performance.now() - anfang - m.ms) * 0.1;
    if (m.zuletzt) m.abstand += (anfang - m.zuletzt - m.abstand) * 0.1;
    m.zuletzt = anfang;
  }
}
