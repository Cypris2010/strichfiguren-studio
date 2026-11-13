// Strichfiguren-Studio: Video oder Kamera → Pose-Erkennung → 3D-Strichmännchen → Bewegungsdatei.
//
// Ablauf
//   live     Kamera oder Videodatei, jedes Bild wird sofort erkannt und angezeigt
//   analyse  Videodatei wird Bild für Bild (30 oder 60 pro Sekunde) genau ausgewertet
//   take     fertige Aufnahme: abspielen, ansehen, als JSON speichern
//
// Jede Kamera hat eine Aufgabe (Körper, Gesicht oder beides) und arbeitet einer Figur zu. Die zweite
// Kamera kann so dieselbe Person aus einem anderen Winkel filmen (die Körper werden zu einer genaueren
// Figur verschmolzen), nur das Gesicht in Nahaufnahme liefern oder eine zweite Person mit eigener Figur.
// Diese Einstellungen merkt sich das Studio je Gerät (z. B. iPhone und Mac-Kamera).
//
// Band-Funktionen (im Einstellungs-Reiter „Band“, standardmäßig aus): Instrumente, farbiges Tape als
// Marker (A = Gitarrenkopf / Stickspitzen, B = Becken), Schlagzeug einmessen, Luftband (Töne, WAV, MIDI).
import { Studio3D } from './scene.js';
import { createDetector } from './pose.js';
import { PoseFilter, ExtraFilter, GesichtFilter } from './filter.js';
import { createGesicht, mimik as mimikRoh, GESICHT_LINIEN, NeutralSchaetzer, neutralAusFrames } from './face.js';
import { buildRig, restPose, OVERLAY_LINIEN } from './rig.js';
import { ankerBerechnen, KIT_TEILE } from './instrumente.js';
import { MarkerSucher, markerAuswerten, trommelKandidaten, beckenRuhe } from './marker.js';
import { Luftband, luftFilter, luftExtraFilter } from './luftband.js';
import { Klang, tonspurRendern } from './klang.js';
import { midiErzeugen } from './midi.js';
import { Verschmelzer } from './ansichten.js';
import { BlenderStream } from './stream.js';

const FORMAT = 'strichfiguren-take';
const $ = id => document.getElementById(id);
const ui = {
  status: $('status'), messung: $('messung'), videos: $('videos'), buehne: document.querySelector('.buehne'),
  btnEinstellungen: $('btnEinstellungen'), btnEinstellungenZu: $('btnEinstellungenZu'), einstellungen: $('einstellungen'),
  chkBand: $('chkBand'), bandBereich: $('bandBereich'), bandAus: $('bandAus'), selFigur2: $('selFigur2'), rngMimik: $('rngMimik'),
  kameraBlock2: $('kameraBlock2'),
  btnKamera: $('btnKamera'), btnKamera2: $('btnKamera2'),
  lblVideo: $('lblVideo'), dateiVideo: $('dateiVideo'),
  btnAufnahme: $('btnAufnahme'), btnAnalyse: $('btnAnalyse'),
  selModell: $('selModell'), selFps: $('selFps'),
  chkMarker: $('chkMarker'), btnFarbeA: $('btnFarbeA'), btnFarbeB: $('btnFarbeB'), feldA: $('feldA'), feldB: $('feldB'),
  rngToleranz: $('rngToleranz'), btnEinmessen: $('btnEinmessen'), btnKitZurueck: $('btnKitZurueck'),
  rolleText: $('rolleText'), zweitesInstrument: $('zweitesInstrument'),
  chkDrehen: $('chkDrehen'), selStil: $('selStil'), selForm: $('selForm'), selHaltung: $('selHaltung'), rngGlaettung: $('rngGlaettung'), chkBoden: $('chkBoden'),
  btnPlay: $('btnPlay'), rngZeit: $('rngZeit'), zeit: $('zeit'), btnExport: $('btnExport'), dateiJson: $('dateiJson'),
  chkLuftband: $('chkLuftband'), selAkkorde: $('selAkkorde'), selKlang: $('selKlang'), rngEmpfindlich: $('rngEmpfindlich'),
  btnTonspur: $('btnTonspur'), btnMidi: $('btnMidi'),
  chkBlender: $('chkBlender'), txtBlender: $('txtBlender'), blenderInfo: $('blenderInfo'),
};

const studio = new Studio3D($('dreiD'));
const sucher = new MarkerSucher();
const klang = new Klang();
const staerke = () => +ui.rngGlaettung.value;

// Je Kamera eine „Person“: Video, Erkennung, Figur, Instrument, Luftband und die Daten einer Aufnahme.
// Im Modus „gleiche Figur“ liefert die zweite Kamera nur Posen zu; Figur und Instrument sind die der ersten.
function personAnlegen(nr, el) {
  return {
    nr, ...el,
    figur: studio.figuren[nr],
    aktiv: nr === 0,       // zweite: Kamera läuft oder eine Aufnahme mit zwei Videos/Personen ist geladen
    stream: null, videoUrl: null, mitVideo: false,
    detector: null, laden: null, token: 0,
    liveFilter: new PoseFilter(staerke()), liveExtras: new ExtraFilter(staerke()),
    luftFilter: luftFilter(), luftExtras: luftExtraFilter(),   // Luftband: eigene, ganz leichte Glättung
    luftband: new Luftband(),
    letzteErkennung: null,
    // Gesicht: Erkennung je Kamera, Ruhegesicht je Kamera (= je Person vor dieser Kamera)
    gesicht: null, gesichtLaden: null, neutral: new NeutralSchaetzer(),
    // nur bei Figuren-Besitzern: bestes Gesicht der letzten Zeit (aus welcher Kamera auch immer) und seine Glättung
    kandidat: null, gesichtVon: null, liveGesichtFilter: new GesichtFilter(staerke()), letzterRig: null,
    gPosen: null,
    letztesBild: -Infinity, liveSeit: 0,   // Live: wann kam das letzte neue Bild, seit wann läuft die Kamera (ms)
    kitBild: {},         // eingemessene Stellen im Videobild { teil: [u, v] }
    posen: null, extras: null, rohExtras: null,
    toene: null,           // Luftband eines Takes: { ereignisse: [{ t, art, … }], zonen: [je Bild] }
    tonZeit: null,         // bis hierhin wurde beim Abspielen schon gespielt
    mess: {},
  };
}
const P = [
  personAnlegen(0, {
    video: $('video'), overlay: $('overlay'), rahmen: $('videoRahmen'), leer: $('videoLeer'), etikett: $('etikett1'),
    hud: $('hud'), selKamera: $('selKamera'), selRolle: $('selRolle'), selHand: $('selHand'),
    selAufgabe: $('selAufgabe1'), chkSpiegeln: $('chkSpiegeln1'), btnNeutral: $('btnNeutral1'), neutralInfo: $('neutralInfo1'),
  }),
  personAnlegen(1, {
    video: $('video2'), overlay: $('overlay2'), rahmen: $('videoRahmen2'), leer: $('videoLeer2'), etikett: $('etikett2'),
    hud: $('hud2'), selKamera: $('selKamera2'), selRolle: $('selRolle2'), selHand: $('selHand2'),
    selAufgabe: $('selAufgabe2'), chkSpiegeln: $('chkSpiegeln2'), btnNeutral: $('btnNeutral2'), neutralInfo: $('neutralInfo2'),
  }),
];
const [P1, P2] = P;

const S = {
  mode: 'idle',        // idle | live | analyse | take
  quelle: null,        // kamera | datei | import
  zweite: 'winkel',    // was die zweite Kamera ist: 'winkel' (gleiche Figur) | 'person' (eigene Figur)
  verschmelzer: new Verschmelzer(),
  kameras: [],
  mikro: null, dateiName: '',
  aufnahme: null, analyse: null,
  take: null,
  uhr: { laeuft: false, start: 0, versatz: 0 },
  // Tape-Farben: a = Gitarrenkopf / Stickspitzen, b = Becken (Standard: neongrün und pink)
  marker: { a: { hsv: [105, 0.75, 0.8], rgb: [57, 255, 20] }, b: { hsv: [320, 0.7, 0.85], rgb: [255, 60, 200] } },
  klickModus: null,    // 'a' | 'b' | 'einmessen'
  einmessen: null,
};

