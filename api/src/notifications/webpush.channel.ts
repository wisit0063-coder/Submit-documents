import webpush from 'web-push';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import type { NotificationChannel } from './channel';
import type { PushContent } from './push-policy';

/**
 * Popup notifications through the browser vendors' push services (Web Push).
 *
 * Only messages that carry a `push` payload are sent here. Everything else the
 * dispatcher handles - new-account emails with a temporary password, sign-up
 * results, refund notices - stays email-only on purpose: a popup can land on a
 * screen other people can see, and the owner chose a short list of events for
 * it (push-policy.ts).
 */

/** How long a push service holds a message for a browser that is closed. */
const TTL_SECONDS = 3 * 24 * 60 * 60;
/** A hung push service must not hold up the approval that triggered it. */
const SEND_TIMEOUT_MS = 10_000;

let state: 'unknown' | 'ready' | 'off' = 'unknown';

function ready(): boolean {
  if (state !== 'unknown') return state === 'ready';
  if (!env.vapid.publicKey || !env.vapid.privateKey) {
    state = 'off';
    return false;
  }
  try {
    webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);
    state = 'ready';
  } catch (error) {
    // A malformed key would otherwise throw on every single send. Say so once,
    // without echoing the key, and treat the channel as switched off.
    console.error('[notify:webpush] VAPID keys rejected:', error instanceof Error ? error.message : error);
    state = 'off';
  }
  return state === 'ready';
}

export function pushPublicKey(): string | null {
  return ready() ? env.vapid.publicKey : null;
}

export interface PushOutcome {
  devices: number;
  delivered: number;
  removed: number;
}

/**
 * Sends one popup to every browser a person has allowed. Never throws: like
 * every channel, a dead push service must not undo an approval that committed.
 */
export async function sendPushToUser(
  userId: bigint,
  content: PushContent,
  link: string,
): Promise<PushOutcome> {
  const outcome: PushOutcome = { devices: 0, delivered: 0, removed: 0 };
  if (!ready()) return outcome;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  outcome.devices = subscriptions.length;
  if (subscriptions.length === 0) return outcome;

  const payload = JSON.stringify({ ...content, url: link });

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          payload,
          {
            TTL: TTL_SECONDS,
            urgency: 'normal',
            // The push service drops an undelivered message when a newer one
            // with the same topic arrives, so a closed laptop wakes to one
            // popup per claim rather than a backlog.
            topic: content.tag,
            timeout: SEND_TIMEOUT_MS,
          },
        );
        outcome.delivered += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404 and 410 mean the browser revoked permission, was reinstalled, or
        // the subscription simply expired. Keeping the row would retry a dead
        // address on every claim forever.
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: subscription.endpoint } });
          outcome.removed += 1;
          return;
        }
        // The status code only: the payload and the endpoint stay out of logs.
        console.error(`[notify:webpush] user=${userId} send failed status=${status ?? 'network'}`);
      }
    }),
  );

  console.info(
    `[notify:webpush] user=${userId} devices=${outcome.devices} delivered=${outcome.delivered} removed=${outcome.removed}`,
  );
  return outcome;
}

export const webPushChannel: NotificationChannel = {
  name: 'webpush',
  isEnabled: () => ready(),
  async send(message) {
    if (!message.push) return;
    await sendPushToUser(message.userId, message.push, message.link ?? '/');
  },
};
