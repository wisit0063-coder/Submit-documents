#!/bin/sh
# One reminder run. Also callable by hand:
#   docker compose exec cron reminders.sh
TOKEN=$(cat /run/cron/token)
URL=$(cat /run/cron/url)

echo "[cron] $(date '+%Y-%m-%d %H:%M:%S %Z') POST $URL"
if wget -q -O - -T 60 --header "X-Cron-Token: $TOKEN" --post-data '' "$URL"; then
  echo
  echo "[cron] reminder run finished"
else
  echo "[cron] reminder run FAILED" >&2
  exit 1
fi
