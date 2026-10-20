/**
 * Clawback arithmetic for a payment row.
 *
 * Kept in a module that imports nothing so the rules can be tested without a
 * DATABASE_URL, the same reason the visibility rule lives in config/authz.ts.
 *
 * The numbers arrive as Prisma Decimal values, which is why everything goes
 * through Number() rather than being compared directly: Decimal objects are
 * never equal to each other with ===, and a Decimal is not a number.
 */

/** Only the two money columns matter here, in whatever shape they arrive. */
export type RefundableAmounts = {
  amount: unknown;
  refundAmount?: unknown;
};

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** What has already been handed back across every earlier clawback. */
export function refundedSoFar(payment: RefundableAmounts): number {
  return toNumber(payment.refundAmount);
}

/** What the claimant still holds, and so the most a further clawback may take. */
export function outstanding(payment: RefundableAmounts): number {
  return Math.max(0, toNumber(payment.amount) - refundedSoFar(payment));
}

/**
 * True once nothing is left to claw back, which is what flips the claim to
 * REFUNDED and returns the entitlement.
 *
 * A partial clawback - an overpaid rate corrected by a few hundred baht -
 * leaves money in the claimant's hands, so the claim stays PAID and keeps
 * consuming its yearly slot. Only a full one undoes the reimbursement.
 */
export function refundedInFull(payment: RefundableAmounts): boolean {
  const paid = toNumber(payment.amount);
  if (paid <= 0) return true;
  return refundedSoFar(payment) >= paid;
}
