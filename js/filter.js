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
