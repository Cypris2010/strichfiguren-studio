// Farbmarker im Video finden und mit Hilfe der erkannten Pose in 3D einordnen.
//
// Idee: Ein Streifen auffälliges Klebeband (z. B. neongrün) am Gitarrenkopf oder an den
// Stickspitzen ist in jedem Bild leicht zu finden. Aus der Pose wissen wir, wie Bild und
// Körper zusammenhängen (Maßstab, Lage). Damit wird aus dem 2D-Punkt im Bild ein 3D-Punkt –
// die fehlende Tiefe ergibt sich aus dem Instrument: Die Gitarre liegt flach vor dem Bauch,
// ein Stick ist 42 cm lang.
import * as THREE from 'three';
import { MP } from './rig.js';
import { rumpf } from './instrumente.js';

const r4 = v => Math.round(v * 1e4) / 1e4;
const BREITE = 320;   // Auflösung für die Farbsuche

export function rgbZuHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export class MarkerSucher {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  bild(quelle) {
    const w = quelle.videoWidth || quelle.naturalWidth || quelle.width;
    const h = quelle.videoHeight || quelle.naturalHeight || quelle.height;
    if (!w || !h) return null;
    const W = BREITE, H = Math.max(1, Math.round((BREITE * h) / w));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.ctx.drawImage(quelle, 0, 0, W, H);
    return { W, H, d: this.ctx.getImageData(0, 0, W, H).data };
  }

  // Mittlere Farbe um einen Bildpunkt (u, v von 0 bis 1)
  farbeBei(quelle, u, v) {
    const b = this.bild(quelle);
    if (!b) return null;
    const cx = Math.round(u * (b.W - 1)), cy = Math.round(v * (b.H - 1));
    let r = 0, g = 0, bl = 0, n = 0;
    for (let y = cy - 3; y <= cy + 3; y++) {
      for (let x = cx - 3; x <= cx + 3; x++) {
        if (x < 0 || y < 0 || x >= b.W || y >= b.H) continue;
        const i = (y * b.W + x) * 4;
        r += b.d[i]; g += b.d[i + 1]; bl += b.d[i + 2]; n++;
      }
    }
    r /= n; g /= n; bl /= n;
    return { hsv: rgbZuHsv(r, g, bl), rgb: [r, g, bl].map(Math.round) };
  }

  // Für jede Zielfarbe die größten Flecken: [[[u, v, Flächenanteil], …], …], größter zuerst.
  // Das Bild wird nur einmal gelesen, auch bei mehreren Farben.
  suche(quelle, ziele) {
    const b = this.bild(quelle);
    return ziele.map(z => (b && z ? this.flecken(b, z, z.max ?? 3) : null));
  }

  flecken(b, ziel, max) {
    const { W, H, d } = b, N = W * H;
    const [zh, zs, zv] = ziel.hsv;
    const tolH = 5 + 3.5 * ziel.tol;
    const minS = Math.max(0.2, zs * (1 - 0.06 * ziel.tol));
    const minV = Math.max(0.12, zv * (1 - 0.07 * ziel.tol));
    const maske = new Uint8Array(N);
    for (let k = 0, i = 0; k < N; k++, i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, bl = d[i + 2] / 255;
      const mx = Math.max(r, g, bl), df = mx - Math.min(r, g, bl);
      if (mx < minV || !df || df / mx < minS) continue;
      let h = mx === r ? ((g - bl) / df) % 6 : mx === g ? (bl - r) / df + 2 : (r - g) / df + 4;
      h *= 60;
      if (h < 0) h += 360;
      let dh = Math.abs(h - zh);
      if (dh > 180) dh = 360 - dh;
      if (dh <= tolH) maske[k] = 1;
    }
    // Zusammenhängende Flecken (4er-Nachbarschaft)
    const stapel = new Int32Array(N), flecken = [];
    for (let start = 0; start < N; start++) {
      if (maske[start] !== 1) continue;
      let n = 0, sx = 0, sy = 0, top = 0;
      maske[start] = 2;
      stapel[top++] = start;
      while (top) {
        const k = stapel[--top], x = k % W, y = (k / W) | 0;
        n++; sx += x; sy += y;
        if (x > 0 && maske[k - 1] === 1) { maske[k - 1] = 2; stapel[top++] = k - 1; }
        if (x < W - 1 && maske[k + 1] === 1) { maske[k + 1] = 2; stapel[top++] = k + 1; }
        if (y > 0 && maske[k - W] === 1) { maske[k - W] = 2; stapel[top++] = k - W; }
        if (y < H - 1 && maske[k + W] === 1) { maske[k + W] = 2; stapel[top++] = k + W; }
      }
      if (n >= 4) flecken.push([(sx / n + 0.5) / W, (sy / n + 0.5) / H, n / N]);
    }
    flecken.sort((a, b) => b[2] - a[2]);
    return flecken.slice(0, max).map(f => f.map(r4));
  }
}

