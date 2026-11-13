// Strichfiguren-Studio: Video oder Kamera → Pose-Erkennung → 3D-Strichmännchen → Bewegungsdatei.
//
// Ablauf
//   live     Kamera oder Videodatei, jedes Bild wird sofort erkannt und angezeigt
//   analyse  Videodatei wird Bild für Bild (30 oder 60 pro Sekunde) genau ausgewertet
//   take     fertige Aufnahme: abspielen, ansehen, als JSON speichern
import { Studio3D } from './scene.js';
import { createDetector } from './pose.js';
import { createGesicht, mimik as mimikRoh, GESICHT_LINIEN, NeutralSchaetzer, neutralAusFrames } from './face.js';
import { PoseFilter, GesichtFilter } from './filter.js';
import { buildRig, restPose, OVERLAY_LINIEN } from './rig.js';

const FORMAT = 'strichfiguren-take';
const $ = id => document.getElementById(id);
const ui = {
  status: $('status'), video: $('video'), overlay: $('overlay'), rahmen: $('videoRahmen'), leer: $('videoLeer'),
  btnKamera: $('btnKamera'), lblVideo: $('lblVideo'), dateiVideo: $('dateiVideo'),
  btnAufnahme: $('btnAufnahme'), btnAnalyse: $('btnAnalyse'),
  selModell: $('selModell'), selFps: $('selFps'), chkSpiegeln: $('chkSpiegeln'),
  selErkennung: $('selErkennung'), btnNeutral: $('btnNeutral'), gesichtInfo: $('gesichtInfo'), rngMimik: $('rngMimik'),
  chkDrehen: $('chkDrehen'), selStil: $('selStil'), rngGlaettung: $('rngGlaettung'), chkBoden: $('chkBoden'),
  btnPlay: $('btnPlay'), rngZeit: $('rngZeit'), zeit: $('zeit'), btnExport: $('btnExport'), dateiJson: $('dateiJson'),
};

const studio = new Studio3D($('dreiD'));
const S = {
  mode: 'idle',        // idle | live | analyse | take
  quelle: null,        // kamera | datei | import
  stream: null, mikro: null, videoUrl: null, dateiName: '',
  detector: null,
  gesicht: null,       // Gesichtserkennung (Detektor + Landmarker), wird bei Bedarf geladen
  liveFilter: new PoseFilter(+ui.rngGlaettung.value),
  liveGesichtFilter: new GesichtFilter(+ui.rngGlaettung.value),
  neutral: new NeutralSchaetzer(),   // Ruhegesicht der Person, live geschätzt oder gemerkt
  letzterRig: null,
  liveToken: 0,
  aufnahme: null, analyse: null,
  take: null, posen: null, mitVideo: false,
  uhr: { laeuft: false, start: 0, versatz: 0 },
};

