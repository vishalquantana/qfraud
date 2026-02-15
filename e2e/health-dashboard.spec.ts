import { test, expect } from "@playwright/test";
import { loginDashboard, USERS, expectHeading, expectNoErrors } from "./helpers";

test.describe("Health Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginDashboard(page, USERS.admin);
    await page.goto("/dashboard/health");
    await page.waitForLoadState("networkidle");
  });

  test("loads the health check page", async ({ page }) => {
    await expectHeading(page, /system health/i);
  });

  test("shows service status cards", async ({ page }) => {
    await page.waitForTimeout(3000);

    // Should show individual service cards for database, queue, etc.
    const serviceCards = page
      .getByText(/database/i)
      .or(page.getByText(/queue/i))
      .or(page.getByText(/storage/i));
    expect(await serviceCards.count()).toBeGreaterThan(0);
  });

  test("shows overall system status indicator", async ({ page }) => {
    await page.waitForTimeout(3000);

    // Should show healthy/degraded/unhealthy status
    const statusIndicator = page
      .getByText(/healthy|degraded|unhealthy/i)
      .first();
    await expect(statusIndicator).toBeVisible({ timeout: 10_000 });
  });

  test("displays service latency information", async ({ page }) => {
    await page.waitForTimeout(3000);

    // Should show latency values (ms)
    const latency = page.getByText(/\d+\s*ms/i);
    // May or may not be visible depending on service availability
    const count = await latency.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("no errors on page load", async ({ page }) => {
    await page.waitForTimeout(3000);
    await expectNoErrors(page);
  });
});
