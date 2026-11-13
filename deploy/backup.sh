#!/bin/sh
# A copy of the database, every night (cron): one file per day on this server (the last 7 stay), and, when BACKUP_BUCKET and the keys are set in .env,
# also to an R2 bucket (the last 14 stay there).
#   0 3 * * *  cd /opt/saturn && sh deploy/backup.sh >> /var/log/saturn-backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
STAMP=$(date +%Y-%m-%d)
DIR=/var/backups/saturn
mkdir -p "$DIR"
FILE="$DIR/satuern-$STAMP.sql.gz"
docker compose exec -T db pg_dump -U satuern satuern | gzip > "$FILE"
find "$DIR" -name 'satuern-*.sql.gz' -mtime +7 -delete
if [ -n "${BACKUP_BUCKET:-}" ] && [ -n "${BACKUP_ENDPOINT:-}" ]; then
  export AWS_ACCESS_KEY_ID="$BACKUP_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
  docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -v "$DIR":/b amazon/aws-cli --endpoint-url "$BACKUP_ENDPOINT" s3 cp "/b/satuern-$STAMP.sql.gz" "s3://$BACKUP_BUCKET/satuern-$STAMP.sql.gz"
  OLD=$(date -d "14 days ago" +%Y-%m-%d 2>/dev/null || true)
  if [ -n "$OLD" ]; then
    docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION amazon/aws-cli --endpoint-url "$BACKUP_ENDPOINT" s3 rm "s3://$BACKUP_BUCKET/satuern-$OLD.sql.gz" || true
  fi
fi
echo "backup $STAMP done: $(du -h "$FILE" | cut -f1)"
