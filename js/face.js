// Gesichtserkennung in zwei Stufen (beides MediaPipe, läuft im Browser):
//   1. Face Detector (BlazeFace) sucht alle Gesichter im ganzen Bild – schnell, liefert Rahmen.
//   2. Face Landmarker wertet einen Ausschnitt um den Kopf genau aus: 478 Punkte und
//      52 Blendshapes (Mund auf, Blinzeln, Lächeln, Augenbrauen …), daraus die Kopfdrehung.
//
// Der Ausschnitt ist der Trick: bei Ganzkörperaufnahmen ist das Gesicht im Vollbild zu klein
// für das Gesichtsmodell. Wir schneiden deshalb um den Kopf aus und vergrößern auf 256 × 256.
// Woher der Ausschnitt kommt, in dieser Reihenfolge:
//   detektor  Rahmen des Face Detectors, der zum Kopf der Pose passt
//   verfolgt  das Gesicht aus dem letzten Bild
//   pose      Kopfpunkte der Pose (Nase, Augen, Ohren) – klappt auch bei kleinen Gesichtern
import * as THREE from 'three';
import { FaceDetector, FaceLandmarker } from '@mediapipe/tasks-vision';
import { mitGpu, monotoneZeit } from './pose.js';

const DETEKTOR_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const LANDMARKER_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const AUSSCHNITT = 256;      // Pixel, Eingabe für den Face Landmarker
const MIN_PIXEL = 36;        // kleinere Köpfe lohnen nicht
const r4 = v => Math.round(v * 1e4) / 1e4;
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;

// Linien für die Einblendung im Video: Umriss, Augen, Brauen, Lippen
export const GESICHT_LINIEN = [
  FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, FaceLandmarker.FACE_LANDMARKS_LIPS,
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
].flat().map(c => [c.start, c.end]);

const groesse = q => [q.videoWidth || q.naturalWidth || q.width, q.videoHeight || q.naturalHeight || q.height];

// Kopfausschnitt aus den Pose-Bildpunkten (0 Nase, 2/5 Augen, 7/8 Ohren, 11/12 Schultern)
function posenAusschnitt(q, W, H) {
  const P = i => [q[i][0] * W, q[i][1] * H];
  const ab = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const nase = P(0), lO = P(7), rO = P(8);
  const ohren = ab(lO, rO), augen = ab(P(2), P(5)), schultern = ab(P(11), P(12));
  const s = Math.max(ohren * 2.3, augen * 5, schultern * 0.6);
  const mx = (lO[0] + rO[0]) / 2, my = (lO[1] + rO[1]) / 2;
  return { cx: (nase[0] + mx) / 2, cy: (nase[1] + my) / 2 - s * 0.06, s };
}

const ausBox = b => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, s: Math.max(b.w, b.h) * 1.9 });