const rigOpts = () => ({ boden: ui.chkBoden.checked, sitzen: ui.selHaltung.value === 'sitzen' });
const status = text => { ui.status.textContent = text; ui.status.title = text; };
const r3 = v => Math.round(v * 1000) / 1000;
const r4 = v => Math.round(v * 1e4) / 1e4;
const zeitText = s => { const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
const einmal = (el, ereignis) => new Promise(ok => el.addEventListener(ereignis, ok, { once: true }));
// Band-Funktionen aus: keine Instrumente, keine Marker, kein Luftband
const bandAn = () => ui.chkBand.checked;
const rolle = p => (bandAn() ? p.selRolle.value : '');
// Was eine Kamera auswertet
const koerperAn = p => p.selAufgabe.value !== 'gesicht';
const gesichtAn = p => p.selAufgabe.value !== 'koerper';
const AUFGABEN = { beides: 'Körper + Gesicht', koerper: 'Körper', gesicht: 'Gesicht' };
// Wofür die zweite Kamera da ist: Figur 1 (zweiter Winkel oder Gesicht) oder eine eigene Figur
const zweiteModus = () => (ui.selFigur2.value === '1' ? 'person' : 'winkel');
// Hat diese Kamera eine eigene Figur? Die erste immer, die zweite nur im Modus „eigene Figur“.
const hatFigur = p => p.aktiv && (p.nr === 0 || S.zweite === 'person');
// Zwei Körper-Ansichten derselben Person verschmelzen
const zweiWinkel = () => P2.aktiv && S.zweite === 'winkel' && koerperAn(P1) && koerperAn(P2);
// Zu welcher Figur (Person mit Figur) die Bilder einer Kamera gehören
const besitzer = p => (hatFigur(p) ? p : P1);
// Liefert irgendeine Kamera den Körper für diese Figur? Sonst steht sie und nur das Gesicht bewegt sich.
const hatKoerperQuelle = o => P.some(p => p.aktiv && besitzer(p) === o && koerperAn(p));
// Namen der Blendshapes (sind bei allen Gesichtsmodellen gleich)
const gesichtsNamen = () => P.find(p => p.gesicht?.namen)?.gesicht.namen ?? null;
const mimik = (g, namen, neutral) => mimikRoh(g, namen, +ui.rngMimik.value, neutral);
// Daten einer Person in der geladenen Aufnahme: { instrument, seitenverhaeltnis, frames }
const takeDaten = p => (p.nr === 0 ? S.take : S.take?.zweite) ?? null;
const seitenverhaeltnis = p => (p.video.videoWidth && p.video.videoHeight
  ? p.video.videoWidth / p.video.videoHeight
  : takeDaten(p)?.seitenverhaeltnis ?? 16 / 9);
const kameraId = p => p.stream?.getVideoTracks()[0]?.getSettings().deviceId || '';
const kameraName = p => p.stream?.getVideoTracks()[0]?.label || 'der Kamera';

function gemerkt(schluessel) { try { return localStorage.getItem(schluessel) || ''; } catch { return ''; } }
function merken(schluessel, wert) { try { localStorage.setItem(schluessel, wert); } catch { /* dann eben nicht merken */ } }
const KAMERA_SPEICHER = ['strichfiguren-kamera', 'strichfiguren-kamera2'];
const GERAETE_SPEICHER = 'strichfiguren-geraete';   // Einstellungen je Kamera-Gerät
const BAND_SPEICHER = 'strichfiguren-band';

ui.selHaltung.value = gemerkt('strichfiguren-haltung') || 'stehen';   // vor der ersten Pose
for (const p of P) p.figur.setPose(restPose(rigOpts()));

// ---------- Erkennungsmodell (eins je Kamera: MediaPipe verfolgt die Person von Bild zu Bild) ----------
// Nacheinander laden: MediaPipe richtet beim Laden globale Hilfsmittel ein, gleichzeitig kann das schiefgehen.
let ladeKette = Promise.resolve();
function detektor(p) {
  const name = ui.selModell.value;
  if (p.detector?.name === name) return Promise.resolve(p.detector);
  if (!p.laden) {
    p.detector?.close();
    p.detector = null;
    ui.selModell.disabled = true;
    status('Erkennungsmodell wird geladen …');
    p.laden = ladeKette = ladeKette.catch(() => {}).then(() => createDetector(name))
      .then(d => { p.detector = d; status('Erkennungsmodell bereit.'); return d; })
      .finally(() => { p.laden = null; ui.selModell.disabled = P.some(q => q.laden); });
  }
  return p.laden;
}

// Gesichtserkennung je Kamera (MediaPipe verfolgt das Gesicht von Bild zu Bild); auch nacheinander laden
function gesichtErkennung(p) {
  if (p.gesicht) return Promise.resolve(p.gesicht);
  p.gesichtLaden ??= ladeKette = ladeKette.catch(() => {}).then(() => createGesicht())
    .then(g => { p.gesicht = g; return g; })
    .catch(err => { console.error(err); status('Gesichtsmodell nicht geladen: ' + err.message); return null; })
    .finally(() => { p.gesichtLaden = null; });
  return p.gesichtLaden;
}

// Gesichtsmodell bei Bedarf im Hintergrund laden; Körper läuft so lange schon
function gesichtVorbereiten(p) {
  if (gesichtAn(p) && !p.gesicht) gesichtErkennung(p);
  p.gesicht?.reset();
}

// ---------- Einstellungen je Kamera-Gerät ----------
// Gemerkt werden Aufgabe, Spiegeln, Figur (zweite Kamera) und ein gemerktes Ruhegesicht.
function geraete() { try { return JSON.parse(gemerkt(GERAETE_SPEICHER) || '{}'); } catch { return {}; } }

function geraetEinstellungenLaden(p) {
  const id = kameraId(p), e = id && geraete()[id];
  p.chkSpiegeln.checked = e?.spiegeln ?? true;      // Kameras standardmäßig wie ein Spiegel
  p.selAufgabe.value = e?.aufgabe ?? 'beides';
  if (p.nr === 1 && e?.figur !== undefined) ui.selFigur2.value = String(e.figur);
  p.neutral.reset();
  if (e?.neutral) p.neutral.merken(e.neutral);
  neutralAnzeigen(p);
}

function geraetEinstellungenSpeichern(p) {
  const id = kameraId(p);
  if (!id) return;   // Videodatei: nichts zu merken
  const alle = geraete();
  alle[id] = {
    name: kameraName(p), spiegeln: p.chkSpiegeln.checked, aufgabe: p.selAufgabe.value,
    ...(p.nr === 1 && { figur: +ui.selFigur2.value }),
    ...(p.neutral.fest && { neutral: p.neutral.werte.map(v => Math.round(v * 100) / 100) }),
  };
  merken(GERAETE_SPEICHER, JSON.stringify(alle));
}

function neutralAnzeigen(p) {
  p.neutralInfo.textContent = p.neutral.fest ? 'Ruhegesicht: gemerkt' : 'Ruhegesicht: automatisch';
}

// ---------- Tape-Marker ----------
function markerZiele(p) {
  if (!bandAn() || !ui.chkMarker.checked) return null;
  const tol = +ui.rngToleranz.value;
  return [{ ...S.marker.a, tol, max: 3 }, rolle(p) === 'schlagzeug' ? { ...S.marker.b, tol, max: 4 } : null];
}

// Ergänzt ein erkanntes Bild um die gefundenen Marker (m = Farbe A, mb = Farbe B).
// Bei zwei Winkeln zählen nur die Marker der ersten Kamera.
function markerSuchen(p, f) {
  const ziele = hatFigur(p) && markerZiele(p);
  if (!f || !ziele) return;
  const [m, mb] = sucher.suche(p.video, ziele);
  if (m?.length) f.m = m;
  if (mb?.length) f.mb = mb;
}

function farbfelder() {
  ui.feldA.style.background = `rgb(${S.marker.a.rgb})`;
  ui.feldB.style.background = `rgb(${S.marker.b.rgb})`;
}

// ---------- Einblendung im Video ----------
// e: Ergebnis der Gesichtserkennung (live: Rahmen aller Gesichter und Gesichtslinien) oder { gesicht } aus einer Aufnahme
function zeichneOverlay(p, q, f, e = null) {
  const c = p.overlay, v = p.video, w = v.videoWidth, h = v.videoHeight;
  const g = c.getContext('2d');
  if (!w || !h) { g.clearRect(0, 0, c.width, c.height); return; }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  g.clearRect(0, 0, w, h);
  const dicke = Math.max(2, w / 300);
  g.lineCap = 'round';
  gesichtEinblenden(g, e, w, h, dicke);
  if (q) {
    g.lineWidth = dicke;
    g.strokeStyle = 'rgba(70, 240, 255, .9)';
    g.beginPath();
    for (const [i, k] of OVERLAY_LINIEN) { g.moveTo(q[i][0] * w, q[i][1] * h); g.lineTo(q[k][0] * w, q[k][1] * h); }
    g.stroke();
    g.fillStyle = '#fff';
    for (const [x, y] of q.slice(11)) { g.beginPath(); g.arc(x * w, y * h, dicke * 1.1, 0, Math.PI * 2); g.fill(); }
  }
  // Gefundene Marker einkreisen
  const kreis = (u, vv, farbe) => {
    for (const [breite, stil] of [[dicke * 2.2, '#fff'], [dicke, farbe]]) {
      g.lineWidth = breite;
      g.strokeStyle = stil;
      g.beginPath();
      g.arc(u * w, vv * h, dicke * 7, 0, Math.PI * 2);
      g.stroke();
    }
  };
  for (const [u, vv] of f?.m ?? []) kreis(u, vv, `rgb(${S.marker.a.rgb})`);
  for (const [u, vv] of f?.mb ?? []) kreis(u, vv, `rgb(${S.marker.b.rgb})`);
  // Eingemessene Teile des Schlagzeugs
  if (hatFigur(p) && rolle(p) === 'schlagzeug') {
    const gespiegelt = p.chkSpiegeln.checked;
    g.font = `600 ${Math.round(dicke * 7)}px system-ui, sans-serif`;
    for (const [name, [u, vv]] of Object.entries(p.kitBild)) {
      const x = u * w, y = vv * h, a = dicke * 5;
      g.lineWidth = dicke;
      g.strokeStyle = '#ffe14d';
      g.beginPath();
      g.moveTo(x - a, y); g.lineTo(x + a, y); g.moveTo(x, y - a); g.lineTo(x, y + a);
      g.stroke();
      g.save();
      g.translate(x + a * 1.3, y - a * 0.6);
      if (gespiegelt) g.scale(-1, 1);   // Schrift trotz gespiegeltem Video lesbar
      g.fillStyle = '#ffe14d';
      g.textAlign = gespiegelt ? 'right' : 'left';
      g.fillText(name, 0, 0);
      g.restore();
    }
  }
}

function gesichtEinblenden(g, e, w, h, dicke) {
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
    const Q = e.punkte;
    g.lineWidth = Math.max(1, dicke * 0.5);
    g.beginPath();
    for (const [i, k] of GESICHT_LINIEN) { g.moveTo(Q[i][0] * w, Q[i][1] * h); g.lineTo(Q[k][0] * w, Q[k][1] * h); }
    g.stroke();
  } else if (e.gesicht?.k) {
    const [x, y, bw, bh] = e.gesicht.k;
    g.lineWidth = Math.max(1, dicke * 0.6);
    g.strokeRect(x * w, y * h, bw * w, bh * h);
  }
}

function zeigeVideo(p, sichtbar, text) {
  p.leer.hidden = sichtbar;
  if (text) p.leer.textContent = text;
}

// Spiegeln je Kamera; eine Figur folgt der Kamera, die sie besitzt
function spiegeln() {
  for (const p of P) p.rahmen.classList.toggle('gespiegelt', p.chkSpiegeln.checked);
  studio.setSpiegeln(P1.chkSpiegeln.checked, 0);
  studio.setSpiegeln(P2.chkSpiegeln.checked, 1);
}

function neueVideoUrl(p, blobOderDatei) {
  if (p.videoUrl) URL.revokeObjectURL(p.videoUrl);
  p.videoUrl = URL.createObjectURL(blobOderDatei);
  p.video.srcObject = null;
  p.video.src = p.videoUrl;
}

// Aufnahmen aus MediaRecorder kennen ihre Länge oft nicht; ein Sprung ans Ende behebt das
async function videoLaden(p, blob) {
  const v = p.video;
  neueVideoUrl(p, blob);
  await einmal(v, 'loadedmetadata');
  if (!isFinite(v.duration)) {
    v.currentTime = 1e101;
    await Promise.race([einmal(v, 'durationchange'), new Promise(ok => setTimeout(ok, 1500))]);
    v.currentTime = 0;
  }
}

const analysierbar = p => !!p.video.currentSrc && !p.video.srcObject && isFinite(p.video.duration);

// Was gerade zu sehen ist: zweites Video, zweite Figur, Bedienelemente für die zweite Kamera
function ansichtAnpassen() {
  const zwei = P2.aktiv, eigene = hatFigur(P2);
  P2.rahmen.hidden = !zwei;
  ui.videos.classList.toggle('zwei', zwei);
  // Etikett im Video: was diese Kamera auswertet und für welche Figur
  const figurText = p => (zwei ? ` → Figur ${besitzer(p).nr + 1}` : '');
  for (const p of P) p.etikett.textContent = `Kamera ${p.nr + 1} · ${AUFGABEN[p.selAufgabe.value]}${figurText(p)}`;
  P1.etikett.hidden = !zwei && P1.selAufgabe.value === 'beides';   // bei einer Kamera nur zeigen, wenn es etwas zu sagen gibt
  studio.setFigurenZahl(eigene ? 2 : 1);
  ui.zweitesInstrument.hidden = !eigene;
  ui.rolleText.textContent = eigene ? 'Figur 1' : 'Instrument';
  ui.kameraBlock2.classList.toggle('aus', !P2.aktiv);
  const live = S.mode === 'live' && S.quelle === 'kamera', mehrere = S.kameras.length >= 2;
  ui.btnKamera2.textContent = P2.stream ? '✕ 2. Kamera' : '+ 2. Kamera';
  // Nicht einfach ausgrauen: Ein Klick sagt, was fehlt (erste Kamera starten, zweite Kamera nicht zu sehen)
  ui.btnKamera2.disabled = !!S.aufnahme || !!S.analyse;
  ui.btnKamera2.classList.toggle('gedimmt', !P2.stream && !(live && mehrere));
  ui.btnKamera2.title = P2.stream ? 'Zweite Kamera ausschalten'
    : mehrere ? 'Eine zweite Kamera dazunehmen (erst die erste mit „Kamera“ starten)'
      : 'Braucht eine zweite Kamera, z. B. das iPhone (am Mac als Integrationskamera)';
  P1.selKamera.disabled = !S.kameras.length;
  P2.selKamera.disabled = !mehrere;
  spiegeln();
}

// ---------- Aufräumen ----------
function kameraStoppen(p) {
  p.stream?.getTracks().forEach(t => t.stop());
  p.stream = null;
  p.liveSeit = 0;
  if (p.video.srcObject) p.video.srcObject = null;
}

function zweiteZuruecksetzen() {
  P2.token++;
  kameraStoppen(P2);
  P2.video.pause();
  P2.video.removeAttribute('src');
  P2.video.load();
  if (P2.videoUrl) { URL.revokeObjectURL(P2.videoUrl); P2.videoUrl = null; }
  P2.aktiv = false;
  P2.mitVideo = false;
  P2.letzteErkennung = null;
  P2.kandidat = P1.kandidat = null;
  P1.stehtGemeldet = P2.stehtGemeldet = false;
  zeichneOverlay(P2, null);
  S.verschmelzer.reset();
  luftbandOberflaeche(P2);
  ansichtAnpassen();
}

function stoppeAlles() {
  for (const p of P) p.token++;
  if (S.einmessen) einmessenBeenden();
  klickModusSetzen(null);
  if (S.analyse) { S.analyse.abbrechen = true; S.analyse.verwerfen = true; }
  if (S.aufnahme) {
    const a = S.aufnahme;
    S.aufnahme = null;
    for (const { recorder } of a.videos) { try { recorder?.stop(); } catch { /* schon gestoppt */ } }
    aufnahmeKnopf(false);
  }
  S.mikro?.getTracks().forEach(t => t.stop());
  S.mikro = null;
  for (const p of P) {
    kameraStoppen(p);
    p.video.pause();
    p.letzteErkennung = null;
    p.kandidat = null;
    p.letzterRig = null;
    p.figur.setMimik(null);
    zeichneOverlay(p, null);
  }
  S.uhr.laeuft = false;
  S.mode = 'idle';
  zweiteZuruecksetzen();
}

function takeEntfernen() {
  S.take = null;
  for (const p of P) Object.assign(p, { posen: null, gPosen: null, extras: null, rohExtras: null, toene: null, tonZeit: null, mitVideo: false });
  ui.btnPlay.disabled = ui.rngZeit.disabled = ui.btnExport.disabled = ui.btnTonspur.disabled = ui.btnMidi.disabled = true;
  ui.btnPlay.textContent = '▶';
  ui.rngZeit.value = 0;
  ui.zeit.textContent = '0:00.0 / 0:00.0';
}

