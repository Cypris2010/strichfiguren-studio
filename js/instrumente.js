// Instrumente für die Band: Gitarre, Bass und Schlagzeug.
//
// Gitarre und Bass hängen vor dem Bauch und richten den Hals jedes Bild zur Greifhand aus –
// so liegt die Greifhand immer am Hals, egal was die Erkennung im Detail liefert.
// Das Schlagzeug steht fest vor der Figur. Bei einer fertigen Aufnahme werden Blickrichtung,
// Sitzhöhe und Greifhand einmal aus der ganzen Aufnahme bestimmt („Anker“); live werden sie
// langsam nachgeführt, damit nichts zappelt.
import * as THREE from 'three';

const FARBEN = {
  flach:     { licht: false, holz: '#e07a3f', fell: '#f6efe4', becken: '#d9b44a', stock: '#c99a5b', akzent: '#1c3762', blitz: '#ff3b47' },
  plastisch: { licht: true,  holz: '#b5562a', fell: '#efe9df', becken: '#cfa43c', stock: '#d9b07a', akzent: '#1c3762', blitz: '#ff3b47' },
  neon:      { licht: false, holz: '#ff4fd8', fell: '#ff9be9', becken: '#ffe14d', stock: '#ffe14d', akzent: '#46f0ff', blitz: '#ffffff' },
};
const MATERIALIEN = ['holz', 'fell', 'becken', 'stock', 'akzent', 'blitz'];

const OBEN = new THREE.Vector3(0, 1, 0);
const vec = a => new THREE.Vector3(a[0], a[1], a[2]);
const glatt = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const NACH_GREIFSEITE = 25 * Math.PI / 180;   // Halswinkel, wenn die Greifhand gerade nicht am Hals ist
const STOCK = 0.42;                            // Länge eines Sticks
export const ZONEN = 4;                        // Akkordzonen am Hals (Luftband)
const GRIFFBEREICH = 0.45;                     // so weit am Hals entlang reicht ein Arm bequem (m)
const BLITZ = 0.1;                             // so lange leuchtet ein Teil nach einem Schlag (s)

// Reihenfolge beim Einmessen: [Name, wohin klicken]
export const KIT_TEILE = [
  ['snare', 'die Mitte der Snare'],
  ['hihat', 'das Tape an der Hi-Hat (oberes Becken)'],
  ['tom1', 'die Mitte von Tom 1 (hoch)'],
  ['tom2', 'die Mitte von Tom 2'],
  ['standtom', 'die Mitte des Standtoms'],
  ['crash', 'das Tape am Crash-Becken'],
  ['ride', 'das Tape am Ride-Becken'],
  ['bassdrum', 'die Mitte der Bassdrum'],
];

// Ausrichtung des Oberkörpers: up = Wirbelsäule, side = zur linken Schulter, fwd = Blickrichtung
export function rumpf(j) {
  const P = vec(j.pelvis), up = vec(j.chest).sub(P).normalize();
  const side = vec(j.lSh).sub(vec(j.rSh));
  side.addScaledVector(up, -side.dot(up)).normalize();
  const fwd = new THREE.Vector3().crossVectors(side, up).normalize();
  return { P, up, side, fwd };
}

// > 0: die linke Hand ist weiter seitlich draußen, also greift die linke (Rechtshänder)
function greifSeite(j, r) {
  const links = vec(j.lWr).sub(r.P).dot(r.side);
  const rechts = -vec(j.rWr).sub(r.P).dot(r.side);
  return links - rechts;
}

// Feste Werte für eine ganze Aufnahme; gelenke = Liste von Posen aus rig.js
export function ankerBerechnen(gelenke) {
  if (!gelenke.length) return null;
  let vx = 0, vz = 0, greif = 0;
  const hoehen = [];
  for (const j of gelenke) {
    const r = rumpf(j);
    vx += r.fwd.x;
    vz += r.fwd.z;
    greif += greifSeite(j, r);
    hoehen.push(r.P.y);
  }
  hoehen.sort((a, b) => a - b);
  return { yaw: Math.atan2(vx, vz), becken: hoehen[hoehen.length >> 1], greifLinks: greif >= 0 };
}

