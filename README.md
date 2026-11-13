# Strichfiguren-Studio

Video oder Kamera → Körperpunkte (MediaPipe Pose) und Gesicht (MediaPipe Face) → 3D-Strichmännchen mit Mimik (three.js) → Bewegungsdatei (JSON).
Erste Stufe für ein Musikvideo mit Strichmännchen.

## Starten

```bash
cd ~/annimatin-test && python3 -m http.server 8123
```

Dann http://localhost:8123 öffnen (Chrome empfohlen). Per `file://` geht es nicht, und die Kamera braucht `localhost` oder https.

## Aufbau der Oberfläche

- **Editor**: oben Quelle (*Kamera*, *+ 2. Kamera*, *Video öffnen*), *Aufnahme* und *Analysieren*; links die Videos,
  rechts die Figur mit den Ansichten (*Vorne*, *Seite*, *Schräg*, *Oben*, *Kopf*) und dem Stil; unten die Zeitleiste.
  Im Video steht als Etikett, was die Kamera auswertet und für welche Figur.
- **⚙ Einstellungen** (rechts oben) klappt eine Spalte mit drei Reitern auf. Videos und Figur bleiben dabei
  sichtbar und anklickbar (wichtig fürs Einmessen und die Tape-Farben).
  - **Kamera** – je Kamera: Gerät, **Aufgabe** (*Körper + Gesicht*, *Nur Körper*, *Nur Gesicht*), bei der zweiten
    die **Figur**, *Spiegeln* und *Neutral merken*. **Das alles merkt sich das Studio je Gerät** – z. B. iPhone als
    Gesichtskamera ohne Spiegeln, Mac-Kamera für den Körper gespiegelt. Beim nächsten Start ist alles wieder so.
  - **Auswertung** – Modell, Bilder pro Sekunde für *Analysieren*, Glättung, Füße am Boden, Stärke der Mimik.
  - **Band** – standardmäßig aus. Ein Schalter aktiviert Instrumente, Tape-Marker, Schlagzeug einmessen und das
    Luftband mit Tonspur- und MIDI-Export. Solange er aus ist, taucht davon nichts im Editor auf.

### Was die Kameras auswerten

| Kamera 1 | Kamera 2 | Ergebnis |
| --- | --- | --- |
| Körper + Gesicht | – | eine Figur mit Mimik |
| Nur Gesicht | – | Nahaufnahme: die Figur steht, nur Mimik und Kopf bewegen sich |
| Körper, Figur 1 | Gesicht, Figur 1 | Körper aus der Totalen, Mimik aus der Nahaufnahme (z. B. Gesang) |
| Körper, Figur 1 | Körper, Figur 1 | zwei Winkel derselben Person, zu einer genaueren Figur verschmolzen |
| beliebig | beliebig, Figur 2 | zwei Personen mit je eigener Figur |

Sehen zwei Kameras das Gesicht derselben Figur, zählt die, in der es größer ist. Bei zwei Winkeln wird die
Kopfdrehung aus Kamera 2 in die Ausrichtung von Kamera 1 gedreht, sobald der Winkel bestimmt ist.

### Gesicht

Zwei MediaPipe-Modelle je Kamera: der **Face Detector** findet alle Gesichter (gestrichelte Rahmen), der
**Face Landmarker** wertet einen vergrößerten Ausschnitt um den Kopf aus (478 Punkte, 52 Blendshapes). So klappt
es auch bei Ganzkörperaufnahmen. Die Figur bekommt ein gezeichnetes Gesicht mit Augen, Brauen und Mund und dreht
den Kopf mit. Die Mimik wird verstärkt (*Mimik* unter *Auswertung*), damit schon ein dezentes Lächeln sichtbar wird.

**Neutral merken** (Reiter *Kamera*): entspannt in die Kamera schauen und klicken. MediaPipe meldet bei vielen schon
im entspannten Gesicht gesenkte Brauen und Mundwinkel; ab dann zählt nur, was davon abweicht. Ohne Klick wird das
Ruhegesicht automatisch geschätzt, Doppelklick schaltet zurück darauf. Bei einer Aufnahme merkt sich der Knopf das
Gesicht an der aktuellen Stelle und speichert es im Export mit.

## Bedienung im Einzelnen

