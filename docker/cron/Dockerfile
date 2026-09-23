# Daily trigger for POST /api/cron/reminders.
#
# CLAUDE.md forbids timers inside the app (no setInterval, no worker process):
# scheduled work is an HTTP call guarded by a secret header. On cPanel that call
# comes from cPanel cron; under Docker it comes from this container.
FROM alpine:3.20

# tzdata so the schedule is written in Bangkok time rather than UTC.
RUN apk add --no-cache tzdata
ENV TZ=Asia/Bangkok

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY reminders.sh /usr/local/bin/reminders.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh /usr/local/bin/reminders.sh \
 && chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/reminders.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
