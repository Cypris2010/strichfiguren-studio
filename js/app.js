// Strichfiguren-Studio: Video oder Kamera → Pose-Erkennung → 3D-Strichmännchen → Bewegungsdatei.
//
// Ablauf
//   live     Kamera oder Videodatei, jedes Bild wird sofort erkannt und angezeigt
//   analyse  Videodatei wird Bild für Bild (30 oder 60 pro Sekunde) genau ausgewertet
//   take     fertige Aufnahme: abspielen, ansehen, als JSON speichern
import { Studio3D } from './scene.js';
import { createDetector } from './pose.js';
import { PoseFilter } from './filter.js';
import { buildRig, restPose, OVERLAY_LINIEN } from './rig.js';

const FORMAT = 'strichfiguren-take';
const $ = id => document.getElementById(id);
const ui = {
  status: $('status'), video: $('video'), overlay: $('overlay'), rahmen: $('videoRahmen'), leer: $('videoLeer'),
  btnKamera: $('btnKamera'), lblVideo: $('lblVideo'), dateiVideo: $('dateiVideo'),
  btnAufnahme: $('btnAufnahme'), btnAnalyse: $('btnAnalyse'),
  selModell: $('selModell'), selFps: $('selFps'), chkSpiegeln: $('chkSpiegeln'),
  chkDrehen: $('chkDrehen'), selStil: $('selStil'), rngGlaettung: $('rngGlaettung'), chkBoden: $('chkBoden'),
  btnPlay: $('btnPlay'), rngZeit: $('rngZeit'), zeit: $('zeit'), btnExport: $('btnExport'), dateiJson: $('dateiJson'),
};

const studio = new Studio3D($('dreiD'));
const S = {
  mode: 'idle',        // idle | live | analyse | take
  quelle: null,        // kamera | datei | import
  stream: null, mikro: null, videoUrl: null, dateiName: '',
  detector: null,
  liveFilter: new PoseFilter(+ui.rngGlaettung.value),
  liveToken: 0,
  aufnahme: null, analyse: null,
  take: null, posen: null, mitVideo: false,
  uhr: { laeuft: false, start: 0, versatz: 0 },
};

const rigOpts = () => ({ boden: ui.chkBoden.checked });
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

// ---------- Einblendung im Video ----------
function zeichneOverlay(q) {
  const c = ui.overlay, v = ui.video, w = v.videoWidth, h = v.videoHeight;
  const g = c.getContext('2d');
  if (!w || !h) { g.clearRect(0, 0, c.width, c.height); return; }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  g.clearRect(0, 0, w, h);
  if (!q) return;
  const dicke = Math.max(2, w / 300);
  g.lineCap = 'round';
  g.lineWidth = dicke;
  g.strokeStyle = 'rgba(70, 240, 255, .9)';
  g.beginPath();
  for (const [i, k] of OVERLAY_LINIEN) { g.moveTo(q[i][0] * w, q[i][1] * h); g.lineTo(q[k][0] * w, q[k][1] * h); }
  g.stroke();
  g.fillStyle = '#fff';
  for (const [x, y] of q.slice(11)) { g.beginPath(); g.arc(x * w, y * h, dicke * 1.1, 0, Math.PI * 2); g.fill(); }
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
  const token = ++S.liveToken;
  const v = ui.video;
  let letzteZeit = -1;
  const plane = () => ('requestVideoFrameCallback' in v ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick));
  function tick() {
    if (token !== S.liveToken || S.mode !== 'live') return;
    const neuesBild = S.quelle === 'kamera' || v.currentTime !== letzteZeit;
    if (S.detector && v.readyState >= 2 && neuesBild) {
      letzteZeit = v.currentTime;
      const jetzt = performance.now();
      liveBild(S.detector.detect(v, jetzt), jetzt / 1000);
    }
    plane();
  }
  plane();
}

function liveBild(f, t) {
  zeichneOverlay(f?.q);
  if (!f) return;
  studio.setPose(buildRig(S.liveFilter.apply(f.p, t), rigOpts()));
  if (S.aufnahme) S.aufnahme.frames.push({ t: r3((performance.now() - S.aufnahme.start) / 1000), p: f.p, q: f.q });
}

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
  if (!a.frames.length) { status('In der Aufnahme wurde keine Person erkannt.'); return; }

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
  takeSetzen(neuerTake({ quelle: 'kamera', name, fps: Math.round(a.frames.length / Math.max(dauer, 0.001)), dauer, frames: a.frames }), mitVideo);
  status(`Aufnahme fertig: ${zeitText(dauer)}, ${a.frames.length} Posen. Abspielen mit ▶ oder Leertaste.`);
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
}

