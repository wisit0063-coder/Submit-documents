import type { NotificationChannel } from './channel';
import { env } from '../config/env';

/** Development fallback: prints what would have been sent. Never logs credentials. */
export const logChannel: NotificationChannel = {
  name: 'log',
  isEnabled: () => env.mailDriver !== 'smtp',
  async send(message) {
    console.info(
      `[notify] to=${message.email ?? message.userId} subject=${message.subject}` +
        (message.link ? ` link=${message.link}` : ''),
    );
  },
};
