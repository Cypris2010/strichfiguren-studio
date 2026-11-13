# Strichfiguren-Studio

Video oder Kamera → Körperpunkte (MediaPipe Pose) → 3D-Strichmännchen (three.js) → Bewegungsdatei (JSON).
Erste Stufe für ein Musikvideo mit Strichmännchen.

## Starten

```bash
cd ~/annimatin-test && python3 -m http.server 8123
```

Dann http://localhost:8123 öffnen (Chrome empfohlen). Per `file://` geht es nicht, und die Kamera braucht `localhost` oder https.

## Bedienung

- **Kamera** – Live-Vorschau. **● Aufnahme** speichert die Bewegung zusammen mit Video und Ton.
- **Video öffnen …** – Abspielen zeigt eine schnelle Vorschau. **Analysieren** wertet jedes Bild genau aus (30 oder 60 pro Sekunde).
- **Zeitleiste** – Abspielen (auch mit der Leertaste) und Springen. Das Strichmännchen läuft synchron zum Video.
- **Export / Import JSON** – Bewegungsdatei speichern und wieder laden.
- **Ansicht** – Kamera-Voreinstellungen, mit der Maus drehen und zoomen, Stile *Flach*, *Plastisch*, *Neon*.
- **Glättung** – 0 = Rohdaten, 10 = sehr ruhig. Schnelle Bewegungen bleiben trotzdem erhalten (One-Euro-Filter).

## Tipps für Aufnahmen

Stativ, ganzer Körper im Bild, eine Person pro Video, leicht schräg von vorn, gutes Licht.
Für Schlagzeug lieber mit 60 Bildern pro Sekunde filmen und analysieren.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `js/pose.js` | MediaPipe laden, 33 Punkte pro Bild erkennen |
| `js/filter.js` | One-Euro-Filter gegen Zittern |
| `js/rig.js` | Punkte → Strichmännchen mit festen Knochenlängen, Füße am Boden |
| `js/scene.js` | three.js-Szene, Figur, Stile, Kamera |
| `js/app.js` | Bedienung, Aufnahme, Analyse, Abspielen, Export |

Die JSON-Datei enthält die **Rohdaten** (Welt- und Bildpunkte je Bild). Glättung und Übertragung auf die Figur passieren beim Abspielen. So lassen sich alte Aufnahmen später mit besseren Verfahren neu verarbeiten.

## Noch nicht drin

- Bewegung durch den Raum: die Figur bleibt an ihrem Platz
- Finger und Mimik (MediaPipe Hands / Face)
- Instrumente mit festen Kontaktpunkten für die Hände
- Mehrere Figuren, Synchronisieren über die Tonspur, Ausgabe als fertiges Video