async function analysieren() {
  if (S.analyse) { S.analyse.abbrechen = true; return; }
  const v = ui.video;
  if (S.quelle !== 'datei' || !isFinite(v.duration)) { status('Analysieren geht nur mit einer geöffneten Videodatei.'); return; }
  const det = await detektor();
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
  const frames = [];
  const start = performance.now();

  for (let i = 0; i <= n; i++) {
    const t = Math.min(dauer - 0.001, i / fps);
    await springe(v, t);
    if (ctl.abbrechen) break;
    const f = det.detect(v, t * 1000);
    zeichneOverlay(f?.q);
    if (f) {
      frames.push({ t: r3(t), p: f.p, q: f.q });
      studio.setPose(buildRig(filter.apply(f.p, t), rigOpts()));
    }
    if (i % 4 === 0) status(`Analyse: ${Math.round((i / n) * 100)} % · ${frames.length} Posen erkannt`);
  }

  S.analyse = null;
  ui.btnAnalyse.textContent = 'Analysieren';
  bedienungSperren(false);
  if (ctl.verwerfen) return;
  if (!frames.length) {
    status('In diesem Video wurde keine Person erkannt.');
    v.controls = true;
    liveStarten();
    return;
  }
  takeSetzen(neuerTake({ quelle: 'video', name: S.dateiName, fps, dauer, frames }), true);
  const sek = ((performance.now() - start) / 1000).toFixed(0);
  status(`${ctl.abbrechen ? 'Abgebrochen' : 'Fertig'}: in ${frames.length} von ${n + 1} Bildern eine Person erkannt (${sek} s). Abspielen mit ▶ oder Leertaste.`);
}

// ---------- Fertige Aufnahme (Take) ----------
function neuerTake({ quelle, name, fps, dauer, frames }) {
  return {
    format: FORMAT,
    version: 1,
    erstellt: new Date().toISOString(),
    name,
    quelle,
    fps,
    duration: r3(dauer),
    punkte: 'mediapipe-pose-33',
    erklaerung: 'frames[].t = Sekunden; p = 33 Weltpunkte [x, y, z, Sichtbarkeit] in Metern um die Hüftmitte (x rechts, y unten, z negativ = zur Kamera); q = 33 Bildpunkte [x, y] von 0 bis 1',
    frames,
  };
}

function posenBerechnen() {
  if (!S.take) return;
  const filter = new PoseFilter(+ui.rngGlaettung.value);
  S.posen = S.take.frames.map(f => ({ t: f.t, p: filter.apply(f.p, f.t) }));
}

function takeSetzen(take, mitVideo) {
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
  if (t <= P[lo].t) return { p: P[lo].p, i: lo };
  if (t >= P[hi].t) return { p: P[hi].p, i: hi };
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].t <= t) lo = m; else hi = m; }
  const A = P[lo], B = P[hi], spanne = B.t - A.t, k = (t - A.t) / (spanne || 1);
  const i = k < 0.5 ? lo : hi;
  if (spanne > 0.25) return { p: P[i].p, i };   // Lücke in der Erkennung: nicht darüber hinweg überblenden
  return { p: A.p.map((pa, j) => { const pb = B.p[j]; return [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k, pa[3]]; }), i };
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
    studio.setPose(buildRig(r.p, rigOpts()));
    if (S.mitVideo) zeichneOverlay(S.take.frames[r.i].q);
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
    if (take.format !== FORMAT || !Array.isArray(take.frames) || !take.frames.length) {
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
    status(`${datei.name}: ${zeitText(take.duration)}, ${take.frames.length} Posen geladen.`);
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
ui.selModell.onchange = () => { if (S.mode === 'live') detektor().catch(err => status('Modell nicht geladen: ' + err.message)); };

ui.chkDrehen.onchange = () => studio.setDrehen(ui.chkDrehen.checked);
ui.selStil.onchange = () => studio.setStil(ui.selStil.value);
ui.chkBoden.onchange = () => { if (S.mode === 'idle') studio.setPose(restPose(rigOpts())); };
ui.rngGlaettung.oninput = () => { S.liveFilter.setStaerke(+ui.rngGlaettung.value); posenBerechnen(); };
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
window.studio = { S, studio, takeSetzen, neuerTake, detektor };
