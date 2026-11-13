#!/bin/sh
# Raspberry Pi: schaut alle 5 Minuten, ob Satürn antwortet. Fällt die Seite aus (zweimal hintereinander), kommt eine Nachricht aufs Handy (ntfy.sh, ohne Konto).
#   */5 * * * *  sh /home/pi/saturn/check_site.sh
URL="${SATURN_URL:-https://thesaturnweb.duckdns.org/}"
TOPIC="${SATURN_NTFY_TOPIC:-}"          # zum Beispiel saturn-dein-geheimer-name (in der App ntfy abonnieren)
STATE=/tmp/saturn_down
if curl -fsS -m 20 -o /dev/null "$URL"; then
  [ -f "$STATE" ] && [ -n "$TOPIC" ] && curl -s -d "Satürn ist wieder da" "https://ntfy.sh/$TOPIC" >/dev/null
  rm -f "$STATE"
else
  if [ -f "$STATE" ]; then
    [ -n "$TOPIC" ] && [ "$(cat "$STATE")" = "1" ] && curl -s -H "Priority: high" -d "Satürn antwortet nicht" "https://ntfy.sh/$TOPIC" >/dev/null && echo 2 > "$STATE"
  else
    echo 1 > "$STATE"
  fi
fi