const rigOpts = () => ({ boden: ui.chkBoden.checked });
const mimik = (g, namen, neutral = S.neutral.werte) => mimikRoh(g, namen, +ui.rngMimik.value, neutral);
const status = text => { ui.status.textContent = text; ui.status.title = text; };
const r3 = v => Math.round(v * 1000) / 1000;
const zeitText = s => { const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
const einmal = (el, ereignis) => new Promise(ok => el.addEventListener(ereignis, ok, { once: true }));

studio.setPose(restPose(rigOpts()));

// ---------- Erkennungsmodell ----------
let ladeVersprechen = null;
function detektor() {
  const name = ui.selModell.value;
  if (S.detector?.name === name) return Promise.resolve(S.detector);
  if (!ladeVersprechen) {
    S.detector?.close();
    S.detector = null;
    ui.selModell.disabled = true;
    status('Erkennungsmodell wird geladen …');
    ladeVersprechen = createDetector(name)
      .then(d => { S.detector = d; status('Erkennungsmodell bereit.'); return d; })
      .finally(() => { ladeVersprechen = null; ui.selModell.disabled = false; });
  }
  return ladeVersprechen;
}

// ---------- Gesichtserkennung ----------
let gesichtLaden = null;
function gesichtErkennung() {
  if (S.gesicht) return Promise.resolve(S.gesicht);
  gesichtLaden ??= createGesicht()
    .then(g => { S.gesicht = g; gesichtInfo(''); return g; })
    .catch(err => { console.error(err); gesichtInfo('Gesichtsmodell nicht geladen: ' + err.message); return null; })
    .finally(() => { gesichtLaden = null; });
  return gesichtLaden;
}
// Gesicht nur auswerten, wenn eingeschaltet und geladen (das Laden blockiert die Pose nicht)
const gesichtAn = () => ui.selErkennung.value !== 'koerper';
const koerperAn = () => ui.selErkennung.value !== 'gesicht';
const gesichtAktiv = () => gesichtAn() && S.gesicht;
function gesichtVorbereiten() {
  if (gesichtAn() && !S.gesicht) gesichtErkennung();
  S.gesicht?.reset();
  S.liveGesichtFilter.reset();
}

const HERKUNFT = { detektor: 'Detektor', verfolgt: 'verfolgt', pose: 'aus der Pose' };
function gesichtInfo(text) { if (ui.gesichtInfo.textContent !== text) ui.gesichtInfo.textContent = text; }
function gesichtStatus(e, mitKoerper = true) {
  if (!gesichtAn()) return gesichtInfo('');
  if (!S.gesicht) return gesichtInfo(gesichtLaden ? 'Gesichtsmodell lädt …' : '');
  if (!e) return gesichtInfo('');
  const n = e.boxen.length, anzahl = n > 1 ? ` · ${n} Gesichter im Bild` : '';
  const nur = mitKoerper ? '' : ', nur Gesicht';
  gesichtInfo(e.gesicht ? `Gesicht erkannt (${HERKUNFT[e.herkunft]}${nur})${anzahl}` : `kein Gesicht${anzahl}`);
}

// ---------- Einblendung im Video ----------
// q: Pose-Bildpunkte; e: Ergebnis der Gesichtserkennung (live) oder { gesicht } aus einer Aufnahme
function zeichneOverlay(q, e = null) {
  const c = ui.overlay, v = ui.video, w = v.videoWidth, h = v.videoHeight;
  const g = c.getContext('2d');
  if (!w || !h) { g.clearRect(0, 0, c.width, c.height); return; }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  g.clearRect(0, 0, w, h);
  const dicke = Math.max(2, w / 300);
  zeichneGesichtOverlay(g, e, w, h, dicke);
  if (!q) return;
  g.lineCap = 'round';
  g.lineWidth = dicke;
  g.strokeStyle = 'rgba(70, 240, 255, .9)';
  g.beginPath();
  for (const [i, k] of OVERLAY_LINIEN) { g.moveTo(q[i][0] * w, q[i][1] * h); g.lineTo(q[k][0] * w, q[k][1] * h); }
  g.stroke();
  g.fillStyle = '#fff';
  for (const [x, y] of q.slice(11)) { g.beginPath(); g.arc(x * w, y * h, dicke * 1.1, 0, Math.PI * 2); g.fill(); }
}

function zeichneGesichtOverlay(g, e, w, h, dicke) {
  if (!e) return;
  // alle Gesichter, die der Detektor findet: gestrichelte Rahmen
  g.lineWidth = Math.max(1, dicke * 0.6);
  g.strokeStyle = 'rgba(255, 255, 255, .7)';
  g.setLineDash([dicke * 3, dicke * 2]);
  for (const b of e.boxen ?? []) g.strokeRect(b.x * w, b.y * h, b.w * w, b.h * h);
  g.setLineDash([]);
  // das ausgewertete Gesicht: Umriss, Augen, Brauen, Mund – in einer Aufnahme nur der Rahmen
  g.strokeStyle = 'rgba(255, 210, 90, .95)';
  if (e.punkte) {
    const P = e.punkte;
    g.lineWidth = Math.max(1, dicke * 0.5);
    g.beginPath();
    for (const [i, k] of GESICHT_LINIEN) { g.moveTo(P[i][0] * w, P[i][1] * h); g.lineTo(P[k][0] * w, P[k][1] * h); }
    g.stroke();
  } else if (e.gesicht?.k) {
    const [x, y, bw, bh] = e.gesicht.k;
    g.lineWidth = Math.max(1, dicke * 0.6);
    g.strokeRect(x * w, y * h, bw * w, bh * h);
  }
}

function zeigeVideo(sichtbar, text) {
  ui.leer.hidden = sichtbar;
  if (text) ui.leer.textContent = text;
}

function spiegeln() {
  const an = ui.chkSpiegeln.checked;
  ui.rahmen.classList.toggle('gespiegelt', an);
  studio.setSpiegeln(an);
}

function neueVideoUrl(blobOderDatei) {
  if (S.videoUrl) URL.revokeObjectURL(S.videoUrl);
  S.videoUrl = URL.createObjectURL(blobOderDatei);
  ui.video.srcObject = null;
  ui.video.src = S.videoUrl;
}

// ---------- Aufräumen ----------
function kameraStoppen() {
  S.stream?.getTracks().forEach(t => t.stop());
  S.stream = null;
  if (ui.video.srcObject) ui.video.srcObject = null;
}

function stoppeAlles() {
  S.liveToken++;
  if (S.analyse) { S.analyse.abbrechen = true; S.analyse.verwerfen = true; }
  if (S.aufnahme) {
    const a = S.aufnahme;
    S.aufnahme = null;
    try { a.recorder?.stop(); } catch { /* schon gestoppt */ }
    aufnahmeKnopf(false);
  }
  S.mikro?.getTracks().forEach(t => t.stop());
  S.mikro = null;
  kameraStoppen();
  ui.video.pause();
  S.uhr.laeuft = false;
  S.mode = 'idle';
  zeichneOverlay(null);
  gesichtStatus(null);
}

function takeEntfernen() {
  S.take = null;
  S.posen = null;
  S.mitVideo = false;
  ui.btnPlay.disabled = ui.rngZeit.disabled = ui.btnExport.disabled = true;
  ui.btnPlay.textContent = '▶';
  ui.rngZeit.value = 0;
  ui.zeit.textContent = '0:00.0 / 0:00.0';
}

// ---------- Live: Kamera oder Videodatei ----------
function liveStarten() {
  S.mode = 'live';
  S.liveFilter.reset();
  S.letzterRig = null;
  gesichtVorbereiten();
  const token = ++S.liveToken;
  const v = ui.video;
  let letzteZeit = -1;
  const plane = () => ('requestVideoFrameCallback' in v ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick));
  function tick() {
    if (token !== S.liveToken || S.mode !== 'live') return;
    const neuesBild = S.quelle === 'kamera' || v.currentTime !== letzteZeit;
    if ((S.detector || !koerperAn()) && v.readyState >= 2 && neuesBild) {
      letzteZeit = v.currentTime;
      const jetzt = performance.now();
      const f = koerperAn() && S.detector ? S.detector.detect(v, jetzt) : null;
      liveBild(f, gesichtAktiv() ? S.gesicht.detect(v, jetzt, f?.q) : null, jetzt / 1000);
    }
    plane();
  }
  plane();
}