export async function createGesicht() {
  const [detektor, landmarker] = await Promise.all([
    mitGpu(FaceDetector, { baseOptions: { modelAssetPath: DETEKTOR_URL }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 }),
    mitGpu(FaceLandmarker, {
      baseOptions: { modelAssetPath: LANDMARKER_URL }, runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: true, minFaceDetectionConfidence: 0.4, minTrackingConfidence: 0.4,
    }),
  ]);
  const zeit = monotoneZeit();
  const leinwand = document.createElement('canvas');
  leinwand.width = leinwand.height = AUSSCHNITT;
  const g = leinwand.getContext('2d', { willReadFrequently: false });
  let letzter = null;   // Ausschnitt aus dem letzten erkannten Gesicht
  const api = { namen: null, leinwand };

  // Quadrat (Pixel) aus der Quelle in die Leinwand kopieren, Ränder außerhalb bleiben schwarz
  function ausschneiden(quelle, W, H, { cx, cy, s }) {
    const x0 = cx - s / 2, y0 = cy - s / 2, k = AUSSCHNITT / s;
    const sx = Math.max(0, x0), sy = Math.max(0, y0);
    const sw = Math.min(W, x0 + s) - sx, sh = Math.min(H, y0 + s) - sy;
    g.fillStyle = '#000';
    g.fillRect(0, 0, AUSSCHNITT, AUSSCHNITT);
    if (sw > 1 && sh > 1) g.drawImage(quelle, sx, sy, sw, sh, (sx - x0) * k, (sy - y0) * k, sw * k, sh * k);
    return { x0, y0, s };
  }

  // q = Pose-Bildpunkte (darf fehlen). Ergebnis:
  //   boxen     alle Gesichter des Detektors [{x, y, w, h, s}] (0..1)
  //   herkunft  woher der Ausschnitt kam (detektor | verfolgt | pose) oder null
  //   gesicht   { b: Blendshapes, r: Kopfdrehung als Quaternion [x, y, z, w], k: Rahmen [x, y, w, h] } oder null
  //   punkte    478 Bildpunkte [x, y] (0..1) – nur für die Live-Einblendung, wird nicht gespeichert
  api.detect = (quelle, ms, q) => {
    const [W, H] = groesse(quelle);
    if (!W || !H) return null;
    const ts = zeit(ms);
    const boxen = detektor.detectForVideo(quelle, ts).detections.map(d => {
      const b = d.boundingBox;
      return { x: b.originX, y: b.originY, w: b.width, h: b.height, s: d.categories?.[0]?.score ?? 0 };
    });

    const ausPose = q ? posenAusschnitt(q, W, H) : null;
    const nahe = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy) < b.s * 0.5;
    let aus = null, herkunft = null;
    const passend = ausPose
      ? boxen.map(ausBox).filter(b => nahe(b, ausPose)).sort((a, b) => Math.hypot(a.cx - ausPose.cx, a.cy - ausPose.cy) - Math.hypot(b.cx - ausPose.cx, b.cy - ausPose.cy))[0]
      : null;
    if (passend) [aus, herkunft] = [passend, 'detektor'];
    else if (letzter && (!ausPose || nahe(letzter, ausPose))) [aus, herkunft] = [letzter, 'verfolgt'];
    else if (ausPose) [aus, herkunft] = [ausPose, 'pose'];
    else if (boxen.length) [aus, herkunft] = [ausBox(boxen.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b))), 'detektor'];

    const ergebnis = {
      boxen: boxen.map(b => ({ x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H, s: b.s })),
      herkunft: null, gesicht: null, punkte: null,
    };
    if (!aus || aus.s < MIN_PIXEL) { letzter = null; return ergebnis; }

    const { x0, y0, s } = ausschneiden(quelle, W, H, aus);
    const r = landmarker.detectForVideo(leinwand, ts);
    const lm = r.faceLandmarks?.[0];
    if (!lm) { letzter = null; return ergebnis; }

    // zurück in Pixel des ganzen Bildes; z hat ungefähr denselben Maßstab wie x
    const px = lm.map(l => [x0 + l.x * s, y0 + l.y * s, l.z * s]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of px) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    letzter = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, s: Math.max(maxX - minX, maxY - minY) * 1.7 };

    const kat = r.faceBlendshapes?.[0]?.categories ?? [];
    if (!api.namen && kat.length) api.namen = [...kat].sort((a, b) => a.index - b.index).map(c => c.categoryName);
    const b = new Array(api.namen?.length ?? 0).fill(0);
    for (const c of kat) b[c.index] = r2(c.score);

    ergebnis.herkunft = herkunft;
    ergebnis.gesicht = {
      b,
      r: kopfDrehung(px).map(r4),
      k: [r3(minX / W), r3(minY / H), r3((maxX - minX) / W), r3((maxY - minY) / H)],
    };
    ergebnis.punkte = px.map(([x, y]) => [x / W, y / H]);
    return ergebnis;
  };

  api.reset = () => { letzter = null; };
  api.close = () => { detektor.close(); landmarker.close(); };
  return api;
}

// Kopfdrehung aus den Gesichtspunkten, im Koordinatensystem der Figur
// (x = linke Seite der Person = rechts im Bild, y nach oben, z zur Kamera).
// 33/263 = äußere Augenwinkel (rechts/links der Person), 10 = Stirn, 152 = Kinn.
const vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion();
function kopfDrehung(px) {
  const P = (v, i) => v.set(px[i][0], -px[i][1], -px[i][2]);
  vx.subVectors(P(vx, 263), P(vz, 33)).normalize();
  vy.subVectors(P(vy, 10), P(vz, 152));
  vy.addScaledVector(vx, -vy.dot(vx)).normalize();
  vz.crossVectors(vx, vy);
  quat.setFromRotationMatrix(m4.makeBasis(vx, vy, vz));
  return [quat.x, quat.y, quat.z, quat.w];
}

