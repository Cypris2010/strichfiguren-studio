// Luftband: aus Bewegung werden Töne.
//
//   Schlagzeug  Stick oder Hand saust nach unten und stoppt abrupt → Schlag auf das Teil, auf das
//               die Stickspitze zeigt; die Lautstärke kommt aus der Geschwindigkeit.
//               Die Fußspitze tippt → Bassdrum (Schlagfuß) bzw. Hi-Hat-Pedal (anderer Fuß).
//               Ist die Fußspitze an der Hi-Hat angehoben, klingt die Hi-Hat offen.
//   Gitarre     Die Anschlaghand zieht schnell über die Saiten → Akkord, abwärts oder aufwärts.
//   Bass        genauso, gespielt wird der Grundton.
//               Wo die Greifhand am Hals liegt, wählt einen von vier Akkorden (Zone 1 am Kopf).
//
// Eingabe pro Bild: instrumente.messpunkte(j), alles in Figur-Koordinaten (Meter, y nach oben).
// Die Pose dafür wird nur ganz leicht geglättet: Jede Glättung verzögert den Schlag und verschiebt
// den tiefsten Punkt – und damit, welches Teil getroffen wird.
import { ZONEN } from './instrumente.js';
import { PoseFilter, ExtraFilter } from './filter.js';

export const luftFilter = () => new PoseFilter(1.5, { beta: 3, dCutoff: 3 });
export const luftExtraFilter = () => new ExtraFilter(1);

const LUECKE = 0.2;           // größerer Abstand zwischen zwei Bildern: neu anfangen
const MAX_WINKEL = 50 * Math.PI / 180;   // so weit darf die Stickspitze am Teil vorbei zeigen
const BREMSZEIT = 0.075;      // ein Schlag stoppt abrupt; wer langsamer abbremst, senkt nur den Arm (s)
const HIHAT_OFFEN = 0.09;     // ab dieser Höhe der Fußspitze (m) ist die Hi-Hat offen
// Schwellen: Mindestgeschwindigkeit (m/s) und Mindestweg (m) einer Bewegung. Sie liegen klar über dem
// Zittern der Erkennung (gemessen: bis etwa 0,3 m/s und 4 cm in zwei Bildern bei den Füßen).
const SCHWELLE = {
  hand:  { v: 0.8, weg: 0.05 },    // Sticks ohne Tape: Bewegung der Hand
  tape:  { v: 1.1, weg: 0.06 },    // Sticks mit Tape: Bewegung der Spitze
  fuss:  { v: 0.6, weg: 0.045 },
  saite: { v: 0.8, weg: 0.045 },   // Anschlag: Weg über die letzten zwei Bilder
};

const staerke = (geschw, voll) => Math.min(1, Math.max(0.1, geschw / voll));

// Verfolgt die Höhe y eines Punktes und meldet einen Schlag, wenn eine schnelle Abwärtsbewegung
// abrupt endet. ort: wo der Schlag landet (die Stickspitze); gemeldet werden Ort und Zeit des
// tiefsten Moments.
function abwaerts(z, t, y, ort, vMin, wegMin, bremszeit) {
  if (z.t === undefined || t <= z.t || t - z.t > LUECKE) {
    Object.assign(z, { t, y, ab: false });
    return null;
  }
  const dt = t - z.t, v = (y - z.y) / dt, vorher = z.y;
  z.t = t;
  z.y = y;
  if (z.ab && y < z.tief) Object.assign(z, { tief: y, tiefT: t, tiefOrt: ort.clone() });
  if (z.ab && -v >= 0.7 * z.spitze) z.schnellT = t;   // zuletzt noch (fast) volle Fahrt
  if (v < -vMin) {
    if (!z.ab) Object.assign(z, { ab: true, oben: vorher, tief: y, tiefT: t, tiefOrt: ort.clone(), spitze: 0, schnellT: t });
    if (-v > z.spitze) { z.spitze = -v; z.schnellT = t; }
    return null;
  }
  if (z.ab && v > -Math.max(vMin * 0.35, z.spitze * 0.3)) {   // stark abgebremst
    z.ab = false;
    // Bremszeit: mindestens gut zwei Bilder, sonst fallen langsame Kameras durch
    if (z.oben - z.tief < wegMin || t - z.schnellT > Math.max(bremszeit, 2.5 * dt)) return null;
    return { geschw: z.spitze, ort: z.tiefOrt, t: z.tiefT };
  }
  return null;
}

export class Luftband {
  constructor() {
    this.akkorde = ['G', 'D', 'Em', 'C'];
    this.faktor = 1;
    this.zuruecksetzen();
  }

  setAkkorde(liste) { this.akkorde = liste; }
  // 1 = nur kräftige Bewegungen zählen, 10 = schon kleine
  setEmpfindlichkeit(e) { this.faktor = 2 ** ((5 - e) / 4); }
  zuruecksetzen() { this.punkte = {}; this.zone = null; this.hihatOffen = false; }
  punkt(name) { return (this.punkte[name] ??= {}); }