- **Kamera** – Live-Vorschau. **● Aufnahme** speichert die Bewegung zusammen mit Video und Ton.
  Sind mehrere Kameras da, erscheint daneben eine Auswahl; der Wechsel geht auch mitten im Live-Bild.
  Das **iPhone** taucht am Mac als Integrationskamera auf (iPhone in der Nähe, gesperrt, quer und ruhig
  aufgestellt; gleiche Apple-ID). Die gewählte Kamera wird gemerkt.
  Oben im Live-Bild steht, wie viele Bilder pro Sekunde ausgewertet werden und wie lange das dauert:
  *Erkennung* (MediaPipe), *Rest* (Tape, Figur, Luftband), *3D* (Zeichnen), *Last* (Anteil der Rechenzeit) und
  wie viele Bilder pro Sekunde jede Kamera mit einer **2. Kamera** noch schaffen würde.
  Erkennt eine Kamera gerade niemanden, steht dort *keine Person erkannt*.
- **+ 2. Kamera** – eine zweite Kamera dazunehmen (erst die erste mit *Kamera* starten). Wofür, stellst du unter
  *Einstellungen → Kamera* mit Aufgabe und Figur ein (siehe Tabelle oben):
  - *Figur 1, Körper*: Beide Kameras filmen dieselbe Person, am besten 45–90° auseinander und beide
    mit dem ganzen Körper im Bild. Das Studio bestimmt selbst, wie die Kameras zueinander stehen (Anzeige
    *Winkel … °*), und verschmilzt beide Ansichten zu einer Figur: Was für die eine Kamera Tiefe ist (ungenau),
    sieht die andere von der Seite (genau). Sieht nur eine Kamera die Person, bewegt diese allein die Figur.
  - *Figur 1, Nur Gesicht*: Die zweite Kamera liefert nur die Mimik, am besten nah am Gesicht.
  - *Figur 2*: Die zweite Kamera filmt eine zweite Person. Sie bekommt eine eigene Figur
    rechts daneben und ihr eigenes Instrument (*Figur 2* unter *Einstellungen → Band*).

  **● Aufnahme** nimmt dann beide Kameras gleichzeitig auf (den Ton im ersten Video), **Analysieren** wertet
  beide Videos Bild für Bild im Gleichschritt aus, beim Abspielen laufen beide Videos synchron. Mit der
  Einstellung lässt sich eine Aufnahme auch nachträglich anders auswerten: umstellen, dann *Analysieren*.
  **Zwei Kameras gleichzeitig gehen nur in Chrome.** Safari liefert nur von einer Kamera Bilder: Kommt die
  zweite dazu, bleibt das Bild der ersten stehen (mit Skelett und Figur). Das Studio merkt das, schaltet die
  zweite wieder ab und sagt Bescheid. Liefert eine Kamera keine Bilder mehr, steht oben *Bild steht*.
  Damit nichts einfriert, darf die Erkennung höchstens 70 % der Rechenzeit belegen. Mit zwei Kameras wertet
  dann jede weniger Bilder aus (gemessen auf einem MacBook Air mit *ausgewogen*: etwa 12 je Kamera statt 28 bei
  einer); die Anzeige meldet das als *gedrosselt*. Das Modell *schnell* schafft mehr.
- **Video öffnen …** – Abspielen zeigt eine schnelle Vorschau. **Analysieren** wertet jedes Bild genau aus (30 oder 60 pro Sekunde).
- **Zeitleiste** – Abspielen (auch mit der Leertaste) und Springen. Das Strichmännchen läuft synchron zum Video.
- **Export / Import JSON** – Bewegungsdatei speichern und wieder laden.
- **Ansicht** – Kamera-Voreinstellungen, mit der Maus drehen und zoomen, Stile *Flach*, *Plastisch*, *Neon*.
- **Glättung** – 0 = Rohdaten, 10 = sehr ruhig. Schnelle Bewegungen bleiben trotzdem erhalten (One-Euro-Filter).
- **Instrument** – Gitarre, Bass oder Schlagzeug. Gitarre und Bass hängen vor dem Bauch, der Hals zeigt immer zur Greifhand. Das Schlagzeug steht fest vor der Figur, mit Hocker, Becken und Sticks in den Händen.
- **Hand** – *automatisch* erkennt die Greifhand an der Gitarre: Es ist die Hand, die weiter seitlich vom Körper weg ist. *Linkshänder* spiegelt beim Schlagzeug den Aufbau. Bei einer fertigen Aufnahme werden Blickrichtung, Sitzhöhe und Greifhand einmal aus der ganzen Aufnahme bestimmt, damit nichts wackelt.

Alles Folgende gehört zu den **Band-Funktionen** (*Einstellungen → Band*, erst einschalten).

## Instrumente mit Tape verfolgen

Knalliges Klebeband (neongrün, pink, orange) ist in jedem Bild leicht zu finden. Aus der Pose
weiß das Studio, wie Bild und Körper zusammenhängen, und rechnet den Tape-Punkt in 3D um.

