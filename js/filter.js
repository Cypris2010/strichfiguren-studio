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

// Glättet eine Richtung [x, y, z] über die Zeit. Fehlt sie kurz (Marker verdeckt),
// wird die letzte bis zu `halten` Sekunden weiterverwendet.
export class RichtungsFilter {
  constructor(staerke = 5, halten = 0.3) { this.staerke = staerke; this.halten = halten; this.reset(); }
  reset() { this.filter = null; this.letzte = null; this.letzteZeit = -Infinity; }
  apply(v, t) {
    if (!v) return t - this.letzteZeit <= this.halten ? this.letzte : null;
    if (t - this.letzteZeit > this.halten) this.filter = null;   // nach einer Lücke neu anfangen
    let w = v;
    if (this.staerke > 0) {
      const c = minCutoff(this.staerke);
      this.filter ??= [new OneEuro(c, BETA), new OneEuro(c, BETA), new OneEuro(c, BETA)];
      w = v.map((x, k) => this.filter[k].filter(x, t));
    }
    const l = Math.hypot(w[0], w[1], w[2]) || 1;
    this.letzte = [w[0] / l, w[1] / l, w[2] / l];
    this.letzteZeit = t;
    return this.letzte;
  }
}

// Glättet eine einzelne Zahl (Kippwinkel eines Beckens), mit kurzem Halten bei Lücken.
// Becken schwingen schnell, darum nur halb so stark wie die Pose.
class WertFilter {
  constructor(staerke = 5, halten = 0.3) { this.staerke = staerke / 2; this.halten = halten; this.f = null; this.letzte = null; this.letzteZeit = -Infinity; }
  apply(x, t) {
    if (x === null || x === undefined) return t - this.letzteZeit <= this.halten ? this.letzte : null;
    if (t - this.letzteZeit > this.halten) this.f = null;
    this.f ??= new OneEuro(minCutoff(this.staerke), BETA * 4);
    this.letzte = this.staerke > 0 ? this.f.filter(x, t) : x;
    this.letzteZeit = t;
    return this.letzte;
  }
}

// Glättet alles, was aus Markern kommt: Gitarrenhals, beide Sticks, Becken
export class ExtraFilter {
  constructor(staerke = 5) {
    this.staerke = staerke;
    this.hals = new RichtungsFilter(staerke);
    this.stoecke = [new RichtungsFilter(staerke), new RichtungsFilter(staerke)];
    this.becken = {};
  }
  apply(e, t) {
    const becken = {};
    for (const name of new Set([...Object.keys(this.becken), ...Object.keys(e?.becken ?? {})])) {
      this.becken[name] ??= new WertFilter(this.staerke);
      becken[name] = this.becken[name].apply(e?.becken?.[name] ?? null, t);
    }
    return {
      hals: this.hals.apply(e?.hals ?? null, t),
      stoecke: this.stoecke.map((f, k) => f.apply(e?.stoecke?.[k] ?? null, t)),
      becken,
    };
  }
}

// Filtert alle 33 Punkte (x, y, z) einer Pose; die Sichtbarkeit bleibt unverändert.
// beta / dCutoff höher = folgt schnellen Bewegungen früher (fürs Luftband)
export class PoseFilter {
  constructor(staerke = 5, { beta = BETA, dCutoff = 1 } = {}) { this.beta = beta; this.dCutoff = dCutoff; this.setStaerke(staerke); }
  setStaerke(staerke) { this.staerke = staerke; this.reset(); }
  reset() { this.filter = null; }
  apply(p, t) {
    if (this.staerke <= 0) return p;
    const c = minCutoff(this.staerke);
    this.filter ??= p.map(() => [0, 1, 2].map(() => new OneEuro(c, this.beta, this.dCutoff)));
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