// ---------- Live: Kamera oder Videodatei ----------
// Die Erkennung darf im Mittel höchstens diesen Anteil der Rechenzeit belegen. Der Rest bleibt für die
// 3D-Ansicht, die Videos und die Bedienung – sonst friert bei zwei Kameras alles ein. Jede Kamera hat ein
// Zeitkonto: Es wächst mit ihrem Anteil am Budget, jede Erkennung bucht ihre tatsächliche Dauer ab.
// Ist es leer, wird das Bild übersprungen. Bei einer Kamera und schnellem Rechner merkt man davon nichts.
const BUDGET = 0.7;
const KONTO = [-100, 40];   // so tief bzw. hoch kann das Zeitkonto stehen (ms)
const FRISCHES_BILD = 1000;  // liefert eine Kamera so lange (ms) kein neues Bild, steht sie
const liefertBilder = (q, jetzt) => ((q.nr === 0 && S.mode === 'live') || q.stream) && jetzt - q.letztesBild < FRISCHES_BILD;
// Nur Kameras, die wirklich Bilder liefern, teilen sich das Budget
const laufendeKameras = jetzt => Math.max(1, P.filter(q => liefertBilder(q, jetzt)).length);

function liveStarten(p) {
  S.mode = 'live';
  p.liveFilter.reset();
  p.liveExtras = new ExtraFilter(staerke());
  p.luftFilter = luftFilter();
  p.luftExtras = luftExtraFilter();
  gesichtVorbereiten(p);
  besitzer(p).liveGesichtFilter.reset();
  besitzer(p).kandidat = null;
  p.letzterRig = null;
  S.verschmelzer.reset();   // neue Kamera: der Winkel zwischen beiden muss neu bestimmt werden
  messungZuruecksetzen(p);
  p.figur.setAnker(null);
  const token = ++p.token;
  const v = p.video;
  let letzteZeit = -1, konto = 0, uhr = performance.now();
  p.liveSeit = uhr;
  p.letztesBild = -Infinity;
  // Mit requestVideoFrameCallback läuft tick nur, wenn die Kamera wirklich ein neues Bild liefert
  const plane = () => ('requestVideoFrameCallback' in v ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick));
  function tick() {
    if (token !== p.token || S.mode !== 'live') return;
    const jetzt = performance.now();
    const neuesBild = !!v.srcObject || v.currentTime !== letzteZeit;
    if (neuesBild) p.letztesBild = jetzt;
    konto = Math.min(KONTO[1], konto + (jetzt - uhr) * BUDGET / laufendeKameras(jetzt));
    uhr = jetzt;
    const koerper = koerperAn(p), gesicht = gesichtAn(p) && p.gesicht;
    if ((p.detector || !koerper) && (koerper || gesicht) && v.readyState >= 2 && neuesBild && konto > 0) {
      letzteZeit = v.currentTime;
      const f = koerper ? p.detector.detect(v, jetzt) : null;
      const e = gesicht ? p.gesicht.detect(v, jetzt, f?.q) : null, erkannt = performance.now();
      liveBild(p, f, e, jetzt / 1000);
      messen(p, jetzt, erkannt - jetzt, performance.now() - erkannt, !!(f || e?.gesicht));
      konto = Math.max(KONTO[0], konto - (performance.now() - jetzt));
    }
    plane();
  }
  plane();
}

// e: Ergebnis der Gesichtserkennung dieser Kamera (oder null)
function liveBild(p, f, e, t) {
  markerSuchen(p, f);
  zeichneOverlay(p, f?.q, f, e);
  if (f) p.letzteErkennung = f;
  const o = besitzer(p);
  const neuesGesicht = gesichtMelden(o, p, e?.gesicht, t);
  if (neuesGesicht || (gesichtAn(p) && !e?.gesicht)) mimikZeigen(o, t);
  // Zwei Winkel: beide Kameras liefern der ersten Figur zu
  if (zweiWinkel()) f = S.verschmelzer.bild(p.nr, f, t);
  if (f && koerperAn(p)) figurBewegen(o, f, t);
  // Figur ohne Körper-Kamera (nur Gesicht): sie steht, aufgenommen wird nur das Gesicht
  else if (neuesGesicht && !hatKoerperQuelle(o)) {
    if (!o.letzterRig) o.figur.setPose(restPose(rigOpts()));
    if (S.aufnahme) S.aufnahme.frames[o.nr].push({ t: r3((performance.now() - S.aufnahme.start) / 1000), g: o.kandidat.g });
  }
}

// ---------- Gesicht einer Figur: aus der Kamera, die es gerade am größten sieht ----------
const GESICHT_FRISCH = 0.3;   // s: so lange gilt ein Gesicht, bevor eine andere Kamera übernehmen darf
const flaeche = g => g.k[2] * g.k[3];

// Kopfdrehung aus Kamera 2 in die Ausrichtung von Kamera 1 (nur wenn der Winkel bekannt ist)
function inKamera1(g, p, verschmelzer = S.verschmelzer) {
  if (p.nr === 0 || S.zweite !== 'winkel' || !verschmelzer.bereit) return g;
  const h = -verschmelzer.winkel / 2, s = Math.sin(h), c = Math.cos(h), [x, y, z, w] = g.r;
  // Drehung um die Senkrechte (y) vor die Kopfdrehung setzen
  return { ...g, r: [c * x + s * z, c * y + s * w, c * z - s * x, c * w - s * y].map(r4) };
}

// Meldet das Gesicht einer Kamera ihrer Figur. → true, wenn es übernommen wurde
function gesichtMelden(o, p, g, t, verschmelzer) {
  if (!g) return false;
  const k = o.kandidat;
  if (k && k.p !== p && t - k.t < GESICHT_FRISCH && t >= k.t && flaeche(k.g) > flaeche(g)) return false;
  p.neutral.update(g.b);
  o.kandidat = { g: inKamera1(g, p, verschmelzer), t, p };
  o.gesichtVon = p;
  return true;
}

function mimikZeigen(o, t) {
  const k = o.kandidat, frisch = k && t - k.t < GESICHT_FRISCH && t >= k.t;
  const g = o.liveGesichtFilter.apply(frisch ? k.g : null, t);
  o.figur.setMimik(mimik(g, gesichtsNamen(), o.gesichtVon?.neutral.werte));
}

// Gesicht für ein aufgenommenes Bild (roh, ungeglättet), wenn es frisch genug ist
const gesichtFuerBild = (o, t) => (o.kandidat && Math.abs(t - o.kandidat.t) < 0.15 ? o.kandidat.g : undefined);

function figurBewegen(p, f, t) {
  const ins = p.figur.instrumente;
  const roh = markerAuswerten(f, seitenverhaeltnis(p), rolle(p), ins.greiftLinks(), p.kitBild);
  if (luftbandAn(p)) {
    const jl = buildRig(p.luftFilter.apply(f.p, t), rigOpts());
    ins.update(jl, p.luftExtras.apply(roh, t), false);
    luftbandZeigen(p, p.luftband.schritt(t, ins.messpunkte(jl), fuesseSichtbar(f.p)));
  }
  p.letzterRig = buildRig(p.liveFilter.apply(f.p, t), rigOpts());
  p.figur.setPose(p.letzterRig, p.liveExtras.apply(roh, t));
  if (S.aufnahme) S.aufnahme.frames[p.nr].push(bildDaten((performance.now() - S.aufnahme.start) / 1000, f, gesichtFuerBild(p, t)));
}

// Ein Bild für die Aufnahme (q2: Bildpunkte der zweiten Kamera, wenn zwei Winkel verschmolzen wurden; g: Gesicht)
const bildDaten = (t, f, g) => ({ t: r3(t), p: f.p, q: f.q, m: f.m, mb: f.mb, ...(f.q2 && { q2: f.q2 }), ...(g && { g }) });

// ---------- Kameras wählen (z. B. das iPhone, am Mac als Integrationskamera) ----------
// Die Liste hat erst Namen, wenn die Kamera einmal erlaubt wurde
async function kamerasAuflisten() {
  let kameras = [];
  try {
    kameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && d.deviceId);
  } catch { /* keine Liste */ }
  S.kameras = kameras;
  for (const p of P) {
    const aktiv = kameraId(p) || gemerkt(KAMERA_SPEICHER[p.nr]);
    p.selKamera.replaceChildren(...kameras.map((d, i) => new Option(d.label || `Kamera ${i + 1}`, d.deviceId, false, d.deviceId === aktiv)));
    p.selKamera.title = p.selKamera.selectedOptions[0]?.text ?? '';
  }
  ansichtAnpassen();
}

// ausser: diese Kamera nicht nehmen (sie filmt schon als erste)
async function kameraOeffnen(id, ausser = '') {
  const bild = { width: { ideal: 1280 }, height: { ideal: 720 } };
  const versuchen = async kid => {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { ...bild, deviceId: { exact: kid } }, audio: false });
    } catch (err) {
      console.warn('Kamera nicht verfügbar', err);
      return null;
    }
  };
  let stream = id && id !== ausser ? await versuchen(id) : null;
  if (!stream && ausser) {
    // Zweite Kamera: irgendeine, die nicht schon die erste ist
    for (const d of S.kameras) {
      if (d.deviceId === ausser || d.deviceId === id) continue;
      if ((stream = await versuchen(d.deviceId))) break;
    }
    if (!stream) throw new Error('Keine zweite Kamera gefunden. Ist das iPhone verbunden?');
  }
  stream ??= await navigator.mediaDevices.getUserMedia({ video: bild, audio: false });
  const spur = stream.getVideoTracks()[0];
  if (spur) spur.onended = () => { if (P.some(p => p.stream === stream)) status('Eine Kamera ist nicht mehr da. Wähle eine andere oder starte sie neu.'); };
  return stream;
}

async function kameraWechseln(p) {
  const id = p.selKamera.value, andere = P[1 - p.nr];
  if (andere.stream && id === kameraId(andere)) {
    status(`Diese Kamera filmt schon als ${andere.nr ? 'zweite' : 'erste'}. Wähle eine andere.`);
    kamerasAuflisten();
    return;
  }
  merken(KAMERA_SPEICHER[p.nr], id);
  p.selKamera.title = p.selKamera.selectedOptions[0]?.text ?? '';
  if (!p.stream) { status('Diese Kamera wird beim nächsten Klick auf „Kamera“ verwendet.'); return; }
  if (S.aufnahme) { status('Während einer Aufnahme lässt sich die Kamera nicht wechseln.'); kamerasAuflisten(); return; }
  try {
    status('Kamera wird gewechselt …');
    kameraStoppen(p);   // erst die alte freigeben – manche Kameras (iPhone) liefern nur an einen
    p.stream = await kameraOeffnen(id, p.nr ? kameraId(P1) : '');
    geraetEinstellungenLaden(p);
    if (p.nr === 1) S.zweite = zweiteModus();
    ansichtAnpassen();
    p.video.srcObject = p.stream;
    await p.video.play();
    if (gesichtAn(p)) gesichtErkennung(p);
    liveStarten(p);
    status(`Live mit ${kameraName(p)}.`);
  } catch (err) {
    console.error(err);
    status('Kamera nicht verfügbar: ' + err.message);
  }
  kamerasAuflisten();
}

// ---------- Zweite Kamera ----------
async function zweiteKameraUmschalten() {
  if (S.aufnahme) { status('Während einer Aufnahme lässt sich die zweite Kamera nicht an- oder ausschalten.'); return; }
  if (P2.stream) {
    zweiteZuruecksetzen();
    kamerasAuflisten();
    status(`Nur noch ${kameraName(P1)}.`);
    return;
  }
  if (S.mode !== 'live' || S.quelle !== 'kamera') { status('Starte zuerst mit „Kamera“ die erste Kamera.'); return; }
  await kamerasAuflisten();
  if (S.kameras.length < 2) {
    const browser = istSafari ? 'Safari' : /edg\//i.test(navigator.userAgent) ? 'Edge' : /chrome/i.test(navigator.userAgent) ? 'Chrome' : 'Der Browser';
    status(`${browser} sieht nur eine Kamera (${kameraName(P1)}). Fürs iPhone: in der Nähe, gesperrt und ruhig hinstellen, ` +
      'einmal in FaceTime als Kamera wählen, dann den Browser ganz beenden (⌘Q) und neu öffnen. Fragt das iPhone nach, „Erlauben“ tippen.');
    return;
  }
  try {
    status('Zweite Kamera wird gestartet …');
    P2.stream = await kameraOeffnen(gemerkt(KAMERA_SPEICHER[1]), kameraId(P1));
    geraetEinstellungenLaden(P2);
    S.zweite = zweiteModus();
    const v = P2.video;
    v.removeAttribute('src');
    v.controls = false;
    v.loop = false;
    v.muted = true;
    v.srcObject = P2.stream;
    await v.play();
    P2.aktiv = true;
    zeigeVideo(P2, true);
    P2.figur.setInstrument(rolle(P2), P2.selHand.value);
    luftbandOberflaeche(P1);
    luftbandOberflaeche(P2);
    await kamerasAuflisten();
    await Promise.all([detektor(P2), gesichtAn(P2) ? gesichtErkennung(P2) : null]);
    if (!P2.stream) return;   // inzwischen wieder ausgeschaltet
    liveStarten(P2);
    status(zweiteHinweis());
  } catch (err) {
    console.error(err);
    zweiteZuruecksetzen();
    status('Zweite Kamera nicht verfügbar: ' + err.message);
  }
  kamerasAuflisten();
}