function liveBild(f, e, t) {
  zeichneOverlay(f?.q, e);
  gesichtStatus(e, !!f);
  // Gesicht auch ohne erkannten Körper zeigen (Nahaufnahme): dann bleibt die letzte Haltung stehen
  if (e?.gesicht) S.neutral.update(e.gesicht.b);
  const g = S.liveGesichtFilter.apply(e?.gesicht, t);
  if (f) S.letzterRig = buildRig(S.liveFilter.apply(f.p, t), rigOpts());
  studio.setPose(S.letzterRig ?? restPose(rigOpts()), mimik(g, S.gesicht?.namen));
  if (S.aufnahme) bildMerken(S.aufnahme.frames, r3((performance.now() - S.aufnahme.start) / 1000), f, e);
}

// Ein Bild der Aufnahme: Körper (p, q) und/oder Gesicht (g). Nahaufnahmen haben nur g.
function bildMerken(frames, t, f, e) {
  if (!f && !e?.gesicht) return false;
  const frame = { t };
  if (f) { frame.p = f.p; frame.q = f.q; }
  if (e?.gesicht) frame.g = e.gesicht;
  frames.push(frame);
  return true;
}
const zaehlen = frames => {
  const k = frames.filter(f => f.p).length, g = frames.filter(f => f.g).length;
  return [k && `${k} mit Körper`, g && `${g} mit Gesicht`].filter(Boolean).join(', ') || 'nichts';
};

