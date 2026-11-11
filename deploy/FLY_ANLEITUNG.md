# Satürn auf Fly.io (Seite) + Neon (Datenbank) + Bunny (Videos) + R2 (Dateien)

```
Besucher → thesaturnweb.duckdns.org  (oder deinname.fly.dev)
              └─ Fly.io: Satürn (1 kleine Maschine, immer an, HTTPS automatisch)
                    ├─ Neon: PostgreSQL-Datenbank
                    ├─ Bunny Stream: Videos (klein gerechnet)
                    └─ Cloudflare R2: Bilder, Sticker, Songs
```

Alles, was Geheimnis ist (Schlüssel, Passwörter), tippst du selbst in das Terminal ein. Schick mir nie die Werte.

## 1. Konten

1. **Fly.io** (fly.io): „Sign up" mit Google oder GitHub. Fly verlangt eine **Zahlungskarte** (Karte oder PayPal, meist nur Kartenland und Postleitzahl, keine volle Adresse). Eine kleine Maschine kostet etwa 5–8 $ im Monat. Fly hat **keine harte Kostengrenze**, es rechnet nach Verbrauch ab. Schau im Dashboard unter *Billing* gelegentlich nach.
2. **Neon** (neon.tech): „Sign up" mit Google oder GitHub (kostet am Anfang nichts, 0,5 GB). Lege ein **Projekt** an (Name `saturn`, Region Frankfurt). Auf der Projektseite steht **„Connection string"**: kopiere ihn (er beginnt mit `postgresql://` und ist ein Geheimnis).
3. **Bunny.net**: wie in `ANLEITUNG.md` Abschnitt 1 (Library mit nur 480p/360p/240p und **MP4 Fallback** an; Library-ID, API-Key, CDN-Hostname merken).
4. **Cloudflare R2**: derselbe Bucket wie auf Railway (gleiche Zugangsdaten).

## 2. Fly-Programm auf deinem Windows-Rechner installieren

PowerShell öffnen (Startmenü → „PowerShell") und einfügen:

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

Dann PowerShell schließen und neu öffnen, und anmelden:

```powershell
fly auth login
```

(Es öffnet sich der Browser; du bestätigst mit deinem Fly-Konto.)

## 3. Die Seite auf Fly anlegen

Im Ordner des Projekts (`C:\Users\oraks\Documents\scr\video-app`):

```powershell
cd C:\Users\oraks\Documents\scr\video-app
fly launch --no-deploy --copy-config --name thesaturnweb-app --region fra
```

(`thesaturnweb-app` muss auf Fly einmalig sein. Ist er vergeben, nimm einen anderen Namen. Auf die Fragen nach Postgres, Redis usw. antwortest du mit **Nein**.)

## 4. Geheimnisse eintragen

Diese Zeile mit **deinen** Werten (ersetze nur den Text hinter `=`; die gleichen Werte wie bei Railway). Du kannst sie in mehreren Zeilen einfügen:

```powershell
fly secrets set SECRET_KEY="..." YIPI_ADMINS="lerox" DATABASE_URL="postgresql://..neon.." 
fly secrets set R2_ACCOUNT_ID="..." R2_ACCESS_KEY_ID="..." R2_SECRET_ACCESS_KEY="..." R2_BUCKET_NAME="..." R2_PUBLIC_URL="..."
fly secrets set BUNNY_LIBRARY_ID="..." BUNNY_API_KEY="..." BUNNY_CDN_HOST="vz-....b-cdn.net" BUNNY_HEIGHT="480"
fly secrets set GROQ_API_KEY="..." POLLINATIONS_API_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_PUBLIC_KEY="..." VAPID_SUBJECT="..." 
fly secrets set IMPRESSUM_NAME="..." IMPRESSUM_ADDRESS="..." IMPRESSUM_EMAIL="..."
```

Wichtig: `SECRET_KEY` ist derselbe wie auf Railway, sonst werden alle abgemeldet. Die Datenbank in `DATABASE_URL` ist leer, bis du sie im nächsten Schritt füllst.

## 5. Datenbank von Railway nach Neon kopieren

Auf Railway beim Postgres die **öffentliche** Adresse (`DATABASE_PUBLIC_URL`) kopieren. Dann im Projektordner (Python muss installiert sein, ist es bei dir):

```powershell
python scripts\copy_database.py "RAILWAY_ADRESSE" "NEON_ADRESSE"
```

Am Ende steht `done: ... rows copied`. Die alte Datenbank wird nur gelesen.

## 6. Starten

```powershell
fly deploy
fly status
fly logs
```

Nach ein, zwei Minuten läuft die Seite unter `https://thesaturnweb-app.fly.dev`. Sie darf nur **eine** Maschine haben:

```powershell
fly scale count 1
```

## 7. Mit deinem DuckDNS-Namen

1. `fly ips allocate-v4` (kostet ca. 2 $ im Monat; ohne feste IPv4 geht der eigene Name nicht) und `fly ips list`: dort stehen die IPv4- und IPv6-Adresse.
2. Auf duckdns.org bei `thesaturnweb` die **IPv4** bei „current ip" und die **IPv6** bei „ipv6" eintragen (beide „update").
3. `fly certs add thesaturnweb.duckdns.org` (Fly holt das HTTPS-Zertifikat; mit `fly certs show thesaturnweb.duckdns.org` siehst du, wann es fertig ist).

Alternativ bleibst du bei `thesaturnweb-app.fly.dev`, das kostet nichts extra und geht sofort.

## 8. Videos nach Bunny

```powershell
fly ssh console -C "python scripts/migrate_to_bunny.py 5"
fly ssh console -C "python scripts/migrate_to_bunny.py"
```

## 9. Aktualisieren

Nach jedem neuen Code (das mache ich dir bereit): im Projektordner `fly deploy`.

## Kosten (ungefähr)

Maschine 5–8 $, IPv4 2 $, Neon 0 $ (bis 0,5 GB), Bunny wenige Cent pro GB, R2 gratis bis 10 GB. Zusammen etwa 8–12 $ im Monat.

## Wenn etwas nicht geht

- `fly logs` zeigt die Fehler der Seite. `fly status` zeigt, ob die Maschine läuft.
- Die Seite ist langsam beim ersten Aufruf: Neon schläft nach Leerlauf kurz ein und wacht beim ersten Zugriff wieder auf.
- Abgemeldet nach dem Umzug: `SECRET_KEY` war nicht derselbe wie auf Railway.
- Der DuckDNS-Name zeigt nicht: `fly certs show thesaturnweb.duckdns.org`; stehen IPv4 und IPv6 bei DuckDNS richtig?