// ---------- Steht eine Kamera? ----------
// Safari liefert (Stand macOS 26) nur von einer Kamera gleichzeitig Bilder: Kommt die zweite dazu, bleibt
// das Bild der ersten einfach stehen – und mit ihm Skelett und Figur. Das merken wir daran, dass eine
// Kamera keine neuen Bilder mehr liefert (oder stummgeschaltet ist), während die andere läuft. In Safari
// schalten wir dann die zweite wieder ab und öffnen die erste neu (eine angehaltene gibt Safari nicht wieder frei).
const STEHT_NACH = 1500;   // ms ohne neues Bild
const istSafari = /^((?!chrome|chromium|crios|android|edg).)*safari/i.test(navigator.userAgent);
let kameraPruefung = false;

function kamerasPruefen() {
  if (kameraPruefung || S.mode !== 'live' || S.quelle !== 'kamera' || !P1.stream || !P2.stream || document.hidden) return;
  const jetzt = performance.now();
  const spur = p => p.stream.getVideoTracks()[0];
  const liefert = p => !spur(p)?.muted && jetzt - p.letztesBild < 500;
  const steht = p => {
    if (!p.liveSeit || jetzt - p.liveSeit < STEHT_NACH || spur(p)?.readyState === 'ended') return false;   // startet noch / ist weg
    if (!spur(p)?.muted && jetzt - p.letztesBild < STEHT_NACH) return false;
    // Vielleicht hat der Browser nur das Video angehalten: erst einmal weiterspielen lassen
    if (p.video.paused) { p.video.play().catch(() => {}); p.liveSeit = jetzt; return false; }
    return true;
  };
  const stehende = steht(P1) && liefert(P2) ? P1 : steht(P2) && liefert(P1) ? P2 : null;
  if (!stehende) {
    if (P1.stehtGemeldet || P2.stehtGemeldet) status('Beide Kameras liefern wieder Bilder.');
    P1.stehtGemeldet = P2.stehtGemeldet = false;
    return;
  }
  if (istSafari && !S.aufnahme) { zweiteWiederAus(stehende); return; }
  if (stehende.stehtGemeldet) return;
  stehende.stehtGemeldet = true;
  status(stehende === P1
    ? 'Kamera 1 liefert keine Bilder mehr, seit die zweite läuft. Vielleicht kann der Rechner nicht beide gleichzeitig – dann die zweite ausschalten.'
    : 'Kamera 2 liefert keine Bilder mehr. Ist das iPhone noch in der Nähe und gesperrt?');
}
setInterval(kamerasPruefen, 500);

async function zweiteWiederAus(stehende) {
  kameraPruefung = true;
  try {
    const id = kameraId(P1) || gemerkt(KAMERA_SPEICHER[0]);
    zweiteZuruecksetzen();
    if (stehende === P1) {
      const token = P1.token;
      kameraStoppen(P1);
      const stream = await kameraOeffnen(id);
      if (P1.token !== token || S.mode !== 'live') { stream.getTracks().forEach(t => t.stop()); return; }   // inzwischen etwas anderes gestartet
      P1.stream = stream;
      P1.video.srcObject = stream;
      await P1.video.play();
      liveStarten(P1);
    }
    status(`Safari liefert nur von einer Kamera gleichzeitig Bilder: Die ${stehende === P1 ? 'erste' : 'zweite'} blieb stehen, ` +
      `deshalb ist die zweite wieder aus. Für zwei Kameras öffne ${location.origin} in Chrome.`);
  } catch (err) {
    console.error(err);
    status('Die erste Kamera lässt sich nicht neu starten: ' + err.message + ' Klick auf „Kamera“.');
  } finally {
    kameraPruefung = false;
  }
  kamerasAuflisten();
}

// Was die zweite Kamera gerade tut, in einem Satz
function zweiteHinweis() {
  const n1 = kameraName(P1), n2 = kameraName(P2);
  if (S.zweite === 'person') return `Zwei Personen: ${n2} filmt die zweite Figur. Ihr Instrument wählst du unter Einstellungen → Band.`;
  if (zweiWinkel()) {
    return `Zwei Winkel: ${n1} und ${n2} filmen dieselbe Person, am besten 45–90° auseinander und beide mit dem ganzen Körper im Bild. ` +
      'Sobald beide dich sehen, wird der Winkel bestimmt und die Figur aus beiden Ansichten verschmolzen (Anzeige oben im Video).';
  }
  if (!koerperAn(P2)) return `${n2} liefert das Gesicht für Figur 1 (am besten nah dran), ${n1} ${koerperAn(P1) ? 'den Körper' : 'auch nur das Gesicht'}.`;
  return `${n2} liefert den Körper für Figur 1${gesichtAn(P1) ? `, ${n1} das Gesicht` : ''}.`;
}

// Aufgabe oder Figur einer Kamera geändert: gilt sofort (live) bzw. für die nächste Analyse
function kameraAufgabeGeaendert(p) {
  if (p.stream) geraetEinstellungenSpeichern(p);
  if (S.aufnahme) { status('Während einer Aufnahme lässt sich das nicht umstellen – gilt ab der nächsten.'); }
  const vorher = S.zweite;
  if (!S.aufnahme && !(S.mode === 'take' && P2.aktiv)) S.zweite = zweiteModus();
  if (gesichtAn(p)) gesichtErkennung(p);
  if (!gesichtAn(p)) { besitzer(p).kandidat = null; zeichneOverlay(p, null); }
  if (S.mode === 'live') {
    for (const q of P) { q.liveFilter.reset(); q.figur.setAnker(null); q.liveGesichtFilter.reset(); }
    if (vorher !== S.zweite) {
      S.verschmelzer.reset();
      P2.figur.setInstrument(rolle(P2), P2.selHand.value);
      luftbandOberflaeche(P1);
      luftbandOberflaeche(P2);
    }
    if (!koerperAn(p) && !hatKoerperQuelle(besitzer(p))) besitzer(p).figur.setPose(restPose(rigOpts()));
    ansichtAnpassen();
    if (P2.stream) status(zweiteHinweis());
  } else if (S.mode === 'take' && P.some(q => q.aktiv && analysierbar(q))) {
    ansichtAnpassen();
    status('Gilt für die nächste Auswertung: „Analysieren“ wertet das Video so neu aus.');
  } else ansichtAnpassen();
}

// ---------- Messung im Live-Bild: Wie viel Rechenzeit bleibt, z. B. für eine zweite Kamera? ----------
//   Erkennung  MediaPipe für ein Bild
//   Rest       Tape-Suche, Glättung, Figur, Luftband, Einblendung
//   3D         Zeichnen der 3D-Ansicht (läuft mit der Bildwiederholrate des Bildschirms)
//   Last       Anteil der Zeit, in der der Browser damit beschäftigt ist
let messungGezeigt = 0;
function messungZuruecksetzen(p) {
  Object.assign(p.mess, { erkennung: null, rest: null, person: null, zeiten: [], n: 0 });
  ui.messung.hidden = true;
}


const zahl = (x, stellen = 0) => x.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });

// gefunden: wurde in diesem Bild eine Person erkannt?
function messen(p, jetzt, erkennungMs, restMs, gefunden) {
  const glatt = (alt, neu) => (alt === null ? neu : alt + (neu - alt) * 0.1);
  const m = p.mess;
  m.person = glatt(m.person, gefunden ? 1 : 0);
  m.zeiten.push(jetzt);
  while (m.zeiten[0] < jetzt - 2000) m.zeiten.shift();
  // Die ersten Bilder nach dem Laden eines Modells sind langsam (Aufwärmen) und zählen nicht
  if (++m.n > 3) {
    m.erkennung = glatt(m.erkennung, erkennungMs);
    m.rest = glatt(m.rest, restMs);
  }
  if (jetzt - messungGezeigt < 250) return;   // viermal pro Sekunde reicht
  const laufend = P.filter(q => q.nr === 0 || q.stream);
  const werte = laufend.map(q => {
    // Kommt kein neues Bild mehr, zählt diese Kamera nicht mit (sonst stünde hier ihr alter Wert)
    if (q !== p && !liefertBilder(q, jetzt)) return { steht: true };
    const z = q.mess.zeiten.filter(t => t >= jetzt - 2000);
    if (z.length < 3 || q.mess.erkennung === null) return null;
    return {
      bps: (z.length - 1) / ((z.at(-1) - z[0]) / 1000),
      kamera: q.stream?.getVideoTracks()[0]?.getSettings().frameRate ?? null,
      erkennung: q.mess.erkennung, rest: q.mess.rest, person: q.mess.person,
    };
  });
  if (werte.some(w => !w)) return;
  messungGezeigt = jetzt;
  const d = studio.messung;
  const bilder = w => (w.kamera ? `${zahl(w.bps)} von ${zahl(w.kamera)}` : zahl(w.bps));
  const keine = w => (w.person < 0.5 ? ', keine Person erkannt' : '');
  let last = (1000 / d.abstand) * d.ms / 1000;
  for (const w of werte) if (!w.steht) last += w.bps * (w.erkennung + w.rest) / 1000;
  const lastText = `Last ${zahl(Math.min(last, 9.99) * 100)} %`;
  if (werte.length === 1) {
    const [w] = werte;
    // Mit einer zweiten Kamera teilen sich beide das Budget für die Erkennung
    const jeKamera = Math.min(w.kamera || w.bps, 1000 * BUDGET / (2 * (w.erkennung + w.rest)));
    ui.messung.textContent = `${bilder(w)} Bildern/s ausgewertet${keine(w)} · Erkennung ${zahl(w.erkennung, 1)} ms · ` +
      `Rest ${zahl(w.rest, 1)} ms · 3D ${zahl(d.ms, 1)} ms · ${lastText} · mit 2. Kamera je ${zahl(jeKamera)} Bilder/s`;
  } else {
    const v = S.verschmelzer;
    const winkel = !zweiWinkel() || werte.some(w => w.steht) ? ''
      : v.bereit ? ` · Winkel ${zahl(Math.abs(v.winkel * 180 / Math.PI))}°${v.verschmolzen ? ', verschmolzen' : ''}`
        : ' · Winkel wird bestimmt …';
    const kamera = (w, i) => `Kamera ${i + 1}: ` + (w.steht ? 'Bild steht' : `${bilder(w)} Bilder/s${keine(w)}`);
    const erkennung = werte.filter(w => !w.steht).map(w => zahl(w.erkennung, 1)).join(' + ');
    ui.messung.textContent = `${werte.map(kamera).join(' · ')} · Erkennung ${erkennung} ms · 3D ${zahl(d.ms, 1)} ms · ${lastText}` +
      (werte.some(w => !w.steht && w.kamera && w.bps < 0.85 * w.kamera) ? ' (gedrosselt, damit nichts hängt; Modell „schnell“ schafft mehr)' : '') + winkel;
  }
  ui.messung.hidden = false;
}

async function kameraStarten() {
  try {
    stoppeAlles();
    takeEntfernen();
    status('Kamera wird gestartet …');
    P1.stream = await kameraOeffnen(gemerkt(KAMERA_SPEICHER[0]));
    const v = P1.video;
    v.removeAttribute('src');
    v.controls = false;
    v.loop = false;
    v.muted = true;
    v.srcObject = P1.stream;
    await v.play();
    S.quelle = 'kamera';
    geraetEinstellungenLaden(P1);
    ansichtAnpassen();
    zeigeVideo(P1, true);
    await Promise.all([detektor(P1), gesichtAn(P1) ? gesichtErkennung(P1) : null]);
    liveStarten(P1);
    await kamerasAuflisten();
    ui.btnAufnahme.disabled = false;
    ui.btnAnalyse.disabled = true;
    status(`Live mit ${kameraName(P1)}: Bewege dich vor der Kamera. Mit „Aufnahme“ hältst du eine Bewegung fest.` +
      (S.kameras.length >= 2 ? ' „+ 2. Kamera“ nimmt eine zweite dazu.' : ''));
  } catch (err) {
    console.error(err);
    status('Kamera nicht verfügbar: ' + err.message);
  }
}

