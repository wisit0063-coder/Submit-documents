import { api } from '@/lib/api';

/**
 * Popup notifications in the corner of the screen (Web Push, CLAUDE.md ข้อ 10).
 *
 * The browser hands out an address for this device when someone allows
 * notifications; the server keeps it and delivers to it later, even with the
 * site closed. Everything here is about getting that address to the server for
 * whoever is signed in - and taking it back when they sign out.
 */

export type PushState =
  /** This browser cannot do Web Push at all. */
  | 'unsupported'
  /** Push needs HTTPS. localhost counts; http://<LAN address> does not. */
  | 'insecure'
  /** The server has no keys configured, so nothing would ever arrive. */
  | 'unavailable'
  /** The person clicked "Block". Only the browser's own settings undo that. */
  | 'denied'
  | 'off'
  | 'on';

export function pushSupport(): 'unsupported' | 'insecure' | 'ok' {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (!window.isSecureContext) return 'insecure';
  return 'ok';
}

/**
 * A remembered "no thanks" per account. Permission is per browser, not per
 * person, so without this anyone who switched popups off would get them back
 * the next time they signed in on a browser that had once allowed them.
 */
const optOutKey = (userId: string) => `cpru-push-off:${userId}`;

function optedOut(userId: string): boolean {
  try {
    return window.localStorage.getItem(optOutKey(userId)) === '1';
  } catch {
    return false;
  }
}

function setOptedOut(userId: string, value: boolean) {
  try {
    if (value) window.localStorage.setItem(optOutKey(userId), '1');
    else window.localStorage.removeItem(optOutKey(userId));
  } catch {
    // Private windows may refuse storage; the choice then lasts one session.
  }
}

/** The server's public key arrives as URL-safe base64; the browser wants bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = window.atob(padded);
  // Backed by a plain ArrayBuffer, which is what subscribe() accepts.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function serverKey(): Promise<string | null> {
  const { publicKey } = await api.get<{ publicKey: string | null }>('/push/public-key');
  return publicKey;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/** Where things stand on this browser for this person, without asking anything. */
export async function readPushState(userId: string): Promise<PushState> {
  const support = pushSupport();
  if (support !== 'ok') return support;
  if (Notification.permission === 'denied') return 'denied';
  if (!(await serverKey())) return 'unavailable';
  if (Notification.permission !== 'granted' || optedOut(userId)) return 'off';
  const existing = await (await registration()).pushManager.getSubscription();
  return existing ? 'on' : 'off';
}

/**
 * Subscribes this browser and hands the address to the server. Asks for
 * permission only when it has not been given yet, which must happen inside a
 * click: Chrome refuses a permission prompt that a page raises on its own.
 */
export async function enablePush(userId: string): Promise<PushState> {
  const support = pushSupport();
  if (support !== 'ok') return support;

  const key = await serverKey();
  if (!key) return 'unavailable';

  const permission =
    Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';

  const reg = await registration();
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key),
      });
    } catch {
      // Left over from a different server key: drop it and start again.
      const stale = await reg.pushManager.getSubscription();
      await stale?.unsubscribe();
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key),
      });
    }
  }

  await api.post('/push/subscribe', subscription.toJSON());
  setOptedOut(userId, false);
  return 'on';
}

/**
 * Re-binds this browser to whoever just signed in, when it already has
 * permission and that person has not switched popups off here. Never prompts.
 */
export async function syncPush(userId: string): Promise<PushState> {
  const state = await readPushState(userId);
  if (state !== 'off') return state;
  if (Notification.permission !== 'granted' || optedOut(userId)) return 'off';
  return enablePush(userId);
}

/**
 * Stops popups on this browser. `remember` is true when the person switched
 * them off themselves, and false on sign-out - signing out is not saying no.
 */
export async function disablePush(userId: string | null, remember: boolean): Promise<void> {
  if (remember && userId) setOptedOut(userId, true);
  if (pushSupport() !== 'ok') return;

  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;

  try {
    // While still signed in: the server only lets people remove their own rows.
    await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
  } finally {
    // Unsubscribing locally as well means the next person to sign in here
    // starts clean, even if the server call failed.
    await subscription.unsubscribe();
  }
}

export function sendTestPush() {
  return api.post<{ devices: number; delivered: number; removed: number }>('/push/test');
}