// ---------- Bild → Welt ----------

// Schwach-perspektivische Abbildung von Bildpunkten auf MediaPipe-Weltkoordinaten (x, y in Metern),
// per kleinster Quadrate aus allen gut sichtbaren Körperpunkten bestimmt.
function bildAbbildung(p, q, aspect) {
  const pts = [];
  for (let i = 11; i < 33; i++) if (p[i][3] >= 0.5) pts.push([q[i][0] * aspect, q[i][1], p[i][0], p[i][1]]);
  if (pts.length < 4) return null;
  const m = [0, 0, 0, 0];
  for (const pt of pts) for (let k = 0; k < 4; k++) m[k] += pt[k] / pts.length;
  let zaehler = 0, nenner = 0;
  for (const [u, v, x, y] of pts) {
    zaehler += (u - m[0]) * (x - m[2]) + (v - m[1]) * (y - m[3]);
    nenner += (u - m[0]) ** 2 + (v - m[1]) ** 2;
  }
  if (nenner < 1e-9) return null;
  const s = zaehler / nenner, a = m[2] - s * m[0], b = m[3] - s * m[1];
  const abb = (u, v) => [s * u * aspect + a, s * v + b];
  abb.s = s;   // Meter pro Bildhöhe
  return abb;
}

// Gelenke in echter Größe, three.js-Achsen (y oben, z zur Kamera)
const drei = pt => [pt[0], -pt[1], -pt[2]];
const vec = a => new THREE.Vector3(a[0], a[1], a[2]);
function weltGelenke(p) {
  const g = {};
  for (const [k, i] of Object.entries(MP)) g[k] = drei(p[i]);
  const mitte = (a, b) => a.map((v, k) => (v + b[k]) / 2);
  g.pelvis = mitte(g.lHip, g.rHip);
  g.chest = mitte(g.lSh, g.rSh);
  return g;
}

// Richtung des Gitarrenhalses aus dem Marker am Gitarrenkopf, oder null
export function halsAusMarker(p, q, m, aspect, greifLinks) {
  if (!m?.length || !q) return null;
  const abb = bildAbbildung(p, q, aspect);
  if (!abb) return null;
  const g = weltGelenke(p), r = rumpf(g);
  const greif = r.side.clone().multiplyScalar(greifLinks ? 1 : -1);
  const mitte = r.P.clone().addScaledVector(r.up, 0.14).addScaledVector(r.fwd, 0.1).addScaledVector(greif, -0.05);
  const hand = vec(greifLinks ? g.lWr : g.rWr);
  for (const [u, v] of m) {   // größter Fleck zuerst
    const [x, y] = abb(u, v);
    const kopf = new THREE.Vector3(x, -y, 0);
    // Tiefe: der Gitarrenkopf liegt in der Ebene der Gitarre (Normale = Blickrichtung)
    const n = r.fwd;
    kopf.z = Math.abs(n.z) > 0.3 ? mitte.z - (n.x * (kopf.x - mitte.x) + n.y * (kopf.y - mitte.y)) / n.z : hand.z;
    const rel = kopf.sub(mitte), abstand = rel.length();
    if (abstand < 0.3 || abstand > 1.4 || rel.dot(greif) < 0.05) continue;   // passt nicht zu einem Gitarrenkopf
    rel.addScaledVector(r.fwd, -rel.dot(r.fwd)).normalize();
    return rel.toArray();
  }
  return null;
}

// Richtungen beider Sticks aus den Markern an den Spitzen: [links, rechts], je [x, y, z] oder null
const STOCK = 0.42;
export function stoeckeAusMarker(p, q, m, aspect) {
  const ergebnis = [null, null];
  if (!m?.length || !q) return ergebnis;
  const abb = bildAbbildung(p, q, aspect);
  if (!abb) return ergebnis;
  const g = weltGelenke(p), r = rumpf(g);
  const griffe = [vec(g.lIdx), vec(g.rIdx)];
  const spitzen = m.map(([u, v]) => { const [x, y] = abb(u, v); return [x, -y]; });
  // Abstand Griff → Spitze im Bild; nur plausible Längen zählen
  const kosten = griffe.map(G => spitzen.map(([x, y]) => {
    const d = Math.hypot(x - G.x, y - G.y);
    return d > 0.1 && d < STOCK * 1.5 ? Math.abs(d - 0.32) : Infinity;
  }));
  // Beste Zuordnung: möglichst beide Hände, dann geringste Kosten
  let beste = null;
  for (let i = -1; i < spitzen.length; i++) {
    for (let j = -1; j < spitzen.length; j++) {
      if (i >= 0 && i === j) continue;
      const ki = i < 0 ? 0 : kosten[0][i], kj = j < 0 ? 0 : kosten[1][j];
      if (ki === Infinity || kj === Infinity) continue;
      const wertung = [(i >= 0) + (j >= 0), -(ki + kj)];
      if (!beste || wertung[0] > beste.w[0] || (wertung[0] === beste.w[0] && wertung[1] > beste.w[1])) beste = { i, j, w: wertung };
    }
  }
  if (!beste) return ergebnis;
  [beste.i, beste.j].forEach((s, k) => {
    if (s < 0) return;
    const G = griffe[k], [x, y] = spitzen[s];
    const dx = x - G.x, dy = y - G.y, dz = Math.sqrt(Math.max(0, STOCK * STOCK - dx * dx - dy * dy));
    // Von den zwei möglichen Tiefen die, bei der der Stick nach vorn zeigt
    const vorn = new THREE.Vector3(dx, dy, dz), hinten = new THREE.Vector3(dx, dy, -dz);
    ergebnis[k] = (vorn.dot(r.fwd) >= hinten.dot(r.fwd) ? vorn : hinten).normalize().toArray();
  });
  return ergebnis;
}