async function videoOeffnen(datei) {
  try {
    stoppeAlles();
    takeEntfernen();
    const v = P1.video;
    v.controls = true;
    v.loop = false;
    v.muted = false;
    neueVideoUrl(P1, datei);
    await new Promise((ok, fehler) => {
      v.onloadedmetadata = ok;
      v.onerror = () => fehler(new Error('Das Video kann der Browser nicht lesen.'));
    });
    S.quelle = 'datei';
    S.dateiName = datei.name;
    P1.chkSpiegeln.checked = false;   // Videodateien sind normalerweise nicht gespiegelt
    spiegeln();
    zeigeVideo(P1, true);
    ui.btnAufnahme.disabled = true;
    ui.btnAnalyse.disabled = false;
    await Promise.all([detektor(P1), gesichtAn(P1) ? gesichtErkennung(P1) : null]);
    liveStarten(P1);
    ansichtAnpassen();
    status(`${datei.name}: Abspielen zeigt eine Vorschau, „Analysieren“ wertet jedes Bild genau aus.`);
  } catch (err) {
    console.error(err);
    status('Video lässt sich nicht öffnen: ' + err.message);
  }
}

// ---------- Aufnahme mit der Kamera (bei zwei Kameras beide gleichzeitig) ----------
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
  if (S.quelle !== 'kamera' || !P1.stream) return;
  // Ton mit aufnehmen (im Video der ersten Kamera), damit die Bewegung später zur Musik passt
  try {
    S.mikro = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    S.mikro = null;
  }
  const videos = P.filter(p => p.stream).map(p => {
    const spuren = p.nr === 0 && S.mikro ? new MediaStream([...p.stream.getVideoTracks(), ...S.mikro.getAudioTracks()]) : p.stream;
    const teile = [];
    let recorder = null;
    try {
      recorder = new MediaRecorder(spuren, videoFormat());
      recorder.ondataavailable = e => { if (e.data.size) teile.push(e.data); };
      recorder.start(500);
    } catch (err) {
      console.warn('Video wird nicht mit aufgenommen', err);
      recorder = null;
    }
    return { p, recorder, teile };
  });
  S.aufnahme = { start: performance.now(), frames: [[], []], videos, zweite: P2.stream ? S.zweite : null, verschmelzen: zweiWinkel() };
  aufnahmeKnopf(true);
  ansichtAnpassen();
  const wie = videos.length > 1 ? (S.zweite === 'person' ? 'mit zwei Personen' : zweiWinkel() ? 'mit zwei Winkeln' : 'mit zwei Kameras') : '';
  status(`Aufnahme ${wie} läuft (${S.mikro ? 'mit' : 'ohne'} Ton) …`.replace('  ', ' '));
}

async function aufnahmeBeenden() {
  const a = S.aufnahme;
  S.aufnahme = null;
  aufnahmeKnopf(false);
  const blobs = await Promise.all(a.videos.map(({ recorder, teile }) => (recorder && recorder.state !== 'inactive'
    ? new Promise(ok => { recorder.onstop = () => ok(new Blob(teile, { type: recorder.mimeType })); recorder.stop(); })
    : null)));
  S.mikro?.getTracks().forEach(t => t.stop());
  S.mikro = null;
  const [f1, f2] = a.frames, zweitePerson = a.zweite === 'person';
  if (!f1.length && !(zweitePerson && f2.length)) { status('In der Aufnahme wurde keine Person erkannt.'); ansichtAnpassen(); return; }

  for (const p of P) p.token++;
  const aspekte = P.map(seitenverhaeltnis);
  for (const p of P) kameraStoppen(p);
  ui.btnAufnahme.disabled = true;
  const mitVideo = [false, false];
  for (const [i, { p }] of a.videos.entries()) {
    if (blobs[i]?.size) { await videoLaden(p, blobs[i]); mitVideo[p.nr] = true; }
    else zeigeVideo(p, false, 'Das Video konnte nicht mit aufgenommen werden – die Bewegung schon.');
  }
  const dauer = Math.max(f1.at(-1)?.t ?? 0, f2.at(-1)?.t ?? 0);
  S.dateiName = 'kamera-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const fps = Math.round(Math.max(f1.length, f2.length) / Math.max(dauer, 0.001));
  takeSetzen(neuerTake({
    quelle: 'kamera', name: S.dateiName, fps, dauer, frames: f1, aspect: aspekte[0],
    zweite: zweitePerson ? { frames: f2, aspect: aspekte[1] } : null, ansichten: a.zweite === 'winkel' && a.verschmelzen ? 2 : 1,
  }), mitVideo);
  ui.btnAnalyse.disabled = !mitVideo[0];
  const posen = zweitePerson ? `${f1.length} + ${f2.length} Posen` : `${f1.length} Posen`;
  status(`Aufnahme fertig: ${zeitText(dauer)}, ${posen}. Abspielen mit ▶ oder Leertaste; „Analysieren“ wertet das Video noch genauer aus.`);
}

// ---------- Genaue Analyse eines Videos (bei zwei Videos beide, Bild für Bild im Gleichschritt) ----------
function springe(v, t) {
  return new Promise(ok => {
    const fertig = () => { clearTimeout(timer); v.removeEventListener('seeked', fertig); ok(); };
    const timer = setTimeout(fertig, 2000);
    v.addEventListener('seeked', fertig);
    v.currentTime = t;
  });
}

function bedienungSperren(gesperrt) {
  for (const el of [ui.btnKamera, ui.dateiVideo, ui.dateiJson, ui.selModell, ui.selFps, ui.btnEinmessen, ui.btnFarbeA, ui.btnFarbeB, ui.selFigur2, P1.selAufgabe, P2.selAufgabe]) {
    el.disabled = gesperrt;
  }
  ui.lblVideo.classList.toggle('gesperrt', gesperrt);
  ansichtAnpassen();
}

async function analysieren() {
  if (S.analyse) { S.analyse.abbrechen = true; return; }
  if (!analysierbar(P1)) { status('Analysieren geht nur mit einem Video (Datei oder Kamera-Aufnahme).'); return; }
  const quellen = P2.aktiv && analysierbar(P2) ? [P1, P2] : [P1];
  const zweite = quellen.length > 1 ? zweiteModus() : null;
  if (S.einmessen) einmessenBeenden();
  klickModusSetzen(null);
  const det = await Promise.all(quellen.map(p => (koerperAn(p) ? detektor(p) : null)));
  const ges = await Promise.all(quellen.map(p => (gesichtAn(p) ? gesichtErkennung(p) : null)));
  ges.forEach(g => g?.reset());
  for (const p of P) p.token++;
  takeEntfernen();
  if (zweite) S.zweite = zweite;
  S.mode = 'analyse';
  const ctl = S.analyse = { abbrechen: false, verwerfen: false };
  ui.btnAnalyse.textContent = 'Abbrechen';
  bedienungSperren(true);
  luftbandOberflaeche(P1);
  luftbandOberflaeche(P2);
  for (const p of quellen) {
    p.figur.setAnker(null);
    p.figur.setInstrument(rolle(p), p.selHand.value);
    p.video.pause();
    p.video.controls = false;
  }

  const fps = +ui.selFps.value, dauer = P1.video.duration, n = Math.max(1, Math.round(dauer * fps));
  const filter = P.map(() => new PoseFilter(staerke())), extras = P.map(() => new ExtraFilter(staerke()));
  const gFilter = P.map(() => new GesichtFilter(staerke()));
  const verschmelzen = zweite === 'winkel' && quellen.length > 1 && koerperAn(P1) && koerperAn(P2);
  for (const p of P) { p.kandidat = null; p.letzterRig = null; }
  let mitGesicht = 0;
  const aspekte = P.map(seitenverhaeltnis);
  const frames = [[], []];
  const verschmelzer = new Verschmelzer();
  let verschmolzen = 0;
  const start = performance.now();

  for (let i = 0; i <= n; i++) {
    const t = Math.min(dauer - 0.001, i / fps);
    await Promise.all(quellen.map(p => springe(p.video, Math.min(p.video.duration - 0.001, t))));
    if (ctl.abbrechen) break;
    const gesichter = [];
    const erkannt = quellen.map((p, k) => {
      if (t > p.video.duration) return null;   // das zweite Video ist etwas kürzer
      const f = det[k] ? det[k].detect(p.video, t * 1000) : null;
      const e = ges[k] ? ges[k].detect(p.video, t * 1000, f?.q) : null;
      markerSuchen(p, f);
      zeichneOverlay(p, f?.q, f, e);
      gesichter.push([p, e?.gesicht]);
      return f;
    });
    let liste;
    const koerper = quellen.map(koerperAn);
    if (verschmelzen) {
      verschmelzer.bild(1, erkannt[1], t);
      liste = [[P1, verschmelzer.bild(0, erkannt[0], t)]];
      if (verschmelzer.verschmolzen) verschmolzen++;
    } else {
      // jede Körper-Kamera liefert ihrer Figur; zwei für dieselbe Figur ohne Verschmelzen: die erste, die jemanden sieht
      liste = [];
      for (const [k, p] of quellen.entries()) {
        const o = zweite === 'person' ? p : P1;
        if (koerper[k] && erkannt[k] && !liste.some(([x]) => x === o)) liste.push([o, erkannt[k]]);
      }
    }
    // Gesichter: je Figur das größte (alle Bilder dieser Zeit sind gleichzeitig)
    for (const [p, g] of gesichter) gesichtMelden(zweite === 'person' ? p : P1, p, g, t, verschmelzer);
    const besitzerListe = zweite === 'person' ? quellen : [P1];
    for (const o of besitzerListe) {
      const g = o.kandidat?.t === t ? o.kandidat.g : undefined;   // nur ein Gesicht aus genau diesem Bild
      const f = liste.find(([x]) => x === o)?.[1];
      if (f) {
        frames[o.nr].push(bildDaten(t, f, g));
        const roh = markerAuswerten(f, aspekte[o.nr], rolle(o), o.figur.instrumente.greiftLinks(), o.kitBild);
        o.letzterRig = buildRig(filter[o.nr].apply(f.p, t), rigOpts());
        o.figur.setPose(o.letzterRig, extras[o.nr].apply(roh, t));
      } else if (g && !quellen.some((q, k) => koerper[k] && (zweite === 'person' ? q === o : true))) {
        frames[o.nr].push({ t: r3(t), g });   // Figur ohne Körper-Kamera: nur das Gesicht
        if (!o.letzterRig) o.figur.setPose(restPose(rigOpts()));
      }
      if (g) mitGesicht++;
      o.figur.setMimik(mimik(gFilter[o.nr].apply(g, t), gesichtsNamen(), o.gesichtVon?.neutral.werte));
    }
    if (i % 4 === 0) {
      status(`Analyse: ${Math.round((i / n) * 100)} % · ${frames[0].length}${zweite === 'person' ? ` + ${frames[1].length}` : ''} Bilder erkannt` +
        (ges.some(Boolean) ? `, ${mitGesicht} mit Gesicht` : ''));
    }
  }

  S.analyse = null;
  ui.btnAnalyse.textContent = 'Analysieren';
  bedienungSperren(false);
  if (ctl.verwerfen) return;
  if (!frames[0].length && !frames[1].length) {
    status('In diesem Video wurde weder Körper noch Gesicht erkannt.');
    P1.video.controls = S.quelle === 'datei';
    liveStarten(P1);
    return;
  }
  const quelle = S.quelle === 'kamera' ? 'kamera' : 'video';
  takeSetzen(neuerTake({
    quelle, name: S.dateiName, fps, dauer, frames: frames[0], aspect: aspekte[0],
    zweite: zweite === 'person' ? { frames: frames[1], aspect: aspekte[1] } : null, ansichten: verschmelzen ? 2 : 1,
  }), [true, quellen.length > 1]);
  const sek = ((performance.now() - start) / 1000).toFixed(0);
  const mitMarkern = frames[0].filter(f => f.m || f.mb).length;
  const personen = zweite === 'person' ? `${frames[0].length} + ${frames[1].length} Bilder` : `${frames[0].length} Bilder`;
  status(`${ctl.abbrechen ? 'Abgebrochen' : 'Fertig'}: ${personen} aus ${n + 1} erkannt` +
    (ges.some(Boolean) ? `, ${mitGesicht} mit Gesicht` : '') +
    (verschmelzen ? `, davon ${verschmolzen} aus beiden Winkeln verschmolzen` : '') +
    (ui.chkMarker.checked ? `, in ${mitMarkern} Bildern Marker` : '') + ` (${sek} s). Abspielen mit ▶ oder Leertaste.`);
}

// ---------- Fertige Aufnahme (Take) ----------
const instrumentDaten = p => ({
  rolle: p.selRolle.value,   // auch bei ausgeschalteten Band-Funktionen merken
  hand: p.selHand.value,
  kit: { ...p.figur.instrumente.kalib },
  kitBild: { ...p.kitBild },
});

// zweite: { frames, aspect } einer zweiten Person; ansichten = 2: frames sind aus zwei Winkeln verschmolzen
// Gesicht einer Figur für die Aufnahme: Namen der Blendshapes und Ruhegesicht (gemerkt oder aus der Aufnahme)
function gesichtDaten(o, frames) {
  const namen = gesichtsNamen();
  if (!namen || !frames.some(f => f.g)) { for (const f of frames) delete f.g; return null; }
  const quelle = o.gesichtVon;
  return {
    modell: 'mediapipe-face-landmarker',
    namen,
    neutral: quelle?.neutral.fest ? quelle.neutral.werte.map(v => Math.round(v * 100) / 100) : neutralAusFrames(frames),
  };
}

