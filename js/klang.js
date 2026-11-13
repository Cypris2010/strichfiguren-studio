// Klangerzeugung für das Luftband – alles synthetisch mit Web Audio, ohne Samples.
//   Schlagzeug   Oszillatoren und Rauschen, wie bei einem Drumcomputer
//   Gitarre/Bass gezupfte Saite (Karplus-Strong), die Gitarre wahlweise verzerrt
// Dieselben Funktionen spielen live (AudioContext) und rendern eine Tonspur (OfflineAudioContext).

// Griffe: Bund je Saite von der tiefen E- bis zur hohen e-Saite, null = nicht anschlagen
export const GRIFFE = {
  G: [3, 2, 0, 0, 0, 3], D: [null, null, 0, 2, 3, 2], Em: [0, 2, 2, 0, 0, 0], C: [null, 3, 2, 0, 1, 0],
  Am: [null, 0, 2, 2, 1, 0], F: [1, 3, 3, 2, 1, 1], E: [0, 2, 2, 1, 0, 0], A: [null, 0, 2, 2, 2, 0],
  Dm: [null, null, 0, 2, 3, 1],
  E5: [0, 2, 2, null, null, null], A5: [null, 0, 2, 2, null, null], D5: [null, null, 0, 2, 3, null],
  G5: [3, 5, 5, null, null, null], C5: [null, 3, 5, 5, null, null],
};
const LEERSAITEN = [40, 45, 50, 55, 59, 64];   // MIDI-Nummern von E2 A2 D3 G3 B3 E4
const TONNAMEN = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };
export const hz = midi => 440 * 2 ** ((midi - 69) / 12);

// Töne eines Anschlags als [Saite, MIDI-Nummer]. richtung -1 = abwärts (tief → hoch), +1 = aufwärts (nur die hohen Saiten)
export function akkordToene(name, richtung = -1) {
  const griff = GRIFFE[name] ?? GRIFFE.G;
  const toene = griff.flatMap((bund, saite) => (bund === null ? [] : [[saite, LEERSAITEN[saite] + bund]]));
  return richtung > 0 ? toene.slice(-4).reverse() : toene;
}

// Grundton für den Bass, in der tiefen Lage E1 … D#2
export function bassTon(name) {
  const ton = TONNAMEN[name[0]] ?? 7, vorzeichen = name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0;
  return 28 + ((ton + vorzeichen - 4 + 24) % 12);
}

// ---------- Signalweg ----------
const PANORAMA = { bassdrum: 0, snare: 0.05, hihat: -0.3, pedal: -0.3, tom1: -0.1, tom2: 0.12, standtom: 0.3, crash: -0.45, ride: 0.4 };

function filter(ctx, typ, frequenz, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = typ;
  f.frequency.value = frequenz;
  f.Q.value = q;
  return f;
}

function verzerrerKurve(n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(2.5 * x) / Math.tanh(2.5); }
  return c;
}

function kette(ctx, art) {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const komp = ctx.createDynamicsCompressor();
  komp.threshold.value = -12;
  komp.ratio.value = 4;
  komp.attack.value = 0.003;
  komp.release.value = 0.15;
  master.connect(komp).connect(ctx.destination);

  const rauschen = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = rauschen.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const trommeln = {};
  for (const [name, pan] of Object.entries(PANORAMA)) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    trommeln[name] = p;
  }

  // Gitarre: clean oder durch Verzerrer und Lautsprecher-Tiefpass
  const gitarre = ctx.createGain(), clean = ctx.createGain(), verzerrt = ctx.createGain();
  gitarre.connect(clean).connect(filter(ctx, 'lowpass', 6500)).connect(master);
  const vor = ctx.createGain(), form = ctx.createWaveShaper(), nach = ctx.createGain();
  vor.gain.value = 6;
  form.curve = verzerrerKurve();
  form.oversample = '4x';
  nach.gain.value = 0.22;
  gitarre.connect(verzerrt).connect(filter(ctx, 'highpass', 110)).connect(vor).connect(form)
    .connect(filter(ctx, 'lowpass', 3200, 0.9)).connect(nach).connect(master);

  const bass = ctx.createGain();
  bass.connect(filter(ctx, 'lowpass', 1400)).connect(master);

  const k = { ctx, master, rauschen, trommeln, gitarre, bass, wege: { clean, verzerrt }, klingt: {} };
  klangSetzen(k, art);
  return k;
}

function klangSetzen(k, art) {
  k.wege.clean.gain.value = art === 'verzerrt' ? 0 : 1;
  k.wege.verzerrt.gain.value = art === 'verzerrt' ? 1 : 0;
}

// ---------- Schlagzeug ----------
// Lautstärke-Hüllkurve: in 2 ms anschwellen, dann exponentiell abklingen
function huelle(ctx, t, spitze, abkling, ziel) {
  const g = ctx.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, spitze), t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + abkling);
  g.connect(ziel);
  return g;
}

