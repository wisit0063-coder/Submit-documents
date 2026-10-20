/**
 * Which addresses the server will deliver a push to.
 *
 * A subscription's endpoint is a URL the browser supplies, and the server later
 * makes an HTTPS request to it. Taken on trust, that lets any signed-in user
 * register http://db:5432 or a cloud metadata address and have the API call it
 * on their behalf every time a claim moves (server-side request forgery). Real
 * endpoints only ever live on the browser vendors' push services, so anything
 * else is refused at the door.
 *
 * Imports nothing, so it is testable without a database.
 */

/** Hosts the major browsers hand out, exact or as a suffix after a dot. */
const PUSH_SERVICE_HOSTS: readonly string[] = [
  'fcm.googleapis.com', // Chrome, and Edge on Android
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com', // Safari, including iPhone home-screen apps
  'notify.windows.com', // Edge on Windows: wns2-<region>.notify.windows.com
];

/** Real endpoints are a few hundred characters; this is generous headroom. */
export const MAX_ENDPOINT_LENGTH = 1000;

export function isAllowedPushEndpoint(raw: string): boolean {
  if (raw.length > MAX_ENDPOINT_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // Push services are HTTPS on the default port, with no credentials in the URL.
  if (url.protocol !== 'https:') return false;
  if (url.port !== '') return false;
  if (url.username !== '' || url.password !== '') return false;

  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