function neuerTake({ quelle, name, fps, dauer, frames, aspect, zweite = null, ansichten = 1 }) {
  // Bilder ohne Körper und ohne Gesicht braucht niemand
  frames = frames.filter(f => f.p || f.g);
  const take = {
    format: FORMAT,
    version: 3,
    erstellt: new Date().toISOString(),
    name,
    quelle,
    fps,
    duration: r3(dauer),
    seitenverhaeltnis: r4(aspect ?? seitenverhaeltnis(P1)),
    instrument: instrumentDaten(P1),
    marker: ui.chkMarker.checked ? { a: S.marker.a, b: S.marker.b, toleranz: +ui.rngToleranz.value } : null,
    punkte: 'mediapipe-pose-33',
    erklaerung: 'frames[].t = Sekunden; p = 33 Weltpunkte [x, y, z, Sichtbarkeit] in Metern um die Hüftmitte ' +
      '(x rechts, y unten, z negativ = zur Kamera); q = 33 Bildpunkte [x, y] von 0 bis 1; ' +
      'm / mb = gefundene Tape-Marker [x, y, Fläche] in Farbe a (Kopf/Sticks) / b (Becken); ' +
      'ansichten = 2: p aus zwei Kamerawinkeln verschmolzen, q2 = Bildpunkte der zweiten Kamera; ' +
      'p und q fehlen, wenn kein Körper erkannt wurde (Nahaufnahme); ' +
      'g = Gesicht { b: Blendshapes 0..1 in der Reihenfolge von gesicht.namen (ARKit-Namen, Left = linke Seite der Person), ' +
      'r: Kopfdrehung als Quaternion [x, y, z, w] (x = linke Seite der Person, y oben, z zur Kamera), k: Gesichtsrahmen [x, y, Breite, Höhe] 0..1 }; ' +
      'gesicht.neutral = Ruhegesicht (Blendshapes), wird beim Übertragen abgezogen; ' +
      'zweite = zweite Person mit eigener Kamera (gleicher Aufbau)',
    frames,
  };
  const g1 = gesichtDaten(P1, frames);
  if (g1) take.gesicht = g1;
  if (ansichten > 1) take.ansichten = ansichten;
  if (zweite) {
    const f2 = zweite.frames.filter(f => f.p || f.g);
    take.zweite = { seitenverhaeltnis: r4(zweite.aspect), instrument: instrumentDaten(P2), frames: f2 };
    const g2 = gesichtDaten(P2, f2);
    if (g2) take.zweite.gesicht = g2;
  }
  return take;
}

// Gesicht zwischen zwei Bildern überblenden (Blendshapes linear, Drehung über die kürzere Richtung)
function gesichtMischen(A, B, k) {
  if (!A || !B) return k < 0.5 ? (A ?? B) : (B ?? A);
  const vz = A.r.reduce((s, v, i) => s + v * B.r[i], 0) < 0 ? -1 : 1;
  const r = A.r.map((v, i) => v + (vz * B.r[i] - v) * k), l = Math.hypot(...r) || 1;
  return { b: A.b.map((v, i) => v + (B.b[i] - v) * k), r: r.map(v => v / l) };
}

function posenBerechnen(p) {
  if (!p) { P.forEach(q => posenBerechnen(q)); return; }
  const d = takeDaten(p);
  p.posen = p.extras = p.rohExtras = null;
  if (d && hatFigur(p)) {
    const filter = new PoseFilter(staerke()), gFilter = new GesichtFilter(staerke());
    let letzte = null;   // ohne Körper bleibt die letzte Haltung stehen (am Anfang: Grundhaltung)
    p.posen = d.frames.map(f => {
      if (f.p) letzte = filter.apply(f.p, f.t);
      return { t: f.t, p: letzte, g: d.gesicht ? gFilter.apply(f.g, f.t) : null };
    });
    // Blickrichtung, Sitzhöhe und Greifhand einmal aus der ganzen Aufnahme
    const mitKoerper = p.posen.filter(f => f.p);
    p.figur.setAnker(mitKoerper.length ? ankerBerechnen(mitKoerper.map(f => buildRig(f.p, rigOpts()))) : null);
    // Marker: Hals- und Stickrichtungen, Beckenbewegung
    const r = rolle(p), aspect = d.seitenverhaeltnis ?? 16 / 9;
    if (r && d.frames.some(f => f.m || f.mb)) {
      const ruhe = beckenRuhe(d.frames, p.kitBild, aspect), greifLinks = p.figur.instrumente.greiftLinks();
      p.rohExtras = d.frames.map(f => (f.p ? markerAuswerten(f, aspect, r, greifLinks, ruhe) : null));
      const ef = new ExtraFilter(staerke());
      p.extras = p.rohExtras.map((e, i) => ef.apply(e, d.frames[i].t));
    }
  }
  toeneBerechnen(p);
}

function instrumentSetzen(p) {
  p.figur.setInstrument(rolle(p), p.selHand.value);
  luftbandOberflaeche(p);
  const d = takeDaten(p);
  if (d) {
    d.instrument = instrumentDaten(p);
    posenBerechnen(p);
  }
  if (S.mode === 'idle') p.figur.setPose(restPose(rigOpts()));
}

// mitVideo: [erste, zweite] – gibt es zu dieser Kamera ein Video?
function takeSetzen(take, mitVideo = [false, false]) {
  // ältere Aufnahmen mit Gesicht, aber ohne Ruhegesicht: aus der Aufnahme selbst schätzen
  for (const d of [take, take.zweite]) if (d?.gesicht && !d.gesicht.neutral) d.gesicht.neutral = neutralAusFrames(d.frames);
  S.take = take;
  S.mode = 'take';
  S.zweite = take.zweite ? 'person' : 'winkel';
  P2.aktiv = !!take.zweite || ((take.ansichten ?? 1) > 1 && !!mitVideo[1]);
  if (P2.aktiv) ui.selFigur2.value = S.zweite === 'person' ? '1' : '0';
  P.forEach((p, i) => { p.mitVideo = p.aktiv && !!mitVideo[i]; });
  for (const p of P) {
    const d = takeDaten(p);
    if (!d) continue;
    const ins = d.instrument ?? {};
    if (ins.rolle !== undefined) p.selRolle.value = ins.rolle;
    if (ins.hand) p.selHand.value = ins.hand;
    p.figur.instrumente.setKit(ins.kit);
    p.kitBild = { ...(ins.kitBild ?? {}) };
  }
  if (take.marker) {
    S.marker.a = take.marker.a;
    S.marker.b = take.marker.b;
    ui.rngToleranz.value = take.marker.toleranz ?? ui.rngToleranz.value;
    farbfelder();
  }
  ansichtAnpassen();
  for (const p of P) {
    p.figur.setInstrument(rolle(p), p.selHand.value);
    luftbandOberflaeche(p);
    const d = takeDaten(p);
    if (d) d.instrument = instrumentDaten(p);
    const v = p.video;
    v.controls = false;
    v.loop = p.nr === 0;     // die zweite läuft im Gleichschritt mit der ersten
    v.muted = p.nr !== 0;    // Ton nur aus dem ersten Video
  }
  posenBerechnen();
  ui.rngZeit.max = take.duration;
  ui.rngZeit.disabled = ui.btnPlay.disabled = ui.btnExport.disabled = false;
  zeitSetzen(0);
}

// Pose zu einer beliebigen Zeit: zwischen den beiden nächsten Bildern überblenden
function poseBei(p, t) {
  const L = p.posen;
  if (!L?.length) return null;
  let lo = 0, hi = L.length - 1;
  if (t <= L[lo].t) return { p: L[lo].p, g: L[lo].g, i: lo };
  if (t >= L[hi].t) return { p: L[hi].p, g: L[hi].g, i: hi };
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m].t <= t) lo = m; else hi = m; }
  const A = L[lo], B = L[hi], spanne = B.t - A.t, k = (t - A.t) / (spanne || 1);
  const i = k < 0.5 ? lo : hi;
  if (spanne > 0.25) return { p: L[i].p, g: L[i].g, i };   // Lücke in der Erkennung: nicht darüber hinweg überblenden
  return {
    p: A.p && B.p ? A.p.map((pa, j) => { const pb = B.p[j]; return [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k, pa[3]]; }) : L[i].p,
    g: gesichtMischen(A.g, B.g, k),
    i,
  };
}

function takeZeit() {
  if (P1.mitVideo) return P1.video.currentTime;
  const u = S.uhr, d = S.take.duration;
  if (!u.laeuft) return u.versatz;
  const t = u.versatz + (performance.now() - u.start) / 1000;
  return d > 0 ? t % d : 0;
}

function zeitSetzen(t) {
  if (P1.mitVideo) P1.video.currentTime = t;
  else { S.uhr.versatz = t; S.uhr.start = performance.now(); }
  if (P2.mitVideo) P2.video.currentTime = Math.min(t, (P2.video.duration || t) - 0.01);
}

function laeuft() { return P1.mitVideo ? !P1.video.paused : S.uhr.laeuft; }

function abspielenUmschalten() {
  if (S.mode !== 'take') return;
  if (P1.mitVideo) {
    if (P1.video.paused) P1.video.play(); else P1.video.pause();
  } else if (S.uhr.laeuft) {
    S.uhr.versatz = takeZeit();
    S.uhr.laeuft = false;
  } else {
    S.uhr.start = performance.now();
    S.uhr.laeuft = true;
  }
}

// Das zweite Video folgt dem ersten (oder der Uhr): gleiche Zeit, gleiches Abspielen
function videoAngleichen(v, t, spielt) {
  if (v.readyState < 1) return;
  const ziel = Math.max(0, Math.min(t, (v.duration || t) - 0.01));
  if (!v.seeking && Math.abs(v.currentTime - ziel) > (spielt ? 0.15 : 0.02)) v.currentTime = ziel;
  if (spielt && v.paused && t < v.duration) v.play().catch(() => {});
  else if (!spielt && !v.paused) v.pause();
}

let ziehen = false;
studio.beiBild = () => {
  if (S.mode !== 'live' && !ui.messung.hidden) ui.messung.hidden = true;
  if (S.mode !== 'take' || !S.take) return;
  const t = takeZeit(), spielt = laeuft();
  for (const p of P) {
    if (!p.aktiv) continue;
    if (p.nr > 0 && p.mitVideo) videoAngleichen(p.video, t, spielt);
    if (!p.posen) {
      // Zweiter Winkel: keine eigene Figur, aber die Einblendung in seinem Video
      if (p.mitVideo && zweiWinkel()) { const r = poseBei(P1, t); zeichneOverlay(p, r && S.take.frames[r.i].q2, null); }
      continue;
    }
    const r = poseBei(p, t);
    if (r) {
      const d = takeDaten(p);
      p.figur.setPose(r.p ? buildRig(r.p, rigOpts()) : restPose(rigOpts()), p.extras?.[r.i] ?? null);
      p.figur.setMimik(d.gesicht ? mimik(r.g, d.gesicht.namen, d.gesicht.neutral) : null);
      p.takeGesicht = r.g;
      if (p.mitVideo) { const f = d.frames[r.i]; zeichneOverlay(p, f.q, f, f.g ? { gesicht: f.g } : null); }
    }
    // Luftband: alle Töne spielen, die seit dem letzten Bild dran waren (nicht beim Springen)
    if (p.toene) {
      const vorher = p.tonZeit;
      p.tonZeit = t;
      const neu = spielt && vorher !== null && t > vorher && t - vorher < 0.5
        ? p.toene.ereignisse.filter(e => e.t > vorher && e.t <= t) : [];
      luftbandZeigen(p, { ereignisse: neu, zone: r ? p.toene.zonen[r.i] : null });
    }
  }
  if (!ziehen) ui.rngZeit.value = t;
  const text = `${zeitText(t)} / ${zeitText(S.take.duration)}`;
  if (ui.zeit.textContent !== text) ui.zeit.textContent = text;
  const knopf = spielt ? '❚❚' : '▶';
  if (ui.btnPlay.textContent !== knopf) ui.btnPlay.textContent = knopf;
};

// ---------- Klicks ins Video: Farbe wählen, Schlagzeug einmessen ----------
function klickModusSetzen(modus) {
  S.klickModus = modus;
  for (const p of P) p.rahmen.classList.toggle('klickbar', !!modus && (modus !== 'einmessen' || S.einmessen?.p === p));
  ui.btnFarbeA.classList.toggle('aktiv', modus === 'a');
  ui.btnFarbeB.classList.toggle('aktiv', modus === 'b');
  P1.video.controls = !modus && S.mode === 'live' && S.quelle === 'datei';
  if (modus) for (const p of P) if (!p.video.srcObject) p.video.pause();   // Kamera läuft weiter, Videos halten an
}