async function kameraStarten() {
  try {
    stoppeAlles();
    takeEntfernen();
    status('Kamera wird gestartet …');
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const v = ui.video;
    v.removeAttribute('src');
    v.controls = false;
    v.loop = false;
    v.muted = true;
    v.srcObject = S.stream;
    await v.play();
    S.quelle = 'kamera';
    ui.chkSpiegeln.checked = true;
    spiegeln();
    zeigeVideo(true);
    await detektor();
    liveStarten();
    ui.btnAufnahme.disabled = false;
    ui.btnAnalyse.disabled = true;
    status('Live: Bewege dich vor der Kamera. Mit „Aufnahme“ hältst du eine Bewegung fest.');
  } catch (err) {
    console.error(err);
    status('Kamera nicht verfügbar: ' + err.message);
  }
}

async function videoOeffnen(datei) {
  try {
    stoppeAlles();
    takeEntfernen();
    const v = ui.video;
    v.controls = true;
    v.loop = false;
    v.muted = false;
    neueVideoUrl(datei);
    await new Promise((ok, fehler) => {
      v.onloadedmetadata = ok;
      v.onerror = () => fehler(new Error('Das Video kann der Browser nicht lesen.'));
    });
    S.quelle = 'datei';
    S.dateiName = datei.name;
    ui.chkSpiegeln.checked = false;
    spiegeln();
    zeigeVideo(true);
    ui.btnAufnahme.disabled = true;
    ui.btnAnalyse.disabled = false;
    await detektor();
    liveStarten();
    status(`${datei.name}: Abspielen zeigt eine Vorschau, „Analysieren“ wertet jedes Bild genau aus.`);
  } catch (err) {
    console.error(err);
    status('Video lässt sich nicht öffnen: ' + err.message);
  }
}

// ---------- Aufnahme mit der Kamera ----------
function aufnahmeKnopf(an) {
  ui.btnAufnahme.textContent = an ? '■ Stopp' : '● Aufnahme';
  ui.btnAufnahme.classList.toggle('aufnahme', an);
}

function videoFormat() {
  for (const typ of ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']) {
    if (window.MediaRecorder?.isTypeSupported?.(typ)) return { mimeType: typ };
  }
  return {};
}

async function aufnahmeUmschalten() {
  if (S.aufnahme) return aufnahmeBeenden();
  if (S.quelle !== 'kamera' || !S.stream) return;
  // Ton mit aufnehmen, damit die Bewegung später zur Musik passt
  let spuren = S.stream;
  try {
    S.mikro = await navigator.mediaDevices.getUserMedia({ audio: true });
    spuren = new MediaStream([...S.stream.getVideoTracks(), ...S.mikro.getAudioTracks()]);
  } catch {
    S.mikro = null;
  }
  let recorder = null;
  const teile = [];
  try {
    recorder = new MediaRecorder(spuren, videoFormat());
    recorder.ondataavailable = e => { if (e.data.size) teile.push(e.data); };
    recorder.start(500);
  } catch (err) {
    console.warn('Video wird nicht mit aufgenommen', err);
    recorder = null;
  }
  S.aufnahme = { start: performance.now(), frames: [], recorder, teile };
  aufnahmeKnopf(true);
  status(S.mikro ? 'Aufnahme läuft (mit Ton) …' : 'Aufnahme läuft (ohne Ton) …');
}

