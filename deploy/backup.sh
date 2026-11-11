#!/bin/sh
# A copy of the database to an R2 bucket (one file per day, the last 14 stay). Run it every night from cron:
#   0 3 * * *  cd /opt/saturn && sh deploy/backup.sh >> /var/log/saturn-backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
STAMP=$(date +%Y-%m-%d)
FILE="/tmp/satuern-$STAMP.sql.gz"
docker compose exec -T db pg_dump -U satuern satuern | gzip > "$FILE"
export AWS_ACCESS_KEY_ID="$BACKUP_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -v /tmp:/tmp amazon/aws-cli --endpoint-url "$BACKUP_ENDPOINT" s3 cp "$FILE" "s3://$BACKUP_BUCKET/satuern-$STAMP.sql.gz"
rm -f "$FILE"
# remove the copies that are older than 14 days
OLD=$(date -d "14 days ago" +%Y-%m-%d 2>/dev/null || true)
if [ -n "$OLD" ]; then
  docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION amazon/aws-cli --endpoint-url "$BACKUP_ENDPOINT" s3 rm "s3://$BACKUP_BUCKET/satuern-$OLD.sql.gz" || true
fi
echo "backup $STAMP done"
