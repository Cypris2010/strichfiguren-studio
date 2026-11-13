// Live-Stream der Bewegungsdaten an Blender (Addon blender/strichfiguren_live.py).
//
// Das Addon startet in Blender einen kleinen WebSocket-Server (Standard: ws://localhost:8765). Läuft Blender
// auf einem anderen Rechner im Netzwerk, trägt man dessen Adresse ein (z. B. 192.168.1.23 – „ws://“ und der
// Port 8765 werden ergänzt). Ein Kennwort geht als ?k=… mit. Das Studio
// schickt nach jedem gezeichneten Bild, höchstens 60-mal pro Sekunde, was die Figuren gerade tun:
//
//   { format: 'strichfiguren-live', version: 1, t, modus, spielt, figuren: [{ nr, gelenke: { pelvis: [x,y,z], … },
//     kopf: [x,y,z,w], mimik: { augeL, …, laechelnR } | null }] }
//
// Koordinaten wie in three.js (Meter, y nach oben, Figur schaut nach +z), aber schon mit der Lage der
// Figur auf der Bühne (zwei Figuren stehen nebeneinander) und dem Spiegeln verrechnet. Das Addon dreht
// sie in Blenders System (z nach oben). t: Zeit in der Aufnahme beim Abspielen, sonst Sekunden seit Start.

const FORMAT = 'strichfiguren-live';
const MIN_ABSTAND = 1000 / 60;   // ms
const r4 = v => Math.round(v * 1e4) / 1e4;

// „192.168.1.23“, „mac-studio.local:9000“ oder „ws://…“ → vollständige ws://-Adresse (wirft bei Unsinn)
export function adresseNormalisieren(eingabe, kennwort = '') {
  let a = eingabe.trim();
  if (!/^wss?:\/\//i.test(a)) a = 'ws://' + a;
  const url = new URL(a);
  if (!url.hostname) throw new Error('keine Adresse');
  if (!url.port && url.protocol === 'ws:') url.port = '8765';
  if (kennwort) url.searchParams.set('k', kennwort);
  return url.href;
}

const LOKAL = /^(localhost|127\.|\[::1\])/i;

export class BlenderStream {
  constructor({ beiStatus = () => {} } = {}) {
    this.ws = null;
    this.an = false;
    this.adresse = 'ws://localhost:8765';
    this.beiStatus = beiStatus;
    this.zuletzt = 0;
    this.letzte = [];          // je Figur: zuletzt gesendete Pose und Mimik (Objekte), um Doppeltes zu sparen
    this.gesendet = 0;
    this.wiederholung = null;
  }

  starten(adresse, kennwort = '') {
    try { this.adresse = adresseNormalisieren(adresse || this.adresse, kennwort); } catch { this.beiStatus('fehler'); return; }
    this.an = true;
    // Eine https-Seite darf kein unverschlüsseltes ws:// zu einem anderen Rechner öffnen
    const host = new URL(this.adresse).host;
    if (location.protocol === 'https:' && this.adresse.startsWith('ws:') && !LOKAL.test(host)) {
      this.an = false; this.beiStatus('https'); return;
    }
    this.verbinden();
  }

  get ziel() { return new URL(this.adresse).host; }

  stoppen() {
    this.an = false;
    clearTimeout(this.wiederholung);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this.beiStatus('aus');
  }

  get verbunden() { return this.ws?.readyState === WebSocket.OPEN; }

  verbinden() {
    if (!this.an) return;
    this.beiStatus('verbinde');
    let ws;
    try { ws = new WebSocket(this.adresse); } catch { this.beiStatus('fehler'); return; }
    this.ws = ws;
    ws.onopen = () => { this.letzte = []; this.gesendet = 0; this.beiStatus('verbunden'); };
    // Blender noch nicht bereit oder Addon gestoppt: alle 2 s neu versuchen
    ws.onclose = e => {
      this.ws = null;
      if (!this.an) return;
      if (e.code === 4001) { this.an = false; this.beiStatus('kennwort'); return; }   // nicht dauernd neu probieren
      this.beiStatus(LOKAL.test(this.ziel) ? 'wartet' : 'wartetNetz');
      this.wiederholung = setTimeout(() => this.verbinden(), 2000);
    };
    ws.onerror = () => {};
  }

  // Nach jedem Bild aus Studio3D aufrufen; zeit: Sekunden (Aufnahme-Zeit oder Uhr),
  // modus: 'live' | 'aufnahme' | 'ruhe', spielt: läuft die Aufnahme gerade
  bild(studio, zeit, modus = 'live', spielt = false) {
    if (!this.verbunden) return;
    const jetzt = performance.now();
    if (jetzt - this.zuletzt < MIN_ABSTAND) return;
    // nicht stauen, wenn Blender langsamer liest als wir senden
    if (this.ws.bufferedAmount > 256 * 1024) return;

    let neu = false;
    const figuren = [];
    studio.figuren.forEach((f, nr) => {
      if (!f.gruppe.visible || !f.letzte) return;
      const [j] = f.letzte, alt = this.letzte[nr];
      if (!alt || alt.j !== j || alt.mimik !== f.mimik) neu = true;
      this.letzte[nr] = { j, mimik: f.mimik };
      figuren.push(figurDaten(f, nr, j));
    });
    // steht alles still, reicht ein Lebenszeichen pro Sekunde
    if (!neu && jetzt - this.zuletzt < 1000) return;
    this.zuletzt = jetzt;
    this.ws.send(JSON.stringify({ format: FORMAT, version: 1, t: r4(zeit), modus, spielt, figuren }));
    this.gesendet++;
  }
}

function figurDaten(f, nr, j) {
  const g = f.gruppe, sx = g.scale.x, ox = g.position.x, oy = g.position.y, oz = g.position.z;
  const gelenke = {};
  for (const [name, p] of Object.entries(j)) {
    if (!Array.isArray(p) || p.length !== 3) continue;   // j.kopf ist keine Position
    gelenke[name] = [r4(p[0] * sx + ox), r4(p[1] + oy), r4(p[2] + oz)];
  }
  // Kopfdrehung (Gesicht oder grob aus der Pose); beim Spiegeln an der x-Achse mitspiegeln
  const q = f.kopfGruppe.quaternion;
  const kopf = sx < 0 ? [q.x, -q.y, -q.z, q.w] : [q.x, q.y, q.z, q.w];
  let mimik = null;
  if (f.mimik) {
    mimik = {};
    for (const [k, v] of Object.entries(f.mimik)) if (typeof v === 'number') mimik[k] = r4(v);
  }
  return { nr, gelenke, kopf: kopf.map(r4), mimik };
}
