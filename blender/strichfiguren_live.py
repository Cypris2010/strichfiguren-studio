# Strichfiguren live – Blender-Addon
#
# Empfängt die Bewegung aus dem Strichfiguren-Studio (Browser) live und bewegt damit Strichfiguren in
# Blender. Auf Wunsch wird alles als Keyframes aufgenommen, dann kann man in Blender Licht, Kamerafahrten
# und Bühne bauen und das Ganze zu einem Video rendern.
#
# Installieren: Blender → Bearbeiten → Einstellungen → Add-ons → (Pfeil oben rechts) „Von Datenträger
# installieren …“ → diese Datei wählen → Haken bei „Strichfiguren live“.
# Bedienen: im 3D-Fenster mit N die Seitenleiste öffnen → Reiter „Strichfiguren“ → „Empfang starten“.
# Im Studio dann unter ⚙ → Auswertung → „Live an Blender“ den Haken setzen.
#
# Je Figur entsteht eine Sammlung „Strichfigur N“ mit
#   SF{N}_{gelenk}   Empties an den Gelenken (Namen wie im Studio: pelvis, chest, headC, lSh, lEl, …)
#   SF{N}_Glied_*    Zylinder, die per Constraint von Gelenk zu Gelenk reichen
#   SF{N}_Kopf       Kopf mit Drehung; die Mimik steht als Eigenschaften daran (augeL, mundAuf, …)
#   SF{N}_AugeL/R, SF{N}_Mund   einfache Gesichtsteile, die der Mimik folgen
# An die Empties kann man später eigene Figuren hängen (z. B. per Constraint an ein Armature).
#
# Der Server lauscht nur auf diesem Rechner (127.0.0.1) und braucht keine zusätzlichen Pakete.

bl_info = {
    "name": "Strichfiguren live",
    "author": "Strichfiguren-Studio",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "3D-Ansicht → Seitenleiste (N) → Strichfiguren",
    "description": "Bewegung aus dem Strichfiguren-Studio live empfangen und als Keyframes aufnehmen",
    "category": "Animation",
}

import base64
import hashlib
import json
import socket
import struct
import threading
import time

import bmesh
import bpy
from mathutils import Quaternion

FORMAT = "strichfiguren-live"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# Glieder wie in js/scene.js: (von, nach, Radius in m)
SEGMENTE = [
    ("pelvis", "chest", 0.055), ("chest", "headC", 0.03),
    ("chest", "lSh", 0.035), ("chest", "rSh", 0.035),
    ("lSh", "lEl", 0.033), ("lEl", "lWr", 0.03), ("lWr", "lIdx", 0.025),
    ("rSh", "rEl", 0.033), ("rEl", "rWr", 0.03), ("rWr", "rIdx", 0.025),
    ("pelvis", "lHip", 0.042), ("pelvis", "rHip", 0.042),
    ("lHip", "lKn", 0.042), ("lKn", "lAn", 0.035), ("lAn", "lHe", 0.028), ("lHe", "lTo", 0.028),
    ("rHip", "rKn", 0.042), ("rKn", "rAn", 0.035), ("rAn", "rHe", 0.028), ("rHe", "rTo", 0.028),
]
GELENKE = ["pelvis", "chest", "headC", "lSh", "rSh", "lEl", "rEl", "lWr", "rWr", "lIdx", "rIdx",
           "lHip", "rHip", "lKn", "rKn", "lAn", "rAn", "lHe", "rHe", "lTo", "rTo"]
KOPF_RADIUS = 0.115
MIMIK = ["augeL", "augeR", "braueInnen", "braueL", "braueR", "mundAuf", "laechelnL", "laechelnR", "spitz"]


# ---------------------------------------------------------------- Koordinaten
# Studio (three.js): y nach oben, Figur schaut nach +z.  Blender: z nach oben, Figur schaut nach −y
# (also in die Vorderansicht, Ziffernblock 1). (x, y, z) → (x, −z, y) ist eine echte Drehung.

def ort(p):
    return (p[0], -p[2], p[1])


def drehung(q):  # three.js [x, y, z, w] → Blender Quaternion (w, x, y, z)
    return Quaternion((q[3], q[0], -q[2], q[1]))


# ---------------------------------------------------------------- WebSocket-Server (nur Standardbibliothek)

