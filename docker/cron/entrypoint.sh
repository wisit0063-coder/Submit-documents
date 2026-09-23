#!/bin/sh
# Writes the crontab from the environment, then runs crond in the foreground.
set -e

if [ -z "$CRON_TOKEN" ]; then
  echo "[cron] CRON_TOKEN is not set; refusing to start" >&2
  exit 1
fi

# The token goes to a root-only file, not onto the crontab line: crond logs the
# commands it runs, and tokens must never reach a log (CLAUDE.md section 11).
umask 077
mkdir -p /run/cron
printf '%s' "$CRON_TOKEN" > /run/cron/token
printf '%s' "${REMINDER_URL:-http://api:3000/api/cron/reminders}" > /run/cron/url

SCHEDULE="${REMINDER_SCHEDULE:-0 8 * * *}"
echo "$SCHEDULE /usr/local/bin/reminders.sh" > /etc/crontabs/root

echo "[cron] reminders scheduled at '$SCHEDULE' ($TZ)"
exec crond -f -l 6
