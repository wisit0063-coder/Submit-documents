/**
 * Clawback arithmetic, mirroring api/src/utils/refund.ts. The server decides;
 * this copy only decides what to draw, so the two must agree.
 *
 * It exists because a partial refund is not the end of the story: money may
 * still be outstanding, and the screen has to keep offering the rest.
 */
type RefundableAmounts = {
  amount: number;
  refundAmount?: number | null;
};

export function refundedSoFar(payment: RefundableAmounts): number {
  return Number(payment.refundAmount ?? 0);
}

/** What the claimant still holds, and so the most a further clawback may take. */
export function outstanding(payment: RefundableAmounts): number {
  return Math.max(0, Number(payment.amount) - refundedSoFar(payment));
}
