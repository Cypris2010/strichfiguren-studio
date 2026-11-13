// Überträgt erkannte MediaPipe-Punkte auf ein Strichmännchen mit festen Knochenlängen.
// Aus dem Video nehmen wir nur die Richtung jedes Knochens, nicht seine Länge. So bekommt
// jede Aufnahme dieselben Proportionen, egal wie groß die Person ist oder wie weit weg sie stand.
//
// Koordinaten der Figur (three.js): Meter, y nach oben, Figur schaut Richtung +z (zur Kamera),
// ihre linke Seite liegt bei +x – genau wie die Person im Video von vorn gesehen.

// MediaPipe-Pose: Nummern der Punkte, die wir brauchen
export const MP = {
  nose: 0, lEar: 7, rEar: 8,
  lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lIdx: 19, rIdx: 20,
  lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lHe: 29, rHe: 30, lTo: 31, rTo: 32,
};

// [Gelenk, Elterngelenk, Länge in m] – Reihenfolge so, dass Eltern immer zuerst kommen.
// pelvis = Mitte der Hüften, chest = Mitte der Schultern, headC = Mitte zwischen den Ohren.
export const KNOCHEN = [
  ['chest', 'pelvis', 0.50],
  ['headC', 'chest', 0.27],
  ['lSh', 'chest', 0.19], ['rSh', 'chest', 0.19],
  ['lEl', 'lSh', 0.29], ['rEl', 'rSh', 0.29],
  ['lWr', 'lEl', 0.26], ['rWr', 'rEl', 0.26],
  ['lIdx', 'lWr', 0.09], ['rIdx', 'rWr', 0.09],
  ['lHip', 'pelvis', 0.10], ['rHip', 'pelvis', 0.10],
  ['lKn', 'lHip', 0.44], ['rKn', 'rHip', 0.44],
  ['lAn', 'lKn', 0.43], ['rAn', 'rKn', 0.43],
  ['lHe', 'lAn', 0.06], ['rHe', 'rAn', 0.06],
  ['lTo', 'lAn', 0.16], ['rTo', 'rAn', 0.16],
];

export const FUSS_RADIUS = 0.028;
const HUEFTHOEHE = 0.96;   // ohne Boden-Fixierung

const einheit = v => { const l = Math.hypot(v[0], v[1], v[2]); return l < 1e-6 ? null : [v[0] / l, v[1] / l, v[2] / l]; };
const mitte = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// Ruhehaltung: aufrecht stehen, Arme locker hängend
const STANDARD = Object.fromEntries(Object.entries({
  chest: [0, 1, 0], headC: [0, 1, 0.05],
  lSh: [1, 0, 0], rSh: [-1, 0, 0],
  lEl: [0.12, -1, 0], rEl: [-0.12, -1, 0],
  lWr: [0.05, -1, 0.15], rWr: [-0.05, -1, 0.15],
  lIdx: [0, -1, 0.1], rIdx: [0, -1, 0.1],
  lHip: [1, 0, 0], rHip: [-1, 0, 0],
  lKn: [0.03, -1, 0], rKn: [-0.03, -1, 0],
  lAn: [0, -1, 0], rAn: [0, -1, 0],
  lHe: [0, -1, -0.35], rHe: [0, -1, -0.35],
  lTo: [0.1, -0.25, 1], rTo: [-0.1, -0.25, 1],
}).map(([k, v]) => [k, einheit(v)]));

// Sitzen: Beine stehen fest (Oberschenkel nach vorn, Unterschenkel senkrecht), nur der Oberkörper
// kommt aus dem Video. Die Beine schauen immer nach vorn (+z), wie auf einem Hocker vor der Kamera.
const SITZBEINE = Object.fromEntries(Object.entries({
  lHip: [1, 0, 0], rHip: [-1, 0, 0],
  lKn: [0.12, -0.08, 1], rKn: [-0.12, -0.08, 1],
  lAn: [0.02, -1, 0.12], rAn: [-0.02, -1, 0.12],
  lHe: [0, -1, -0.35], rHe: [0, -1, -0.35],
  lTo: [0.1, -0.25, 1], rTo: [-0.1, -0.25, 1],
}).map(([k, v]) => [k, einheit(v)]));

function aufbauen(richtung, { boden = true, sitzen = false } = {}) {
  if (sitzen) { richtung = { ...richtung, ...SITZBEINE }; boden = true; }
  const j = { pelvis: [0, 0, 0] };
  for (const [kind, eltern, laenge] of KNOCHEN) {
    const p = j[eltern], d = richtung[kind];
    j[kind] = [p[0] + d[0] * laenge, p[1] + d[1] * laenge, p[2] + d[2] * laenge];
  }
  // Boden-Fixierung: der tiefste Fußpunkt steht immer auf dem Boden
  const dy = boden ? FUSS_RADIUS - Math.min(j.lHe[1], j.rHe[1], j.lTo[1], j.rTo[1]) : HUEFTHOEHE;
  for (const k in j) j[k][1] += dy;
  if (sitzen) j.sitzt = true;
  return j;
}

export const restPose = opts => aufbauen(STANDARD, opts);

// p: 33 MediaPipe-Weltpunkte [x, y, z, sichtbarkeit] → Gelenkpositionen der Figur
// opts: { boden: Füße auf den Boden stellen, sitzen: Beine fest im Sitzen, nur Oberkörper aus dem Video }
export function buildRig(p, opts) {
  // MediaPipe: y nach unten, z negativ = näher an der Kamera → umdrehen für three.js
  const q = {};
  for (const [k, i] of Object.entries(MP)) q[k] = [p[i][0], -p[i][1], -p[i][2]];
  q.pelvis = mitte(q.lHip, q.rHip);
  q.chest = mitte(q.lSh, q.rSh);
  q.headC = mitte(q.lEar, q.rEar);
  const richtung = {};
  for (const [kind, eltern] of KNOCHEN) richtung[kind] = einheit(minus(q[kind], q[eltern])) ?? STANDARD[kind];
  const j = aufbauen(richtung, opts);
  // grobe Kopfrichtung aus der Pose (Ohrenlinie, Nase), falls kein Gesicht erkannt wurde
  const x = einheit(minus(q.lEar, q.rEar));
  if (x) j.kopf = { x, f: minus(q.nose, q.headC) };
  return j;
}

// Linien für die Einblendung im Video (MediaPipe-Nummern)
export const OVERLAY_LINIEN = [
  [7, 0], [0, 8], [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];
