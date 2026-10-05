import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * Single Prisma instance. Shared hosting gives us very few DB connections,
 * so the client is created once per process and reused.
 */
export const prisma = new PrismaClient({
  log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  // Applies to every prisma.$transaction() call, so the money paths in
  // approval/payment do not have to repeat it. See env.ts for why the defaults
  // are not enough once the database is remote.
  transactionOptions: {
    maxWait: env.dbTransactionMaxWaitMs,
    timeout: env.dbTransactionTimeoutMs,
  },
});

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
