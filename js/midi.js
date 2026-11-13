// MIDI-Datei aus den Luftband-Ereignissen eines Takes (Standard MIDI File, Format 1), eine Spur je Person.
//   Schlagzeug  Kanal 10 mit der General-MIDI-Belegung (Bassdrum 36, Snare 38, Hi-Hat 42/46/44 …)
//   Gitarre     Kanal 1, jeder Anschlag als Akkord mit leicht versetzten Saiten (zweite Gitarre Kanal 3)
//   Bass        Kanal 2, Grundton
// Tempo 120 BPM: Die Zeiten stimmen in Sekunden genau mit dem Video überein; das Musikprogramm
// kann die Spur danach auf das echte Songtempo ziehen.
import { akkordToene, bassTon } from './klang.js';

const PPQ = 480, TEMPO = 500000;                     // 480 Ticks pro Viertel, 500 000 µs pro Viertel = 120 BPM
const TICKS_PRO_SEKUNDE = PPQ * 1e6 / TEMPO;
export const GM_SCHLAGZEUG = {
  bassdrum: 36, snare: 38, hihat: 42, hihatOffen: 46, pedal: 44,
  tom1: 50, tom2: 47, standtom: 43, crash: 49, ride: 51,
};
const PROGRAMM = { clean: 27, verzerrt: 30, bass: 33 };   // GM: Clean Guitar, Distortion Guitar, Finger Bass
const NACHKLANG = 2;   // Saiten klingen höchstens so lange (s), sonst bis zum nächsten Anschlag

const vlq = n => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (typ, s) => { const b = [...new TextEncoder().encode(s)]; return [0xff, typ, ...vlq(b.length), ...b]; };

// meldungen: [Tick, [Bytes …]] → Spur-Block
function spur(meldungen) {
  meldungen.sort((a, b) => a[0] - b[0] || a[2] - b[2]);   // gleiche Zeit: Note-Off vor Note-On
  const daten = [];
  let zuletzt = 0;
  for (const [tick, bytes] of meldungen) {
    daten.push(...vlq(tick - zuletzt), ...bytes);
    zuletzt = tick;
  }
  daten.push(0, 0xff, 0x2f, 0);   // Spurende
  return [...'MTrk'].map(c => c.charCodeAt(0)).concat(u32(daten.length), daten);
}

const TITEL = { schlagzeug: 'Schlagzeug', gitarre: 'Gitarre', bass: 'Bass' };

// Noten einer Person: [Start (s), Ende (s), Note, Anschlagstärke]
function notenVon(ereignisse, rolle) {
  const anschlag = e => Math.max(1, Math.min(127, Math.round(30 + 97 * (e.staerke ?? 0.7))));
  const noten = [];
  const liste = [...ereignisse].sort((a, b) => a.t - b.t);
  if (rolle === 'schlagzeug') {
    for (const e of liste) {
      const note = e.name === 'hihat' && e.offen ? GM_SCHLAGZEUG.hihatOffen : GM_SCHLAGZEUG[e.name];
      if (note) noten.push([e.t, e.t + 0.1, note, anschlag(e)]);
    }
    return noten;
  }
  liste.forEach((e, i) => {
    const ende = Math.min(liste[i + 1]?.t ?? Infinity, e.t + NACHKLANG);
    if (rolle === 'bass') { noten.push([e.t, ende, bassTon(e.akkord), anschlag(e)]); return; }
    const leiser = e.richtung > 0 ? 15 : 0;
    akkordToene(e.akkord, e.richtung).forEach(([, note], n) => {
      const start = e.t + n * 0.012;
      noten.push([start, Math.max(start + 0.03, ende), note, Math.max(1, anschlag(e) - leiser)]);
    });
  });
  return noten;
}

// spuren: [{ ereignisse: [{ t, art, name | akkord, richtung, staerke, offen }], rolle, titel? }]
//   rolle: 'schlagzeug' | 'gitarre' | 'bass' – jede Person bekommt ihre eigene Spur.
//   Schlagzeug immer auf Kanal 10; Gitarre bevorzugt Kanal 1, Bass Kanal 2, weitere auf den nächsten freien.
export function midiErzeugen(spuren, { name = 'Luftband', klang = 'clean' } = {}) {
  const tick = s => Math.max(0, Math.round(s * TICKS_PRO_SEKUNDE));
  // Spur 1: Tempo, Takt, Name
  const bloecke = [spur([
    [0, text(0x03, name), 0],
    [0, [0xff, 0x51, 0x03, (TEMPO >> 16) & 255, (TEMPO >> 8) & 255, TEMPO & 255], 0],
    [0, [0xff, 0x58, 0x04, 4, 2, 24, 8], 0],   // 4/4
  ])];
  const belegt = new Set([9]);
  for (const { ereignisse, rolle, titel } of spuren) {
    let kanal = 9;
    if (rolle !== 'schlagzeug') {
      kanal = rolle === 'bass' ? 1 : 0;
      while (belegt.has(kanal) && kanal < 15) kanal++;
      belegt.add(kanal);
    }
    const meldungen = [[0, text(0x03, titel ?? TITEL[rolle] ?? 'Luftband'), 0]];
    if (rolle !== 'schlagzeug') meldungen.push([0, [0xc0 | kanal, rolle === 'bass' ? PROGRAMM.bass : PROGRAMM[klang] ?? PROGRAMM.clean], 0]);
    for (const [start, ende, note, v] of notenVon(ereignisse, rolle)) {
      meldungen.push([tick(start), [0x90 | kanal, note, v], 2]);
      meldungen.push([Math.max(tick(start) + 1, tick(ende)), [0x80 | kanal, note, 0], 1]);
    }
    bloecke.push(spur(meldungen));
  }
  const n = bloecke.length;
  const kopf = [...'MThd'].map(c => c.charCodeAt(0)).concat(u32(6), [0, 1, n >> 8, n & 255, PPQ >> 8, PPQ & 255]);
  return new Blob([new Uint8Array([...kopf, ...bloecke.flat()])], { type: 'audio/midi' });
}