async function aufnahmeBeenden() {
  const a = S.aufnahme;
  S.aufnahme = null;
  aufnahmeKnopf(false);
  let blob = null;
  if (a.recorder && a.recorder.state !== 'inactive') {
    blob = await new Promise(ok => {
      a.recorder.onstop = () => ok(new Blob(a.teile, { type: a.recorder.mimeType }));
      a.recorder.stop();
    });
  }
  S.mikro?.getTracks().forEach(t => t.stop());
  S.mikro = null;
  if (!a.frames.length) { status('In der Aufnahme wurde weder Körper noch Gesicht erkannt.'); return; }

  S.liveToken++;
  kameraStoppen();
  ui.btnAufnahme.disabled = true;
  let mitVideo = false;
  if (blob?.size) {
    const v = ui.video;
    neueVideoUrl(blob);
    await einmal(v, 'loadedmetadata');
    // Aufnahmen aus MediaRecorder kennen ihre Länge oft nicht; ein Sprung ans Ende behebt das
    if (!isFinite(v.duration)) {
      v.currentTime = 1e101;
      await Promise.race([einmal(v, 'durationchange'), new Promise(ok => setTimeout(ok, 1500))]);
      v.currentTime = 0;
    }
    mitVideo = true;
  } else {
    zeigeVideo(false, 'Das Video konnte nicht mit aufgenommen werden – die Bewegung schon.');
  }
  const dauer = a.frames.at(-1).t;
  const name = 'kamera-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  takeSetzen(neuerTake({ quelle: 'kamera', name, fps: Math.round(a.frames.length / Math.max(dauer, 0.001)), dauer, frames: a.frames, namen: S.gesicht?.namen }), mitVideo);
  status(`Aufnahme fertig: ${zeitText(dauer)}, ${a.frames.length} Bilder (${zaehlen(S.take.frames)}). Abspielen mit ▶ oder Leertaste.`);
}

// ---------- Genaue Analyse einer Videodatei ----------
function springe(v, t) {
  return new Promise(ok => {
    const fertig = () => { clearTimeout(timer); v.removeEventListener('seeked', fertig); ok(); };
    const timer = setTimeout(fertig, 2000);
    v.addEventListener('seeked', fertig);
    v.currentTime = t;
  });
}

function bedienungSperren(gesperrt) {
  ui.btnKamera.disabled = gesperrt;
  ui.dateiVideo.disabled = gesperrt;
  ui.lblVideo.classList.toggle('gesperrt', gesperrt);
  ui.dateiJson.disabled = gesperrt;
  ui.selModell.disabled = gesperrt;
  ui.selFps.disabled = gesperrt;
  ui.selErkennung.disabled = gesperrt;
}

async function analysieren() {
  if (S.analyse) { S.analyse.abbrechen = true; return; }
  const v = ui.video;
  if (S.quelle !== 'datei' || !isFinite(v.duration)) { status('Analysieren geht nur mit einer geöffneten Videodatei.'); return; }
  const det = koerperAn() ? await detektor() : null;
  const gs = gesichtAn() ? await gesichtErkennung() : null;
  if (!det && !gs) { status('Gesichtsmodell nicht verfügbar.'); return; }
  gs?.reset();
  S.letzterRig = null;
  S.liveToken++;
  takeEntfernen();
  S.mode = 'analyse';
  v.pause();
  v.controls = false;

  const fps = +ui.selFps.value, dauer = v.duration, n = Math.max(1, Math.round(dauer * fps));
  const ctl = S.analyse = { abbrechen: false, verwerfen: false };
  ui.btnAnalyse.textContent = 'Abbrechen';
  bedienungSperren(true);
  const filter = new PoseFilter(+ui.rngGlaettung.value);
  const gFilter = new GesichtFilter(+ui.rngGlaettung.value);
  const frames = [];
  const start = performance.now();

  for (let i = 0; i <= n; i++) {
    const t = Math.min(dauer - 0.001, i / fps);
    await springe(v, t);
    if (ctl.abbrechen) break;
    const f = det ? det.detect(v, t * 1000) : null;
    const e = gs ? gs.detect(v, t * 1000, f?.q) : null;
    zeichneOverlay(f?.q, e);
    gesichtStatus(e, !!f);
    if (bildMerken(frames, r3(t), f, e)) {
      if (f) S.letzterRig = buildRig(filter.apply(f.p, t), rigOpts());
      if (e?.gesicht) S.neutral.update(e.gesicht.b);
      studio.setPose(S.letzterRig ?? restPose(rigOpts()), mimik(gFilter.apply(e?.gesicht, t), gs?.namen));
    }
    if (i % 4 === 0) status(`Analyse: ${Math.round((i / n) * 100)} % · erkannt: ${zaehlen(frames)}`);
  }

  S.analyse = null;
  ui.btnAnalyse.textContent = 'Analysieren';
  bedienungSperren(false);
  if (ctl.verwerfen) return;
  if (!frames.length) {
    status('In diesem Video wurde weder Körper noch Gesicht erkannt.');
    v.controls = true;
    liveStarten();
    return;
  }
  takeSetzen(neuerTake({ quelle: 'video', name: S.dateiName, fps, dauer, frames, namen: gs?.namen }), true);
  const sek = ((performance.now() - start) / 1000).toFixed(0);
  status(`${ctl.abbrechen ? 'Abgebrochen' : 'Fertig'}: ${n + 1} Bilder ausgewertet, erkannt: ${zaehlen(S.take.frames)} (${sek} s). Abspielen mit ▶ oder Leertaste.`);
}