// Klick ins Video beim Einmessen → zwei mögliche Positionen der Trommel in Figur-Koordinaten.
// Höhe und seitliche Lage kommen aus dem Bild; die Tiefe aus dem üblichen Abstand D zum Becken.
export function trommelKandidaten(p, q, u, v, aspect, beckenY, D) {
  const abb = bildAbbildung(p, q, aspect);
  if (!abb) return null;
  const g = weltGelenke(p);
  const k = 0.5 / Math.max(0.2, vec(g.chest).distanceTo(vec(g.pelvis)));   // auf die Proportionen der Figur
  const [x, y] = abb(u, v);
  const X = x * k, Y = -y * k + beckenY;
  const dz = Math.sqrt(Math.max(0, D * D - X * X));
  return [[X, Y, dz], [X, Y, -dz]];
}

// ---------- Becken ----------
// Jedes Becken hat einen Tape-Punkt am Rand (zur Kamera hin). Die Ruhelage im Bild kennen wir
// vom Einmessen bzw. als Mittel über die Aufnahme. Hebt sich der Punkt, kippt das Becken;
// bei der Hi-Hat öffnet sich das obere Becken.
export const BECKEN = ['hihat', 'crash', 'ride'];
const BECKEN_RADIUS = 0.22;
const SUCHRADIUS = 0.08;   // in Bildhöhen
const begrenzt = (x, a, b) => Math.min(b, Math.max(a, x));

function naechsterFleck(flecken, [ru, rv], aspect) {
  let beste = null, bd = SUCHRADIUS;
  for (const f of flecken ?? []) {
    const d = Math.hypot((f[0] - ru) * aspect, f[1] - rv);
    if (d < bd) { bd = d; beste = f; }
  }
  return beste;
}

// Ruhelage jedes Beckens im Bild: Mittel (Median) aller Flecken nahe der eingemessenen Stelle
export function beckenRuhe(frames, kitBild, aspect) {
  const ruhe = {};
  for (const name of BECKEN) {
    if (!kitBild?.[name]) continue;
    const us = [], vs = [];
    for (const f of frames) {
      const fl = naechsterFleck(f.mb, kitBild[name], aspect);
      if (fl) { us.push(fl[0]); vs.push(fl[1]); }
    }
    if (us.length < 5) { ruhe[name] = kitBild[name]; continue; }
    us.sort((a, b) => a - b);
    vs.sort((a, b) => a - b);
    ruhe[name] = [us[us.length >> 1], vs[vs.length >> 1]];
  }
  return ruhe;
}

// Kippwinkel (Crash, Ride) bzw. Öffnung in Metern (Hi-Hat) je Becken, oder null
export function beckenAusMarker(p, q, mb, aspect, ruhe) {
  const abb = mb?.length && q ? bildAbbildung(p, q, aspect) : null;
  if (!abb) return null;
  const out = {};
  for (const [name, r] of Object.entries(ruhe ?? {})) {
    const fl = naechsterFleck(mb, r, aspect);
    if (!fl) { out[name] = null; continue; }
    const hub = -(fl[1] - r[1]) * abb.s;   // Bild-y zeigt nach unten
    out[name] = name === 'hihat' ? begrenzt(hub, -0.01, 0.08) : Math.asin(begrenzt(hub / BECKEN_RADIUS, -0.6, 0.6));
  }
  return out;
}

// Was die Instrumente aus den Markern eines Bildes brauchen
export function markerAuswerten(f, aspect, rolle, greifLinks, ruhe) {
  if (!f?.q) return null;
  if (rolle === 'gitarre' || rolle === 'bass') {
    return f.m?.length ? { hals: halsAusMarker(f.p, f.q, f.m, aspect, greifLinks) } : null;
  }
  if (rolle === 'schlagzeug') {
    return {
      stoecke: stoeckeAusMarker(f.p, f.q, f.m, aspect),
      becken: beckenAusMarker(f.p, f.q, f.mb, aspect, ruhe) ?? {},
    };
  }
  return null;
}
