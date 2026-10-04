# ysound Song-Rechner

Die Webseite (Railway) hat keine Grafikkarte. Damit ysound trotzdem **kostenlos und ohne Limit pro Song** echte
KI-Songs mit Gesang machen kann, läuft das Modell **ACE-Step 1.5** (MIT-Lizenz) auf einem Computer mit
Grafikkarte, hier deinem PC. Die Webseite sammelt die Aufträge, dein PC holt sie ab, macht die Songs und
lädt die fertigen MP3s hoch. **Ist der PC aus, ist ysound auf "Song-Rechner ist gerade aus" gestellt** (niemand
kann dann Songs bestellen, also bleibt nichts hängen).

```
Besucher ──> Webseite (Railway) <──(ausgehend, HTTPS)── worker.py ──(127.0.0.1)──> ACE-Step-Server ──> Grafikkarte
```

## Dateien

| Datei | Aufgabe |
|---|---|
| `worker.py` | Holt Aufträge von der Webseite, prüft sie, lässt das Modell den Song machen, lädt ihn hoch. Nur Standardbibliothek, etwa 350 Zeilen. |
| `serve_model.py` | Startet den ACE-Step-Server: offline, nur auf `127.0.0.1`, mit API-Schlüssel, hinter `netguard.py`. |
| `netguard.py` | Sperrt im Modell-Prozess jeden Zugriff auf alles außer diesen Computer (Sicherheitsnetz, ohne Admin). |
| `download_model.py` + `model_manifest.json` | Lädt die Modell-Dateien **einmal** von einer festgenagelten Version und prüft jede Datei per Hash. |
| `harden.ps1` | Optional, als Administrator: Windows-Firewall-Regel, die dem Modell das Netz **richtig** sperrt. |
| `run_all.py` / `start-ysound.bat` | Startet Modell und Worker zusammen. |

## Sicherheit: was geschützt wird und wie

Das Modell selbst (die Gewichte) kann nichts ausführen, es sind nur Zahlen (`.safetensors`). Gefährlich wäre
Code drumherum und offene Zugänge. Deshalb:

1. **Festgenagelt und geprüft.** ACE-Step-Code: Commit `ca1e85fe9430`. Gewichte: Hugging-Face-Version
   `19671f406d60`. Pakete: `uv.lock` des Projekts (mit Hashes, `uv sync --frozen`). Nichts davon aktualisiert sich selbst.
   Den Code habe ich vor dem Start nach Netzwerkzugriffen, `eval`/`exec`, `pickle` und `subprocess` durchsucht:
   im normalen Betrieb nichts Auffälliges. Beim Laden führt ACE-Step Python-Dateien aus dem Modell-Ordner aus
   (`trust_remote_code`), überschreibt sie aber vorher mit den Kopien aus dem geprüften Code.
2. **Hash-geprüfter Download.** `download_model.py` löscht jede Datei, die nicht exakt zur festgenagelten Version passt.
3. **Offline.** Hugging Face, Transformers, Telemetrie, Modell-Nachladen und die "externe KI"-Funktionen sind aus.
4. **Kein Netz fürs Modell** (zwei Schichten): `netguard.py` von innen, und mit `harden.ps1` die Windows-Firewall
   von außen. Das Modell darf nur mit `127.0.0.1` sprechen.
5. **Nur lokal erreichbar.** Der Modell-Server hört nur auf `127.0.0.1` und verlangt einen API-Schlüssel. Es wird
   kein Port im Router geöffnet, der Worker verbindet sich nur **nach außen**.
6. **Der Worker ist klein und lesbar.** Er gibt dem Modell nur Tags, Text, Länge und Sprache weiter, jeweils
   geprüft und gekürzt. Nie Dateipfade, Modellnamen oder Adressen aus dem Internet. Er folgt keinen Weiterleitungen
   (das Token kann nirgends anders landen), führt keine Befehle aus und schreibt das Token nie ins Log.