// ---------- Fertige Aufnahme (Take) ----------
function neuerTake({ quelle, name, fps, dauer, frames, namen }) {
  const mitGesicht = namen && frames.some(f => f.g);
  if (!mitGesicht) {
    for (const f of frames) delete f.g;
    frames = frames.filter(f => f.p);
  }
  return {
    format: FORMAT,
    version: 2,
    erstellt: new Date().toISOString(),
    name,
    quelle,
    fps,
    duration: r3(dauer),
    punkte: 'mediapipe-pose-33',
    erklaerung: 'frames[].t = Sekunden; p und q fehlen, wenn kein Körper erkannt wurde (Nahaufnahme); p = 33 Weltpunkte [x, y, z, Sichtbarkeit] in Metern um die Hüftmitte (x rechts, y unten, z negativ = zur Kamera); q = 33 Bildpunkte [x, y] von 0 bis 1',
    ...(mitGesicht && {
      gesicht: {
        modell: 'mediapipe-face-landmarker',
        namen,
        neutral: S.neutral.fest ? S.neutral.werte.map(v => Math.round(v * 100) / 100) : neutralAusFrames(frames),
        erklaerung: 'neutral = Ruhegesicht der Person (Blendshapes), wird beim Übertragen abgezogen; frames[].g (fehlt, wenn kein Gesicht erkannt) = { b: Blendshapes 0..1 in der Reihenfolge von namen (ARKit-Namen, Left = linke Seite der Person), r: Kopfdrehung als Quaternion [x, y, z, w] (x = linke Seite der Person, y oben, z zur Kamera; [0, 0, 0, 1] = Blick in die Kamera), k: Gesichtsrahmen im Bild [x, y, Breite, Höhe] von 0 bis 1 }',
      },
    }),
    frames,
  };
}

function posenBerechnen() {
  if (!S.take) return;
  const filter = new PoseFilter(+ui.rngGlaettung.value);
  const gFilter = new GesichtFilter(+ui.rngGlaettung.value);
  const namen = S.take.gesicht?.namen;
  let p = null;   // ohne Körper bleibt die letzte Haltung stehen (am Anfang: Grundhaltung)
  S.posen = S.take.frames.map(f => {
    if (f.p) p = filter.apply(f.p, f.t);
    return { t: f.t, p, g: namen ? gFilter.apply(f.g, f.t) : null };
  });
}

// Gesicht zwischen zwei Bildern überblenden (Blendshapes linear, Drehung über die kürzere Richtung)
function gesichtMischen(A, B, k) {
  if (!A || !B) return k < 0.5 ? (A ?? B) : (B ?? A);
  const vz = A.r.reduce((s, v, i) => s + v * B.r[i], 0) < 0 ? -1 : 1;
  const r = A.r.map((v, i) => v + (vz * B.r[i] - v) * k), l = Math.hypot(...r) || 1;
  return { b: A.b.map((v, i) => v + (B.b[i] - v) * k), r: r.map(v => v / l) };
}

