#!/bin/sh
# Raspberry Pi: holt jede Nacht die Sicherungen der Datenbank vom Satürn-Server und behält die letzten 30 Tage.
# Der Pi ruft den Server an (nur ausgehend): am Router muss nichts freigegeben werden, und niemand erfährt deine Heim-Adresse.
#   30 3 * * *  sh /home/pi/saturn/backup_pull.sh >> /home/pi/saturn/backup.log 2>&1
set -eu
SERVER="${SATURN_SERVER:-root@80.240.27.242}"
DIR="${SATURN_BACKUPS:-/home/pi/saturn/backups}"
KEY="${SATURN_KEY:-/home/pi/.ssh/saturn_backup}"
mkdir -p "$DIR"
rsync -a --partial -e "ssh -i $KEY -o KexAlgorithms=curve25519-sha256 -o StrictHostKeyChecking=accept-new" "$SERVER:" "$DIR/"
find "$DIR" -name 'satuern-*.sql.gz' -mtime +30 -delete
LAST=$(ls -1 "$DIR"/satuern-*.sql.gz 2>/dev/null | tail -1)
[ -n "$LAST" ] && gzip -t "$LAST"
echo "$(date '+%F %T') ok: $(ls -1 "$DIR"/satuern-*.sql.gz | wc -l) Sicherungen, neueste $(basename "$LAST") ($(du -h "$LAST" | cut -f1))"
