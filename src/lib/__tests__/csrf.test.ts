import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Stub CSRF_SECRET env var before importing the module
// ---------------------------------------------------------------------------
const TEST_SECRET = "test-csrf-secret-key-for-unit-tests";

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", TEST_SECRET);
});

import { generateCsrfToken, validateCsrfToken } from "@/lib/csrf";

describe("generateCsrfToken", () => {
  it("generates a token for a session", () => {
    const token = generateCsrfToken("session-abc-123");

    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("generates the same token for the same session (deterministic)", () => {
    const token1 = generateCsrfToken("session-abc-123");
    const token2 = generateCsrfToken("session-abc-123");

    expect(token1).toBe(token2);
  });

  it("generates different tokens for different sessions", () => {
    const token1 = generateCsrfToken("session-abc-123");
    const token2 = generateCsrfToken("session-xyz-789");

    expect(token1).not.toBe(token2);
  });

  it("produces a valid hex-encoded HMAC-SHA256 token", () => {
    const token = generateCsrfToken("session-abc-123");

    // HMAC-SHA256 in hex = 64 characters
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("validateCsrfToken", () => {
  it("validates a correct token and returns true", () => {
    const token = generateCsrfToken("session-abc-123");
    const result = validateCsrfToken(token, "session-abc-123");

    expect(result).toBe(true);
  });

  it("rejects an incorrect token", () => {
    const result = validateCsrfToken("invalid-token-value", "session-abc-123");

    expect(result).toBe(false);
  });

  it("rejects an empty token", () => {
    const result = validateCsrfToken("", "session-abc-123");

    expect(result).toBe(false);
  });

  it("rejects a token from a different session", () => {
    const token = generateCsrfToken("session-abc-123");
    const result = validateCsrfToken(token, "session-xyz-789");

    expect(result).toBe(false);
  });

  it("uses timing-safe comparison (calls crypto.timingSafeEqual)", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    const token = generateCsrfToken("session-abc-123");

    validateCsrfToken(token, "session-abc-123");

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