// Blendshapes → die paar Werte, die das Strichgesicht braucht.
// „Left“ meint bei MediaPipe (wie bei ARKit) die linke Seite der Person.
// staerke verstärkt die Mimik: echte Gesichter lächeln dezent (mouthSmile ≈ 0,3), ein
// Strichgesicht braucht deutliche Linien. GRUND_LAECHELN gibt einem neutralen Gesicht
// einen freundlichen Zug, genau wie bei der Figur ohne erkanntes Gesicht.
// neutral: Ruhegesicht der Person (Blendshapes), wird abgezogen. MediaPipe meldet bei vielen
// Menschen schon im entspannten Gesicht gesenkte Brauen, Mundwinkel nach unten oder Lippenpressen –
// verstärkt sähe das nach schlechter Laune aus. Erst die Abweichung vom Ruhegesicht zählt.
export const GRUND_LAECHELN = 0.2;
const indexCache = new WeakMap();
const klemme = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export function mimik(gesicht, namen, staerke = 2, neutral = null) {
  if (!gesicht || !namen) return null;
  let idx = indexCache.get(namen);
  if (!idx) { idx = Object.fromEntries(namen.map((n, i) => [n, i])); indexCache.set(namen, idx); }
  const w = n => {
    const i = idx[n], v = gesicht.b[i] ?? 0, n0 = Math.min(0.9, neutral?.[i] ?? 0);
    return Math.max(0, (v - n0) / (1 - n0));
  };
  const k = staerke;
  const auge = s => klemme(1 - (w('eyeBlink' + s) - 0.1) / 0.45);
  // browDown kommt beim Lächeln oft mit (Augen kneifen); damit das nicht grimmig wirkt, zählt es schwächer
  // und beim Lachen fast gar nicht
  const lacht = klemme((w('mouthSmileLeft') + w('mouthSmileRight')) / 2 * 2);
  const braue = s => klemme((w('browOuterUp' + s) - 0.6 * (1 - lacht) * w('browDown' + s)) * k, -1, 1);
  // Lächeln zählt voll, Mundwinkel nach unten nur halb: im Zweifel freundlich
  const laecheln = s => klemme(GRUND_LAECHELN + (Math.max(0, w('mouthSmile' + s) - 0.03) * 1.3 - w('mouthFrown' + s) * 0.6) * k, -1, 1);
  return {
    r: gesicht.r,
    augeL: auge('Left'), augeR: auge('Right'),
    braueInnen: klemme(w('browInnerUp') * k),
    braueL: braue('Left'), braueR: braue('Right'),
    mundAuf: klemme(w('jawOpen') * 0.7 * k),
    laechelnL: laecheln('Left'), laechelnR: laecheln('Right'),
    spitz: klemme(Math.max(w('mouthPucker'), w('mouthFunnel')) * 0.8 * k),
  };
}

// Ruhegesicht live schätzen: jeder Wert folgt nach unten schnell, nach oben nur sehr langsam.
// So landet die Schätzung beim entspannten Gesicht, auch wenn zwischendurch gelacht oder gesungen wird.
export class NeutralSchaetzer {
  constructor() { this.werte = null; this.fest = false; }
  reset() { this.werte = null; this.fest = false; }
  update(b) {
    if (this.fest || !b?.length) return;
    if (this.werte?.length !== b.length) { this.werte = [...b]; return; }
    this.werte = this.werte.map((n, i) => n + (b[i] - n) * (b[i] < n ? 0.08 : 0.003));
  }
  // „Neutral merken“: aktuelles Gesicht als Ruhegesicht festhalten
  merken(b) { if (b?.length) { this.werte = [...b]; this.fest = true; } }
}

// Ruhegesicht einer fertigen Aufnahme: pro Blendshape das 10-%-Quantil über alle Bilder mit Gesicht
export function neutralAusFrames(frames) {
  const alle = frames.filter(f => f.g).map(f => f.g.b);
  if (!alle.length) return null;
  return alle[0].map((_, i) => {
    const w = alle.map(b => b[i]).sort((a, b) => a - b);
    return Math.round(w[Math.floor((w.length - 1) * 0.1)] * 100) / 100;
  });
}
