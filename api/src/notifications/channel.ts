/**
 * Notification transport abstraction.
 *
 * The system must not be wired to one provider: LINE Notify was shut down on
 * 31 March 2025 and anything replacing it (LINE Messaging API, SMS, in-app)
 * only has to implement this interface and register in dispatcher.ts.
 */
export interface NotificationMessage {
  /** Recipient user id, for channels that address people rather than inboxes. */
  userId: bigint;
  email: string | null;
  lineUserId: string | null;
  subject: string;
  /** Plain text body. Channels render their own markup from this. */
  body: string;
  /** Deep link into the SPA, e.g. /requests/12. */
  link?: string;
}

export interface NotificationChannel {
  readonly name: string;
  isEnabled(): boolean;
  send(message: NotificationMessage): Promise<void>;
}