// Umriss eines Gitarrenkorpus (Achtform), Hals zeigt nach +x
function korpusForm(s) {
  const ellipse = (x, c, rx, ry) => (Math.abs(x - c) < rx ? ry * Math.sqrt(1 - ((x - c) / rx) ** 2) : 0);
  const halb = x => Math.max(ellipse(x, -0.13 * s, 0.17 * s, 0.19 * s), ellipse(x, 0.10 * s, 0.11 * s, 0.15 * s));
  const x0 = -0.30 * s, x1 = 0.21 * s, N = 64, oben = [];
  for (let k = 1; k < N; k++) {
    const x = x0 + (x1 - x0) * (1 - Math.cos(Math.PI * k / N)) / 2;
    oben.push([x, halb(x)]);
  }
  const form = new THREE.Shape();
  form.moveTo(x0, 0);
  for (const [x, y] of oben) form.lineTo(x, y);
  form.lineTo(x1, 0);
  for (const [x, y] of oben.reverse()) form.lineTo(x, -y);
  form.closePath();
  return form;
}

export class Instrumente {
  constructor(eltern) {
    this.gruppe = new THREE.Group();
    eltern.add(this.gruppe);
    this.meshes = [];
    this.mat = {};
    this.bauch = 0;   // wie weit der Bauch der Figur über ein Strichmännchen hinausragt (m)
    this.setStil('flach');

    this.gitarre = this.saiteninstrument(1, 0.45);
    this.bass = this.saiteninstrument(1.12, 0.67);
    this.kit = this.schlagzeug();
    this.stoecke = [this.stock(), this.stock()];

    this.hand = 'auto';
    this.anker = null;
    this.kalib = {};
    this.pulse = {};   // Luftband: letzter Schlag je Teil { start, staerke }
    this.stockMarker = [false, false];   // folgt der Stick gerade einem Tape-Marker?
    this.liveZuruecksetzen();
    this.setRolle('');
  }

  mesh(geo, farbe, eltern) {
    const m = new THREE.Mesh(geo, this.mat[farbe]);
    m.userData.farbe = farbe;
    m.castShadow = true;
    eltern.add(m);
    this.meshes.push(m);
    return m;
  }

  setStil(name) {
    const f = FARBEN[name] ?? FARBEN.flach;
    Object.values(this.mat).forEach(m => m.dispose());
    this.mat = {};
    for (const k of MATERIALIEN) {
      this.mat[k] = f.licht
        ? new THREE.MeshStandardMaterial({ color: f[k], roughness: k === 'becken' ? 0.3 : 0.55, metalness: k === 'becken' ? 0.6 : 0 })
        : new THREE.MeshBasicMaterial({ color: f[k] });
    }
    for (const m of this.meshes) m.material = this.mat[m.userData.farbe];
  }

  // ---------- Bauteile ----------
  saiteninstrument(s, halsLaenge) {
    const g = new THREE.Group();
    this.gruppe.add(g);
    const korpus = new THREE.ExtrudeGeometry(korpusForm(s), {
      depth: 0.05 * s, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 6,
    });
    korpus.translate(0, 0, -0.025 * s);
    this.mesh(korpus, 'holz', g);

    const halsStart = 0.17 * s, oben = 0.025 * s + 0.008;
    const hals = this.mesh(new THREE.BoxGeometry(halsLaenge, 0.05, 0.03), 'holz', g);
    hals.position.set(halsStart + halsLaenge / 2, 0, 0.01);
    const kopf = this.mesh(new THREE.BoxGeometry(0.17, 0.085, 0.025), 'holz', g);
    kopf.position.set(halsStart + halsLaenge + 0.085, 0, 0.005);
    const loch = this.mesh(new THREE.CylinderGeometry(0.045 * s, 0.045 * s, 0.004, 28), 'akzent', g);
    loch.rotation.x = Math.PI / 2;
    loch.position.set(-0.04 * s, 0, oben + 0.002);
    // Saiten als ein schmales Band vom Steg bis zum Sattel
    const steg = -0.15 * s, sattel = halsStart + halsLaenge;
    const saiten = this.mesh(new THREE.BoxGeometry(sattel - steg, 0.022, 0.003), 'akzent', g);
    saiten.position.set((sattel + steg) / 2, 0, oben + 0.005);
    // Luftband: Grenzen der Akkordzonen und die gerade gegriffene Zone. Die Zonen reichen nur so
    // weit, wie ein Arm bequem greift – beim langen Basshals wäre die erste sonst kaum zu erreichen.
    const griff = { start: halsStart, laenge: Math.min(halsLaenge, GRIFFBEREICH) };
    const zonen = new THREE.Group();
    zonen.visible = false;
    g.add(zonen);
    for (let k = 1; k < ZONEN; k++) {
      const bund = this.mesh(new THREE.BoxGeometry(0.006, 0.056, 0.006), 'fell', zonen);
      bund.position.set(griff.start + griff.laenge * k / ZONEN, 0, 0.028);
    }
    const feld = this.mesh(new THREE.BoxGeometry(griff.laenge / ZONEN - 0.012, 0.052, 0.004), 'blitz', zonen);
    feld.position.z = 0.027;
    feld.visible = false;
    g.userData = { saiten, zonen, feld, griff };
    return g;
  }

