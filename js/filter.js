// One-Euro-Filter: glättet Zittern bei langsamer Bewegung stark,
// lässt schnelle Bewegungen (Schlagzeug, Gitarrenanschlag) aber fast ungebremst durch.
// https://gery.casiez.net/1euro/

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

class OneEuro {
  constructor(minCutoff, beta, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.t = null;
  }
  filter(x, t) {
    if (this.t === null || t <= this.t) {   // erstes Bild oder Zeitsprung zurück
      this.t = t; this.x = x; this.dx = 0;
      return x;
    }
    const dt = t - this.t;
    this.t = t;
    this.dx += alpha(this.dCutoff, dt) * ((x - this.x) / dt - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
}

// Stärke 0 = aus, 10 = sehr ruhig
const minCutoff = staerke => 6 / (1 + 0.9 * staerke);
const BETA = 0.8;

// Filtert alle 33 Punkte (x, y, z) einer Pose; die Sichtbarkeit bleibt unverändert.
export class PoseFilter {
  constructor(staerke = 5) { this.setStaerke(staerke); }
  setStaerke(staerke) { this.staerke = staerke; this.reset(); }
  reset() { this.filter = null; }
  apply(p, t) {
    if (this.staerke <= 0) return p;
    const c = minCutoff(this.staerke);
    this.filter ??= p.map(() => [new OneEuro(c, BETA), new OneEuro(c, BETA), new OneEuro(c, BETA)]);
    return p.map((pt, i) => {
      const f = this.filter[i];
      return [f[0].filter(pt[0], t), f[1].filter(pt[1], t), f[2].filter(pt[2], t), pt[3]];
    });
  }
}

// Glättet Gesichtsdaten { b: Blendshapes, r: Quaternion } und hält das letzte Gesicht
// kurz fest, wenn die Erkennung für ein paar Bilder aussetzt (Blinzeln, Hand vorm Gesicht).
const HALTEN = 0.3;   // Sekunden
export class GesichtFilter {
  constructor(staerke = 5) { this.setStaerke(staerke); }
  setStaerke(staerke) { this.staerke = staerke; this.reset(); }
  reset() { this.fb = this.fr = this.letztes = this.rVorher = null; this.letzteT = -Infinity; }
  apply(g, t) {
    if (!g) return t >= this.letzteT && t - this.letzteT < HALTEN ? this.letztes : null;
    // q und −q sind dieselbe Drehung: beim Vorzeichen des letzten Bildes bleiben, sonst springt der Filter
    let r = g.r;
    if (this.rVorher && r[0] * this.rVorher[0] + r[1] * this.rVorher[1] + r[2] * this.rVorher[2] + r[3] * this.rVorher[3] < 0) r = r.map(v => -v);
    this.rVorher = r;
    let b = g.b;
    if (this.staerke > 0) {
      // Mimik ist schnell (Singen, Blinzeln): schwächer glätten als den Körper
      const c = minCutoff(this.staerke) * 2;
      if (this.fb?.length !== b.length) this.fb = b.map(() => new OneEuro(c, BETA * 2));
      this.fr ??= r.map(() => new OneEuro(c, BETA));
      b = b.map((v, i) => this.fb[i].filter(v, t));
      r = r.map((v, i) => this.fr[i].filter(v, t));
    }
    const l = Math.hypot(...r) || 1;
    this.letztes = { ...g, b, r: r.map(v => v / l) };
    this.letzteT = t;
    return this.letztes;
  }
}