7. **Geheimnisse bleiben bei dir.** Das Token liegt nur in `worker.json` (nur dein Windows-Konto darf sie lesen).
   Die Webseite kennt nur dessen SHA-256-Hash (`YSOUND_WORKER_TOKEN_SHA256`). Auch wenn Railway-Variablen
   irgendwann leaken, ist das Token nicht dabei. Tausche den Hash bei Railway aus, ist das alte Token sofort tot.
8. **Die Webseite prüft alles zurück.** Hochgeladenes muss echtes Audio und klein genug sein. Aufträge, die ewig
   hängen, werden nach 25 Minuten als fehlgeschlagen markiert.
9. **Schonung.** Immer nur ein Song gleichzeitig, kleine Pause dazwischen, das Modell läuft mit niedriger Priorität.

**Ehrlich zu den Grenzen:** `netguard.py` ist ein Sicherheitsnetz, keine Mauer gegen absichtlich bösartigen Code. Die
Mauer ist die Firewall-Regel aus `harden.ps1`. Ohne sie bleibt das Restrisiko: ein manipuliertes Paket
oder Modell könnte versuchen, Dateien deines Benutzerkontos zu lesen. Mit festgenagelten Versionen und Hash-Prüfung
ist das unwahrscheinlich, ausgeschlossen ist es nie. Ein eigenes Windows-Konto ohne Zugriff auf deine Dateien wäre
die nächste Stufe; das ist mit Python-Umgebung und Grafikkarte aufwendig und hier nicht eingerichtet.

## Einrichten (einmalig, ist auf diesem PC schon gemacht)

```powershell
# 1. ACE-Step-Code (festgenagelter Commit) und Umgebung
git clone https://github.com/ACE-Step/ACE-Step-1.5.git %USERPROFILE%\ysound-ai\ACE-Step-1.5
cd %USERPROFILE%\ysound-ai\ACE-Step-1.5 ; git checkout ca1e85fe9430
uv python install 3.12                                  # eigenes Python nur fürs Modell (nötig für die Firewall-Regel)
uv sync --frozen --python-preference only-managed

# 2. Modell-Dateien (ca. 6,3 GB, hash-geprüft)
python download_model.py

# 3. Geheimnisse anlegen; zeigt den Hash für Railway
python worker.py --init --site https://nexai.up.railway.app
#    -> bei Railway die Variable YSOUND_WORKER_TOKEN_SHA256 setzen (nur der Hash, kein Geheimnis)

# 4. Optional, einmal als Administrator: Netz fürs Modell sperren
powershell -ExecutionPolicy Bypass -File harden.ps1
```

## Benutzen

* **Starten:** `start-ysound.bat` doppelklicken. Beim ersten Mal lädt das Modell einige Minuten.
  Solange das Fenster offen ist, werden Songs gemacht. **Schließen oder Strg+C beendet alles.**
* **Prüfen:** `python worker.py --check` zeigt, ob Modell und Webseite erreichbar sind und das Token stimmt.
* **Log des Modells:** `%USERPROFILE%\ysound-ai\model-server.log`.

## Entfernen

1. Bei Railway `YSOUND_WORKER_TOKEN_SHA256` löschen (ysound ist dann wieder "nicht eingerichtet").
2. `powershell -ExecutionPolicy Bypass -File harden.ps1 -Remove` (als Administrator), falls benutzt.
3. Den Ordner `%USERPROFILE%\ysound-ai` löschen.

## Kosten und Grenzen

Keine Gebühren, nur Strom. Dauer pro Song auf einer 4-GB-Karte: siehe unten, wird gemessen und hier eingetragen.
Bis zu `YSOUND_MAX_QUEUE` (3) Songs können gleichzeitig warten, `YSOUND_PER_HOUR` (6 pro Gerät) und
`YSOUND_DAILY_CAP` (100 pro Tag) begrenzen die Last auch ohne Kosten.