  // t: Sekunden, m: Messpunkte, fuesse: sind die Füße sicher erkannt?
  // → { ereignisse: [{ t, art, name | akkord, richtung, staerke, offen }], zone }
  //   t ist bei Schlägen der tiefste Moment, kann also ein, zwei Bilder zurückliegen
  schritt(t, m, fuesse = true) {
    if (!m) return { ereignisse: [], zone: null };
    if (m.rolle === 'schlagzeug') return { ereignisse: this.schlagzeug(t, m, fuesse), zone: null };
    const ereignisse = this.saiten(t, m);
    return { ereignisse, zone: this.zone };
  }

  schlagzeug(t, m, fuesse) {
    const f = this.faktor, aus = [];
    if (fuesse) {
      this.hihatOffen = m.hihat.y > HIHAT_OFFEN;
      const { v, weg } = SCHWELLE.fuss;
      const b = abwaerts(this.punkt('bassFuss'), t, m.bass.y, m.bass, v * f, weg * f, BREMSZEIT / f);
      if (b) aus.push({ t: b.t, art: 'trommel', name: 'bassdrum', staerke: staerke(b.geschw, 1.5 * f) });
      const h = abwaerts(this.punkt('hihatFuss'), t, m.hihat.y, m.hihat, v * f, weg * f, BREMSZEIT / f);
      if (h) aus.push({ t: h.t, art: 'trommel', name: 'pedal', staerke: staerke(h.geschw, 1.5 * f) });
    } else {
      this.hihatOffen = false;
    }

    // Ohne Einmessen liegen die Ziele relativ zur Körperhöhe (wer steht, spielt weiter oben)
    const ziele = m.teile.map(z => ({ ...z, y: z.p.y + m.versatz }));
    // Mit Tape zählt die Bewegung der Stickspitze. Ohne Tape die der Hand: Die geschätzte Spitze
    // wackelt mehr, weil sich jeder kleine Fehler über die ganze Sticklänge verstärkt.
    m.spitzen.forEach((spitze, k) => {
      const mitTape = m.mitMarker[k], y = mitTape ? spitze.y : m.haende[k].y, sw = mitTape ? SCHWELLE.tape : SCHWELLE.hand;
      const s = abwaerts(this.punkt('stock' + k), t, y, spitze, sw.v * f, sw.weg * f, BREMSZEIT / f);
      if (!s) return;
      const name = naechstesTeil(ziele, s.ort, m.mitte);
      if (!name) return;
      const e = { t: s.t, art: 'trommel', name, staerke: staerke(s.geschw, (mitTape ? 5 : 3) * f) };
      if (name === 'hihat') e.offen = this.hihatOffen;
      aus.push(e);
    });
    return aus;
  }

  saiten(t, m) {
    // Akkordzone: 0 am Kopf … 3 am Korpus, mit etwas Hysterese gegen Flackern an den Grenzen
    const lage = (1 - (m.greif.x - m.griff.start) / m.griff.laenge) * ZONEN;
    const roh = Math.min(ZONEN - 1, Math.max(0, Math.floor(lage)));
    if (this.zone === null || Math.abs(lage - (this.zone + 0.5)) > 0.62) this.zone = roh;
    const akkord = this.akkorde[this.zone] ?? this.akkorde[0];

    // Anschlag: Geschwindigkeit der Hand quer zu den Saiten, gemessen relativ zum Korpus
    const z = this.punkt('anschlag'), q = m.hand.dot(m.quer);
    if (z.t === undefined || t <= z.t || t - z.t > LUECKE) {
      Object.assign(z, { t, q, richtung: 0, verlauf: [q] });
      return [];
    }
    const v = (q - z.q) / (t - z.t), vMin = SCHWELLE.saite.v * this.faktor, wegMin = SCHWELLE.saite.weg * this.faktor;
    z.t = t;
    z.q = q;
    z.verlauf = [...z.verlauf, q].slice(-3);
    const weg = q - z.verlauf[0];
    if (Math.abs(v) < vMin * 0.4) { z.richtung = 0; return []; }   // Hand steht: nächster Anschlag in jede Richtung
    const richtung = v <= -vMin && weg <= -wegMin ? -1 : v >= vMin && weg >= wegMin ? 1 : 0;   // -1 = abwärts
    if (!richtung || richtung === z.richtung) return [];
    z.richtung = richtung;
    if (m.hand.length() > 0.5) return [];   // Hand ist gerade nicht an der Gitarre
    const s = staerke(Math.abs(v), 4 * vMin);
    return m.rolle === 'bass'
      ? [{ t, art: 'bass', akkord, staerke: s }]
      : [{ t, art: 'akkord', akkord, richtung, staerke: s }];
  }
}

// Welches Teil ist gemeint? Entscheidend ist die Richtung vom Oberkörper zur Stickspitze, nicht der
// Abstand: Ohne Tape ist die Spitze nur geschätzt und reicht oft zu weit – die Richtung stimmt trotzdem.
function naechstesTeil(ziele, spitze, mitte) {
  const richtung = spitze.clone().sub(mitte);
  let beste = null, bw = MAX_WINKEL;
  for (const z of ziele) {
    const w = richtung.angleTo(z.p.clone().setY(z.y).sub(mitte));
    if (w < bw) { bw = w; beste = z.name; }
  }
  return beste;
}
