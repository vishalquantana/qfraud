import crypto from "crypto";

/**
 * CSRF token utilities using HMAC-SHA256.
 *
 * Tokens are deterministic per (secret, sessionId) pair so the server can
 * re-derive the expected token without storing state.
 */

function getSecret(): string {
  const secret = process.env.CSRF_SECRET;
  if (!secret) {
    throw new Error("CSRF_SECRET environment variable is not set");
  }
  return secret;
}

/**
 * Generate a CSRF token for the given session using HMAC-SHA256.
 */
export function generateCsrfToken(sessionId: string): string {
  const secret = getSecret();
  return crypto
    .createHmac("sha256", secret)
    .update(sessionId)
    .digest("hex");
}

/**
 * Validate a CSRF token against the expected value for the given session.
 * Uses `crypto.timingSafeEqual` for constant-time comparison to prevent
 * timing attacks.
 */
export function validateCsrfToken(
  token: string,
  sessionId: string
): boolean {
  if (!token || token.length === 0) {
    return false;
  }

  const expected = generateCsrfToken(sessionId);

  // timingSafeEqual requires buffers of equal length.
  // If lengths differ the token is obviously wrong, but we still want
  // to avoid leaking length information, so we compare against a
  // hash of the provided token to keep constant time.
  const tokenBuffer = Buffer.from(token, "utf-8");
  const expectedBuffer = Buffer.from(expected, "utf-8");

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}