| Wo kommt Tape hin? | Farbe | Wirkung |
| --- | --- | --- |
| Kopf von Gitarre / Bass | *Kopf/Sticks* | Halswinkel stimmt auch, wenn die Gitarre geschwenkt wird |
| Spitzen beider Sticks | *Kopf/Sticks* | Sticks zeigen dorthin, wo sie wirklich sind (auch in der Tiefe) |
| Rand von Hi-Hat (oben), Crash, Ride – zur Kamera hin | *Becken* (andere Farbe!) | Becken kippen nach dem Schlag, die Hi-Hat öffnet sich |

1. **Tape-Marker** einschalten und mit **Kopf/Sticks** bzw. **Becken** ins Video auf das Tape klicken – das übernimmt die Farbe. Gefundene Marker werden eingekreist; wenn zu viel oder zu wenig gefunden wird, die **Toleranz** ändern.
2. Bei Videodateien danach **Analysieren** – die Marker werden in der Aufnahme mitgespeichert.

### Schlagzeug einmessen

Instrument *Schlagzeug* wählen, ein Bild suchen, in dem der Schlagzeuger gut zu sehen ist, und **Schlagzeug einmessen**:
nacheinander auf Snare, Hi-Hat, Toms, Standtom, Crash, Ride und Bassdrum klicken (bei Becken auf das Tape).
Höhe und seitliche Lage kommen aus dem Bild, der Abstand nach vorn aus einer üblichen Aufstellung.
Teile, die man nicht sieht, überspringen. **↺** stellt die Standardaufstellung wieder her.
Die Kamera darf sich danach nicht bewegen (Stativ), weil die Becken-Ruhelage im Bild gemerkt wird.

## Luftband: Töne aus Bewegung

Instrument wählen und **Luftband** einschalten – dann klingt, was die Figur spielt. Alles wird im Browser
erzeugt, ohne Samples.

| Instrument | So klingt es |
| --- | --- |
| Schlagzeug | Stick (bzw. Hand) schnell nach unten und abrupt stoppen. Getroffen wird das Teil, auf das die Stickspitze zeigt. Fußspitze tippen = Bassdrum, der andere Fuß = Hi-Hat-Pedal; ist er angehoben, klingt die Hi-Hat offen. |
| Gitarre | Anschlaghand schnell über die Saiten ziehen, ab- und aufwärts. Die Greifhand wählt einen von vier **Akkorden**: der erste am Kopf, der letzte am Korpus (am Hals markiert, oben eingeblendet). **Klang** clean oder verzerrt. |
| Bass | Genauso, gespielt wird der Grundton des Akkords. |

- **Empfindlichkeit** – wie kräftig eine Bewegung sein muss. Klingt es von allein, runterdrehen.
- Live liegen etwa 60–100 ms zwischen Bewegung und Ton (Kamera, Erkennung). Zum Spielen reicht das, für exaktes Timing nicht.
- Bei einer **Aufnahme** werden alle Töne vorab bestimmt, jeweils zum tiefsten Punkt des Schlags – also genau.
  ▶ spielt sie mit ab. **Tonspur WAV** speichert sie als Audiodatei, die bei 0:00 mit dem Video beginnt.
  **MIDI** speichert sie fürs Musikprogramm: Schlagzeug auf Kanal 10 (General MIDI), Gitarre auf Kanal 1,
  Bass auf Kanal 2, Tempo 120 BPM – die Zeiten stimmen in Sekunden, das Programm kann sie aufs Songtempo ziehen.
- Bei zwei Personen spielt jede ihr eigenes Instrument: Die Tonspur enthält beide, die MIDI-Datei hat eine Spur
  je Person (eine zweite Gitarre landet auf Kanal 3).
- Fürs Luftband wird die Bewegung kaum geglättet (jede Glättung verzögert und verschiebt den Schlag);
  der Regler *Glättung* wirkt nur auf die Figur.

## Live an Blender

Das Studio kann die Bewegung live an Blender schicken. Dort bewegt sie Strichfiguren, die man ausleuchten,
filmen und als Video rendern kann. Auf Wunsch zeichnet Blender alles als Keyframes auf.

