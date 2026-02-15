import { type Page, expect } from "@playwright/test";

// ─── Test User Credentials ──────────────────────────────
// These match the seed data from prisma/seed.ts

export const USERS = {
  admin: { email: "admin@acme.com", password: "admin123" },
  underwriter: { email: "underwriter@acme.com", password: "uw123" },
  seniorUnderwriter: { email: "senior@acme.com", password: "senior123" },
  siuInvestigator: { email: "siu@acme.com", password: "siu123" },
  broker: { email: "broker@agency.com", password: "broker123" },
};

// ─── Auth Helpers ───────────────────────────────────────

/**
 * Log into the dashboard as a specific user role.
 */
export async function loginDashboard(
  page: Page,
  user: { email: string; password: string },
) {
  await page.goto("/dashboard/login");
  await page.waitForLoadState("networkidle");

  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button[type="submit"]');

  // Wait for navigation away from login page
  await page.waitForURL(/\/dashboard(?!\/login)/, { timeout: 10_000 });
}

/**
 * Log into the broker portal.
 */
export async function loginPortal(
  page: Page,
  user: { email: string; password: string } = USERS.broker,
) {
  await page.goto("/portal/login");
  await page.waitForLoadState("networkidle");

  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button[type="submit"]');

  // Wait for navigation away from login page
  await page.waitForURL(/\/portal(?!\/login)/, { timeout: 10_000 });
}

// ─── Navigation Helpers ─────────────────────────────────

/**
 * Navigate to a dashboard page via sidebar link text.
 */
export async function navigateTo(page: Page, linkText: string) {
  await page.getByRole("link", { name: linkText }).click();
  await page.waitForLoadState("networkidle");
}

/**
 * Wait for a toast/notification message to appear.
 */
export async function waitForToast(page: Page, textPattern: string | RegExp) {
  const pattern =
    typeof textPattern === "string" ? new RegExp(textPattern, "i") : textPattern;
  await expect(page.getByRole("status").or(page.getByRole("alert"))).toContainText(pattern, {
    timeout: 5000,
  });
}

// ─── Assertion Helpers ──────────────────────────────────

/**
 * Assert the page title/heading contains expected text.
 */
export async function expectHeading(page: Page, text: string | RegExp) {
  await expect(page.getByRole("heading", { level: 1 })).toContainText(text);
}

/**
 * Assert no error messages are visible on the page.
 */
export async function expectNoErrors(page: Page) {
  const errorAlerts = page.getByRole("alert");
  const count = await errorAlerts.count();
  // Allow informational alerts, but check none contain "error" or "failed"
  for (let i = 0; i < count; i++) {
    const text = await errorAlerts.nth(i).textContent();
    expect(text?.toLowerCase()).not.toMatch(/error|failed|unexpected/);
  }
}
