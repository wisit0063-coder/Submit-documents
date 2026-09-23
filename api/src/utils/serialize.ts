import { Prisma } from '@prisma/client';

/**
 * BigInt ids and Decimal money columns are not JSON-serialisable.
 * Every response goes through this so the client always sees
 * ids as strings and money as numbers.
 */
export function serialize<T>(value: T): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return Number(value.toString());
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serialize(val);
    }
    return out;
  }
  return value;
}

export function toBigInt(value: string | number | bigint, field = 'id'): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
}
