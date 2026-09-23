import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * Single Prisma instance. Shared hosting gives us very few DB connections,
 * so the client is created once per process and reused.
 */
export const prisma = new PrismaClient({
  log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
});

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