// Klickposition → Bildkoordinaten (0..1), berücksichtigt Seitenränder und Spiegelung
function videoKoordinaten(p, e) {
  const v = p.video, r = p.rahmen.getBoundingClientRect(), vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return null;
  const massstab = Math.min(r.width / vw, r.height / vh), w = vw * massstab, h = vh * massstab;
  let u = (e.clientX - r.left - (r.width - w) / 2) / w;
  const vv = (e.clientY - r.top - (r.height - h) / 2) / h;
  if (u < 0 || u > 1 || vv < 0 || vv > 1) return null;
  if (p.chkSpiegeln.checked) u = 1 - u;
  return [u, vv];
}

function farbeWaehlen(welche) {
  if (!P.some(p => p.aktiv && p.video.videoWidth)) { status('Erst die Kamera starten oder ein Video öffnen.'); return; }
  if (S.einmessen) einmessenBeenden();
  if (S.klickModus === welche) { klickModusSetzen(null); status('Farbwahl abgebrochen.'); return; }
  klickModusSetzen(welche);
  status(welche === 'a'
    ? 'Klicke im Video auf das Tape am Gitarrenkopf oder an einer Stickspitze.'
    : 'Klicke im Video auf das Tape an einem Becken.');
}

function farbeUebernehmen(p, welche, [u, v]) {
  klickModusSetzen(null);
  const farbe = sucher.farbeBei(p.video, u, v);
  if (!farbe) return;
  if (farbe.hsv[1] < 0.3 || farbe.hsv[2] < 0.2) {
    status('Diese Stelle ist kaum farbig. Gut eignet sich knalliges Tape: neongrün, pink oder orange.');
    return;
  }
  S.marker[welche] = farbe;
  farbfelder();
  ui.chkMarker.checked = true;
  status(S.mode === 'take'
    ? 'Farbe übernommen. Analysiere das Video noch einmal, damit die Marker ausgewertet werden.'
    : 'Farbe übernommen. Gefundene Marker werden im Video eingekreist.');
}

// Das aktuelle Videobild einer Kamera mit erkannter Pose (zum Einmessen)
function aktuellesBild(p) {
  const aspect = seitenverhaeltnis(p);
  if (S.mode === 'live') return p.letzteErkennung ? { f: p.letzteErkennung, aspect } : null;
  if (S.mode === 'take' && p.mitVideo && p.posen) {
    const r = poseBei(p, takeZeit()), f = r && takeDaten(p).frames[r.i];
    return f?.q ? { f, aspect } : null;
  }
  return null;
}

// Wer sitzt am Schlagzeug? (Bei zwei Personen wird in dessen Video eingemessen.)
const schlagzeuger = () => P.find(p => hatFigur(p) && rolle(p) === 'schlagzeug') ?? null;

function einmessenUmschalten() {
  if (S.einmessen) { einmessenWeiter(); return; }   // „Überspringen“
  const p = schlagzeuger();
  if (!p) { status('Wähle zuerst als Instrument „Schlagzeug“.'); return; }
  if (!aktuellesBild(p)) { status('Zum Einmessen braucht es ein Videobild, in dem der Schlagzeuger erkannt wird.'); return; }
  S.einmessen = { schritt: 0, p };
  klickModusSetzen('einmessen');
  ui.btnEinmessen.textContent = 'Überspringen ›';
  einmessenFrage();
}

function einmessenFrage() {
  const { schritt, p } = S.einmessen, [, wo] = KIT_TEILE[schritt];
  const welches = hatFigur(P2) ? ` von Person ${p.nr + 1}` : '';
  status(`Einmessen ${schritt + 1}/${KIT_TEILE.length}: Klicke im Video${welches} auf ${wo}. „Überspringen“ lässt das Teil am Standardplatz, Esc beendet.`);
}

function einmessenKlick(uv) {
  const { p } = S.einmessen, [name] = KIT_TEILE[S.einmessen.schritt];
  const b = aktuellesBild(p);
  if (!b) { status('In diesem Bild ist gerade keine Person erkannt. Kurz warten oder ein anderes Bild wählen.'); return; }
  const ins = p.figur.instrumente, j = buildRig(b.f.p, rigOpts());
  const kandidaten = trommelKandidaten(b.f.p, b.f.q, uv[0], uv[1], b.aspect, j.pelvis[1], ins.standardAbstand(name));
  if (!kandidaten) { status('Die Person ist in diesem Bild nicht deutlich genug zu sehen.'); return; }
  ins.einmessen(name, kandidaten);
  p.kitBild[name] = uv.map(r4);
  einmessenWeiter();
}

function einmessenWeiter() {
  S.einmessen.schritt++;
  kitGeaendert(S.einmessen.p);
  if (S.einmessen.schritt >= KIT_TEILE.length) einmessenBeenden(true);
  else einmessenFrage();
}

function einmessenBeenden(fertig = false) {
  const p = S.einmessen?.p;
  S.einmessen = null;
  klickModusSetzen(null);
  ui.btnEinmessen.textContent = 'Schlagzeug einmessen';
  if (fertig && p) {
    const n = Object.keys(p.figur.instrumente.kalib).length;
    status(`Schlagzeug eingemessen: ${n} von ${KIT_TEILE.length} Teilen an ihrem echten Platz. ↺ stellt die Standardaufstellung wieder her.`);
  }
}

function kitGeaendert(p) {
  const d = takeDaten(p);
  if (d) {
    d.instrument = instrumentDaten(p);
    posenBerechnen(p);
  }
  p.figur.neuZeichnen();
  if (S.mode === 'live') zeichneOverlay(p, p.letzteErkennung?.q, p.letzteErkennung);
}

function kitZuruecksetzen() {
  const p = schlagzeuger() ?? P1;
  p.figur.instrumente.setKit({});
  p.kitBild = {};
  kitGeaendert(p);
  status('Das Schlagzeug steht wieder in der Standardaufstellung.');
}

// ---------- Luftband: Bewegung → Töne (jede Figur spielt ihr eigenes Instrument) ----------
const TEILNAMEN = {
  snare: 'Snare', hihat: 'Hi-Hat', pedal: 'Hi-Hat-Pedal', tom1: 'Tom 1', tom2: 'Tom 2',
  standtom: 'Standtom', crash: 'Crash', ride: 'Ride', bassdrum: 'Bassdrum',
};
const INSTRUMENTE = { schlagzeug: 'Schlagzeug', gitarre: 'Gitarre', bass: 'Bass' };
const luftbandAn = p => ui.chkLuftband.checked && hatFigur(p) && !!rolle(p);
const akkordListe = () => ui.selAkkorde.value.split(' ');
// Füße zählen nur, wenn sie gut zu sehen sind – sonst rät die Erkennung und es poltert
const fuesseSichtbar = p => [27, 28, 29, 30, 31, 32].every(i => (p[i][3] ?? 1) > 0.4);
const mitToenen = () => P.filter(p => p.toene?.ereignisse.length);

function luftbandHinweis() {
  const figuren = P.filter(hatFigur), rollen = new Set(figuren.map(rolle).filter(Boolean));
  if (!rollen.size) return 'Luftband: Wähle zuerst ein Instrument.';
  const wie = new Set([...rollen].map(r => (r === 'schlagzeug'
    ? 'Schlagzeug: Sticks schnell nach unten schlagen und abstoppen, die Fußspitze tippt die Bassdrum, der andere Fuß die Hi-Hat.'
    : `Gitarre/Bass: Mit der Anschlaghand schnell über die Saiten ziehen. Die Greifhand wählt den Akkord: ${akkordListe().join(' – ')} vom Kopf bis zum Korpus.`)));
  const text = [...wie].join(' ');
  if (!figuren.some(p => p.toene)) return 'Luftband: ' + text;
  const n = figuren.reduce((s, p) => s + (p.toene?.ereignisse.length ?? 0), 0);
  return `Luftband: ${n} Töne in der Aufnahme. ▶ spielt sie ab, „Tonspur WAV“ und „MIDI“ speichern sie. ${text}`;
}

// Sichtbare Teile: Zonen am Hals, Anzeige über der 3D-Ansicht (Person 1 links, Person 2 rechts)
function luftbandOberflaeche(p) {
  const an = luftbandAn(p);
  p.luftband.zuruecksetzen();
  p.figur.instrumente.setLuftband(an);
  p.figur.instrumente.setZone(null);
  p.hud.replaceChildren();
  p.hud.hidden = !an;
  p.hud.dataset.zone = '';
  if (!an) return;
  const namen = rolle(p) === 'schlagzeug' ? [''] : akkordListe();
  for (const [i, name] of namen.entries()) {
    const s = document.createElement('span');
    s.textContent = name;
    if (name) s.title = `Zone ${i + 1}`;
    p.hud.append(s);
  }
}

function aufblitzen(el, text) {
  if (!el) return;
  if (text !== undefined) el.textContent = text;
  el.classList.remove('schlag');
  void el.offsetWidth;   // Animation neu starten
  el.classList.add('schlag');
}

function luftbandZeigen(p, { ereignisse, zone }) {
  for (const e of ereignisse) { klang.spielen(e); p.figur.instrumente.anschlagen(e); }
  if (p.hud.hidden) return;
  const letzte = ereignisse.at(-1);
  if (rolle(p) === 'schlagzeug') {
    if (letzte) aufblitzen(p.hud.firstChild, TEILNAMEN[letzte.name] + (letzte.offen ? ' offen' : ''));
    return;
  }
  if (p.hud.dataset.zone !== String(zone)) {
    p.hud.dataset.zone = String(zone);
    [...p.hud.children].forEach((s, i) => s.classList.toggle('aktiv', i === zone));
    p.figur.instrumente.setZone(zone);
  }
  if (letzte) aufblitzen(p.hud.children[zone ?? 0]);
}

// Für eine fertige Aufnahme alle Töne vorab bestimmen: exakt und unabhängig vom Abspieltempo
function toeneBerechnen(p) {
  p.toene = null;
  p.tonZeit = null;
  const d = takeDaten(p);
  if (p.posen && d && luftbandAn(p)) {
    const lb = new Luftband(), ins = p.figur.instrumente, ereignisse = [], zonen = [];
    lb.setAkkorde(akkordListe());
    lb.setEmpfindlichkeit(+ui.rngEmpfindlich.value);
    const filter = luftFilter(), extras = luftExtraFilter();
    d.frames.forEach((f, i) => {
      if (!f.p) { zonen.push(null); return; }   // nur Gesicht: kein Ton
      const j = buildRig(filter.apply(f.p, f.t), rigOpts());
      ins.update(j, p.rohExtras ? extras.apply(p.rohExtras[i], f.t) : null, false);
      const r = lb.schritt(f.t, ins.messpunkte(j), fuesseSichtbar(f.p));
      for (const e of r.ereignisse) ereignisse.push({ ...e, t: e.t ?? f.t });
      zonen.push(r.zone);
    });
    ereignisse.sort((a, b) => a.t - b.t);
    p.figur.neuZeichnen();
    p.toene = { ereignisse, zonen };
  }
  ui.btnTonspur.disabled = ui.btnMidi.disabled = !mitToenen().length;
}

function luftbandUmschalten() {
  if (ui.chkLuftband.checked) {
    try {
      klang.setKlang(ui.selKlang.value);
      klang.start();
    } catch (err) {
      console.error(err);
      status('Der Browser lässt keinen Ton zu: ' + err.message);
    }
  }
  luftbandEinstellen();
  status(ui.chkLuftband.checked ? luftbandHinweis() : 'Luftband aus.');
}

function luftbandEinstellen() {
  klang.vorbereiten(akkordListe());
  for (const p of P) {
    p.luftband.setAkkorde(akkordListe());
    p.luftband.setEmpfindlichkeit(+ui.rngEmpfindlich.value);
    luftbandOberflaeche(p);
    toeneBerechnen(p);
    p.figur.neuZeichnen();
  }
}

const dateiStamm = () => (S.take?.name || 'aufnahme').replace(/\.[^.]+$/, '');

async function tonspurSpeichern() {
  const mit = mitToenen();
  if (!mit.length) return;
  const ereignisse = mit.flatMap(p => p.toene.ereignisse);
  ui.btnTonspur.disabled = true;
  status('Tonspur wird erzeugt …');
  try {
    herunterladen(await tonspurRendern(ereignisse, S.take.duration, ui.selKlang.value), dateiStamm() + '.luftband.wav');
    status(`Tonspur gespeichert: ${ereignisse.length} Töne${mit.length > 1 ? ' beider Personen' : ''}. ` +
      'Sie beginnt bei 0:00 wie das Video und passt im Schnittprogramm genau darunter.');
  } catch (err) {
    console.error(err);
    status('Tonspur fehlgeschlagen: ' + err.message);
  }
  ui.btnTonspur.disabled = false;
}