function takeSetzen(take, mitVideo) {
  // ältere Aufnahmen ohne Ruhegesicht: aus der Aufnahme selbst schätzen
  if (take.gesicht && !take.gesicht.neutral) take.gesicht.neutral = neutralAusFrames(take.frames);
  S.take = take;
  S.mitVideo = mitVideo;
  S.mode = 'take';
  posenBerechnen();
  const v = ui.video;
  v.controls = false;
  v.loop = true;
  v.muted = false;
  ui.rngZeit.max = take.duration;
  ui.rngZeit.disabled = ui.btnPlay.disabled = ui.btnExport.disabled = false;
  zeitSetzen(0);
}

// Pose zu einer beliebigen Zeit: zwischen den beiden nächsten Bildern überblenden
function poseBei(t) {
  const P = S.posen;
  if (!P?.length) return null;
  let lo = 0, hi = P.length - 1;
  if (t <= P[lo].t) return { p: P[lo].p, g: P[lo].g, i: lo };
  if (t >= P[hi].t) return { p: P[hi].p, g: P[hi].g, i: hi };
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].t <= t) lo = m; else hi = m; }
  const A = P[lo], B = P[hi], spanne = B.t - A.t, k = (t - A.t) / (spanne || 1);
  const i = k < 0.5 ? lo : hi;
  if (spanne > 0.25) return { p: P[i].p, g: P[i].g, i };   // Lücke in der Erkennung: nicht darüber hinweg überblenden
  return {
    p: A.p && B.p ? A.p.map((pa, j) => { const pb = B.p[j]; return [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k, pa[3]]; }) : P[i].p,
    g: gesichtMischen(A.g, B.g, k),
    i,
  };
}

function takeZeit() {
  if (S.mitVideo) return ui.video.currentTime;
  const u = S.uhr, d = S.take.duration;
  if (!u.laeuft) return u.versatz;
  const t = u.versatz + (performance.now() - u.start) / 1000;
  return d > 0 ? t % d : 0;
}

function zeitSetzen(t) {
  if (S.mitVideo) ui.video.currentTime = t;
  else { S.uhr.versatz = t; S.uhr.start = performance.now(); }
}

function laeuft() { return S.mitVideo ? !ui.video.paused : S.uhr.laeuft; }

function abspielenUmschalten() {
  if (S.mode !== 'take') return;
  if (S.mitVideo) {
    if (ui.video.paused) ui.video.play(); else ui.video.pause();
  } else if (S.uhr.laeuft) {
    S.uhr.versatz = takeZeit();
    S.uhr.laeuft = false;
  } else {
    S.uhr.start = performance.now();
    S.uhr.laeuft = true;
  }
}

let ziehen = false;
studio.beiBild = () => {
  if (S.mode !== 'take' || !S.posen) return;
  const t = takeZeit();
  const r = poseBei(t);
  if (r) {
    studio.setPose(r.p ? buildRig(r.p, rigOpts()) : restPose(rigOpts()), mimik(r.g, S.take.gesicht?.namen, S.take.gesicht?.neutral));
    S.takeGesicht = r.g;
    if (S.mitVideo) { const f = S.take.frames[r.i]; zeichneOverlay(f.q, f.g ? { gesicht: f.g } : null); }
  }
  if (!ziehen) ui.rngZeit.value = t;
  const text = `${zeitText(t)} / ${zeitText(S.take.duration)}`;
  if (ui.zeit.textContent !== text) ui.zeit.textContent = text;
  const knopf = laeuft() ? '❚❚' : '▶';
  if (ui.btnPlay.textContent !== knopf) ui.btnPlay.textContent = knopf;
};