function rauschenSpielen(k, t, dauer, ziel) {
  const s = k.ctx.createBufferSource();
  s.buffer = k.rauschen;
  s.loop = true;
  s.connect(ziel);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dauer);
}

function oszillator(k, typ, f0, f1, gleiten, t, dauer, ziel) {
  const o = k.ctx.createOscillator();
  o.type = typ;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + gleiten);
  o.connect(ziel);
  o.start(t);
  o.stop(t + dauer);
}

// Metallischer Klang: sechs Rechteckschwingungen mit unharmonischen Abständen
const METALL = [2, 3, 4.16, 5.43, 6.79, 8.21];
function becken(k, t, laut, abkling, ziel, typ, frequenz, mitRauschen = true) {
  const f = filter(k.ctx, typ, frequenz, typ === 'bandpass' ? 0.8 : 0.7);
  f.connect(huelle(k.ctx, t, laut, abkling, ziel));
  const m = k.ctx.createGain();
  m.gain.value = 0.25;
  m.connect(f);
  for (const r of METALL) oszillator(k, 'square', 40 * r, 40 * r, 0, t, abkling, m);
  if (mitRauschen) rauschenSpielen(k, t, abkling, f);
}

const tom = frequenz => (k, t, v, z) => {
  oszillator(k, 'sine', frequenz * 1.35, frequenz, 0.09, t, 0.7, huelle(k.ctx, t, 1.0 * v, 0.55, z));
  const tp = filter(k.ctx, 'lowpass', 2000);
  tp.connect(huelle(k.ctx, t, 0.2 * v, 0.05, z));
  rauschenSpielen(k, t, 0.06, tp);
};

const TROMMELN = {
  bassdrum(k, t, v, z) {
    oszillator(k, 'sine', 160, 45, 0.11, t, 0.6, huelle(k.ctx, t, 1.4 * v, 0.5, z));
    const klick = filter(k.ctx, 'lowpass', 2500);
    klick.connect(huelle(k.ctx, t, 0.5 * v, 0.025, z));
    rauschenSpielen(k, t, 0.03, klick);
  },
  snare(k, t, v, z) {
    oszillator(k, 'triangle', 230, 175, 0.06, t, 0.2, huelle(k.ctx, t, 0.7 * v, 0.13, z));
    const hp = filter(k.ctx, 'highpass', 1400);
    hp.connect(huelle(k.ctx, t, 0.9 * v, 0.22, z));
    rauschenSpielen(k, t, 0.25, hp);
  },
  tom1: tom(210),
  tom2: tom(165),
  standtom: tom(105),
  hihat(k, t, v, z, e) { becken(k, t, 0.5 * v, e.offen ? 0.9 : 0.06, z, 'highpass', 7500); },
  pedal(k, t, v, z) { becken(k, t, 0.3 * v, 0.04, z, 'highpass', 6000); },
  crash(k, t, v, z) { becken(k, t, 0.55 * v, 2.8, z, 'highpass', 4500); },
  ride(k, t, v, z) {
    becken(k, t, 1.4 * v, 1.8, z, 'bandpass', 5200, false);
    oszillator(k, 'sine', 3100, 3100, 0, t, 0.8, huelle(k.ctx, t, 0.12 * v, 0.8, z));
  },
};

// ---------- Saiten (Karplus-Strong) ----------
// Ein kurzer Rauschstoß läuft in einer Schleife von der Länge einer Schwingung und wird dabei
// immer weicher – das klingt wie eine gezupfte Saite.
const GITARRE = { art: 'g', dauer: 3, hell: 0.55, nachklang: 3.5 };
const BASS = { art: 'b', dauer: 3, hell: 0.25, nachklang: 4 };
const puffer = new Map();
let variante = 0;

function saitenPuffer(ctx, freq, o) {
  variante = (variante + 1) % 2;   // zwei Varianten je Ton, damit es nicht maschinell klingt
  const schluessel = `${o.art}|${ctx.sampleRate}|${freq.toFixed(2)}|${variante}`;
  let b = puffer.get(schluessel);
  if (b) return b;
  const sr = ctx.sampleRate, n = Math.round(o.dauer * sr), N = Math.max(2, Math.round(sr / freq - 0.5));
  const ring = new Float32Array(N);
  let tp = 0, summe = 0, gross = 0;
  for (let i = 0; i < N; i++) { tp += o.hell * (Math.random() * 2 - 1 - tp); ring[i] = tp; summe += tp; }
  for (let i = 0; i < N; i++) { ring[i] -= summe / N; gross = Math.max(gross, Math.abs(ring[i])); }
  for (let i = 0; i < N; i++) ring[i] /= gross || 1;
  const halt = 10 ** (-3 / (o.nachklang * freq));   // nach `nachklang` Sekunden 60 dB leiser
  b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  for (let i = 0, j = 0; i < n; i++) {
    const j2 = j + 1 === N ? 0 : j + 1, a = ring[j];
    d[i] = a;
    ring[j] = halt * 0.5 * (a + ring[j2]);
    j = j2;
  }
  const aus = Math.min(n, Math.round(0.05 * sr));
  for (let i = 0; i < aus; i++) d[n - 1 - i] *= i / aus;
  puffer.set(schluessel, b);
  return b;
}

