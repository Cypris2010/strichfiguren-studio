// Zwei Kameras, eine Person: aus beiden Ansichten eine genauere Pose.
//
// MediaPipe liefert je Kamera 33 Weltpunkte in Metern um die Hüftmitte, ausgerichtet nach dieser
// Kamera. Quer zur Blickrichtung (x, y) sind sie gut, die Tiefe z ist nur geschätzt. Zwei Kameras
// aus verschiedenen Winkeln ergänzen sich: Was für die eine Tiefe ist, sieht die andere von der Seite.
//   1. Winkel zwischen den Kameras (um die Senkrechte) aus den Posen beider bestimmen – über viele
//      Bilder gemittelt, denn die Stative stehen ja fest. Wohin die Person schaut, spielt keine Rolle.
//   2. Pose der zweiten Kamera in die Ausrichtung der ersten drehen.
//   3. Jeden Punkt mitteln: Jede Kamera zählt quer zu ihrer Blickrichtung voll, in ihrer Tiefe wenig;
//      schlecht sichtbare Punkte zählen weniger.
// Ergebnis ist ein Bild wie von Kamera 1 (p in deren Ausrichtung, q und Marker aus ihrem Bild),
// zusätzlich q2 = Bildpunkte der zweiten Kamera für die Einblendung in deren Video.

const PUNKTE = Array.from({ length: 22 }, (_, i) => 11 + i);   // Rumpf, Arme, Beine – das Gesicht ist zu klein
const GEDAECHTNIS = 0.99;   // je Bildpaar bleibt so viel vom bisherigen Winkel (≈ die letzten 100 Bilder)
const TIEFE = 0.1;          // Gewicht der Tiefe gegenüber der Bildebene (die Tiefe ist gut dreimal ungenauer)
const SICHER = 0.6;         // ab dieser Übereinstimmung beider Kameras wird verschmolzen (0 … 1)
const MIN_PAARE = 15;       // so viele gemeinsame Bilder (eine halbe Sekunde) braucht es mindestens für den Winkel
const FRISCH = 0.1;         // so alt (s) darf das Bild der anderen Kamera zum Verschmelzen höchstens sein
const GLEICHZEITIG = 0.05;  // zum Lernen des Winkels müssen beide Bilder so dicht beieinander liegen
const ABWEICHUNG = 0.25;    // passen beide Posen nach dem Drehen im Mittel schlechter (m), zählt nur Kamera 1

const r4 = v => Math.round(v * 1e4) / 1e4;
const sicht = p => Math.max(0.05, p[3] ?? 1);

export class Verschmelzer {
  constructor() { this.reset(); }
  reset() { this.A = 0; this.B = 0; this.W = 0; this.paare = 0; this.letzte = [null, null]; this.verschmolzen = false; }

  // Kamera 2 gegenüber Kamera 1, im Bogenmaß
  get winkel() { return Math.atan2(this.B, this.A); }
  // Wie einig sind sich beide Kameras über den Winkel? 1 = völlig
  get sicherheit() { return this.W > 0 ? Math.hypot(this.A, this.B) / this.W : 0; }
  get bereit() { return this.paare >= MIN_PAARE && this.sicherheit >= SICHER; }

  // Ein Bild einer Kamera: k = 0 oder 1, f = { p, q, m, mb } oder null (niemand erkannt), t in Sekunden.
  // → verschmolzenes Bild oder null. Kamera 1 gibt den Takt vor, solange sie die Person sieht.
  //   Sieht sie niemanden, springt Kamera 2 ein: gedreht, sobald der Winkel bekannt ist, sonst so,
  //   wie sie die Person sieht (dann schaut die Figur eben in deren Richtung – besser als gar keine).
  bild(k, f, t) {
    this.letzte[k] = f ? { f, t } : null;
    const [a, b] = this.letzte;
    const frisch = (x, grenze) => x && Math.abs(t - x.t) <= grenze;
    if (k === 0) {
      this.verschmolzen = false;
      if (!f) return null;
      if (!frisch(b, FRISCH)) return { ...f };
      if (frisch(b, GLEICHZEITIG)) this.lernen(f.p, b.f.p);
      const p = this.bereit ? this.mitteln(f.p, b.f.p) : null;
      this.verschmolzen = !!p;
      return { ...f, p: p ?? f.p, q2: b.f.q };
    }
    if (frisch(a, FRISCH) || !f) return null;
    this.verschmolzen = false;
    return { p: this.bereit ? this.drehen(f.p) : f.p, q: null, q2: f.q };
  }

  // Winkel aus einem Bildpaar dazulernen (nur waagrecht: x und z)
  lernen(p1, p2) {
    let a = 0, b = 0, w = 0;
    for (const i of PUNKTE) {
      const [x1, , z1] = p1[i], [x2, , z2] = p2[i];
      const g = Math.min(sicht(p1[i]), sicht(p2[i]));
      a += g * (x1 * x2 + z1 * z2);
      b += g * (x1 * z2 - z1 * x2);
      w += g * Math.hypot(x1, z1) * Math.hypot(x2, z2);
    }
    // Ein Bild, in dem sich die Kameras uneins sind (z. B. links und rechts vertauscht), zählt nicht
    if (!w || Math.hypot(a, b) / w < 0.5) return;
    this.A = this.A * GEDAECHTNIS + a;
    this.B = this.B * GEDAECHTNIS + b;
    this.W = this.W * GEDAECHTNIS + w;
    this.paare = this.paare * GEDAECHTNIS + 1;
  }

  // Punkt von Kamera 2 in die Ausrichtung von Kamera 1
  drehen(p2) {
    const c = Math.cos(this.winkel), s = Math.sin(this.winkel);
    return p2.map(([x, y, z, v]) => [r4(c * x + s * z), y, r4(-s * x + c * z), v]);
  }

  mitteln(p1, p2) {
    const c = Math.cos(this.winkel), s = Math.sin(this.winkel);
    const gedreht = this.drehen(p2);
    let abweichung = 0, n = 0;
    for (const i of PUNKTE) {
      abweichung += Math.hypot(p1[i][0] - gedreht[i][0], p1[i][1] - gedreht[i][1], p1[i][2] - gedreht[i][2]);
      n++;
    }
    if (abweichung / n > ABWEICHUNG) return null;
    // Blickrichtung (x, z) jeder Kamera in der Ausrichtung von Kamera 1; dort zählt sie wenig
    const tiefen = [[0, 1], [s, c]];
    return p1.map((a, i) => {
      const b = gedreht[i], va = sicht(a), vb = sicht(b);
      // Gewichte als 2×2-Matrix je Kamera: v · (Einheit − (1 − TIEFE) · d·dᵀ)
      let m00 = 0, m01 = 0, m11 = 0, r0 = 0, r1 = 0;
      [[a, va, tiefen[0]], [b, vb, tiefen[1]]].forEach(([pt, v, [dx, dz]]) => {
        const k = 1 - TIEFE;
        const w00 = v * (1 - k * dx * dx), w01 = -v * k * dx * dz, w11 = v * (1 - k * dz * dz);
        m00 += w00; m01 += w01; m11 += w11;
        r0 += w00 * pt[0] + w01 * pt[2];
        r1 += w01 * pt[0] + w11 * pt[2];
      });
      const det = m00 * m11 - m01 * m01;
      const x = (m11 * r0 - m01 * r1) / det, z = (m00 * r1 - m01 * r0) / det;
      const y = (va * a[1] + vb * b[1]) / (va + vb);
      return [r4(x), r4(y), r4(z), Math.max(a[3] ?? 1, b[3] ?? 1)];
    });
  }
}
