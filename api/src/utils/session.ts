/**
 * Does a session predate the account's current password?
 *
 * The JWT carries only the account id, and `authenticate` reloads the account
 * on every request - but it only ever asked whether the account was still
 * active. Changing a password therefore did not end sessions already open, so
 * handing a position account to its next holder left the previous one able to
 * act for up to JWT_EXPIRES_IN (8 hours). Since a password stands in for a
 * signature (CLAUDE.md ข้อ 18), that is signing after leaving office.
 *
 * This file imports nothing, so the rule is testable without a database
 * (same reason as config/authz.ts and utils/refund.ts).
 */

/**
 * `iat` is whole seconds, while passwordChangedAt carries milliseconds, so a
 * token minted in the same second as the change would look older than it by up
 * to 999ms and be refused the instant it was issued - which is precisely the
 * token handed back by the login that follows a password change. Comparing
 * whole seconds, and treating the same second as current, avoids locking people
 * out of the credential they just set. A token from the same second as a
 * handover is the new holder's; the old holder's is from before it.
 */
export function isSessionStale(
  issuedAtSeconds: number | undefined,
  passwordChangedAt: Date | null | undefined,
): boolean {
  // Accounts whose password predates this column have nothing to compare
  // against: no invalidation, exactly as before.
  if (!passwordChangedAt) return false;
  // A token with no issue time cannot be shown to be current. Every token the
  // app signs has one, so this is a malformed or hand-made token.
  if (issuedAtSeconds === undefined) return true;
  return issuedAtSeconds < Math.floor(passwordChangedAt.getTime() / 1000);
}