// Klingt auf dieser Saite noch etwas, wird es abgedämpft – wie bei einer echten Saite
function daempfen(k, saite, t) {
  const alt = k.klingt[saite];
  if (!alt) return;
  alt.g.gain.setTargetAtTime(0, t, 0.012);
  alt.s.stop(t + 0.12);
  k.klingt[saite] = null;
}

function zupfen(k, ziel, b, t, laut, saite) {
  const s = k.ctx.createBufferSource(), g = k.ctx.createGain();
  s.buffer = b;
  g.gain.value = laut;
  s.connect(g).connect(ziel);
  daempfen(k, saite, t);
  s.start(t);
  k.klingt[saite] = { s, g };
}

function akkordSpielen(k, t, e, v) {
  const toene = akkordToene(e.akkord, e.richtung);
  if (e.richtung <= 0) {   // beim Abschlag schweigen Saiten, die nicht zum Griff gehören
    for (let saite = 0; saite < 6; saite++) if (!toene.some(([s]) => s === saite)) daempfen(k, saite, t);
  }
  const abstand = 0.016 - 0.009 * v;   // kräftiger Anschlag: Saiten dichter hintereinander
  const laut = (e.richtung > 0 ? 0.7 : 1) * v * 0.32;
  toene.forEach(([saite, midi], n) => zupfen(k, k.gitarre, saitenPuffer(k.ctx, hz(midi), GITARRE), t + n * abstand, laut, saite));
}

function ereignisSpielen(k, t, e) {
  const v = 0.25 + 0.75 * Math.min(1, Math.max(0, e.staerke ?? 0.7));
  if (e.art === 'trommel') TROMMELN[e.name]?.(k, t, v, k.trommeln[e.name] ?? k.master, e);
  else if (e.art === 'akkord') akkordSpielen(k, t, e, v);
  else if (e.art === 'bass') zupfen(k, k.bass, saitenPuffer(k.ctx, hz(bassTon(e.akkord)), BASS), t, v * 0.9, 'bass');
}

// ---------- Live ----------
export class Klang {
  constructor() { this.k = null; this.art = 'clean'; }
  get bereit() { return this.k?.ctx.state === 'running'; }

  // Muss aus einem Klick heraus aufgerufen werden, sonst bleibt der Browser stumm.
  // Nicht auf resume() warten: ohne Klick bleibt das Versprechen offen, bis jemand klickt.
  start() {
    if (!this.k) this.k = kette(new AudioContext({ latencyHint: 'interactive' }), this.art);
    if (this.k.ctx.state !== 'running') this.k.ctx.resume().catch(() => {});
  }

  setKlang(art) { this.art = art; if (this.k) klangSetzen(this.k, art); }

  // Saitenklänge vorab berechnen, damit der erste Anschlag nicht hakt
  vorbereiten(akkorde) {
    if (!this.k) return;
    for (const name of akkorde) {
      for (let n = 0; n < 2; n++) {
        for (const [, midi] of akkordToene(name)) saitenPuffer(this.k.ctx, hz(midi), GITARRE);
        saitenPuffer(this.k.ctx, hz(bassTon(name)), BASS);
      }
    }
  }

  spielen(e) { if (this.bereit) ereignisSpielen(this.k, this.k.ctx.currentTime + 0.003, e); }
}

// ---------- Tonspur ----------
// ereignisse: [{ t (s), art, … }] → WAV-Datei, beginnt bei t = 0
export async function tonspurRendern(ereignisse, dauer, art) {
  const sr = 48000, ctx = new OfflineAudioContext(2, Math.ceil((dauer + 3) * sr), sr);
  const k = kette(ctx, art);
  for (const e of [...ereignisse].sort((a, b) => a.t - b.t)) ereignisSpielen(k, e.t, e);
  return wav(await ctx.startRendering());
}

function wav(b) {
  const kanaele = b.numberOfChannels, n = b.length, bytes = n * kanaele * 2;
  const d = new DataView(new ArrayBuffer(44 + bytes));
  const text = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); d.setUint32(4, 36 + bytes, true); text(8, 'WAVE');
  text(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, kanaele, true);
  d.setUint32(24, b.sampleRate, true); d.setUint32(28, b.sampleRate * kanaele * 2, true);
  d.setUint16(32, kanaele * 2, true); d.setUint16(34, 16, true);
  text(36, 'data'); d.setUint32(40, bytes, true);
  const daten = Array.from({ length: kanaele }, (_, c) => b.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) {
    for (let c = 0; c < kanaele; c++, o += 2) {
      const s = Math.max(-1, Math.min(1, daten[c][i]));
      d.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return new Blob([d], { type: 'audio/wav' });
}