function midiSpeichern() {
  const mit = mitToenen();
  if (!mit.length) return;
  const spuren = mit.map(p => ({
    ereignisse: p.toene.ereignisse, rolle: rolle(p),
    titel: mit.length > 1 ? `${INSTRUMENTE[rolle(p)]} (Person ${p.nr + 1})` : undefined,
  }));
  herunterladen(midiErzeugen(spuren, { name: dateiStamm(), klang: ui.selKlang.value }), dateiStamm() + '.mid');
  const n = spuren.reduce((s, sp) => s + sp.ereignisse.length, 0);
  status(`MIDI gespeichert: ${n} Töne bei 120 BPM` + (spuren.length > 1 ? `, eine Spur je Person` : '') +
    (spuren.some(sp => sp.rolle === 'schlagzeug') ? ', Schlagzeug auf Kanal 10 (General MIDI).' : '.') +
    ' Im Musikprogramm lässt sich jeder Klang darauf legen.');
}

// ---------- Speichern und Laden ----------
function herunterladen(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportieren() {
  if (!S.take) return;
  herunterladen(new Blob([JSON.stringify(S.take)], { type: 'application/json' }), dateiStamm() + '.take.json');
}

async function importieren(datei) {
  try {
    const take = JSON.parse(await datei.text());
    if (take.format !== FORMAT || !Array.isArray(take.frames) || !(take.frames.length || take.zweite?.frames?.length)) {
      // (Bilder dürfen nur ein Gesicht enthalten; Version 1 und 2 laden weiter)
      throw new Error('keine Bewegungsdatei aus diesem Studio');
    }
    stoppeAlles();
    takeEntfernen();
    P1.video.removeAttribute('src');
    P1.video.load();
    S.quelle = 'import';
    ui.btnAufnahme.disabled = ui.btnAnalyse.disabled = true;
    for (const p of P) zeigeVideo(p, false, 'Zu dieser Bewegungsdatei gibt es kein Video.');
    takeSetzen(take, [false, false]);
    const posen = (take.zweite ? `${take.frames.length} + ${take.zweite.frames.length} Bilder (zwei Personen)` : `${take.frames.length} Bilder`) +
      (take.gesicht || take.zweite?.gesicht ? ' mit Gesicht' : '');
    status(`${datei.name}: ${zeitText(take.duration)}, ${posen} geladen.`);
  } catch (err) {
    status('Import fehlgeschlagen: ' + err.message);
  }
}

// ---------- Bedienung ----------
farbfelder();
S.zweite = zweiteModus();
ui.btnKamera.onclick = kameraStarten;
ui.btnKamera2.onclick = zweiteKameraUmschalten;

// ---------- Einstellungen (rechte Spalte mit Reitern) ----------
function einstellungenZeigen(an) {
  ui.einstellungen.hidden = !an;
  ui.buehne.classList.toggle('mitEinstellungen', an);
  ui.btnEinstellungen.setAttribute('aria-expanded', String(an));
  merken('strichfiguren-einstellungen-offen', an ? '1' : '');
}
function reiterZeigen(name) {
  document.querySelectorAll('[data-reiter]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.reiter === name)));
  document.querySelectorAll('[data-seite]').forEach(s => { s.hidden = s.dataset.seite !== name; });
  merken('strichfiguren-reiter', name);
}
ui.btnEinstellungen.onclick = () => einstellungenZeigen(ui.einstellungen.hidden);
ui.btnEinstellungenZu.onclick = () => einstellungenZeigen(false);
document.querySelectorAll('[data-reiter]').forEach(b => { b.onclick = () => reiterZeigen(b.dataset.reiter); });
reiterZeigen(gemerkt('strichfiguren-reiter') || 'kamera');
einstellungenZeigen(!!gemerkt('strichfiguren-einstellungen-offen'));

// Band-Funktionen: an einer Stelle an- und ausschalten
function bandUmschalten() {
  merken(BAND_SPEICHER, bandAn() ? '1' : '');
  ui.bandBereich.hidden = !bandAn();
  ui.bandAus.hidden = bandAn();
  if (!bandAn()) { if (S.einmessen) einmessenBeenden(); klickModusSetzen(null); }
  for (const p of P) instrumentSetzen(p);
  if (S.mode !== 'live') for (const p of P) zeichneOverlay(p, p.letzteErkennung?.q ?? null, null);
  status(bandAn() ? 'Band-Funktionen an: Instrumente, Tape-Marker und Luftband unter Einstellungen → Band.' : 'Band-Funktionen aus.');
}
ui.chkBand.checked = !!gemerkt(BAND_SPEICHER);
ui.bandBereich.hidden = !bandAn();
ui.bandAus.hidden = bandAn();
ui.chkBand.onchange = bandUmschalten;

// Kamera-Einstellungen: Aufgabe, Figur, Spiegeln, Ruhegesicht – gemerkt je Gerät
for (const p of P) {
  p.selAufgabe.onchange = () => kameraAufgabeGeaendert(p);
  p.chkSpiegeln.onchange = () => { spiegeln(); if (p.stream) geraetEinstellungenSpeichern(p); };
  p.btnNeutral.onclick = () => neutralMerken(p);
  p.btnNeutral.ondblclick = () => {
    p.neutral.reset();
    neutralAnzeigen(p);
    if (p.stream) geraetEinstellungenSpeichern(p);
    status(`Ruhegesicht von Kamera ${p.nr + 1} wird wieder automatisch geschätzt.`);
  };
}
ui.selFigur2.onchange = () => kameraAufgabeGeaendert(P2);

// Neutral merken: live das aktuelle Gesicht dieser Kamera, in einer Aufnahme das Gesicht an der aktuellen Stelle
function neutralMerken(p) {
  const o = besitzer(p), d = takeDaten(o);
  if (S.mode === 'take' && d?.gesicht) {
    if (!o.takeGesicht) { status('An dieser Stelle der Aufnahme ist kein Gesicht.'); return; }
    d.gesicht.neutral = o.takeGesicht.b.map(v => Math.round(v * 100) / 100);
    status(`Ruhegesicht für Figur ${o.nr + 1} dieser Aufnahme gemerkt (wird mit exportiert).`);
    return;
  }
  const k = o.kandidat;
  if (!k || k.p !== p || performance.now() / 1000 - k.t > 1) {
    status(`Kamera ${p.nr + 1} sieht gerade kein Gesicht. Kamera starten, entspannt hineinschauen und noch einmal klicken.`);
    return;
  }
  p.neutral.merken(o.liveGesichtFilter.letztes?.b ?? k.g.b);
  neutralAnzeigen(p);
  if (p.stream) geraetEinstellungenSpeichern(p);
  status(`Ruhegesicht für ${kameraName(p)} gemerkt. Ab jetzt zählt nur, was davon abweicht.`);
}
ui.rngMimik.oninput = () => { if (S.mode === 'take') studio.beiBild?.(); };
for (const p of P) p.selKamera.onchange = () => kameraWechseln(p);
navigator.mediaDevices?.addEventListener?.('devicechange', kamerasAuflisten);   // iPhone kommt oder geht
kamerasAuflisten();
ui.dateiVideo.onchange = () => { const f = ui.dateiVideo.files[0]; ui.dateiVideo.value = ''; if (f) videoOeffnen(f); };
ui.btnAufnahme.onclick = aufnahmeUmschalten;
ui.btnAnalyse.onclick = analysieren;
ui.selModell.onchange = () => {
  if (S.mode === 'live') for (const p of P.filter(q => q.aktiv)) detektor(p).catch(err => status('Modell nicht geladen: ' + err.message));
};

ui.btnFarbeA.onclick = () => farbeWaehlen('a');
ui.btnFarbeB.onclick = () => farbeWaehlen('b');
ui.btnEinmessen.onclick = einmessenUmschalten;
ui.btnKitZurueck.onclick = kitZuruecksetzen;
for (const p of P) {
  p.rahmen.addEventListener('click', e => {
    if (!S.klickModus || (S.klickModus === 'einmessen' && S.einmessen?.p !== p)) return;
    const uv = videoKoordinaten(p, e);
    if (!uv) return;
    e.preventDefault();
    if (S.klickModus === 'einmessen') einmessenKlick(uv);
    else farbeUebernehmen(p, S.klickModus, uv);
  });
}

ui.chkDrehen.onchange = () => studio.setDrehen(ui.chkDrehen.checked);
ui.selStil.onchange = () => studio.setStil(ui.selStil.value);
// Aussehen der Figuren (Strichmännchen oder Knetfigur), gemerkt im Browser
ui.selForm.value = gemerkt('strichfiguren-form') || 'strich';
studio.setForm(ui.selForm.value);
ui.selForm.onchange = () => { studio.setForm(ui.selForm.value); merken('strichfiguren-form', ui.selForm.value); };
ui.chkBoden.onchange = () => {
  if (S.mode === 'idle') for (const p of P) p.figur.setPose(restPose(rigOpts()));
  else posenBerechnen();
};
// Haltung: Sitzen = Beine fest, nur der Oberkörper aus dem Video; gemerkt im Browser
ui.selHaltung.onchange = () => { merken('strichfiguren-haltung', ui.selHaltung.value); ui.chkBoden.onchange(); };
for (const p of P) p.selRolle.onchange = p.selHand.onchange = () => instrumentSetzen(p);
ui.rngGlaettung.oninput = () => {
  for (const p of P) {
    p.liveFilter.setStaerke(staerke());
    p.liveGesichtFilter.setStaerke(staerke());
    p.liveExtras = new ExtraFilter(staerke());
  }
  posenBerechnen();
};
document.querySelectorAll('[data-ansicht]').forEach(b => { b.onclick = () => studio.setAnsicht(b.dataset.ansicht); });

ui.btnPlay.onclick = abspielenUmschalten;
ui.rngZeit.addEventListener('pointerdown', () => { ziehen = true; });
addEventListener('pointerup', () => { ziehen = false; });
ui.rngZeit.oninput = () => zeitSetzen(+ui.rngZeit.value);
ui.btnExport.onclick = exportieren;
ui.chkLuftband.onchange = luftbandUmschalten;
ui.selAkkorde.onchange = ui.rngEmpfindlich.onchange = () => { luftbandEinstellen(); if (P.some(luftbandAn)) status(luftbandHinweis()); };
ui.selKlang.onchange = () => klang.setKlang(ui.selKlang.value);
ui.btnTonspur.onclick = tonspurSpeichern;
ui.btnMidi.onclick = midiSpeichern;
ui.dateiJson.onchange = () => { const f = ui.dateiJson.files[0]; ui.dateiJson.value = ''; if (f) importieren(f); };

// Live-Stream an Blender: nach jedem Bild Gelenke, Kopf und Mimik aller sichtbaren Figuren
const BLENDER_TEXTE = {
  aus: 'aus', verbinde: 'verbinde …', verbunden: 'verbunden – Blender bekommt die Bewegung',
  wartet: 'wartet auf Blender (Addon gestartet?) – versuche es alle 2 s', fehler: 'Adresse ungültig (z. B. ws://localhost:8765)',
};
const blender = new BlenderStream({ beiStatus: z => { ui.blenderInfo.textContent = BLENDER_TEXTE[z] ?? z; } });
studio.nachBild = s => {
  if (!blender.verbunden) return;
  const aufnahme = S.mode === 'take' && S.take;
  blender.bild(s, aufnahme ? takeZeit() : performance.now() / 1000, aufnahme ? 'aufnahme' : S.mode === 'idle' ? 'ruhe' : 'live', !!aufnahme && laeuft());
};
ui.txtBlender.value = gemerkt('blender-adresse') || ui.txtBlender.value;
ui.chkBlender.onchange = () => {
  if (ui.chkBlender.checked) { merken('blender-adresse', ui.txtBlender.value.trim()); blender.starten(ui.txtBlender.value.trim()); }
  else blender.stoppen();
};
ui.txtBlender.onchange = () => { if (ui.chkBlender.checked) { blender.stoppen(); ui.chkBlender.onchange(); } };

addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (S.einmessen) { einmessenBeenden(); status('Einmessen beendet.'); }
    else if (S.klickModus) { klickModusSetzen(null); status('Farbwahl abgebrochen.'); }
    return;
  }
  if (e.code !== 'Space' || e.target.closest?.('button, select, input:not([type="range"])')) return;
  e.preventDefault();
  abspielenUmschalten();
});

// Zum Ausprobieren in der Browser-Konsole
window.studio = {
  S, P, studio, sucher, klang, takeSetzen, neuerTake, detektor, gesichtErkennung, mimik, liveStarten, liveBild, posenBerechnen, kitGeaendert,
  geraetEinstellungenLaden, geraetEinstellungenSpeichern,
  toeneBerechnen, midiErzeugen, tonspurRendern, ansichtAnpassen, Verschmelzer, kamerasPruefen, zweiteWiederAus, blender,
};
