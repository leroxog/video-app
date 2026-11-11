# Satürn auf einem eigenen Server (Hetzner + DuckDNS + Bunny + R2)

So sieht es am Ende aus:

```
Besucher → deinname.duckdns.org → Hetzner-Server
                                    ├─ Caddy (HTTPS, automatisch)
                                    ├─ Satürn (Flask)
                                    └─ Postgres (Datenbank)
Videos  → Bunny Stream (klein gerechnet, 480p/360p)
Dateien → Cloudflare R2 (Bilder, Sticker, Songs, Backups)
```

## 1. Konten (das legst du selbst an)

1. **DuckDNS** (duckdns.org): mit Google oder GitHub anmelden, einen Namen anlegen (z. B. `saturn` → `saturn.duckdns.org`). Den **Token** nur für dich merken.
2. **Hetzner Cloud** (hetzner.com/cloud): Server anlegen, Typ **CX22**, **Ubuntu 24.04**, Standort Nürnberg oder Falkenstein. Die **IPv4-Adresse** notieren.
3. **Bunny.net**: unter *Stream* eine **Video Library** anlegen (z. B. `saturn-videos`). In der Library:
   - *Encoding*: nur **480p** und **360p** (und 240p) einschalten, alles Größere ausschalten.
   - *Encoding* / *MP4 Fallback*: **einschalten** (sonst gibt es keine `play_480p.mp4`).
   - Notieren: **Library ID**, **API Key** (Reiter *API*), **CDN Hostname** (z. B. `vz-xxxxxxxx-xxx.b-cdn.net`).
4. **Cloudflare R2**: den Bucket von Railway weiterbenutzen (gleiche Zugangsdaten). Dazu einen **zweiten Bucket** `satuern-backup` für die Datenbank-Sicherungen und einen Zugangsschlüssel dafür.

## 2. DuckDNS auf den Server zeigen lassen

Auf duckdns.org bei deinem Namen unter **current ip** die IPv4-Adresse von Hetzner eintragen und auf **update ip** klicken.

## 3. Server einrichten (einmalig)

In der Hetzner-Cloud-Konsole beim Server auf **Konsole** klicken (das schwarze Fenster) und anmelden (Benutzer `root`, das Passwort kam per E-Mail). Dann Zeile für Zeile:

```bash
apt-get update && apt-get -y upgrade
curl -fsSL https://get.docker.com | sh
mkdir -p /opt && cd /opt
git clone https://github.com/leroxog/video-app.git saturn
cd saturn
cp deploy/.env.example .env
nano .env
```

Im Editor alles ausfüllen (`SITE_ADDRESS`, `DB_PASSWORD`, `SECRET_KEY`, R2, Bunny, KI-Schlüssel – die gleichen Werte wie auf Railway). Speichern mit `Strg+O`, `Enter`, beenden mit `Strg+X`. Dann:

```bash
docker compose up -d --build
docker compose logs -f app
```

Nach ein, zwei Minuten sollte `https://deinname.duckdns.org` die Seite zeigen (Caddy holt das HTTPS-Zertifikat selbst; die Adresse muss dafür schon auf die Server-IP zeigen).

## 4. Daten von Railway holen (Umzug)

Auf Railway beim Postgres die **öffentliche Verbindungsadresse** (`DATABASE_PUBLIC_URL`) kopieren. Auf dem neuen Server:

```bash
cd /opt/saturn
docker compose exec -T db pg_dump "DIE_RAILWAY_ADRESSE" > /tmp/railway.sql   # falls pg_dump im Container fehlt: siehe unten
docker compose exec -T db psql -U satuern satuern < /tmp/railway.sql
docker compose restart app
```

(Wenn `pg_dump` mit der Version nicht passt: `docker run --rm postgres:16-alpine pg_dump "DIE_RAILWAY_ADRESSE" > /tmp/railway.sql`.)

Die Dateien (Bilder, Sticker, Songs) liegen schon in R2 und müssen nicht umziehen.

## 5. Videos nach Bunny

```bash
docker compose exec app python scripts/migrate_to_bunny.py 5      # erst nur 5 zum Probieren
docker compose exec app python scripts/migrate_to_bunny.py        # dann alle (kann man abbrechen und neu starten)
```

Neue Videos gehen automatisch nach Bunny. Solange Bunny ein Video noch klein rechnet, liefert die Seite die Originaldatei.

## 6. Sicherungen (jede Nacht)

```bash
crontab -e
```

Zeile einfügen:

```
0 3 * * *  cd /opt/saturn && sh deploy/backup.sh >> /var/log/saturn-backup.log 2>&1
```

## 7. Aktualisieren

Wenn es neuen Code gibt (nach einem `git push`):

```bash
cd /opt/saturn && git pull && docker compose up -d --build
```

## 8. Namen wechseln

Bei DuckDNS einen neuen Namen anlegen und die IP eintragen, dann in `.env` bei `SITE_ADDRESS` den neuen Namen eintragen und `docker compose up -d` ausführen. Achtung: Mit einem neuen Namen müssen alle Nutzer sich neu anmelden und Benachrichtigungen neu erlauben.

## Wenn etwas nicht geht

- `docker compose ps` zeigt, was läuft. `docker compose logs app` zeigt Fehler der Seite, `docker compose logs caddy` Fehler beim HTTPS.
- Kein HTTPS: zeigt der DuckDNS-Name wirklich auf die Server-IP? (`ping deinname.duckdns.org`)
- Videos spielen nicht von Bunny: sind `BUNNY_*` in `.env` gesetzt, und ist *MP4 Fallback* in der Library an?
