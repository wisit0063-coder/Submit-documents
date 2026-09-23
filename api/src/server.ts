import { createApp } from './app';
import { assertProductionSecrets, env } from './config/env';
import { prisma } from './config/prisma';

// Business logic always works in UTC; this only affects log formatting.
process.env.TZ = process.env.TZ ?? env.timezone;

// Fail here rather than serve requests signed with a secret from the repository.
assertProductionSecrets();

const app = createApp();

// Passenger supplies the port. Never hard-code one.
const server = app.listen(env.port, () => {
  console.info(`[api] listening on port ${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal: string) {
  console.info(`[api] ${signal} received, closing`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { app, server };