  schlagzeug() {
    const aussen = new THREE.Group(), innen = new THREE.Group();
    aussen.add(innen);
    this.gruppe.add(aussen);
    const teile = {};

    // Jedes Teil: Gruppe am Boden (x, z) → Gruppe in Höhe y → Wackelgruppe → Meshes.
    // abzug: so viel kürzer ist der Ständer als die Höhe (null = kein Ständer)
    const teil = (name, [x, y, z], abzug, bauen) => {
      const boden = new THREE.Group(), hoehe = new THREE.Group(), wackel = new THREE.Group();
      boden.add(hoehe);
      hoehe.add(wackel);
      innen.add(boden);
      const staender = abzug === null ? null : this.mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), 'akzent', boden);
      // bauen liefert { leuchte: Mesh, das beim Schlag aufleuchtet, r: Radius, oben: Höhe der Schlagfläche }
      teile[name] = { boden, hoehe, wackel, staender, abzug, standard: [x, y, z], ...bauen(wackel) };
    };
    const trommel = (r, h, kipp = 0) => g => {
      const t = new THREE.Group();
      this.mesh(new THREE.CylinderGeometry(r, r, h, 32), 'holz', t);
      const fell = this.mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.008, 32), 'fell', t);
      fell.position.y = h / 2;
      t.rotation.x = kipp;
      g.add(t);
      return { leuchte: fell, r, oben: h / 2 };
    };
    const becken = (r, kippX, kippZ = 0) => g => {
      const b = this.mesh(new THREE.CylinderGeometry(r * 0.12, r, 0.014, 36), 'becken', g);
      b.rotation.set(kippX, 0, kippZ);
      return b;
    };
    const beckenTeil = (r, kippX, kippZ) => g => ({ leuchte: becken(r, kippX, kippZ)(g), r, oben: 0 });

    // Aufstellung für Rechtshänder, Figur sitzt im Ursprung und schaut nach +z, ihre linke Seite ist +x
    teil('bassdrum', [0, 0.27, 0.66], null, trommel(0.27, 0.40, Math.PI / 2));   // Fell zum Publikum
    teil('snare', [0.06, 0.62, 0.36], 0.07, trommel(0.17, 0.14, -0.12));
    teil('tom1', [0.14, 0.88, 0.56], null, trommel(0.12, 0.13, -0.45));          // auf der Bassdrum
    teil('tom2', [-0.14, 0.88, 0.56], null, trommel(0.12, 0.13, -0.45));
    teil('standtom', [-0.44, 0.50, 0.30], 0.16, trommel(0.19, 0.32));
    teil('hihat', [0.40, 0.90, 0.34], 0, g => {
      becken(0.18, -0.05)(g).position.y = -0.015;
      const oben = becken(0.18, -0.05)(g);
      oben.position.y = 0.015;
      return { leuchte: oben, deckel: oben, r: 0.18, oben: 0.015 };   // das obere Becken öffnet sich
    });
    teil('crash', [0.46, 1.22, 0.64], 0, beckenTeil(0.22, -0.30, -0.15));
    teil('ride', [-0.58, 1.08, 0.50], 0, beckenTeil(0.26, -0.25, 0.15));

    // Hocker; Höhe wird an die Figur angepasst
    const fuss = this.mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 24), 'akzent', innen);
    fuss.position.set(0, 0.015, -0.02);
    const stange = this.mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 10), 'akzent', innen);
    const sitz = this.mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 28), 'holz', innen);
    stange.position.set(0, 0, -0.02);
    sitz.position.set(0, 0, -0.02);
    return { aussen, innen, stange, sitz, teile };
  }

  stock() {
    const geo = new THREE.CylinderGeometry(0.007, 0.011, STOCK, 10);
    geo.translate(0, STOCK / 2, 0);   // beginnt am Griff, Spitze zeigt nach +y
    return this.mesh(geo, 'stock', this.gruppe);
  }

  // ---------- Steuerung ----------
  setRolle(rolle) {
    this.rolle = rolle;
    this.gitarre.visible = rolle === 'gitarre';
    this.bass.visible = rolle === 'bass';
    this.kit.aussen.visible = rolle === 'schlagzeug';
    for (const s of this.stoecke) s.visible = rolle === 'schlagzeug';
  }

  setHand(hand) { this.hand = hand; }
  setAnker(anker) { this.anker = anker; }
  liveZuruecksetzen() { this.live = { vorne: new THREE.Vector3(0, 0, 1), greif: 0.01, becken: null }; }

  // Rechtshänder greifen mit links
  greiftLinks() {
    if (this.hand === 'rechts') return true;
    if (this.hand === 'links') return false;
    return this.anker ? this.anker.greifLinks : this.live.greif >= 0;
  }
  blickwinkel() { return this.anker ? this.anker.yaw : Math.atan2(this.live.vorne.x, this.live.vorne.z); }

  // ---------- Luftband ----------
  setLuftband(an) {
    for (const g of [this.gitarre, this.bass]) g.userData.zonen.visible = an;
  }

  // Gegriffene Akkordzone am Hals markieren (null = keine)
  setZone(zone) {
    for (const g of [this.gitarre, this.bass]) {
      const { feld, griff } = g.userData;
      feld.visible = zone !== null && zone !== undefined;
      if (feld.visible) feld.position.x = griff.start + griff.laenge * (1 - (zone + 0.5) / ZONEN);
    }
  }

  // Ein erkannter Schlag oder Anschlag: das Teil leuchtet kurz auf, Trommeln zucken, Becken schwingen
  anschlagen(e) {
    const name = e.art !== 'trommel' ? 'saiten' : e.name === 'pedal' ? 'hihat' : e.name;
    this.pulse[name] = { start: performance.now(), staerke: e.staerke ?? 0.7 };
  }
  pulsAlter(name) {
    const p = this.pulse[name];
    return p ? { alter: (performance.now() - p.start) / 1000, staerke: p.staerke } : { alter: Infinity, staerke: 0 };
  }

  // Für das Luftband: wo sind Stickspitzen, Trommeln und Füße bzw. die Hände am Instrument?
  // Alles in Figur-Koordinaten. Erst nach update() mit derselben Pose aufrufen.
  messpunkte(j) {
    if (!this.rolle) return null;
    if (this.rolle === 'schlagzeug') {
      const yaw = this.blickwinkel(), c = Math.cos(yaw), s = Math.sin(yaw), spiegel = this.hand === 'links' ? -1 : 1;
      const teile = [];
      for (const [name, t] of Object.entries(this.kit.teile)) {
        if (name === 'bassdrum') continue;   // die spielt der Fuß
        const [x, y, z] = this.kalib[name] ?? t.standard, xs = spiegel * x;
        teile.push({ name, p: new THREE.Vector3(xs * c + z * s, y + t.oben, -xs * s + z * c) });
      }
      const spitzen = this.stoecke.map(st => OBEN.clone().applyQuaternion(st.quaternion).multiplyScalar(STOCK).add(st.position));
      const haende = [vec(j.lIdx), vec(j.rIdx)];
      // Ohne Einmessen gilt die Standardaufstellung für jemanden, der sitzt; wer steht, spielt höher
      const becken = this.anker ? this.anker.becken : this.live.becken ?? 0.6;
      const versatz = Object.keys(this.kalib).length ? 0 : Math.min(0.5, Math.max(0, becken - 0.6));
      return {
        rolle: 'schlagzeug', teile, spitzen, haende, mitMarker: [...this.stockMarker], versatz, mitte: vec(j.chest),
        bass: vec(j[spiegel > 0 ? 'rTo' : 'lTo']), hihat: vec(j[spiegel > 0 ? 'lTo' : 'rTo']),
      };
    }
    const g = this.rolle === 'bass' ? this.bass : this.gitarre, greifLinks = this.greiftLinks();
    const zurueck = g.quaternion.clone().invert();
    const [wr, idx] = greifLinks ? ['rWr', 'rIdx'] : ['lWr', 'lIdx'];
    const quer = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);   // quer zu den Saiten
    if (quer.dot(rumpf(j).up) < 0) quer.negate();                            // … und zwar nach oben
    return {
      rolle: this.rolle,
      greif: vec(j[greifLinks ? 'lWr' : 'rWr']).sub(g.position).applyQuaternion(zurueck),   // in Gitarren-Koordinaten
      hand: vec(j[wr]).add(vec(j[idx])).multiplyScalar(0.5).sub(g.position),               // relativ zum Korpus
      quer,
      griff: g.userData.griff,
    };
  }

  // ---------- Schlagzeug einmessen ----------
  // kit: { teil: [x, y, z] } in Koordinaten des Schlagzeugs; fehlende Teile stehen am Standardplatz
  setKit(kit) { this.kalib = { ...(kit ?? {}) }; }
  standardAbstand(name) { const s = this.kit.teile[name].standard; return Math.hypot(s[0], s[2]); }

  // kandidaten: mögliche Positionen in Figur-Koordinaten; genommen wird die, die im
  // Schlagzeug-Aufbau am ehesten zum Standardplatz dieses Teils passt
  einmessen(name, kandidaten) {
    const yaw = this.blickwinkel(), c = Math.cos(yaw), s = Math.sin(yaw), spiegel = this.hand === 'links' ? -1 : 1;
    const std = this.kit.teile[name].standard;
    let beste = null, bd = Infinity;
    for (const [x, y, z] of kandidaten) {
      const lokal = [spiegel * (x * c - z * s), y, x * s + z * c];
      const d = Math.hypot(lokal[0] - std[0], lokal[2] - std[2]);
      if (d < bd) { bd = d; beste = lokal; }
    }
    if (name === 'bassdrum') beste[1] = std[1];   // steht immer auf dem Boden
    this.kalib[name] = beste.map(v => Math.round(v * 1000) / 1000);
  }

  // extra: aus Farbmarkern { hals, stoecke: [l, r], becken: { name: Wert } } – alles optional
  // nachfuehren = false: nur stellen, Blickrichtung & Co. nicht weiter anpassen (zweiter Aufruf im selben Bild)
  update(j, extra, nachfuehren = true) {
    if (!this.rolle) return;
    const r = rumpf(j), L = this.live;
    if (nachfuehren) {
      L.vorne.lerp(new THREE.Vector3(r.fwd.x, 0, r.fwd.z), 0.02);
      L.greif += (greifSeite(j, r) - L.greif) * 0.02;
      L.becken = L.becken === null ? r.P.y : L.becken + (r.P.y - L.becken) * 0.02;
    }

    if (this.rolle === 'schlagzeug') return this.schlagzeugStellen(j, extra);
    this.saitenStellen(this.rolle === 'bass' ? this.bass : this.gitarre, j, r, this.greiftLinks(), extra?.hals);
  }

  saitenStellen(g, j, r, greifLinks, markerRichtung) {
    const greifSeite = r.side.clone().multiplyScalar(greifLinks ? 1 : -1);
    // Korpus vor dem Bauch, leicht zur Anschlagseite
    const mitte = r.P.clone().addScaledVector(r.up, 0.14).addScaledVector(r.fwd, 0.1 + this.bauch).addScaledVector(greifSeite, -0.05);
    // Mit Marker am Gitarrenkopf: dessen Richtung. Sonst zeigt der Hals zur Greifhand.
    let x = null;
    if (markerRichtung) {
      x = vec(markerRichtung);
      x.addScaledVector(r.fwd, -x.dot(r.fwd));
      x = x.length() > 0.3 ? x.normalize() : null;
    }
    if (!x) {
      const zurHand = vec(greifLinks ? j.lWr : j.rWr).sub(mitte);
      zurHand.addScaledVector(r.fwd, -zurHand.dot(r.fwd));
      const abstand = zurHand.length();
      const ruhe = greifSeite.clone().multiplyScalar(Math.cos(NACH_GREIFSEITE)).addScaledVector(r.up, Math.sin(NACH_GREIFSEITE));
      x = abstand > 1e-4 ? ruhe.lerp(zurHand.divideScalar(abstand), glatt(0.18, 0.38, abstand)).normalize() : ruhe;
    }
    const z = r.fwd.clone().addScaledVector(x, -r.fwd.dot(x)).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    g.position.copy(mitte);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    g.userData.saiten.material = this.mat[this.pulsAlter('saiten').alter < BLITZ ? 'blitz' : 'akzent'];
  }

  schlagzeugStellen(j, extra) {
    const a = this.anker, L = this.live, kit = this.kit;
    const yaw = this.blickwinkel(), spiegel = this.hand === 'links' ? -1 : 1;
    kit.aussen.rotation.y = yaw;
    kit.innen.scale.x = spiegel;
    const sitzHoehe = Math.max(0.3, (a ? a.becken : L.becken) - 0.1);
    kit.sitz.position.y = sitzHoehe - 0.035;
    kit.stange.scale.y = sitzHoehe - 0.07;
    kit.stange.position.y = (sitzHoehe - 0.07) / 2;

    // Teile an ihren eingemessenen oder Standardplätzen
    // Becken kippen um die waagrechte Achse quer zur Kamera: hebt sich der Tape-Punkt vorn, kippt der Rand hoch
    const achse = new THREE.Vector3(spiegel * Math.cos(yaw), 0, Math.sin(yaw));
    for (const [name, t] of Object.entries(kit.teile)) {
      const [x, y, z] = this.kalib[name] ?? t.standard;
      t.boden.position.set(x, 0, z);
      t.hoehe.position.y = y;
      if (t.staender) {
        const h = Math.max(0.05, y - t.abzug);
        t.staender.scale.y = h;
        t.staender.position.y = h / 2;
      }
      // Luftband: Teil leuchtet kurz, Trommeln zucken, Becken ohne Marker schwingen nach
      const { alter, staerke } = this.pulsAlter(name);
      t.leuchte.material = this.mat[alter < BLITZ ? 'blitz' : t.leuchte.userData.farbe];
      const istBecken = name === 'crash' || name === 'ride';
      t.wackel.scale.setScalar(istBecken ? 1 : 1 + 0.06 * staerke * Math.max(0, 1 - alter / 0.15));
      const wert = extra?.becken?.[name];
      if (name === 'hihat') t.deckel.position.y = 0.015 + Math.max(0, wert ?? 0);
      else if (istBecken) {
        const schwingen = wert ?? (alter < 2 ? -0.18 * staerke * Math.exp(-alter / 0.35) * Math.cos(alter * 18) : 0);
        t.wackel.quaternion.setFromAxisAngle(achse, -spiegel * schwingen);
      }
    }

    // Sticks: mit Marker an der Spitze deren Richtung, sonst aus Hand und Unterarm
    const seiten = [['lWr', 'lEl', 'lIdx'], ['rWr', 'rEl', 'rIdx']];
    seiten.forEach(([wr, el, idx], k) => {
      const W = vec(j[wr]), I = vec(j[idx]);
      const marker = extra?.stoecke?.[k];
      this.stockMarker[k] = !!marker;
      let d;
      if (marker) d = vec(marker).normalize();
      else {
        const hand = I.clone().sub(W).normalize(), arm = W.clone().sub(vec(j[el])).normalize();
        d = hand.multiplyScalar(0.65).addScaledVector(arm, 0.35).normalize();
      }
      const s = this.stoecke[k];
      s.position.copy(I).addScaledVector(d, -0.07);
      s.quaternion.setFromUnitVectors(OBEN, d);
    });
  }
}
