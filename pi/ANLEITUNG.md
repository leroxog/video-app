# Raspberry Pi 5 als Helfer zu Hause

Der Pi macht zwei Dinge für Satürn. Die Hauptseite bleibt auf dem Vultr-Server.

1. **Sicherungen:** jede Nacht holt er die Datenbank-Sicherung vom Server und behält 30 Tage. Das ist eine zweite Kopie, falls beim Server etwas passiert.
2. **Wächter:** alle 5 Minuten prüft er, ob die Seite antwortet, und schickt dir eine Nachricht aufs Handy, wenn nicht.

Der Pi ruft den Server an, nicht umgekehrt. Am Router wird nichts freigegeben, und niemand sieht deine Adresse.

## 1. Pi vorbereiten (einmalig)

Raspberry Pi OS (64 Bit) installieren, mit Netzwerk verbinden und anmelden (am Pi oder per SSH). Dann Zeile für Zeile:

```bash
sudo apt-get update && sudo apt-get install -y rsync curl
mkdir -p ~/saturn && cd ~/saturn
curl -fsSLO https://raw.githubusercontent.com/leroxog/video-app/master/pi/backup_pull.sh
curl -fsSLO https://raw.githubusercontent.com/leroxog/video-app/master/pi/check_site.sh
ssh-keygen -t ed25519 -N "" -f ~/.ssh/saturn_backup
cat ~/.ssh/saturn_backup.pub
```

Die letzte Zeile zeigt eine lange Zeile, die mit `ssh-ed25519` beginnt. Das ist der **öffentliche** Schlüssel. Er ist kein Geheimnis. Schick sie mir oder trag sie selbst ein (Schritt 2).

## 2. Den Schlüssel auf dem Server erlauben (nur lesen)

Auf dem Server, in /opt/saturn, wird die Zeile so eingetragen, dass der Pi **nur den Ordner der Sicherungen lesen** darf und sonst nichts:

```bash
echo 'command="rrsync -ro /var/backups/saturn",restrict ssh-ed25519 AAAA...DEIN-SCHLUESSEL pi' >> ~/.ssh/authorized_keys
```

(`ssh-ed25519 AAAA...` ist deine Zeile aus Schritt 1.)

## 3. Testen und einplanen

Auf dem Pi:

```bash
sh ~/saturn/backup_pull.sh
```

Es muss `ok: ... Sicherungen` erscheinen. Dann die Zeitpläne eintragen (`crontab -e`):

```
30 3 * * *  sh /home/pi/saturn/backup_pull.sh >> /home/pi/saturn/backup.log 2>&1
*/5 * * * *  SATURN_NTFY_TOPIC=saturn-dein-geheimer-name sh /home/pi/saturn/check_site.sh
```

Für die Nachrichten aufs Handy die App **ntfy** installieren und das Thema `saturn-dein-geheimer-name` abonnieren (nimm einen eigenen, schwer zu erratenden Namen).

## Später möglich

- Videos auf dem Pi klein rechnen (FFmpeg) statt bei Bunny, wenn Bunny zu teuer wird.
- Eine kleine KI auf dem Pi für einfache Aufgaben (der Pi 5 mit 6 GB schafft nur kleine Modelle).
