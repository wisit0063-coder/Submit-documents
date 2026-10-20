import { prisma } from '../config/prisma';
import { sendPushToUser } from '../notifications/webpush.channel';
import type { SubscribePushInput } from '../validators/push.schema';

/**
 * Enough for a desk machine, a laptop, a phone and a few old browsers. Past it
 * the oldest are dropped, so an account shared around for a demo cannot grow
 * the table without bound.
 */
const MAX_DEVICES_PER_USER = 10;

/**
 * Remembers where to deliver this person's popups.
 *
 * Keyed on the endpoint, which belongs to one browser. When someone else signs
 * in on that browser and allows notifications, the row moves to them: a shared
 * computer shows popups for whoever is signed in, never for two people at once.
 */
export async function subscribe(userId: bigint, input: SubscribePushInput, userAgent: string | null) {
  const agent = userAgent ? userAgent.slice(0, 255) : null;

  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: agent,
    },
    update: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: agent },
  });

  const surplus = await prisma.pushSubscription.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    skip: MAX_DEVICES_PER_USER,
    select: { id: true },
  });
  if (surplus.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: surplus.map((row) => row.id) } } });
  }

  return { devices: await prisma.pushSubscription.count({ where: { userId } }) };
}

/** Only ever the caller's own row: one person cannot switch off another's popups. */
export async function unsubscribe(userId: bigint, endpoint: string) {
  const { count } = await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  return { removed: count };
}

/**
 * A popup to the caller's own browsers, so they can see that it works - and so
 * the feature can be shown working without walking a claim through the chain.
 */
export function sendTest(userId: bigint) {
  return sendPushToUser(
    userId,
    {
      title: 'ทดสอบการแจ้งเตือน',
      body: 'เครื่องนี้จะได้รับการแจ้งเตือนจากระบบเบิกค่าตอบแทนการตีพิมพ์แล้ว',
      tag: 'test',
    },
    '/',
  );
}