Am schnellsten: Blender direkt mit dem Startskript öffnen. Es lädt das Addon, startet den Empfang und stellt
die Ansicht auf die Figur ein:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --python blender/live_starten.py
```

Oder dauerhaft installieren:

1. In Blender (ab 3.6): *Bearbeiten → Einstellungen → Add-ons → Von Datenträger installieren …* →
   `blender/strichfiguren_live.py` wählen und den Haken setzen.
2. Im 3D-Fenster mit **N** die Seitenleiste öffnen → Reiter **Strichfiguren** → **Empfang starten**.
3. Im Studio unter **⚙ → Auswertung → Live an Blender** den Haken bei *Bewegung senden* setzen. Unter dem
   Schalter steht, ob die Verbindung steht. Ist Blender noch nicht bereit, versucht es das Studio alle 2 s erneut.

Es geht live mit Kamera und beim Abspielen einer Aufnahme. In Blender entsteht je Figur eine Sammlung
*Strichfigur N* mit Empties an den Gelenken (`SF1_pelvis`, `SF1_lWr`, …), Gliedern, die per Constraint von Gelenk
zu Gelenk reichen, und dem Kopf `SF1_Kopf`. Der Kopf trägt die Drehung und die Mimik als Eigenschaften
(`augeL`, `mundAuf`, `laechelnL`, …). Augen und Mund folgen der Mimik.

**Aufnehmen (Keyframes)** schreibt die empfangene Bewegung in die Zeitleiste. Spielt das Studio eine Aufnahme
ab, landet jedes Bild bei seiner Aufnahme-Zeit (ab dem Startbild der Szene). So passt es später zur Tonspur.
Live wird ab dem aktuellen Bild in Echtzeit aufgezeichnet.

Format der Nachrichten: siehe Kopf von `js/stream.js`. Der Server lauscht nur auf diesem Rechner (127.0.0.1)
und braucht in Blender keine zusätzlichen Pakete.

## Tipps für Aufnahmen

Stativ, ganzer Körper im Bild, eine Person pro Video, leicht schräg von vorn, gutes Licht.
Mit zwei Winkeln: beide Kameras etwa auf Brusthöhe, beide von vorn-seitlich (nicht von hinten – dann
verwechselt die Erkennung links und rechts).
Für Schlagzeug lieber mit 60 Bildern pro Sekunde filmen und analysieren.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `js/pose.js` | MediaPipe laden, 33 Punkte pro Bild erkennen |
| `js/face.js` | Gesichter finden, Kopfausschnitt, Blendshapes, Kopfdrehung, Ruhegesicht |
| `js/filter.js` | One-Euro-Filter gegen Zittern (Körper, Marker, Gesicht) |
| `js/rig.js` | Punkte → Strichmännchen mit festen Knochenlängen, Füße am Boden |
| `js/scene.js` | three.js-Szene, Figuren (eine oder zwei) mit gezeichnetem Gesicht, Stile, Kamera |
| `js/instrumente.js` | Gitarre, Bass, Schlagzeug und Sticks, an der Pose ausgerichtet; Einmessen |
| `js/marker.js` | Tape-Marker im Bild finden, 2D → 3D (Hals, Sticks, Becken, Einmessen) |
| `js/luftband.js` | Luftband: Schläge, Anschläge und Akkordzonen aus der Bewegung erkennen |
| `js/klang.js` | Klangerzeugung (Schlagzeug, Gitarre, Bass) live und als WAV-Tonspur |
| `js/midi.js` | Luftband-Töne als MIDI-Datei, eine Spur je Person |
| `js/ansichten.js` | Zwei Kamerawinkel einer Person: Winkel bestimmen, beide Posen verschmelzen |
| `js/stream.js` | Live-Stream der Gelenke, Kopfdrehung und Mimik an Blender (WebSocket) |
| `blender/strichfiguren_live.py` | Blender-Addon: empfängt den Stream, baut die Figuren, nimmt Keyframes auf |
| `js/app.js` | Bedienung, Einstellungen je Gerät, zweite Kamera, Aufnahme, Analyse, Abspielen, Export |

Die JSON-Datei enthält die **Rohdaten** (Welt- und Bildpunkte je Bild). Glättung und Übertragung auf die Figur passieren beim Abspielen. So lassen sich alte Aufnahmen später mit besseren Verfahren neu verarbeiten.
Bei zwei Personen steht die zweite unter `zweite` (gleicher Aufbau). Bei zwei Winkeln sind die Punkte schon
verschmolzen (`ansichten: 2`), dazu die Bildpunkte der zweiten Kamera als `q2`.
Ab Version 3 hat jedes Bild optional `g` (Blendshapes, Kopfdrehung, Gesichtsrahmen) und jede Figur unter `gesicht`
die Namen der Blendshapes und das Ruhegesicht. Bilder aus Nahaufnahmen haben nur `g`, kein `p`/`q`.

## Noch nicht drin

- Bewegung durch den Raum: die Figur bleibt an ihrem Platz
- Finger (MediaPipe Hands)
- Ohne Tape folgen die Sticks nur der Hand und treffen die Trommeln nicht exakt
- Luftband: keine echten Griffe, nur vier Akkordzonen; ein Instrument je Person
- Mehr als zwei Kameras; zwei Winkel *und* zwei Personen gleichzeitig; Kameras, die die Person von hinten sehen
- Synchronisieren getrennter Aufnahmen über die Tonspur, Ausgabe als fertiges Video
