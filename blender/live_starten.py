# Blender direkt für den Live-Empfang starten – ohne das Addon zu installieren:
#
#   /Applications/Blender.app/Contents/MacOS/Blender --python blender/live_starten.py
#
# Für einen zweiten Rechner im Netzwerk (Studio läuft woanders), optional mit Kennwort:
#
#   /Applications/Blender.app/Contents/MacOS/Blender --python blender/live_starten.py -- --netz --kennwort geheim
#
# Lädt das Addon aus diesem Ordner, startet den Empfang (ws://localhost:8765), räumt die Startszene
# (Würfel) weg und stellt das 3D-Fenster auf die Vorderansicht der Figur. Danach im Studio unter
# ⚙ → Auswertung → „Live an Blender“ den Haken setzen; die Figur bewegt sich dann live in Blender.
import os
import sys

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strichfiguren_live as sf  # noqa: E402

if not hasattr(bpy.types.Scene, "sf_einstellungen"):
    sf.register()

# eigene Optionen stehen hinter „--“ (davor gehört alles Blender)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
NETZ = "--netz" in ARGS
KENNWORT = ARGS[ARGS.index("--kennwort") + 1] if "--kennwort" in ARGS[:-1] else ""


def einrichten():
    for name in ("Cube", "Würfel"):
        ob = bpy.data.objects.get(name)
        if ob:
            bpy.data.objects.remove(ob)
    e = bpy.context.scene.sf_einstellungen
    e.netzwerk, e.kennwort = NETZ, KENNWORT
    sf.EMPFANG.starten(e.port, NETZ, KENNWORT)
    if not bpy.app.timers.is_registered(sf.takt):
        bpy.app.timers.register(sf.takt, first_interval=0.1)
    # Vorderansicht auf Brusthöhe, Materialfarben, Seitenleiste mit dem Reiter „Strichfiguren“
    for fenster in bpy.context.window_manager.windows:
        for bereich in fenster.screen.areas:
            if bereich.type != "VIEW_3D":
                continue
            raum = bereich.spaces.active
            raum.shading.type = "SOLID"
            raum.shading.color_type = "MATERIAL"
            raum.show_region_ui = True
            r3d = raum.region_3d
            r3d.view_perspective = "PERSP"
            r3d.view_rotation = Euler((1.45, 0, 0.12)).to_quaternion()
            r3d.view_location = Vector((0, 0, 1.0))
            r3d.view_distance = 4.2
            for region in bereich.regions:
                if region.type == "UI":
                    try:
                        region.active_panel_category = "Strichfiguren"
                    except (AttributeError, TypeError):
                        pass
    print("Strichfiguren live: Empfang", sf.EMPFANG.fehler or "läuft auf " + ", ".join(sf.EMPFANG.adressen)
          + (" (mit Kennwort)" if KENNWORT else ""))
    return None


# erst wenn die Oberfläche steht
bpy.app.timers.register(einrichten, first_interval=0.5)
