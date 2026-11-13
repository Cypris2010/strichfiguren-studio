// Pose-Erkennung mit MediaPipe Pose Landmarker (läuft komplett im Browser).
// Liefert pro Bild 33 Körperpunkte:
//   p = Weltkoordinaten in Metern, Mittelpunkt zwischen den Hüften
//       [x nach rechts im Bild, y nach unten, z negativ = näher an der Kamera, Sichtbarkeit 0..1]
//   q = Bildkoordinaten 0..1 [x, y] (für die Einblendung im Video)
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const modellUrl = name =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${name}/float16/1/pose_landmarker_${name}.task`;

const r4 = v => Math.round(v * 1e4) / 1e4;
const r2 = v => Math.round(v * 100) / 100;
let fileset = null;

export async function createDetector(name) {
  fileset ??= await FilesetResolver.forVisionTasks(WASM);
  const optionen = delegate => ({
    baseOptions: { modelAssetPath: modellUrl(name), delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  let landmarker;
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, optionen('GPU'));
  } catch (err) {
    console.warn('GPU nicht verfügbar, Erkennung läuft auf der CPU', err);
    landmarker = await PoseLandmarker.createFromOptions(fileset, optionen('CPU'));
  }

  // MediaPipe verlangt streng steigende Zeitstempel. Springt die Quelle zurück
  // (neues Video, Analyse nach Live-Vorschau), verschieben wir die Zeitachse,
  // behalten aber die Abstände zwischen den Bildern bei.
  let letzte = -Infinity, versatz = 0;

  return {
    name,
    detect(quelle, ms) {
      if (ms + versatz <= letzte) versatz = letzte + 33 - ms;
      const ts = Math.max(Math.round(ms + versatz), letzte + 1);
      letzte = ts;
      const r = landmarker.detectForVideo(quelle, ts);
      const welt = r.worldLandmarks?.[0], bild = r.landmarks?.[0];
      if (!welt || !bild) return null;
      return {
        p: welt.map((l, i) => [r4(l.x), r4(l.y), r4(l.z), r2(bild[i].visibility ?? 1)]),
        q: bild.map(l => [r4(l.x), r4(l.y)]),
      };
    },
    close() { landmarker.close(); },
  };
}