class Empfang:
    def __init__(self):
        self.lock = threading.Lock()
        self.laeuft = False
        self.threads = []
        self.port = 8765
        self.letzte = None        # zuletzt empfangene Nachricht (dict)
        self.puffer = []          # alle Nachrichten seit dem letzten Abholen (für die Aufnahme)
        self.verbindungen = 0
        self.anzahl = 0
        self.fehler = ""

    def starten(self, port):
        if self.laeuft:
            return
        self.port, self.fehler, self.anzahl = port, "", 0
        # „localhost“ ist je nach Browser IPv4 (Chrome) oder IPv6 (Safari) – auf beiden lauschen,
        # aber nur auf diesem Rechner
        server, fehler = [], []
        for familie, adresse in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
            try:
                srv = socket.socket(familie, socket.SOCK_STREAM)
                srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                if familie == socket.AF_INET6:
                    srv.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                srv.bind((adresse, port))
                srv.listen(4)
                srv.settimeout(0.5)
                server.append(srv)
            except OSError as e:
                fehler.append(f"{adresse}: {e}")
        if not server:
            self.fehler = f"Port {port} geht nicht: " + "; ".join(fehler)
            return
        self.laeuft = True
        self.threads = [threading.Thread(target=self._annehmen, args=(srv,), daemon=True) for srv in server]
        for t in self.threads:
            t.start()

    def stoppen(self):
        self.laeuft = False
        for t in getattr(self, "threads", []):
            t.join(timeout=2)
        self.threads = []

    def abholen(self):
        with self.lock:
            letzte, puffer, self.puffer = self.letzte, self.puffer, []
        return letzte, puffer

    def _annehmen(self, srv):
        with srv:
            while self.laeuft:
                try:
                    conn, _ = srv.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                threading.Thread(target=self._client, args=(conn,), daemon=True).start()

    def _client(self, conn):
        conn.settimeout(0.5)
        with self.lock:
            self.verbindungen += 1
        try:
            if not self._handshake(conn):
                return
            for text in self._nachrichten(conn):
                try:
                    msg = json.loads(text)
                except ValueError:
                    continue
                if not isinstance(msg, dict) or msg.get("format") != FORMAT:
                    continue
                with self.lock:
                    self.letzte = msg
                    self.puffer.append(msg)
                    if len(self.puffer) > 2000:   # Blender hängt: nicht unbegrenzt sammeln
                        self.puffer = self.puffer[-2000:]
                    self.anzahl += 1
        except OSError:
            pass
        finally:
            with self.lock:
                self.verbindungen -= 1
            try:
                conn.close()
            except OSError:
                pass

    def _lesen(self, conn, n):
        daten = b""
        while len(daten) < n:
            try:
                stueck = conn.recv(n - len(daten))
            except socket.timeout:
                if not self.laeuft:
                    raise OSError("gestoppt")
                continue
            if not stueck:
                raise OSError("Verbindung zu")
            daten += stueck
        return daten

    def _handshake(self, conn):
        kopf = b""
        while b"\r\n\r\n" not in kopf:
            kopf += self._lesen(conn, 1)
            if len(kopf) > 16384:
                return False
        schluessel = None
        for zeile in kopf.decode("latin-1").split("\r\n"):
            name, _, wert = zeile.partition(":")
            if name.strip().lower() == "sec-websocket-key":
                schluessel = wert.strip()
        if not schluessel:
            conn.sendall(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
            return False
        antwort = base64.b64encode(hashlib.sha1((schluessel + WS_GUID).encode()).digest()).decode()
        conn.sendall(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Accept: {antwort}\r\n\r\n").encode())
        return True

    def _nachrichten(self, conn):
        teile = []
        while self.laeuft:
            b1, b2 = self._lesen(conn, 2)
            fin, opcode, maskiert, laenge = b1 & 0x80, b1 & 0x0F, b2 & 0x80, b2 & 0x7F
            if laenge == 126:
                laenge = struct.unpack(">H", self._lesen(conn, 2))[0]
            elif laenge == 127:
                laenge = struct.unpack(">Q", self._lesen(conn, 8))[0]
            if laenge > 8 * 1024 * 1024:
                return
            maske = self._lesen(conn, 4) if maskiert else None
            daten = bytearray(self._lesen(conn, laenge))
            if maske:
                for i in range(laenge):
                    daten[i] ^= maske[i & 3]
            if opcode == 8:      # schließen
                conn.sendall(b"\x88\x00")
                return
            if opcode == 9:      # ping → pong
                conn.sendall(bytes([0x8A, len(daten)]) + bytes(daten) if len(daten) < 126 else b"\x8A\x00")
                continue
            if opcode in (1, 0):
                teile.append(bytes(daten))
                if fin:
                    yield b"".join(teile).decode("utf-8", "replace")
                    teile = []


EMPFANG = Empfang()


# ---------------------------------------------------------------- Szene aufbauen

def material():
    m = bpy.data.materials.get("Strichfigur")
    if not m:
        m = bpy.data.materials.new("Strichfigur")
        m.diffuse_color = (0.11, 0.22, 0.38, 1)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (0.011, 0.04, 0.125, 1)
            bsdf.inputs["Roughness"].default_value = 0.6
    return m


def gesicht_material():
    m = bpy.data.materials.get("Strichfigur Gesicht")
    if not m:
        m = bpy.data.materials.new("Strichfigur Gesicht")
        m.diffuse_color = (1, 1, 1, 1)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    return m


def material_setzen(ob, mat):
    # Material am Objekt statt am (geteilten) Mesh, damit Gesicht und Körper verschieden sein können
    if not ob.data.materials:
        ob.data.materials.append(mat)
    ob.material_slots[0].link = "OBJECT"
    ob.material_slots[0].material = mat


def kugel_mesh():
    me = bpy.data.meshes.get("SF_Kugel")
    if not me:
        me = bpy.data.meshes.new("SF_Kugel")
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
        for f in bm.faces:
            f.smooth = True
        bm.to_mesh(me)
        bm.free()
    return me


def glied_mesh(radius):
    name = f"SF_Glied_{round(radius * 1000)}"
    me = bpy.data.meshes.get(name)
    if not me:
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=radius, radius2=radius, depth=1.0)
        # entlang +y von 0 bis 1 legen (Stretch To streckt die y-Achse zum nächsten Gelenk)
        for v in bm.verts:
            x, y, z = v.co
            v.co = (x, z + 0.5, -y)
        for f in bm.faces:
            f.smooth = True
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()
    return me


def sammlung(nr):
    name = f"Strichfigur {nr + 1}"
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def objekt(name, daten, c):
    ob = bpy.data.objects.get(name)
    if ob:
        return ob, False
    ob = bpy.data.objects.new(name, daten)
    c.objects.link(ob)
    return ob, True


def figur_anlegen(nr):
    """Legt die Figur an (oder findet sie wieder) und gibt {'gelenke': {...}, 'kopf', 'teile'} zurück."""
    c, pre, mat = sammlung(nr), f"SF{nr + 1}_", material()
    gelenke = {}
    radien = {}
    for von, nach, r in SEGMENTE:
        radien[von] = max(radien.get(von, 0), r)
        radien[nach] = max(radien.get(nach, 0), r)
    for g in GELENKE:
        ob, neu = objekt(pre + g, None, c)
        if neu:
            ob.empty_display_type = "SPHERE"
            ob.empty_display_size = 0.02
        gelenke[g] = ob
        if g != "headC":
            k, neu = objekt(pre + g + "_Kugel", kugel_mesh(), c)
            if neu:
                k.parent = ob
                k.scale = (radien[g],) * 3
                material_setzen(k, mat)
    for von, nach, r in SEGMENTE:
        ob, neu = objekt(f"{pre}Glied_{von}_{nach}", glied_mesh(r), c)
        if neu:
            material_setzen(ob, mat)
            cl = ob.constraints.new("COPY_LOCATION")
            cl.target = gelenke[von]
            st = ob.constraints.new("STRETCH_TO")
            st.target = gelenke[nach]
            st.rest_length = 1.0
            st.volume = "NO_VOLUME"

    kopf, neu = objekt(pre + "Kopf", kugel_mesh(), c)
    if neu:
        kopf.scale = (KOPF_RADIUS,) * 3
        kopf.rotation_mode = "QUATERNION"
        material_setzen(kopf, mat)
        cl = kopf.constraints.new("COPY_LOCATION")
        cl.target = gelenke["headC"]
        for m in MIMIK:
            kopf[m] = 0.0
    # Gesicht in Kopf-Koordinaten (Kugel mit Radius 1, vorn = −y): Augen, Mund
    gmat = gesicht_material()
    teile = {}
    for name, pos, groesse in (("AugeL", (0.35, -0.86, 0.22), (0.12, 0.08, 0.2)),
                               ("AugeR", (-0.35, -0.86, 0.22), (0.12, 0.08, 0.2)),
                               ("Mund", (0.0, -0.9, -0.38), (0.3, 0.08, 0.06))):
        ob, neu = objekt(pre + name, kugel_mesh(), c)
        if neu:
            ob.parent = kopf
            ob.location = pos
            ob.scale = groesse
            ob["grund"] = groesse
            material_setzen(ob, gmat)
        teile[name] = ob
    return {"gelenke": gelenke, "kopf": kopf, "teile": teile}


FIGUREN = {}


def figur(nr):
    f = FIGUREN.get(nr)
    # nach dem Löschen in Blender oder einer neuen Datei wieder anlegen
    try:
        if f and f["kopf"].name in bpy.data.objects:
            return f
    except ReferenceError:
        pass
    f = FIGUREN[nr] = figur_anlegen(nr)
    return f


# ---------------------------------------------------------------- Bewegung anwenden

def anwenden(msg, frame=None):
    for fd in msg.get("figuren", []):
        nr = int(fd.get("nr", 0))
        if nr < 0 or nr > 7:
            continue
        f = figur(nr)
        for name, p in fd.get("gelenke", {}).items():
            ob = f["gelenke"].get(name)
            if ob is None or len(p) != 3:
                continue
            ob.location = ort(p)
            if frame is not None:
                ob.keyframe_insert("location", frame=frame)
        kopf = f["kopf"]
        q = fd.get("kopf")
        if q and len(q) == 4:
            kopf.rotation_quaternion = drehung(q)
            if frame is not None:
                kopf.keyframe_insert("rotation_quaternion", frame=frame)
        mimik = fd.get("mimik") or {}
        werte = {m: float(mimik.get(m, 1.0 if m.startswith("auge") else 0.0)) for m in MIMIK}
        for m, v in werte.items():
            kopf[m] = v
            if frame is not None:
                kopf.keyframe_insert(f'["{m}"]', frame=frame)
        # einfache Gesichtsteile: Augen zu = flach, Mund auf = höher, Lächeln = breiter
        t = f["teile"]
        for seite in ("L", "R"):
            auge = t["Auge" + seite]
            gx, gy, gz = auge.get("grund", (0.12, 0.08, 0.2))
            auge.scale = (gx, gy, gz * max(0.08, min(1.0, werte["auge" + seite])))
        mund = t["Mund"]
        gx, gy, gz = mund.get("grund", (0.3, 0.08, 0.06))
        laecheln = (werte["laechelnL"] + werte["laechelnR"]) / 2
        mund.scale = (gx * (1 + 0.4 * laecheln - 0.4 * werte["spitz"]), gy, gz * (1 + 4 * werte["mundAuf"]))
        if frame is not None:
            for ob in t.values():
                ob.keyframe_insert("scale", frame=frame)


class Zustand:
    aufnahme_start = None     # Zeit t der ersten Nachricht dieser Aufnahme (nur live)
    start_frame = 1           # Bild in Blender, an dem die Live-Aufnahme beginnt
    letzter_frame = None
    hoechster_frame = 0
    letzte_anzeige = 0.0


def frame_fuer(scene, msg):
    fps = scene.render.fps / scene.render.fps_base
    t = float(msg.get("t", 0))
    # Beim Abspielen einer Aufnahme im Studio: Zeit der Aufnahme übernehmen (passt später zur Tonspur)
    if msg.get("modus") == "aufnahme" and scene.sf_einstellungen.aufnahme_zeit:
        return scene.frame_start + round(t * fps)
    if Zustand.aufnahme_start is None:
        Zustand.aufnahme_start = t
    return Zustand.start_frame + round((t - Zustand.aufnahme_start) * fps)


def takt():
    if not EMPFANG.laeuft:
        return None
    scene = bpy.context.scene
    e = scene.sf_einstellungen
    letzte, puffer = EMPFANG.abholen()
    try:
        if e.aufnehmen and puffer:
            # je Blender-Bild nur die letzte Nachricht keyframen
            je_frame = {}
            for msg in puffer:
                if msg.get("modus") == "aufnahme" and e.aufnahme_zeit and not msg.get("spielt"):
                    continue   # angehaltene Aufnahme nicht aufzeichnen
                je_frame[frame_fuer(scene, msg)] = msg
            for frame, msg in sorted(je_frame.items()):
                anwenden(msg, frame)
                Zustand.hoechster_frame = max(Zustand.hoechster_frame, frame)
            if Zustand.hoechster_frame > scene.frame_end:
                scene.frame_end = Zustand.hoechster_frame
        elif puffer and letzte:
            anwenden(letzte)
    except Exception as ex:  # nie den Timer sterben lassen
        EMPFANG.fehler = str(ex)
    jetzt = time.monotonic()
    if jetzt - Zustand.letzte_anzeige > 0.5:
        Zustand.letzte_anzeige = jetzt
        for fenster in bpy.context.window_manager.windows:
            for bereich in fenster.screen.areas:
                if bereich.type == "VIEW_3D":
                    bereich.tag_redraw()
    return 1 / 60


# ---------------------------------------------------------------- Oberfläche

def aufnehmen_geaendert(self, context):
    Zustand.aufnahme_start = None
    Zustand.start_frame = context.scene.frame_current
    Zustand.hoechster_frame = context.scene.frame_end


class SF_Einstellungen(bpy.types.PropertyGroup):
    port: bpy.props.IntProperty(name="Port", default=8765, min=1024, max=65535)
    aufnehmen: bpy.props.BoolProperty(name="Aufnehmen (Keyframes)", default=False, update=aufnehmen_geaendert,
                                      description="Empfangene Bewegung als Keyframes in die Zeitleiste schreiben")
    aufnahme_zeit: bpy.props.BoolProperty(
        name="Zeit der Studio-Aufnahme", default=True,
        description="Spielt das Studio eine Aufnahme ab, landet jedes Bild bei seiner Aufnahme-Zeit "
                    "(ab dem Startbild). Sonst ab dem aktuellen Bild in Echtzeit")


class SF_OT_starten(bpy.types.Operator):
    bl_idname = "strichfiguren.starten"
    bl_label = "Empfang starten"
    bl_description = "WebSocket-Server starten, damit das Studio senden kann"

    def execute(self, context):
        EMPFANG.starten(context.scene.sf_einstellungen.port)
        if EMPFANG.fehler:
            self.report({"ERROR"}, EMPFANG.fehler)
            return {"CANCELLED"}
        if not bpy.app.timers.is_registered(takt):
            bpy.app.timers.register(takt, first_interval=0.1)
        return {"FINISHED"}


class SF_OT_stoppen(bpy.types.Operator):
    bl_idname = "strichfiguren.stoppen"
    bl_label = "Empfang stoppen"

    def execute(self, context):
        EMPFANG.stoppen()
        return {"FINISHED"}


class SF_PT_panel(bpy.types.Panel):
    bl_label = "Strichfiguren live"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Strichfiguren"

    def draw(self, context):
        e = context.scene.sf_einstellungen
        lay = self.layout
        if EMPFANG.laeuft:
            lay.operator("strichfiguren.stoppen", icon="PAUSE")
            if EMPFANG.verbindungen:
                lay.label(text=f"Studio verbunden · {EMPFANG.anzahl} Bilder", icon="CHECKMARK")
            else:
                lay.label(text=f"Wartet auf ws://localhost:{EMPFANG.port}", icon="TIME")
        else:
            row = lay.row()
            row.prop(e, "port")
            lay.operator("strichfiguren.starten", icon="PLAY")
        if EMPFANG.fehler:
            lay.label(text=EMPFANG.fehler, icon="ERROR")
        box = lay.box()
        box.prop(e, "aufnehmen", icon="REC")
        sub = box.column()
        sub.enabled = not e.aufnehmen
        sub.prop(e, "aufnahme_zeit")


KLASSEN = (SF_Einstellungen, SF_OT_starten, SF_OT_stoppen, SF_PT_panel)


def register():
    for k in KLASSEN:
        bpy.utils.register_class(k)
    bpy.types.Scene.sf_einstellungen = bpy.props.PointerProperty(type=SF_Einstellungen)


def unregister():
    EMPFANG.stoppen()
    if bpy.app.timers.is_registered(takt):
        bpy.app.timers.unregister(takt)
    del bpy.types.Scene.sf_einstellungen
    for k in reversed(KLASSEN):
        bpy.utils.unregister_class(k)


if __name__ == "__main__":
    register()
