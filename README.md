# Strichfiguren-Studio

Video oder Kamera → Körperpunkte (MediaPipe Pose) und Gesicht (MediaPipe Face) → 3D-Strichmännchen mit Mimik (three.js) → Bewegungsdatei (JSON).
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
- **Erkennung** – *Körper + Gesicht*, *Nur Körper* oder *Nur Gesicht*. *Nur Gesicht* ist für Nahaufnahmen (z. B. Gesang): die Figur steht, nur Mimik und Kopf bewegen sich. Nötig, weil MediaPipe Pose bei Nahaufnahmen sonst einen Körper erfindet. Daneben steht, woher der Gesichtsausschnitt kam und wie viele Gesichter im Bild sind.
- **Mimik** – wie stark der Gesichtsausdruck übertragen wird (1–4, Standard 2). Echte Gesichter lächeln dezent; erst verstärkt wird daraus ein deutliches Smiley. Ein neutrales Gesicht bekommt einen leicht freundlichen Zug.
- **Neutral merken** – Baseline für dein Ruhegesicht: entspannt in die Kamera schauen und klicken. Ab dann zählt nur, was davon abweicht (MediaPipe meldet bei vielen schon im entspannten Gesicht gesenkte Brauen und Mundwinkel, verstärkt sähe das schlecht gelaunt aus). Ohne Klick wird das Ruhegesicht automatisch geschätzt; Doppelklick schaltet zurück auf automatisch. In einer Aufnahme merkt sich der Knopf das Gesicht an der aktuellen Stelle und speichert es im Export mit (`gesicht.neutral`).
- **Kopf** – Kamera nah ans Gesicht; sie folgt dem Kopf, Drehen und Zoomen mit der Maus geht weiter.

## Gesichtserkennung

Zwei MediaPipe-Modelle, beide im Browser:

1. **Face Detector** (BlazeFace) findet alle Gesichter im Bild (gestrichelte Rahmen in der Einblendung).
2. **Face Landmarker** wertet einen vergrößerten Ausschnitt um den Kopf aus: 478 Punkte und 52 Blendshapes (ARKit-Namen wie `jawOpen`, `eyeBlinkLeft`, `mouthSmileRight`). Daraus kommen Mimik und Kopfdrehung.

Der Ausschnitt kommt vom Detektor-Rahmen, der zum Kopf der Pose passt, sonst vom Gesicht im letzten Bild, sonst von den Kopfpunkten der Pose. So klappt es auch bei Ganzkörperaufnahmen, in denen das Gesicht klein ist. Unter etwa 36 Pixeln Kopfgröße gibt es kein Gesicht mehr.

## Tipps für Aufnahmen

Stativ, ganzer Körper im Bild, eine Person pro Video, leicht schräg von vorn, gutes Licht.
Für Schlagzeug lieber mit 60 Bildern pro Sekunde filmen und analysieren.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `js/pose.js` | MediaPipe laden, 33 Punkte pro Bild erkennen |
| `js/face.js` | Gesichter finden, Kopfausschnitt, Blendshapes und Kopfdrehung |
| `js/filter.js` | One-Euro-Filter gegen Zittern (Körper und Gesicht) |
| `js/rig.js` | Punkte → Strichmännchen mit festen Knochenlängen, Füße am Boden |
| `js/scene.js` | three.js-Szene, Figur mit gezeichnetem Gesicht, Stile, Kamera |
| `js/app.js` | Bedienung, Aufnahme, Analyse, Abspielen, Export |

Die JSON-Datei enthält die **Rohdaten** (Welt- und Bildpunkte je Bild, ab Version 2 zusätzlich `g` mit Blendshapes, Kopfdrehung und Gesichtsrahmen; Erklärung steht in der Datei unter `gesicht`). Glättung und Übertragung auf die Figur passieren beim Abspielen. So lassen sich alte Aufnahmen später mit besseren Verfahren neu verarbeiten.

## Noch nicht drin

- Bewegung durch den Raum: die Figur bleibt an ihrem Platz
- Finger (MediaPipe Hands)
- Mehrere Personen im selben Video sicher auseinanderhalten (Wiedererkennung über Gesichtsmerkmale)
- Instrumente mit festen Kontaktpunkten für die Hände
- Mehrere Figuren, Synchronisieren über die Tonspur, Ausgabe als fertiges Video
