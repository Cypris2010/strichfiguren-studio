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

// Gemeinsame Laufzeit für alle MediaPipe-Modelle (Pose und Gesicht)
export const vision = async () => (fileset ??= await FilesetResolver.forVisionTasks(WASM));

// Erst auf der Grafikkarte versuchen, sonst auf der CPU
export async function mitGpu(Klasse, optionen) {
  const fs = await vision();
  const mit = delegate => ({ ...optionen, baseOptions: { ...optionen.baseOptions, delegate } });
  try {
    return await Klasse.createFromOptions(fs, mit('GPU'));
  } catch (err) {
    console.warn('GPU nicht verfügbar, Erkennung läuft auf der CPU', err);
    return Klasse.createFromOptions(fs, mit('CPU'));
  }
}

// MediaPipe verlangt streng steigende Zeitstempel. Springt die Quelle zurück
// (neues Video, Analyse nach Live-Vorschau), verschieben wir die Zeitachse,
// behalten aber die Abstände zwischen den Bildern bei.
export function monotoneZeit() {
  let letzte = -Infinity, versatz = 0;
  return ms => {
    if (ms + versatz <= letzte) versatz = letzte + 33 - ms;
    letzte = Math.max(Math.round(ms + versatz), letzte + 1);
    return letzte;
  };
}

export async function createDetector(name) {
  const landmarker = await mitGpu(PoseLandmarker, {
    baseOptions: { modelAssetPath: modellUrl(name) },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  const zeit = monotoneZeit();

  return {
    name,
    detect(quelle, ms) {
      const r = landmarker.detectForVideo(quelle, zeit(ms));
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