// ---------- Speichern und Laden ----------
function exportieren() {
  if (!S.take) return;
  const blob = new Blob([JSON.stringify(S.take)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = (S.take.name || 'aufnahme').replace(/\.[^.]+$/, '') + '.take.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function importieren(datei) {
  try {
    const take = JSON.parse(await datei.text());
    if (take.format !== FORMAT || !Array.isArray(take.frames) || !take.frames.some(f => f.p || f.g)) {
      throw new Error('keine Bewegungsdatei aus diesem Studio');
    }
    stoppeAlles();
    takeEntfernen();
    ui.video.removeAttribute('src');
    ui.video.load();
    S.quelle = 'import';
    ui.btnAufnahme.disabled = ui.btnAnalyse.disabled = true;
    zeigeVideo(false, 'Zu dieser Bewegungsdatei gibt es kein Video.');
    takeSetzen(take, false);
    status(`${datei.name}: ${zeitText(take.duration)}, ${take.frames.length} Bilder (${zaehlen(take.frames)}) geladen.`);
  } catch (err) {
    status('Import fehlgeschlagen: ' + err.message);
  }
}

// ---------- Bedienung ----------
ui.btnKamera.onclick = kameraStarten;
ui.dateiVideo.onchange = () => { const f = ui.dateiVideo.files[0]; ui.dateiVideo.value = ''; if (f) videoOeffnen(f); };
ui.btnAufnahme.onclick = aufnahmeUmschalten;
ui.btnAnalyse.onclick = analysieren;
ui.chkSpiegeln.onchange = spiegeln;
// Neutral merken: live das aktuelle Gesicht, in einer Aufnahme das Gesicht an der aktuellen Stelle
ui.btnNeutral.onclick = () => {
  if (S.mode === 'take' && S.take?.gesicht) {
    if (!S.takeGesicht) return status('An dieser Stelle der Aufnahme ist kein Gesicht.');
    S.take.gesicht.neutral = S.takeGesicht.b.map(v => Math.round(v * 100) / 100);
    studio.beiBild?.();
    return status('Ruhegesicht für diese Aufnahme gemerkt (wird mit exportiert).');
  }
  const g = S.liveGesichtFilter.letztes;
  if (!g) return status('Kein Gesicht erkannt – erst Kamera oder Video starten und neutral schauen.');
  S.neutral.merken(g.b);
  status('Ruhegesicht gemerkt. Jetzt zählt nur noch, was davon abweicht.');
};
ui.btnNeutral.ondblclick = () => { S.neutral.reset(); status('Ruhegesicht wird wieder automatisch geschätzt.'); };

ui.selErkennung.onchange = () => {
  gesichtVorbereiten();
  S.letzterRig = null;
  if (!gesichtAn()) studio.setMimik(null);
  if (!koerperAn()) { studio.setPose(restPose(rigOpts()), null); studio.setAnsicht('kopf'); }
  gesichtStatus(null);
};
ui.selModell.onchange = () => { if (S.mode === 'live') detektor().catch(err => status('Modell nicht geladen: ' + err.message)); };

ui.chkDrehen.onchange = () => studio.setDrehen(ui.chkDrehen.checked);
ui.selStil.onchange = () => studio.setStil(ui.selStil.value);
ui.chkBoden.onchange = () => { if (S.mode === 'idle') studio.setPose(restPose(rigOpts())); };
// im Stand (Pause, Analyse fertig) sofort neu zeichnen; beim Abspielen und live passiert das ohnehin
ui.rngMimik.oninput = () => { if (S.mode === 'take') studio.beiBild?.(); };
ui.rngGlaettung.oninput = () => {
  S.liveFilter.setStaerke(+ui.rngGlaettung.value);
  S.liveGesichtFilter.setStaerke(+ui.rngGlaettung.value);
  posenBerechnen();
};
document.querySelectorAll('[data-ansicht]').forEach(b => { b.onclick = () => studio.setAnsicht(b.dataset.ansicht); });

ui.btnPlay.onclick = abspielenUmschalten;
ui.rngZeit.addEventListener('pointerdown', () => { ziehen = true; });
addEventListener('pointerup', () => { ziehen = false; });
ui.rngZeit.oninput = () => zeitSetzen(+ui.rngZeit.value);
ui.btnExport.onclick = exportieren;
ui.dateiJson.onchange = () => { const f = ui.dateiJson.files[0]; ui.dateiJson.value = ''; if (f) importieren(f); };

addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.target.closest?.('button, select, input:not([type="range"])')) return;
  e.preventDefault();
  abspielenUmschalten();
});

// Zum Ausprobieren in der Browser-Konsole
window.studio = { S, studio, takeSetzen, neuerTake, detektor, gesichtErkennung, mimik };
